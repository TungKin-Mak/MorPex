/**
 * 会话视图（浅色聊天应用，会话 17h 重构 + 17i 执行反馈 + 17i.2 切页存活）。
 *
 * 布局：
 *   ┌ 左侧会话侧栏（新对话 + 会话列表 + 每项删除） ┐
 *   ├ 右侧主聊天区：顶部标题/模型下拉/状态/删除 → 消息气泡流 → 底部输入条（上传+附件+输入+发送）
 * 功能：删除会话 / 上传文件（附件随消息提交）/ 模型切换（全局生效）。
 *
 * 17i 执行反馈：占位气泡计时 + SSE 实时任务卡片（步骤/进度）+ 最终任务卡片（可展开时间线）。
 * 17i.2 切页存活：活动运行（SSE 流/计时器/任务态）提升为模块级——切走标签再回来，
 *   从模块状态重建实时任务卡片并续接更新；用户消息已由后端先落库（17i.2 后端），
 *   执行中的会话在侧栏/历史里可见，完成后自动升级为最终任务卡片。
 *
 * 保留既有行为：模块级会话状态跨 tab 存活 + localStorage 恢复 + 后端未就绪 5s 轮询重试。
 */
import type { ApiClient } from '../api/client.js';
import type { AgentSessionEntryMessage, DecisionItem, InstallableWorkflow, MailMessage, TaskProjection } from '../api/types.js';
import { openEventStream, type EventStreamHandle, type StreamEvent } from '../api/sse.js';
import { marked } from 'marked';
import hljs from 'highlight.js/lib/common';

// 17i.25：marked 代码块语法高亮（highlight.js）+ 行号
marked.use({
  renderer: {
    code(token: { text: string; lang?: string; escaped?: boolean }): string {
      const lang = (token.lang ?? '').trim();
      let html: string;
      if (lang && hljs.getLanguage(lang)) {
        try { html = hljs.highlight(token.text, { language: lang }).value; } catch { html = escapeHtml(token.text); }
      } else {
        try { html = hljs.highlightAuto(token.text).value; } catch { html = escapeHtml(token.text); }
      }
      const lineCount = token.text.split('\n').length;
      const gutter = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');
      return `<div class="code-wrap"><pre class="code-gutter">${gutter}</pre><pre class="code-body"><code class="hljs">${html}</code></pre></div>`;
    },
  },
});

/** HTML 转义（代码无高亮回退用）。 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 17i.26：带行号的代码视图（gutter 固定 + 高亮 code）。 */
function buildCodeView(raw: string, lang: string): HTMLElement {
  const lines = raw.split('\n');
  const gutter = el('pre', { class: 'code-gutter' }, Array.from({ length: lines.length }, (_, i) => i + 1).join('\n'));
  let inner = '';
  if (lang && hljs.getLanguage(lang)) {
    try { inner = hljs.highlight(raw, { language: lang }).value; } catch { inner = ''; }
  }
  if (!inner) inner = escapeHtml(raw);
  const pre = el('pre', { class: 'code-view' });
  pre.innerHTML = `<code class="hljs">${inner}</code>`;
  return el('div', { class: 'code-view-wrap' }, [gutter, pre]);
}

/** 17i.25：文件扩展名 → highlight.js 语言。 */
const HLJS_LANG: Record<string, string> = {
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cxx: 'cpp',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', py: 'python', java: 'java', go: 'go',
  rs: 'rust', rb: 'ruby', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash',
  sql: 'sql', json: 'json', html: 'xml', htm: 'xml', css: 'css', scss: 'scss',
  yaml: 'yaml', yml: 'yaml', xml: 'xml', ini: 'ini', toml: 'ini',
};
function langFromExt(ext: string): string {
  return HLJS_LANG[ext.toLowerCase()] ?? '';
}
import type { Child } from '../ui/dom.js';
import { el } from '../ui/dom.js';
import { button, jsonPre } from '../ui/widgets.js';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function tsTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

function tsDate(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 耗时格式化：0:42 / 1:23 / 3s。 */
function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  raw?: unknown;
  meta?: Array<{ k: string; v: string }>;
  error?: boolean;
  /** 17i：任务模式回复 → 渲染为任务卡片（仅本次运行内有效；历史回载无此字段 → 渲染为文本）。 */
  task?: TaskSummary;
  /** P1：Space 归属（任务线程过滤用；历史/空间消息带）。 */
  threadId?: string;
}

interface PendingAttachment {
  fileId: string;
  name: string;
  isText: boolean;
}

// ═══ 任务工作台：全局任务列表（UI 改版）═══
interface TaskListItem {
  /** 列表唯一标识（运行期 task_<runId>；历史恢复 = threadId）。 */
  id: string;
  /** 消息归属线程（missionId），任务聊天按它过滤消息。 */
  threadId?: string;
  /** 关联的 activeRun 序号（仅运行期。 */
  runId?: number;
  sessionId: string;
  title: string;
  goal: string;
  deptId?: string;
  deptName?: string;
  status: 'pending' | 'running' | 'waiting' | 'done' | 'failed';
  /** 步骤进度 '1/3'（无步骤时 ''）。 */
  progress: string;
  /** 完成/失败的一句话结尾（状态行 tooltip）。 */
  result?: string;
  createdAt: number;
  updatedAt: number;
}

// ═══ 17i 任务执行追踪（SSE 实时进度）═══
type StepStatus = 'pending' | 'running' | 'done' | 'failed';

/** 步骤实时输出块（17i.4：从 step-agent 会话条目展平；17i.7 增加结构化字段以美化渲染）。 */
interface StepBlock {
  kind: 'think' | 'tool' | 'result';
  /** 显示用文本（回退 / 思考/结果文本）。 */
  text: string;
  /** tool/result 的工具名。 */
  toolName?: string;
  /** tool 调用的参数（结构化，用于可读卡片）。 */
  toolArgs?: unknown;
  /** result 的内容（结构化，用于可读渲染）。 */
  toolContent?: unknown;
}

interface TaskStep {
  key: string;   // nodeId / 去重键
  name: string;
  status: StepStatus;
  detail?: string;
  /** 17i.4：该步骤 step-agent 会话 jsonl 路径（来自 execution.step.started 的 sessionPath），用于轮询实时输出。 */
  sessionPath?: string;
  /** 已展平的实时输出块（思考/工具调用/结果）。 */
  blocks: StepBlock[];
  /** 17i.9：原始会话条目（完整转录视图数据源；含空消息/指令/时间戳）。 */
  raw: AgentSessionEntryMessage[];
  /** 17i.12：流式文本缓冲（execution.stream.text 增量；终端转录实时显示）。 */
  streamText: string;
  /** 17i.12：流式思考缓冲（execution.stream.think 增量）。 */
  streamThink: string;
  /** 已消费的会话条目 id（轮询去重）。 */
  seen: Set<string>;
  /** 轮询重入保护。 */
  _polling?: boolean;
}

/** 任务摘要（最终卡片 + ChatMsg.task）。 */
interface TaskSummary {
  missionId?: string;
  executionId?: string;
  ok: boolean;
  goal?: string;
  durationMs: number;
  steps: TaskStep[];
  /** 17i.5：失败原因（rec.error），失败卡片直接展示。 */
  error?: string;
  /** 本次运行通过 SSE 捕获的原始事件（「查看实时进度」时间线数据源）。 */
  events: StreamEvent[];
}

/** 17i.17：DAG 节点（编排器真实结构）。 */
interface DagNode {
  id: string;
  name: string;
  deps: string[];
  status: 'pending' | 'running' | 'done' | 'failed';
}

interface DagData {
  nodes: DagNode[];
  edges: Array<{ from: string; to: string }>;
}

/** 运行中追踪状态（仅 send() 生命周期内有效）。 */
interface TaskRunState {
  isTask: boolean;
  missionId?: string;
  executionId?: string;
  goal?: string;
  phase?: string;
  status?: string;
  progress?: number;
  steps: TaskStep[];
  events: StreamEvent[];
  /** 17i.17：编排器生成的 DAG 结构（nodes+deps），前端据此渲染节点图。 */
  dag?: DagData;
  /** 本次任务 DAG 执行 id（首个 workflow/node 事件捕获；web 路径无 DAG 事件，不设置）。 */
  dagId?: string;
  /** 17i.5：本次运行捕获的待审批/已决议条目。 */
  approvals: PendingApprovalItem[];
  /** 17i.15：LLM 自主问用户（ask_user 工具）的待答问题。 */
  asks: RunAsk[];
  /** 17i.22：待确认的规划方案（交互模式暂停等确认；Goal 模式无）。 */
  plan: RunPlan | null;
  done: boolean;
}

/** 17i.15：运行中 LLM 提出的问题（前端拟人对话呈现 + 回答）。 */
interface RunAsk {
  askId: string;
  question: string;
  options?: string[];
  answered?: boolean;
}

/** 17i.22：规划方案（供聊天汇报 + 确认）。 */
interface RunPlan {
  planId: string;
  goal: string;
  planFile: string;
  stepNames: string[];
  confirmed?: boolean;
}

// ═══ 17i.2 模块级「活动运行」：跨 tab 切换存活 ═══
interface ActiveRun {
  /** 运行序号：旧运行完成时凭它判断是否已被新运行接管（防污染）。 */
  runId: number;
  sessionId: string;
  text: string;
  startedAt: number;
  state: TaskRunState;
  done: boolean;
  /** 完成后暂存最终消息（含任务卡片），供回页时立即渲染 / loadHistory 消费。 */
  resultMsg?: ChatMsg;
  /** 17k.1 多任务并发：per-run 计时 span（moduleTick 更新）。 */
  elapsedEl: HTMLElement | null;
  /** 17k.1 多任务并发：per-run 的「按本 run 同步 UI」钩子（实时卡片/完成后重启用例）。 */
  syncHook: (() => void) | undefined;
  /** 17k.1 多任务并发：per-run 流式气泡目标（拟人总结/闲聊打字机）。 */
  chatStreamEl: HTMLElement | null;
  chatStreamStarted: boolean;
  chatLogEl: HTMLElement | null;
}
let runSeq = 0;
/** 17k.1 多任务并发：activeRun 单例 → Map<runId, ActiveRun>（多个任务可同时运行，发送框不锁定）。 */
const activeRuns = new Map<number, ActiveRun>();
/** 最近一次发起发送的 runId（chat.stream.delta 流式归属参考）。 */
let lastSendId = 0;
/** 模块级 SSE 流：跨渲染存活，直到全部运行结束才关闭。 */
let runSse: EventStreamHandle | undefined;
/** 模块级占位计时器。 */
let runTimer: number | undefined;
/** 17i.32/33：闲聊流式输出兜底目标（任务拟人总结实际走 run.chatStreamEl；无 run 时用本容器）。 */
let chatStreamEl: HTMLElement | null = null;
let chatStreamStarted = false;
let chatLogEl: HTMLElement | null = null;

function moduleTick(): void {
  for (const run of activeRuns.values()) {
    if (run.elapsedEl) run.elapsedEl.textContent = `（已 ${formatElapsed(Date.now() - run.startedAt)}）`;
  }
}

function moduleOnStreamEvent(evt: StreamEvent): void {
  // ── P2：工位/部门间交流事件 → 实时追加到「协作对话」旁观区（只读）──
  if (evt.type === 'agent.message' || evt.type === 'agent.message.received' || evt.type === 'agent.message.timeout') {
    const p = (evt.payload ?? {}) as Record<string, unknown>;
    const spaceId = String(p.spaceId ?? '');
    const id = String(p.id ?? '');
    if (spaceId && id) {
      const existing = (mailCache[spaceId] ??= []).find((x) => x.id === id);
      if (existing) {
        if (typeof p.reply === 'string') existing.reply = p.reply;
        if (typeof p.status === 'string') existing.status = p.status as MailMessage['status'];
      } else {
        appendMailMessage(spaceId, {
          id,
          from: String(p.from ?? 'unknown'),
          to: String(p.to ?? 'unknown'),
          spaceId,
          taskId: typeof p.taskId === 'string' ? p.taskId : undefined,
          goal: typeof p.goal === 'string' ? p.goal : undefined,
          question: String(p.question ?? ''),
          reply: typeof p.reply === 'string' ? p.reply : undefined,
          status: (typeof p.status === 'string' && (p.status === 'pending' || p.status === 'replied' || p.status === 'timeout')
            ? p.status
            : evt.type === 'agent.message' ? 'pending' : evt.type === 'agent.message.timeout' ? 'timeout' : 'replied') as MailMessage['status'],
          createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
        });
      }
      // 已存在时更新渲染（reply 到达后刷新该条）
      if (mailSpaceIdRef === spaceId && mailBoxRef && mailLogElRef && existing) {
        loadMailbox(spaceId);
      }
    }
    return;
  }
  // ── UI 改版：任务路由结果 → 早期跳转部门视图 + 任务列表项关联部门（不等任务完成）──
  if (evt.type === 'task.routed') {
    const p = (evt.payload ?? {}) as Record<string, unknown>;
    const goal = String(p.goal ?? '');
    const spaceId = String(p.spaceId ?? '');
    // 多任务并发：按目标匹配到对应 run（goal===text 或 goal 含 text）
    let run: ActiveRun | undefined;
    for (const r of activeRuns.values()) {
      if (!r.done && (r.text === goal || (goal && r.text && goal.includes(r.text)))) { run = r; break; }
    }
    if (run && !run.done && spaceId && goal) {
      const item = tasks.find((x) => x.runId === run.runId);
      if (item) {
        item.deptId = spaceId;
        item.deptName = String(p.departmentName ?? item.deptName ?? '');
        if (currentTaskId === item.id) currentTaskId = undefined; // 先清再高亮（避免误选中旧任务）
        upsertTask(item);
        currentTaskId = item.id;
      }
      spaceJumpHook?.(spaceId);
    }
    return;
  }
  // 17i.32/33：流式 token → 追加到当前气泡（聊天用占位；任务拟人总结新建气泡）
  if (evt.type === 'chat.stream.delta') {
    const d = String((evt.payload as Record<string, unknown>)?.delta ?? '');
    if (d) {
      // 17k.1：多任务并发——delta 优先归属最近发送的 run（任务拟人总结/闲聊流式各归各）；无 run 时用模块级兑底
      const target = lastSendId > 0 ? activeRuns.get(lastSendId) : undefined;
      const setTarget = target ?? { chatStreamEl, chatStreamStarted, chatLogEl: null as HTMLElement | null };
      let bodyEl = setTarget.chatStreamEl;
      const logElT = setTarget.chatLogEl ?? chatLogEl;
      if (!bodyEl || !bodyEl.isConnected || !logElT) {
        // 闲聊占位已被替换 / 任务拟人总结 → 新建气泡（归属目标 run 或模块级兑底）
        const body = el('div', { class: 'body' });
        logElT?.appendChild(el('div', { class: 'chat-msg assistant' }, [
          el('div', { class: 'head' }, [
            el('span', { class: 'who' }, 'MorPex'),
            el('span', { class: 'time' }, tsTime(Date.now())),
          ]),
          body,
        ]));
        if (logElT) logElT.scrollTop = logElT.scrollHeight;
        bodyEl = body;
        if (target) { target.chatStreamEl = body; target.chatLogEl = logElT ?? null; target.chatStreamStarted = false; }
        else { chatStreamEl = body; chatStreamStarted = false; }
      }
      if (!setTarget.chatStreamStarted) {
        if (target) target.chatStreamStarted = true; else chatStreamStarted = true;
        bodyEl.replaceChildren();
      }
      bodyEl.appendChild(document.createTextNode(d));
      if (logElT) logElT.scrollTop = logElT.scrollHeight;
    }
    return;
  }
  // 多任务并发：事件广播给所有在途 run（consumeStreamEvent 内部按 isRunRelevant/目标过滤）
  let eventHandled = false;
  for (const run of activeRuns.values()) {
    if (run.done) continue;
    const changed = consumeStreamEvent(run.state, evt, run.text);
    if (changed && run.state.isTask) { run.syncHook?.(); eventHandled = true; }
  }
  if (eventHandled) syncTaskFromRun(); // 任务列表状态/进度实时同步
  // P3-A：人工门事件（plan.ready/user.ask/approval.*）到达时刷新统一决策队列
  if (evt.type.startsWith('plan.ready') || evt.type.startsWith('user.ask') || evt.type.startsWith('approval.')) {
    void refreshPendingDecisions();
  }
}

/**
 * 关闭运行资源。
 * - runId 指定 → 仅移除该 run（多任务并发：其它 run 继续存活）。
 * - 不传 → 清空全部运行（newSession）。
 * 仅当 activeRuns 空了才关闭全局 SSE/计时器/轮询（最后一个 run 结束后收尾）。
 */
function clearRun(runId?: number): void {
  if (runId !== undefined) {
    activeRuns.delete(runId);
  } else {
    activeRuns.clear();
  }
  if (activeRuns.size > 0) return; // 还有其它在途 run，全局资源保留
  if (runSse) {
    runSse.close();
    runSse = undefined;
  }
  if (runTimer !== undefined) {
    window.clearInterval(runTimer);
    runTimer = undefined;
  }
  if (runPoller !== undefined) {
    window.clearInterval(runPoller);
    runPoller = undefined;
  }
  lastSendId = 0;
  chatStreamEl = null;
  chatStreamStarted = false;
}

/** 轮询在途步骤的实时输出（17i.4）：对每个 running 且有 sessionPath 的步骤，增量拉取会话条目并展平。
 * 17k.1 多任务并发：遍历所有在途 run，各自独立增量轮询。
 */
let runPoller: number | undefined;
let runApi: ApiClient | undefined;

async function pollSingleRun(run: ActiveRun): Promise<void> {
  if (!run || run.done || !runApi) return;
  let changed = false;
  // 17i.5：同步待审批请求（事件可能早于 SSE 订阅或漏发，轮询兜底）
  if (run.state.isTask) {
    try {
      const apRes = await runApi.getPendingApprovals();
      for (const a of apRes.approvals ?? []) {
        const id = String(a.id ?? '');
        if (!id || run.state.approvals.some((x) => x.id === id)) continue;
        run.state.approvals.push({
          id,
          title: String(a.artifactName ?? a.action ?? '操作'),
          meta: `风险 ${a.riskLevel ?? '未知'} · ${a.summary ?? ''}`,
          status: 'pending',
        });
        changed = true;
      }
    } catch {
      /* 审批轮询失败忽略 */
    }
    // 17i.22：同步待确认方案（事件漏发兜底）
    try {
      const plRes = await runApi.getPendingPlans();
      for (const pl of plRes.plans ?? []) {
        if (!run.state.plan && pl.id) {
          run.state.plan = { planId: pl.id, goal: String(pl.goal ?? ''), planFile: String(pl.planFile ?? ''), stepNames: Array.isArray(pl.stepNames) ? pl.stepNames : [] };
          changed = true;
        }
      }
    } catch {
      /* 方案轮询失败忽略 */
    }
  }
  for (const step of run.state.steps) {
    if (step.status !== 'running' || !step.sessionPath || step._polling) continue;
    step._polling = true;
    try {
      const res = await runApi.getSessionEntries(step.sessionPath);
      const entries = res?.entries ?? [];
      for (const e of entries) {
        const id = String(e.id ?? '');
        if (!id || step.seen.has(id)) continue;
        step.seen.add(id);
        // 17i.9：原始条目也保留（完整转录视图），再展平为对话气泡
        step.raw.push(e);
        const lines = flattenStepEntry(e);
        if (lines.length > 0) {
          step.blocks.push(...lines);
          changed = true;
        }
      }
    } catch {
      /* 轮询失败忽略，下次重试 */
    } finally {
      step._polling = false;
    }
  }
  if (changed) run.syncHook?.();
}

async function pollStepDetails(): Promise<void> {
  for (const run of activeRuns.values()) {
    await pollSingleRun(run);
  }
}

function taskStatusText(s: TaskRunState): string {
  if (s.status) return s.status;
  if (s.phase) return s.phase;
  return '执行中';
}

/** 事件 → 步骤去重更新。 */
function upsertStep(steps: TaskStep[], key: string, name: string, status: StepStatus, detail?: string): void {
  const idx = steps.findIndex((x) => x.key === key);
  if (idx >= 0) {
    // 只前进不后退：pending/running → done/failed；done/failed 不被打回
    const rank: Record<StepStatus, number> = { pending: 0, running: 1, done: 2, failed: 2 };
    if (rank[status] >= rank[steps[idx].status]) {
      steps[idx].status = status;
      if (detail) steps[idx].detail = detail;
    }
  } else {
    steps.push({ key, name, status, detail, blocks: [], raw: [], streamText: '', streamThink: '', seen: new Set() });
  }
}

/** 从内容块递归提取文本（toolResult 的 content 可能是 string 或 {text}[]）。 */
function extractBlockText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
      .map((c) => (typeof c.text === 'string' ? c.text : extractBlockText(c.content)))
      .filter(Boolean)
      .join('\n');
  }
  if (content && typeof content === 'object' && typeof (content as Record<string, unknown>).text === 'string') {
    return (content as Record<string, unknown>).text as string;
  }
  return '';
}

/** 将会话条目展平为可显示块（思考/工具调用/结果）。 */
/** 将会话条目展平为可显示块（思考/工具调用/结果），并保留结构化字段供美化渲染。 */
function flattenStepEntry(e: AgentSessionEntryMessage): StepBlock[] {
  const out: StepBlock[] = [];
  const role = e.role ?? '';
  const blocks = e.contentBlocks;
  if (!Array.isArray(blocks)) return out;
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    // role=user 是步骤任务指令（样板），不入对话投影；只投影 assistant 思考/输出 + 工具交互
    if (b.type === 'thinking' || b.type === 'reasoning') {
      // 17i.10：模型思考块（pi-ai 把 reasoning_content 组装为 {type:'thinking', thinking}）→ 💭 投影
      const t = String(b.thinking ?? b.text ?? '').trim();
      if (t) out.push({ kind: 'think', text: t });
    } else if (b.type === 'text' && typeof b.text === 'string' && b.text.trim() && role !== 'user') {
      if (role === 'toolResult') {
        // 17i.9：工具结果是「toolResult 消息里的 text 块」，工具名在消息级 e.toolName
        out.push({
          kind: 'result',
          text: b.text.trim(),
          toolName: e.toolName ?? 'tool',
          toolContent: b.text, // 原始 JSON 字符串（safeParse 后高亮）
        });
      } else {
        out.push({ kind: 'think', text: b.text.trim() });
      }
    } else if (b.type === 'toolCall') {
      const name = String(b.name ?? 'tool');
      out.push({
        kind: 'tool',
        text: `${name}(${JSON.stringify(b.arguments ?? {})})`,
        toolName: name,
        toolArgs: b.arguments,
      });
    } else if (b.type === 'toolResult') {
      // 兼容：若存在独立的 toolResult 块
      out.push({
        kind: 'result',
        text: extractBlockText(b.content),
        toolName: String(e.toolName ?? b.toolName ?? 'tool'),
        toolContent: b.content,
      });
    }
  }
  return out;
}

/** 安全解析 JSON 字符串（失败返回原串）。 */
function safeParse(v: unknown): unknown {
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
}

/** 工具名 → [图标, 中文可读名]。 */
function toolLabel(name: string): [string, string] {
  const n = name.toLowerCase();
  if (n.includes('artifact') || n.includes('deliverable')) return ['📄', '生成产物/文档'];
  if (n.includes('knowledge') || n.includes('memory')) return ['🔍', '知识检索'];
  if (n.includes('shell') || n.includes('exec')) return ['💻', '执行命令'];
  if (n === 'fs' || n.includes('fs.') || n.includes('file')) return ['📁', '文件操作'];
  if (n.includes('code') || n.includes('write')) return ['👨‍💻', '生成代码'];
  if (n.includes('web') || n.includes('http') || n.includes('fetch')) return ['🌐', '网络请求'];
  if (n.includes('search')) return ['🔎', '搜索'];
  return ['🔧', '工具'];
}

/** JSON 语法高亮：key/字符串/数字/布尔 着色。 */
function jsonToHtml(json: string): HTMLElement {
  const pre = el('pre', { class: 'json-hl' });
  const re = /("(?:[^"\\]|\\.)*")(\s*:)|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b|\bnull\b)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(json)) !== null) {
    if (m.index > last) pre.appendChild(document.createTextNode(json.slice(last, m.index)));
    if (m[1] !== undefined) {
      pre.appendChild(el('span', { class: 'jk' }, m[1]));
      pre.appendChild(document.createTextNode(m[2] ?? ':'));
    } else if (m[3] !== undefined) {
      pre.appendChild(el('span', { class: 'js' }, m[3]));
    } else if (m[4] !== undefined) {
      pre.appendChild(el('span', { class: 'jn' }, m[4]));
    } else if (m[5] !== undefined) {
      pre.appendChild(el('span', { class: 'jb' }, m[5]));
    }
    last = m.index + m[0].length;
  }
  if (last < json.length) pre.appendChild(document.createTextNode(json.slice(last)));
  return pre;
}

/** 渲染单个值（键值卡内）：字符串→可读文本，对象/数组→高亮 JSON。 */
function renderValue(v: unknown): HTMLElement {
  if (typeof v === 'string') {
    return el('pre', { class: 'tool-v-str' }, v);
  }
  if (v !== null && typeof v === 'object') {
    return jsonToHtml(JSON.stringify(v, null, 2));
  }
  return el('span', null, String(v));
}

/** 工具调用 → 可读卡片（工具名 + 参数键值）。 */
function renderToolCallBlock(name: string, args: unknown): HTMLElement {
  const [icon, label] = toolLabel(name);
  const obj = safeParse(args);
  const card = el('div', { class: 'tool-card' }, [
    el('div', { class: 'tool-card-head' }, `${icon} ${label}（${name}）`),
  ]);
  if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      card.appendChild(
        el('div', { class: 'tool-kv' }, [
          el('span', { class: 'tool-k' }, k),
          el('div', { class: 'tool-v' }, renderValue(v)),
        ]),
      );
    }
  } else {
    card.appendChild(renderValue(obj));
  }
  return card;
}

/** 工具结果 → 可读卡片（内容提取文本，JSON 高亮）。 */
function renderToolResultBlock(toolName: string, content: unknown): HTMLElement {
  const [icon, label] = toolLabel(toolName);
  const card = el('div', { class: 'tool-card result' }, [
    el('div', { class: 'tool-card-head' }, `${icon} ${label}（${toolName}）结果`),
  ]);
  // 提取文本（content 可能是 [{type:'text',text}] 或 string）
  const text = extractBlockText(content);
  const parsed = safeParse(text);
  if (typeof parsed === 'string') {
    card.appendChild(el('pre', { class: 'tool-v-str' }, parsed || '(空结果)'));
  } else {
    card.appendChild(jsonToHtml(JSON.stringify(parsed, null, 2)));
  }
  return card;
}

/** 17i.12：工具调用 → 终端命令行（$ 提示 + 命令）。 */
function renderTermCommand(b: StepBlock): HTMLElement {
  const [icon] = toolLabel(b.toolName ?? 'tool');
  const args = b.toolArgs && typeof b.toolArgs === 'object' ? (b.toolArgs as Record<string, unknown>) : {};
  const cmd =
    typeof args.command === 'string'
      ? args.command
      : typeof args.query === 'string'
        ? args.query
        : b.text.replace(/^\(.*\)$/, '');
  const body = el('span', { class: 'term-body' });
  body.appendChild(document.createTextNode(`${icon} ${b.toolName ?? 'tool'}`));
  if (cmd) {
    body.appendChild(document.createTextNode(' '));
    const code = el('code', null, cmd);
    body.appendChild(code);
  }
  return el('div', { class: 'term-line cmd' }, [el('span', { class: 'term-prompt' }, '$'), body]);
}

/** 17i.12：工具结果 → 终端输出行（截断防爆）。 */
function renderTermResult(b: StepBlock): HTMLElement {
  const text = b.text.length > 600 ? `${b.text.slice(0, 600)}\n…（已截断）` : b.text;
  return el('div', { class: 'term-line out' }, [
    el('span', { class: 'term-prompt' }, '↩'),
    el('pre', { class: 'term-body' }, text || '(空结果)'),
  ]);
}

/** 渲染单个对话气泡（17i.7：把 agent 实际对话投影为聊天式气泡；工具调用/结果卡片化 + JSON 高亮）。 */
function renderStepBlock(b: StepBlock): HTMLElement {
  let body: HTMLElement;
  if (b.kind === 'tool') {
    body = renderToolCallBlock(b.toolName ?? 'tool', b.toolArgs);
  } else if (b.kind === 'result') {
    body = renderToolResultBlock(b.toolName ?? '工具', b.toolContent);
  } else {
    body = el('pre', { class: 'conv-text' }, b.text);
  }
  const who = b.kind === 'result' ? '工具' : 'MorPex';
  const label = b.kind === 'tool' ? '🔧 调用工具' : b.kind === 'result' ? '📄 工具结果' : '💭 思考/输出';
  return el('div', { class: `conv-msg ${b.kind}` }, [
    el('div', { class: 'conv-head' }, [
      el('span', { class: 'conv-who' }, who),
      el('span', { class: 'conv-label' }, label),
    ]),
    body,
  ]);
}

/** 任务目标匹配：用户消息精确一致，或为 goal 后缀（附件上下文被后端拼在消息前）。 */
function matchMissionGoal(goal: string, userText: string): boolean {
  const text = userText.trim();
  return goal.length > 0 && text.length > 0 && (goal === text || goal.endsWith(text));
}

/**
 * 关联后事件归属过滤：mission.* / plan.created / execution.started / execution.failed 按 missionId 一致性；
 * workflow.* / node.* 按首次捕获的 dagId；execution.step.result 为 web 引擎唯一步骤事件（executionId=step_<nodeId> 无法关联）→ 全收。
 */
function isRunRelevant(state: TaskRunState, type: string, evt: StreamEvent, payload: Record<string, unknown>): boolean {
  if (type.startsWith('mission.') || type === 'plan.created' || type === 'execution.started' || type === 'execution.failed') {
    if (payload.missionId !== undefined && state.missionId && String(payload.missionId) !== state.missionId) return false;
    return true;
  }
  if (type.startsWith('workflow.') || type === 'node.started' || type === 'node.completed') {
    const execId = evt.executionId as string | undefined;
    if (!execId) return true;
    if (!state.dagId) state.dagId = execId; // 首次捕获本任务 DAG id（web 路径无 workflow 事件，不触发）
    return execId === state.dagId;
  }
  // 其余类型（llm.call / telemetry / governance / connected 等）：与本次任务无关，不记录、不驱动状态
  // execution.step.started/result 为 web 引擎唯一步骤事件（executionId=step_<nodeId> 无法关联 mission）→ 全收
  // approval.* （17i.5）：人工审批提示/决议，任务级相关 → 全收
  return type === 'execution.step.started' || type === 'execution.step.result' || type.startsWith('approval.') || type.startsWith('user.ask') || type.startsWith('plan.ready');
}

/** 同步 DAG 节点状态（由步骤事件驱动）。 */
function updateDagNode(state: TaskRunState, nodeId: string, status: DagNode['status']): boolean {
  if (!state.dag) return false;
  const n = state.dag.nodes.find((x) => x.id === nodeId);
  if (!n) return false;
  const rank = { pending: 0, running: 1, done: 2, failed: 2 };
  if (rank[status] >= rank[n.status]) n.status = status;
  return true;
}

/** 处理一条 SSE 事件，更新运行态；返回是否发生可见变化（需要重渲染卡片）。 */
function consumeStreamEvent(state: TaskRunState, evt: StreamEvent, userText: string): boolean {
  const type = evt.type ?? '';
  const payload = (evt.payload ?? {}) as Record<string, unknown>;
  let changed = false;

  // 任务关联：mission.created 且目标与用户消息「精确一致」/「后缀一致」→ 判定为「本任务」。
  // 注：后端 GoalParser 将 goal 截断至 200 字符，用户消息恒在 goal 尾部——精确/后缀匹配无召回损失，
  //     且显著降低后台并发 mission 的误关联概率。
  if (!state.isTask && type === 'mission.created') {
    const goal = String(payload.goal ?? payload.objective ?? '');
    if (matchMissionGoal(goal, userText)) {
      state.isTask = true;
      state.missionId = (payload.missionId as string) ?? (evt.executionId as string) ?? undefined;
      state.executionId = (evt.executionId as string) ?? state.missionId;
      state.goal = goal;
      state.phase = '已创建 Mission';
      state.events.push(evt); // 锚定事件进入时间线（不匹配的并发 mission.created 不记录）
      changed = true;
    }
    return changed;
  }
  if (!state.isTask) return changed;

  // 关联后：只接受属于本 mission 的事件并记入时间线（防后台并发任务污染步骤/状态）
  if (!isRunRelevant(state, type, evt, payload)) return changed;
  state.events.push(evt);

  switch (type) {
    case 'mission.updated': {
      // missionId 一致性已在 isRunRelevant 统一校验（mission.updated 事件均带 payload.missionId）
      if (typeof payload.phase === 'string') { state.phase = payload.phase; changed = true; }
      if (typeof payload.status === 'string') { state.status = payload.status; changed = true; }
      if (typeof payload.progress === 'number') { state.progress = payload.progress; changed = true; }
      break;
    }
    case 'mission.completed': {
      state.done = true; state.status = '完成'; changed = true;
      break;
    }
    case 'mission.failed': {
      state.done = true; state.status = '失败'; changed = true;
      break;
    }
    case 'mission.blocked': {
      state.status = '阻塞'; changed = true;
      break;
    }
    case 'workflow.step_started': {
      const nodeId = String(payload.nodeId ?? '');
      const nodeName = String(payload.nodeName ?? nodeId);
      if (nodeId) { upsertStep(state.steps, nodeId, nodeName, 'running'); updateDagNode(state, nodeId, 'running'); changed = true; }
      break;
    }
    case 'workflow.step_completed': {
      const nodeId = String(payload.nodeId ?? '');
      const nodeName = String(payload.nodeName ?? nodeId);
      if (nodeId) { upsertStep(state.steps, nodeId, nodeName, 'done'); updateDagNode(state, nodeId, 'done'); changed = true; }
      break;
    }
    case 'workflow.step_failed': {
      const nodeId = String(payload.nodeId ?? '');
      const nodeName = String(payload.nodeName ?? nodeId);
      if (nodeId) { upsertStep(state.steps, nodeId, nodeName, 'failed', String(payload.error ?? '')); updateDagNode(state, nodeId, 'failed'); changed = true; }
      break;
    }
    case 'execution.step.started': {
      // 会话 17i.3：步骤开始（长步骤执行期实时显示当前步骤名）
      const sNodeId = String(payload.nodeId ?? '');
      const sNodeName = String(payload.nodeName ?? sNodeId);
      if (sNodeId) {
        upsertStep(state.steps, sNodeId, sNodeName, 'running');
        updateDagNode(state, sNodeId, 'running');
        // 17i.4：携带会话路径 → 前端轮询该步骤的实时思考/输出
        if (payload.sessionPath) {
          const st = state.steps.find((x) => x.key === sNodeId);
          if (st) st.sessionPath = String(payload.sessionPath);
        }
        changed = true;
      }
      break;
    }
    case 'execution.step.result': {
      const nodeId = String(payload.nodeId ?? '');
      const nodeName = String(payload.nodeName ?? nodeId);
      if (nodeId) {
        upsertStep(state.steps, nodeId, nodeName, payload.success === true ? 'done' : 'failed', String(payload.error ?? ''));
        updateDagNode(state, nodeId, payload.success === true ? 'done' : 'failed');
        changed = true;
      }
      break;
    }
    case 'node.started': {
      const nodeId = String(payload.nodeId ?? '');
      const nodeName = String(payload.nodeName ?? nodeId);
      if (nodeId) { upsertStep(state.steps, nodeId, nodeName, 'running'); updateDagNode(state, nodeId, 'running'); changed = true; }
      break;
    }
    case 'node.completed': {
      const nodeId = String(payload.nodeId ?? '');
      const nodeName = String(payload.nodeName ?? nodeId);
      if (nodeId) { upsertStep(state.steps, nodeId, nodeName, 'done'); updateDagNode(state, nodeId, 'done'); changed = true; }
      break;
    }
    case 'user.ask': {
      // 17i.15：LLM 自主提问 → 聊天拟人对话呈现，等待用户回答
      const askId = String(payload.askId ?? '');
      if (askId && !state.asks.some((a) => a.askId === askId)) {
        state.asks.push({
          askId,
          question: String(payload.question ?? '需要你补充信息'),
          options: Array.isArray(payload.options) ? (payload.options as string[]).filter((o): o is string => typeof o === 'string') : undefined,
        });
        changed = true;
      }
      break;
    }
    case 'plan.ready': {
      // 17i.22：规划方案已生成 → 聊天汇报 + 等确认（交互模式）
      const planId = String(payload.planId ?? '');
      if (planId) {
        state.plan = {
          planId,
          goal: String(payload.goal ?? ''),
          planFile: String(payload.planFile ?? ''),
          stepNames: Array.isArray(payload.stepNames) ? (payload.stepNames as string[]) : [],
        };
        changed = true;
      }
      break;
    }
    case 'approval.wait_human':
    case 'approval.required': {
      // 17i.5：人工审批请求 → 展示提示（批准/拒绝）
      const apId = String(payload.id ?? payload.requestId ?? '');
      if (apId) {
        const title = String(payload.artifactName ?? payload.action ?? '操作');
        const meta = `风险 ${payload.riskLevel ?? payload.risk ?? '未知'} · ${payload.summary ?? payload.description ?? ''}`;
        if (!state.approvals.some((a) => a.id === apId)) {
          state.approvals.push({ id: apId, title, meta, status: 'pending' });
          changed = true;
        }
      }
      break;
    }
    case 'approval.granted':
    case 'approval.auto_approved':
    case 'approval.denied': {
      const apId2 = String(payload.id ?? payload.requestId ?? '');
      const ap = state.approvals.find((a) => a.id === apId2);
      if (ap && ap.status !== 'resolved') {
        ap.status = 'resolved';
        changed = true;
      }
      break;
    }
    case 'execution.stream.text':
    case 'execution.stream.think': {
      // 17i.12：Codex 式流式 token → 追加到步骤缓冲（终端转录实时显示）
      const nodeKey = String(payload.nodeId ?? '');
      const delta = String(payload.delta ?? '');
      if (nodeKey && delta) {
        const st = state.steps.find((x) => x.key === nodeKey);
        if (st) {
          if (type === 'execution.stream.think') st.streamThink += delta;
          else st.streamText += delta;
          changed = true;
        }
      }
      break;
    }
    case 'execution.dag': {
      // 17i.17：编排器 DAG 结构（nodes+deps+edges）→ 渲染节点图
      const nodes = (payload.nodes ?? []) as Array<{ id: string; name: string; deps?: string[] }>;
      const edges = (payload.edges ?? []) as Array<{ from: string; to: string }>;
      if (nodes.length > 0) {
        state.dag = {
          nodes: nodes.map((n) => ({ id: n.id, name: n.name || n.id, deps: n.deps ?? [], status: 'pending' })),
          edges,
        };
        changed = true;
      }
      break;
    }
    case 'workflow.completed': {
      state.done = true; state.status = '执行完成'; changed = true;
      break;
    }
    case 'workflow.failed': {
      state.done = true; state.status = '执行失败'; changed = true;
      break;
    }
    default:
      break;
  }
  return changed;
}

/** 步骤行节点。 */
function buildStepRow(s: TaskStep): HTMLElement {
  const icon = s.status === 'done' ? '✅' : s.status === 'failed' ? '❌' : s.status === 'running' ? '⏳' : '○';
  const label =
    s.status === 'done' ? '完成' : s.status === 'failed' ? '失败' : s.status === 'running' ? '执行中' : '待执行';
  const children: Child[] = [
    el('span', { class: 'step-icon' }, icon),
    el('span', { class: 'step-name' }, s.name),
    ...(s.detail && s.status === 'failed' ? [el('span', { class: 'step-detail' }, truncate(s.detail, 80))] : []),
    el('span', { class: 'step-status' }, label),
  ];
  // 17i.4：有实时输出块 → 折叠展示思考/工具调用/结果（轮询增量追加，卡片刷新时重建）
  if (s.blocks.length > 0) {
    children.push(
      el('details', { class: 'step-detail-box' }, [
        el('summary', null, `实时输出（${s.blocks.length} 条）`),
        el('div', { class: 'step-detail-body' }, s.blocks.map(renderStepBlock)),
      ]),
    );
  }
  return el('div', { class: `task-step ${s.status}` }, children);
}

/** 时间线（步骤 + 原始事件流），供任务卡片「查看实时进度」展开。 */
function buildTimeline(steps: TaskStep[], events: StreamEvent[]): HTMLElement {
  const stepNodes = steps.length
    ? steps.map(buildStepRow)
    : [el('div', { class: 'timeline-empty' }, '（本次运行未捕获到步骤事件）')];
  const evtNodes = events.length
    ? events.map((e) => {
        const t = typeof e.timestamp === 'number' ? new Date(e.timestamp).toLocaleTimeString() : '';
        const payload = e.payload ? JSON.stringify(e.payload) : '';
        return el('div', { class: 'timeline-event' }, [
          el('span', { class: 'evt-time' }, t),
          el('span', { class: 'evt-type' }, e.type),
          ...(payload ? [el('span', { class: 'evt-payload' }, truncate(payload, 160))] : []),
        ]);
      })
    : [el('div', { class: 'timeline-empty' }, '（无事件流记录）')];
  return el('div', { class: 'task-timeline' }, [
    el('div', { class: 'timeline-label' }, '执行步骤'),
    el('div', { class: 'task-steps' }, stepNodes),
    el('details', { class: 'timeline-raw' }, [
      el('summary', null, `原始事件流（${events.length} 条）`),
      el('div', { class: 'timeline-events' }, evtNodes),
    ]),
  ]);
}

/** 最终任务卡片（响应返回 mode=goal 时作为回复 body）。 */
function buildFinalTaskCard(s: TaskSummary): HTMLElement {
  let open = false;
  const doneCount = s.steps.filter((x) => x.status === 'done' || x.status === 'failed').length;
  const cardEl = el('div', { class: `task-card ${s.ok ? 'ok' : 'fail'}` });
  const render = (): void => {
    cardEl.replaceChildren(
      el('div', { class: 'task-card-head' }, [
        el('span', { class: `task-status ${s.ok ? 'ok' : 'fail'}` }, s.ok ? '✅ 成功' : '❌ 失败'),
        el('span', { class: 'task-goal' }, truncate(s.goal || '任务执行', 80)),
      ]),
      el('div', { class: 'task-card-meta' }, [
        `Mission: ${s.missionId || '-'}`,
        ' · ',
        `耗时 ${formatElapsed(s.durationMs)}`,
        s.steps.length > 0 ? ` · 步骤 ${doneCount}/${s.steps.length}` : '',
        s.executionId && s.executionId !== s.missionId ? ` · Exec: ${s.executionId}` : '',
      ]),
      // 17i.5：失败时直接展示原因（此前只显示 ❌ 失败，用户无从诊断）
      ...(!s.ok && s.error ? [el('div', { class: 'task-error' }, s.error)] : []),
      ...(s.steps.length > 0 ? [el('div', { class: 'task-steps' }, s.steps.map(buildStepRow))] : []),
      el('button', {
        class: 'btn small secondary task-toggle',
        onclick: () => {
          open = !open;
          render();
        },
      }, open ? '收起进度' : '查看实时进度'),
      ...(open ? [buildTimeline(s.steps, s.events)] : []),
    );
  };
  render();
  return cardEl;
}

/** 渲染实时任务卡片（执行中，进度/步骤随事件刷新）。
 *  每次重建都会重新创建计时 span 并赋给模块级 elapsedEl（tick 更新最新引用），
 *  避免 replaceChildren 把旧计时节点丢弃后计时器更新到已脱离 DOM 的节点。 */
/** 待审批条目（17i.5：web 路径高风险操作阻塞等待人工决议）。 */
interface PendingApprovalItem {
  id: string;
  title: string;
  meta: string;
  status: 'pending' | 'resolved';
}

/** 单个步骤行的持久化 DOM（增量更新，避免整卡重建导致 <details> 折叠）。 */
interface StepRowRec {
  row: HTMLElement;
  iconEl: HTMLElement;
  statusEl: HTMLElement;
  detailsEl: HTMLDetailsElement;
  bodyEl: HTMLElement;
  countEl: HTMLElement;
  renderedBlocks: number;
  /** 17i.12：终端转录——流式行引用 + 已渲染字符数 */
  thinkPre: HTMLElement | null;
  textPre: HTMLElement | null;
  renderedThink: number;
  renderedText: number;
}

/**
 * 实时任务卡片控制器（17i.5 重构）：
 * - 骨架只建一次；步骤行按 key 增量 reconcile（新增/删除/状态更新），
 *   已存在的 <details> 不重建 → 展开状态不丢失。
 * - 输出块流式追加到已有 body（不整卡重绘，不折叠）。
 * - 审批待处理时渲染审批提示（批准/拒绝）。
 */
class LiveCardController {
  private cardEl: HTMLElement;
  private headerEl: HTMLElement | null = null;
  private barEl: HTMLElement | null = null;
  private progressTextEl: HTMLElement | null = null;
  private stepsWrapEl: HTMLElement | null = null;
  private emptyEl: HTMLElement | null = null;
  private toggleBtn: HTMLButtonElement | null = null;
  private rawBtn: HTMLButtonElement | null = null;
  private timelineEl: HTMLElement | null = null;
  private approvalsEl: HTMLElement | null = null;
  private rawPanelEl: HTMLElement | null = null;
  private rawStepEls = new Map<string, { section: HTMLElement; entriesEl: HTMLElement; rendered: number }>();
  private narrativeEl: HTMLElement | null = null;
  private narrativeCount = 0;
  private dagEl: HTMLElement | null = null;
  private dagDetailEl: HTMLElement | null = null;
  private dagNodeEls = new Map<string, { el: HTMLElement; statusEl: HTMLElement }>();
  private expandedNodeId: string | null = null;
  private stepEls = new Map<string, StepRowRec>();
  private timelineOpen = false;
  private rawOpen = false;

  constructor(cardEl: HTMLElement) {
    this.cardEl = cardEl;
  }

  /** 渲染/刷新（增量）：SSE 事件、轮询追加、计时 tick 都会调它。 */
  render(state: TaskRunState, startedAt: number, decide: (id: string, d: 'APPROVED' | 'REJECTED') => void, elapsedSink?: (el: HTMLElement) => void): void {
    this.ensureSkeleton();
    // 头部：状态徽章 + 目标 + 计时（计时 span 每次重建，tick 更新最新引用）
    const elapsedSpan = el('span', { class: 'task-elapsed' }, `（已 ${formatElapsed(Date.now() - startedAt)}）`);
    elapsedSink?.(elapsedSpan);
    this.headerEl!.replaceChildren(
      el('span', { class: 'task-status running' }, '⏳ 执行中'),
      el('span', { class: 'task-goal' }, truncate(state.goal || '', 80)),
      elapsedSpan,
    );
    // 进度
    const doneSteps = state.steps.filter((s) => s.status === 'done' || s.status === 'failed').length;
    const curStep = state.steps.find((s) => s.status === 'running');
    const pct =
      state.progress != null
        ? Math.max(0, Math.min(100, Math.round(state.progress)))
        : state.steps.length > 0
          ? Math.round((doneSteps / state.steps.length) * 100)
          : 0;
    this.barEl!.style.width = `${Math.max(4, pct)}%`;
    const hasPendingApproval = state.approvals.some((a) => a.status === 'pending');
    const hasPendingAsk = state.asks.some((a) => !a.answered);
    const planPending = !!state.plan && !state.plan.confirmed;
    this.progressTextEl!.textContent = planPending
      ? '📋 等待确认方案…'
      : hasPendingAsk
        ? '⏸️ 等待你的回答…'
        : hasPendingApproval
          ? '⏸️ 等待人工审批…'
          : curStep
            ? `正在执行：${curStep.name}`
            : `${taskStatusText(state)}${state.done ? '，正在生成报告…' : ''}`;
    // 步骤：增量 reconcile
    this.reconcileSteps(state);
    // 17i.11：拟人化对话叙事（增量追加）
    this.reconcileNarrative(state);
    // 17i.17：DAG 节点图（主要进度视图）
    this.renderDag(state);
    // 审批提示
    this.renderApprovals(state, decide);
    // 切换按钮 + 时间线
    this.toggleBtn!.textContent = this.timelineOpen ? '收起进度' : '查看实时进度';
    if (this.timelineOpen) {
      if (!this.timelineEl) {
        this.timelineEl = buildTimeline(state.steps, state.events);
        this.cardEl.appendChild(this.timelineEl);
      }
    } else if (this.timelineEl) {
      this.timelineEl.remove();
      this.timelineEl = null;
    }
    // 17i.9：原始对话完整转录（增量追加）
    this.rawBtn!.textContent = this.rawOpen ? '收起对话' : '📜 原始对话';
    if (this.rawOpen) {
      this.ensureRawPanel();
      this.reconcileRaw(state);
    } else if (this.rawPanelEl) {
      this.rawPanelEl.remove();
      this.rawPanelEl = null;
      this.rawStepEls.clear();
    }
  }

  /** 切换「查看实时进度」时间线。 */
  toggleTimeline(): void {
    this.timelineOpen = !this.timelineOpen;
  }

  /** 17i.11：拟人化对话叙事——把已捕获事件转成经理 persona 对话，增量追加。 */
  /** 17i.17：DAG 节点图——分层布局 + 状态 + 点击展开渲染好的 LLM 输出（主要进度视图）。 */
  private renderDag(state: TaskRunState): void {
    if (!state.dag || !this.dagEl) {
      if (this.dagEl) this.dagEl.replaceChildren();
      if (this.dagDetailEl) this.dagDetailEl.replaceChildren();
      this.dagNodeEls.clear();
      return;
    }
    // 分层（longest-path layering：level = max(deps level)+1）
    const levelOf = new Map<string, number>();
    const calc = (id: string): number => {
      const have = levelOf.get(id);
      if (have !== undefined) return have;
      const n = state.dag!.nodes.find((x) => x.id === id);
      const lvl = n && n.deps.length > 0 ? Math.max(0, ...n.deps.map((d) => calc(d))) + 1 : 0;
      levelOf.set(id, lvl);
      return lvl;
    };
    for (const n of state.dag.nodes) calc(n.id);
    const levels: DagNode[][] = [];
    for (const n of state.dag.nodes) {
      const l = levelOf.get(n.id) ?? 0;
      (levels[l] ??= []).push(n);
    }
    const seen = new Set<string>();
    this.dagEl.replaceChildren(
      ...levels.map((nodes, lvl) =>
        el('div', { class: 'dag-level' }, [
          ...(lvl > 0 ? [el('span', { class: 'dag-arrow' }, '→')] : []),
          el('div', { class: 'dag-nodes' }, nodes.map((n) => {
            seen.add(n.id);
            const isOpen = this.expandedNodeId === n.id;
            let rec = this.dagNodeEls.get(n.id);
            if (!rec) {
              const statusEl = el('span', { class: 'dag-node-status' });
              const nodeEl = el('div', { class: `dag-node ${n.status}${isOpen ? ' open' : ''}` }, [
                el('span', { class: 'dag-node-icon' }),
                el('span', { class: 'dag-node-name' }, n.name),
                statusEl,
              ]);
              nodeEl.addEventListener('click', () => {
                this.expandedNodeId = this.expandedNodeId === n.id ? null : n.id;
                this.renderDag(state);
                this.renderDagDetail(state);
              });
              rec = { el: nodeEl, statusEl };
              this.dagNodeEls.set(n.id, rec);
            }
            rec.el.className = `dag-node ${n.status}${isOpen ? ' open' : ''}`;
            rec.el.querySelector('.dag-node-icon')!.textContent = dagIcon(n.status);
            rec.statusEl.textContent = dagLabel(n.status);
            return rec.el;
          })),
        ]),
      ),
    );
    for (const [k, rec] of this.dagNodeEls) {
      if (!seen.has(k)) { rec.el.remove(); this.dagNodeEls.delete(k); }
    }
    this.renderDagDetail(state);
  }

  /** 17i.17：展开节点 → 渲染好的 LLM 实际输出（streamThink/streamText；不是工具 JSON）。 */
  private renderDagDetail(state: TaskRunState): void {
    if (!this.dagDetailEl) return;
    if (!this.expandedNodeId) { this.dagDetailEl.replaceChildren(); return; }
    const node = state.dag?.nodes.find((n) => n.id === this.expandedNodeId);
    if (!node) { this.dagDetailEl.replaceChildren(); return; }
    const step = state.steps.find((s) => s.key === node.id);
    const body: Child[] = [
      el('div', { class: 'dag-detail-head' }, [
        el('span', { class: 'dag-detail-name' }, node.name),
        el('span', { class: `dag-detail-status ${node.status}` }, dagLabel(node.status)),
      ]),
    ];
    if (step) {
      if (step.streamThink) body.push(el('div', { class: 'dag-detail-think' }, el('pre', { class: 'dag-detail-text' }, step.streamThink)));
      if (step.streamText) body.push(el('div', { class: 'dag-detail-out' }, el('pre', { class: 'dag-detail-text' }, step.streamText)));
      if (!step.streamText && !step.streamThink && step.blocks.length > 0) {
        // 无流式时回退：只显示文本类块（think），不显示工具 JSON
        const texts = step.blocks.filter((b) => b.kind === 'think').map((b) => b.text).join('\n\n');
        if (texts) body.push(el('div', { class: 'dag-detail-out' }, el('pre', { class: 'dag-detail-text' }, texts)));
      }
      if (!step.streamText && !step.streamThink && !step.blocks.some((b) => b.kind === 'think')) {
        body.push(el('div', { class: 'dag-detail-empty' }, '（该节点无文本输出）'));
      }
    } else {
      body.push(el('div', { class: 'dag-detail-empty' }, '等待该节点开始执行…'));
    }
    this.dagDetailEl.replaceChildren(...body);
  }

  private reconcileNarrative(state: TaskRunState): void {
    if (!this.narrativeEl) return;
    const events = state.events;
    if (events.length <= this.narrativeCount) return;
    for (let i = this.narrativeCount; i < events.length; i++) {
      const line = narrativeLine(state, events[i]);
      if (line) {
        this.narrativeEl.appendChild(
          el('div', { class: 'narrative-line' }, [
            el('span', { class: 'narrative-who' }, line.persona),
            el('span', { class: 'narrative-text' }, line.text),
          ]),
        );
      }
    }
    this.narrativeCount = events.length;
    this.narrativeEl.scrollTop = this.narrativeEl.scrollHeight;
  }

  /** 切换「📜 原始对话」完整转录。 */
  toggleRaw(): void {
    this.rawOpen = !this.rawOpen;
  }

  private ensureRawPanel(): void {
    if (!this.rawPanelEl) {
      this.rawPanelEl = el('div', { class: 'raw-transcript' });
      this.cardEl.appendChild(this.rawPanelEl);
    }
  }

  /** 原始转录增量 reconcile：每个步骤一个 section，按条目 id 增量追加。 */
  private reconcileRaw(state: TaskRunState): void {
    if (!this.rawPanelEl) return;
    for (const step of state.steps) {
      if (step.raw.length === 0) continue;
      let rec = this.rawStepEls.get(step.key);
      if (!rec) {
        const entriesEl = el('div', { class: 'raw-entries' });
        const section = el('div', { class: 'raw-step' }, [
          el('div', { class: 'raw-step-title' }, `📋 ${step.name}`),
          entriesEl,
        ]);
        this.rawPanelEl.appendChild(section);
        rec = { section, entriesEl, rendered: 0 };
        this.rawStepEls.set(step.key, rec);
      }
      if (step.raw.length > rec.rendered) {
        const fresh = step.raw.slice(rec.rendered);
        for (const e of fresh) rec.entriesEl.appendChild(renderRawEntry(e));
        rec.rendered = step.raw.length;
        rec.entriesEl.scrollTop = rec.entriesEl.scrollHeight;
      }
    }
    for (const [key, rec] of this.rawStepEls) {
      if (!state.steps.some((s) => s.key === key)) {
        rec.section.remove();
        this.rawStepEls.delete(key);
      }
    }
  }

  private ensureSkeleton(): void {
    if (this.headerEl) return;
    this.headerEl = el('div', { class: 'task-card-head' });
    this.barEl = el('div', { class: 'task-progress-bar', style: 'width:4%' });
    this.progressTextEl = el('div', { class: 'task-progress-text' });
    this.stepsWrapEl = el('div', { class: 'task-steps' });
    this.emptyEl = el('div', { class: 'task-steps-empty' }, '等待执行步骤…');
    this.narrativeEl = el('div', { class: 'narrative' });
    this.dagEl = el('div', { class: 'dag' });
    this.dagDetailEl = el('div', { class: 'dag-detail' });
    this.toggleBtn = el('button', {
      class: 'btn small secondary',
      onclick: () => { this.toggleTimeline(); },
    }) as HTMLButtonElement;
    this.rawBtn = el('button', {
      class: 'btn small secondary',
      onclick: () => { this.toggleRaw(); },
    }) as HTMLButtonElement;
    this.cardEl.replaceChildren(
      this.headerEl,
      el('div', { class: 'task-progress' }, [
        el('div', { class: 'task-progress-track' }, [this.barEl]),
        this.progressTextEl,
      ]),
      this.dagEl,
      this.dagDetailEl,
      this.narrativeEl,
      this.stepsWrapEl,
      this.emptyEl,
      el('div', { class: 'task-card-actions' }, [this.toggleBtn, this.rawBtn]),
    );
  }

  /** 步骤增量 reconcile：只新建缺失行/更新状态/追加新输出块，不重建已有行（保持 details 展开）。 */
  private reconcileSteps(state: TaskRunState): void {
    const seen = new Set<string>();
    for (const step of state.steps) {
      seen.add(step.key);
      let rec = this.stepEls.get(step.key);
      if (!rec) {
        rec = this.createStepRow(step);
        this.stepEls.set(step.key, rec);
        this.stepsWrapEl!.appendChild(rec.row);
      }
      this.updateStepRow(rec, step);
    }
    for (const [key, rec] of this.stepEls) {
      if (!seen.has(key)) {
        rec.row.remove();
        this.stepEls.delete(key);
      }
    }
    // 空态占位：有步骤则隐藏
    if (this.emptyEl) {
      this.emptyEl.style.display = state.steps.length > 0 ? 'none' : '';
      this.emptyEl.textContent = '等待执行步骤…';
    }
  }

  private createStepRow(step: TaskStep): StepRowRec {
    const iconEl = el('span', { class: 'step-icon' });
    const statusEl = el('span', { class: 'step-status' });
    const countEl = el('span', null, '0');
    // 17i.12：body 即终端转录容器（流式行 + 命令/输出行）
    const bodyEl = el('div', { class: 'step-detail-body step-term' });
    const detailsEl = el('details', { class: 'step-detail-box' }, [
      el('summary', null, ['实时输出（', countEl, ' 条）']),
      bodyEl,
    ]) as HTMLDetailsElement;
    const row = el('div', { class: `task-step ${step.status}` }, [
      iconEl,
      el('span', { class: 'step-name' }, step.name),
      statusEl,
      detailsEl,
    ]);
    return { row, iconEl, statusEl, detailsEl, bodyEl, countEl, renderedBlocks: 0, thinkPre: null, textPre: null, renderedThink: 0, renderedText: 0 };
  }

  private updateStepRow(rec: StepRowRec, step: TaskStep): void {
    rec.row.className = `task-step ${step.status}`;
    rec.iconEl.textContent = step.status === 'done' ? '✅' : step.status === 'failed' ? '❌' : step.status === 'running' ? '⏳' : '○';
    rec.statusEl.textContent =
      step.status === 'done' ? '完成' : step.status === 'failed' ? '失败' : step.status === 'running' ? '执行中' : '待执行';
    // ── 17i.12：终端转录——流式思考/文本增量追加（Codex 式逐 token）──
    if (step.streamThink.length > rec.renderedThink) {
      if (!rec.thinkPre) {
        rec.thinkPre = el('div', { class: 'term-line think' }, [
          el('span', { class: 'term-prompt' }, '💭'),
          el('span', { class: 'term-body' }),
        ]);
        rec.bodyEl.appendChild(rec.thinkPre);
      }
      const bodySpan = rec.thinkPre.querySelector('.term-body') as HTMLElement;
      bodySpan.appendChild(document.createTextNode(step.streamThink.slice(rec.renderedThink)));
      rec.renderedThink = step.streamThink.length;
    }
    if (step.streamText.length > rec.renderedText) {
      if (!rec.textPre) {
        rec.textPre = el('div', { class: 'term-line text' }, [
          el('span', { class: 'term-prompt' }, '▸'),
          el('span', { class: 'term-body' }),
        ]);
        rec.bodyEl.appendChild(rec.textPre);
      }
      const bodySpan = rec.textPre.querySelector('.term-body') as HTMLElement;
      bodySpan.appendChild(document.createTextNode(step.streamText.slice(rec.renderedText)));
      rec.renderedText = step.streamText.length;
    }
    // ── 工具调用/结果块（流式已覆盖文本时跳过 think 块，避免重复）──
    const useStream = step.streamText.length > 0 || step.streamThink.length > 0;
    if (step.blocks.length > rec.renderedBlocks) {
      const fresh = step.blocks.slice(rec.renderedBlocks);
      for (const b of fresh) {
        if (b.kind === 'think' && useStream) continue; // 流式已显示
        if (b.kind === 'tool') rec.bodyEl.appendChild(renderTermCommand(b));
        else rec.bodyEl.appendChild(renderTermResult(b));
      }
      rec.renderedBlocks = step.blocks.length;
      rec.countEl.textContent = String(step.blocks.length);
      rec.bodyEl.scrollTop = rec.bodyEl.scrollHeight;
    } else if (step.blocks.length > 0) {
      rec.countEl.textContent = String(step.blocks.length);
    }
    // 17i.7：运行中的步骤自动展开「实时对话」（投影实际对话，无需手动点）
    if (step.status === 'running') {
      rec.detailsEl.open = true;
    }
    if (step.streamText.length > 0 || step.streamThink.length > 0) {
      rec.bodyEl.scrollTop = rec.bodyEl.scrollHeight;
    }
  }

  private renderApprovals(state: TaskRunState, decide: (id: string, d: 'APPROVED' | 'REJECTED') => void): void {
    const pending = state.approvals.filter((a) => a.status === 'pending');
    if (pending.length === 0) {
      if (this.approvalsEl) {
        this.approvalsEl.remove();
        this.approvalsEl = null;
      }
      return;
    }
    if (!this.approvalsEl) {
      this.approvalsEl = el('div', { class: 'task-approvals' });
      this.cardEl.insertBefore(this.approvalsEl, this.stepsWrapEl);
    }
    this.approvalsEl.replaceChildren(
      ...pending.map((a) =>
        el('div', { class: 'approval-prompt' }, [
          el('div', { class: 'approval-title' }, `⚠️ 需要人工审批：${a.title}`),
          el('div', { class: 'approval-meta' }, a.meta),
          el('div', { class: 'approval-actions' }, [
            el('button', { class: 'btn small ok', onclick: () => decide(a.id, 'APPROVED') }, '✅ 批准'),
            el('button', { class: 'btn small danger', onclick: () => decide(a.id, 'REJECTED') }, '❌ 拒绝'),
          ]),
        ]),
      ),
    );
  }
}

/** 原始对话转录条目（17i.9：忠实显示每条消息，含空消息/指令/时间戳）。 */
function renderRawEntry(e: AgentSessionEntryMessage): HTMLElement {
  const role = e.role ?? '?';
  const tsRaw = e.timestamp;
  const ts =
    typeof tsRaw === 'string'
      ? tsRaw.slice(11, 19)
      : typeof tsRaw === 'number'
        ? new Date(tsRaw).toLocaleTimeString()
        : '';
  const who = role === 'assistant' ? '💭 MorPex' : role === 'toolResult' ? '📄 工具' : '👤 用户';
  const blocks = Array.isArray(e.contentBlocks) ? e.contentBlocks : [];
  const nodes: Child[] = [];
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'thinking' || b.type === 'reasoning') {
      const t = String(b.thinking ?? b.text ?? '').trim();
      if (t) nodes.push(el('pre', { class: 'raw-text' }, t));
    } else if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
      nodes.push(el('pre', { class: 'raw-text' }, b.text.trim()));
    } else if (b.type === 'toolCall') {
      nodes.push(renderToolCallBlock(String(b.name ?? 'tool'), b.arguments));
    } else if (b.type === 'toolResult') {
      nodes.push(renderToolResultBlock(String(b.toolName ?? 'tool'), b.content));
    }
  }
  if (nodes.length === 0) nodes.push(el('span', { class: 'raw-empty' }, '（空消息）'));
  return el('div', { class: 'raw-entry' }, [
    el('div', { class: 'raw-head' }, [el('span', { class: 'raw-who' }, who), el('span', { class: 'raw-ts' }, ts)]),
    ...nodes,
  ]);
}

/** 17i.36：网络/连接错误判定（重试 + 失败处理共用）。 */
function isNetErrText(t: string): boolean {
  return /(无法连接|Failed to fetch|fetch failed|ECONNREFUSED|ERR_CONNECTION)/i.test(t);
}

/** 17i.11：按任务内容选派部门经理 persona。 */
function pickManager(text: string): string {
  if (/(分析|报告|调研|数据|统计|图表)/.test(text)) return '📊 数据部经理';
  if (/(营销|推广|市场|文案|广告|品牌)/.test(text)) return '📣 市场部经理';
  if (/(设计|UI|视觉|美工)/.test(text)) return '🎨 设计部经理';
  return '💻 软件部经理';
}

/** 17i.17：DAG 节点状态图标/文案。 */
function dagIcon(status: DagNode['status']): string {
  return status === 'done' ? '✅' : status === 'failed' ? '❌' : status === 'running' ? '⏳' : '○';
}
function dagLabel(status: DagNode['status']): string {
  return status === 'done' ? '完成' : status === 'failed' ? '失败' : status === 'running' ? '执行中' : '待执行';
}

/** 17i.13：经理接单语（自然对话，任务卡片在顶部面板不占聊天）。 */
function buildManagerIntro(goal: string): string {
  return `${pickManager(goal)}：好的，我收到了你的任务「${truncate(goal, 60)}」，马上开始分析。执行进度请看上方任务面板。`;
}

/** 17i.13：经理完成/失败报告（自然对话）。 */
function buildManagerReport(goal: string, ok: boolean, error?: string): string {
  if (ok) return `${pickManager(goal)}：✅ 任务「${truncate(goal, 60)}」已完成！详情见上方任务面板。`;
  return `${pickManager(goal)}：❌ 任务「${truncate(goal, 60)}」执行失败了${error ? `：${truncate(error, 120)}` : ''}，详见上方任务面板。`;
}

/** 会话级已完成任务（模块级，跨 tab 存活；顶部面板列出）。 */
interface CompletedTask {
  goal: string;
  ok: boolean;
  error?: string;
  missionId?: string;
  durationMs: number;
  ts: number;
}
let completedTasks: CompletedTask[] = [];

/** 17i.22：Goal 模式（全自动执行，跳过规划方案确认）；localStorage 持久化。 */
let goalMode = (() => {
  try { return localStorage.getItem('morpex.goal-mode') === '1'; } catch { return false; }
})();

// ═══ P1：Space 组织模型（总部/部门空间树；模块级缓存跨 tab 存活）═══
interface SpaceNode {
  id: string; // 'hq' | `dept_${departmentId}`
  name: string;
  icon?: string;
  departmentId?: string;
  /** P1：是否为部门节点（后端 Space.departmentId 未映射时不依赖它判断） */
  isDept?: boolean;
}
/** 部门 Space 原始数据（来自 GET /api/spaces；未加载/后端未支持时为空 → 侧栏仅历史会话）。 */
let spaceDepartments: Array<{ id: string; name?: string; icon?: string; departmentId?: string; capabilities?: string[] }> = [];
let hqSpace: { id: string; name?: string; icon?: string } | undefined;
/** 渲染用空间树节点（[总部, 部门…]）。 */
let spaceTree: SpaceNode[] = [];

// ═══ 任务工作台：模块级任务列表（跨 tab 存活 + localStorage）═══
const TASKS_STORAGE_KEY = 'morpex.tasks';
let tasks: TaskListItem[] = [];
let currentTaskId: string | undefined;
/** 当前渲染注册的任务列表刷新钩子（upsertTask/removeTask 后调用）。 */
let taskListHook: (() => void) | undefined;
/** UI 改版：当前渲染注册的「跳转到指定部门 Space」钩子（task.routed 事件早期跳转用）。 */
let spaceJumpHook: ((spaceId: string) => void) | undefined;

// ═══ P2：AgentMailbox 只读旁观（部门 Space 内「协作对话」区）═══
/** renderConsole 注入的 API 客户端（模块级函数用；渲染时赋值）。 */
let apiRef: ApiClient | undefined;
/** 已加载的 mail 消息（spaceId → messages；跨 tab 存活，切回不再重复拉全量）。 */
let mailCache: Record<string, MailMessage[]> = {};
/** 当前渲染的「协作对话」<details> 与内容容器（由装配创建，跨渲染复用引用）。 */
let mailLogElRef: HTMLElement | null = null;
let mailBoxRef: HTMLDetailsElement | null = null;
let mailSpaceIdRef: string | null = null;

// ═══ P3-A：HumanDecision 统一决策队列（待处理徽章 + 下拉快速处理）═══
/** 会话级待处理决策（轮询 /api/decisions/pending 拉取，含 plan/ask/approval 三类聚合）。 */
let pendingDecisions: DecisionItem[] = [];
/** 徽章按钮 + 下拉列表容器（装配创建）。 */
let badgeBtnRef: HTMLElement | null = null;
let pendingPopRef: HTMLElement | null = null;
let pendingBadgeHook: (() => void) | undefined;

/** 拉取统一决策队列并刷新徽章（供轮询/事件/渲染复用）。 */
async function refreshPendingDecisions(): Promise<void> {
  if (!apiRef) return;
  try {
    const r = await apiRef.getPendingDecisions();
    if (r?.ok && Array.isArray(r.decisions)) pendingDecisions = r.decisions;
  } catch {
    /* 后端不可用：维持旧值（UI 已降级保留原有 plan/ask/approval 渲染） */
  }
  pendingBadgeHook?.();
}

/** P3-A：从待处理徽章快速决议一项（plan/approval 可直接处理；ask 引导到聊天气泡输入）。 */
async function respondViaBadge(id: string, decision: string | undefined, btn?: HTMLElement): Promise<void> {
  if (!apiRef) return;
  try {
    await apiRef.respondDecision(id, decision);
    pendingDecisions = pendingDecisions.filter((x) => x.id !== id);
    pendingBadgeHook?.();
    if (btn) btn.replaceChildren('✅ 已处理');
  } catch {
    if (btn) btn.replaceChildren('⚠️ 处理失败');
  }
}

/** 统一决策类型文案/图标。 */
function decisionKindMeta(kind: string): { icon: string; label: string } {
  if (kind === 'plan') return { icon: '📋', label: '确认方案' };
  if (kind === 'approval') return { icon: '⚠️', label: '审批' };
  return { icon: '❓', label: '回答' };
}

/** 17k.3：构建一张「待你决定」交互卡片（plan/ask/approval 统一；切视图重载后回复入口不丢）。 */
function buildDecisionCard(d: DecisionItem): HTMLElement {
  const km = decisionKindMeta(d.kind);
  const title = d.title || d.question || d.goal || '待你决定';
  const headEl = el('div', { class: 'pending-card-head' }, [
    el('span', { class: 'pending-item-kind' }, `${km.icon} ${km.label}`),
    el('span', { class: 'pending-item-goal' }, truncate(d.goal || title, 30)),
  ]);
  const bodyEl = el('div', { class: 'pending-card-q' },
    (d.kind === 'ask' && (!d.question || d.question === '需要你补充一些信息'))
      ? '该任务需要你补充一些信息：请在下方输入你的回答或补充需求细节（例如技术栈、风格、预算等），提交后任务继续。'
      : (d.question || title));
  const actionsEl = el('div', { class: 'pending-card-actions' });
  let card: HTMLElement | undefined;
  const markDone = (): void => {
    pendingDecisions = pendingDecisions.filter((x) => x.id !== d.id);
    pendingBadgeHook?.();
    if (card && card.isConnected) card.replaceWith(el('div', { class: 'pending-card-done' }, '✅ 已处理'));
  };
  const submit = async (decision?: string, answer?: string): Promise<void> => {
    try { if (apiRef) await apiRef.respondDecision(d.id, decision, answer); } catch { /* 忽略（后端抖动） */ }
    markDone();
    void refreshPendingDecisions(); // 17k.7：与后端同步（避免刷新后未决气泡复活）
  };
  if (d.kind === 'plan') {
    actionsEl.appendChild(button('确认继续 ▶', () => { void submit(undefined); }, 'send'));
  } else if (d.kind === 'approval') {
    actionsEl.appendChild(button('✅ 批准', () => { void submit('APPROVED'); }, 'ok'));
    actionsEl.appendChild(button('❌ 拒绝', () => { void submit('REJECTED'); }, 'danger'));
  } else {
    const inputRef = el('input', { type: 'text', class: 'clarify-input', placeholder: '输入你的回答…' }) as HTMLInputElement;
    actionsEl.appendChild(inputRef);
    actionsEl.appendChild(button('提交回答', () => { const a = inputRef.value.trim(); if (a) void submit(undefined, a); }, 'send'));
  }
  card = el('div', { class: 'chat-msg assistant' }, [
    el('div', { class: 'head' }, [
      el('span', { class: 'who' }, 'MorPex'),
      el('span', { class: 'time' }, tsTime(Date.now())),
    ]),
    el('div', { class: 'body' }, el('div', { class: 'pending-card' }, [headEl, bodyEl, actionsEl])),
  ]);
  return card;
}

/** P2：渲染/追加一条 mail 消息到「协作对话」容器（幂等按 id 去重）。 */
function appendMailMessage(spaceId: string, m: MailMessage): void {
  const arr: MailMessage[] = (mailCache[spaceId] ??= []);
  if (arr.some((x) => x.id === m.id)) return;
  arr.push(m);
  arr.sort((a: MailMessage, b: MailMessage) => a.createdAt - b.createdAt);
  if (mailSpaceIdRef === spaceId && mailLogElRef && mailBoxRef) {
    const statusTxt = m.status === 'pending' ? '⏳ 等待回复' : m.status === 'timeout' ? '⏱ 超时' : '✅ 已回复';
    mailLogElRef.appendChild(
      el('div', { class: 'mail-bubble' }, [
        el('div', { class: 'mail-q' }, [
          el('span', { class: 'mail-route' }, `${m.from} → ${m.to}`),
          el('span', { class: 'mail-text' }, m.question),
        ]),
        ...(m.reply ? [el('div', { class: 'mail-a' }, m.reply)] : []),
        el('div', { class: 'mail-meta' }, [
          el('span', { class: 'mail-time' }, tsTime(m.createdAt)),
          el('span', { class: `mail-status ${m.status}` }, statusTxt),
        ]),
      ]),
    );
    const count = (arr.length);
    mailBoxRef.querySelector('summary')?.replaceChildren('🗣 协作对话（' + count + '）');
  }
}

/** P2：进入部门 Space 时拉取协作对话记录（只读旁观）。 */
async function loadMailbox(spaceId: string): Promise<void> {
  if (!apiRef) return;
  mailSpaceIdRef = spaceId;
  if (mailBoxRef && mailLogElRef) {
    mailBoxRef.open = true;
  }
  try {
    const r = await apiRef.getMailboxMessages(spaceId);
    if (r?.ok && Array.isArray(r.messages)) {
      mailCache[spaceId] = r.messages.slice().sort((a: MailMessage, b: MailMessage) => a.createdAt - b.createdAt);
      if (mailSpaceIdRef === spaceId && mailLogElRef) {
        mailLogElRef.replaceChildren(...mailCache[spaceId].map((m) => {
          const statusTxt = m.status === 'pending' ? '⏳ 等待回复' : m.status === 'timeout' ? '⏱ 超时' : '✅ 已回复';
          return el('div', { class: 'mail-bubble' }, [
            el('div', { class: 'mail-q' }, [
              el('span', { class: 'mail-route' }, `${m.from} → ${m.to}`),
              el('span', { class: 'mail-text' }, m.question),
            ]),
            ...(m.reply ? [el('div', { class: 'mail-a' }, m.reply)] : []),
            el('div', { class: 'mail-meta' }, [
              el('span', { class: 'mail-time' }, tsTime(m.createdAt)),
              el('span', { class: `mail-status ${m.status}` }, statusTxt),
            ]),
          ]);
        }));
        if (mailBoxRef) mailBoxRef.querySelector('summary')?.replaceChildren('🗣 协作对话（' + mailCache[spaceId].length + '）');
      }
    }
  } catch {
    /* 后端未支持：保持空态 */
  }
}

function loadTasksFromStorage(): void {
  try {
    const raw = localStorage.getItem(TASKS_STORAGE_KEY);
    if (raw) tasks = (JSON.parse(raw) as TaskListItem[]).filter((t) => t && typeof t.id === 'string');
  } catch {
    tasks = [];
  }
}
function persistTasks(): void {
  try {
    if (tasks.length > 50) tasks = tasks.slice(tasks.length - 50);
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
  } catch {
    /* 忽略 */
  }
}
function upsertTask(t: Partial<TaskListItem> & { id: string }): void {
  const i = tasks.findIndex((x) => x.id === t.id);
  if (i >= 0) {
    tasks[i] = { ...tasks[i], ...t, updatedAt: Date.now() };
  } else {
    tasks.push({
      id: t.id,
      threadId: t.threadId,
      runId: t.runId,
      sessionId: t.sessionId ?? '',
      title: t.title ?? t.goal ?? t.id,
      goal: t.goal ?? '',
      deptId: t.deptId,
      deptName: t.deptName,
      status: t.status ?? 'pending',
      progress: t.progress ?? '',
      result: t.result,
      createdAt: t.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    } as TaskListItem);
  }
  persistTasks();
  taskListHook?.();
}
function removeTask(id: string): void {
  tasks = tasks.filter((x) => x.id !== id);
  persistTasks();
  if (currentTaskId === id) {
    currentTaskId = undefined;
    taskListHook?.();
  }
}
/** deepseek 风格任务标题摘要：去语气/谓语前缀 + 收尾符 + 截断 ≤12 字。 */
function taskTitle(goal: string): string {
  const g = goal.trim();
  const m = g
    .replace(/^(请|帮我|给我|帮|做|写|生成|创建|设计|开发|制作|实现|搞|弄|做一个|搞一个|写一个|生成一个|创建一个|做一个|开发一个|设计一个)[的个]?\s*/i, '')
    .replace(/[。.！!？?，,]$/, '');
  const t = m || g;
  return t.length > 14 ? `${t.slice(0, 14)}…` : t;
}

/** 用所有在途 run 状态刷新任务列表项（状态/进度/threadId）。模块级，供 SSE 事件同步。 */
function syncTaskFromRun(): void {
  for (const run of activeRuns.values()) {
    let item = tasks.find((x) => x.runId === run.runId)
      || tasks.find((x) => x.threadId && x.threadId === run.state?.missionId);
    if (!item) continue;
    const s = run.state;
    if (s.missionId && !item.threadId) item.threadId = s.missionId;
    // 人工门 pending → waiting（需回复）；否则 running
    const hasPendingGate =
      s.approvals.some((a) => a.status === 'pending')
      || s.asks.some((a) => !a.answered)
      || (!!s.plan && !s.plan.confirmed);
    if (!run.done) item.status = hasPendingGate ? 'waiting' : 'running';
    // 进度：已完成步骤 / 总步骤（DAG 节点数优先）
    const total = s.dag?.nodes?.length || s.steps.length || 0;
    const doneSteps = s.steps.filter((x) => x.status === 'done' || x.status === 'failed').length;
    item.progress = total > 0 ? `${doneSteps}/${total}` : '';
    upsertTask(item);
  }
}

/** 17i.11：从事件生成一句拟人化对话（经理 persona）；无关事件返回 null。 */
function narrativeLine(state: TaskRunState, evt: StreamEvent): { persona: string; text: string } | null {
  const type = evt.type ?? '';
  const payload = (evt.payload ?? {}) as Record<string, unknown>;
  const manager = pickManager(state.goal || '');
  const name = String(payload.nodeName ?? payload.nodeId ?? '');
  if (type === 'mission.created') return { persona: manager, text: '好的，收到任务，马上开始分析。' };
  if (type === 'mission.updated') {
    const phase = payload.phase;
    if (phase === 'PLANNING' || phase === 'SIMULATING') return { persona: manager, text: '正在分析需求并确定方案…' };
    if (phase === 'EXECUTING') return { persona: manager, text: '方案已确定，开始执行。' };
  }
  if (type === 'execution.step.started' || type === 'workflow.step_started') {
    return { persona: manager, text: `已指派 Agent 执行：${name}` };
  }
  if (type === 'execution.step.result') {
    return { persona: manager, text: `${name} ${payload.success === true ? '✅ 完成' : '❌ 失败'}` };
  }
  if (type === 'workflow.step_completed') return { persona: manager, text: `${name} ✅ 完成` };
  if (type === 'workflow.step_failed') return { persona: manager, text: `${name} ❌ 失败` };
  if (type === 'approval.wait_human' || type === 'approval.required') return { persona: '⚠️ 审批', text: '需要你的确认（见上方审批提示）。' };
  if (type === 'mission.completed') return { persona: manager, text: '🎉 任务完成，正在汇总报告…' };
  if (type === 'mission.failed') return { persona: manager, text: '任务执行失败，详见报告。' };
  if (type === 'workflow.completed') return { persona: manager, text: '所有 Agent 已完成执行。' };
  return null;
}

/** 17i.15：LLM 自主提问 → 拟人问答气泡（聊天中呈现，回答后回调）。 */
function buildAskPrompt(goal: string, ask: RunAsk, onAnswer: (answer: string) => void): HTMLElement {
  const manager = pickManager(goal);
  const answers: { v: string } = { v: '' };
  const inputRef = el('input', {
    type: 'text',
    class: 'clarify-input',
    placeholder: '输入你的回答…',
    oninput: () => {
      answers.v = (inputRef as HTMLInputElement).value.trim();
      for (const b of optionBtns) b.classList.remove('selected');
    },
  }) as HTMLInputElement;
  const optionBtns = (ask.options ?? []).map((opt) => {
    const btn = el('button', {
      class: 'btn small chip',
      onclick: () => {
        answers.v = opt;
        for (const b of optionBtns) b.classList.remove('selected');
        btn.classList.add('selected');
        inputRef.value = '';
      },
    }, opt) as HTMLButtonElement;
    return btn;
  });
  const submit = button('提交回答', () => {
    onAnswer(answers.v || (ask.options?.[0] ?? ''));
  }, 'send');
  return el('div', { class: 'clarify-prompt' }, [
    el('div', { class: 'clarify-persona' }, `${manager}：${ask.question}`),
    ...(optionBtns.length > 0 ? [el('div', { class: 'clarify-options' }, optionBtns)] : []),
    inputRef,
    el('div', { class: 'clarify-actions' }, [submit]),
  ]);
}

/** 17i.24：把 markdown 渲染后的 HTML 包进带样式的文档（iframe srcdoc）。 */
function buildMarkdownDoc(html: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
    font-size:14px;line-height:1.7;color:#24292f;padding:20px 28px;max-width:820px;margin:0 auto;}
  h1,h2,h3{line-height:1.3;margin:1.2em 0 .5em;}
  h1{border-bottom:1px solid #e1e4e8;padding-bottom:.3em;}
  h2{border-bottom:1px solid #eaecef;padding-bottom:.3em;}
  code{background:#f0f3f6;border-radius:4px;padding:1px 5px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;}
  pre{background:#0d1117;color:#e6edf3;border-radius:8px;padding:12px 14px;overflow:auto;}
  pre code{background:none;padding:0;color:inherit;}
  blockquote{border-left:4px solid #d0d7de;color:#57606a;margin:1em 0;padding:.2em 1em;}
  table{border-collapse:collapse;margin:1em 0;}
  th,td{border:1px solid #d0d7de;padding:6px 12px;text-align:left;}
  th{background:#f0f3f6;}
  a{color:#0969da;}
  img{max-width:100%;}
  hr{border:none;border-top:1px solid #e1e4e8;margin:1.5em 0;}
  li{margin:.2em 0;}
  /* highlight.js github-dark（代码块） */
  .hljs{color:#c9d1d9;background:#0d1117;}
  .hljs-keyword,.hljs-selector-tag,.hljs-literal{color:#ff7b72;}
  .hljs-string,.hljs-attr,.hljs-addition{color:#a5d6ff;}
  .hljs-number,.hljs-symbol,.hljs-bullet{color:#79c0ff;}
  .hljs-comment,.hljs-quote{color:#8b949e;font-style:italic;}
  .hljs-title,.hljs-title.function_,.hljs-section{color:#d2a8ff;}
  .hljs-params{color:#c9d1d9;}
  .hljs-built_in,.hljs-type{color:#ffa657;}
  .hljs-variable,.hljs-template-variable{color:#ffa657;}
  .hljs-meta{color:#79c0ff;}
  .hljs-attribute{color:#ffa657;}
  .hljs-tag{color:#79c0ff;}
  .hljs-name{color:#7ee787;}
  .hljs-deletion{color:#ffa198;}
  .hljs-emphasis{font-style:italic;}
  .hljs-strong{font-weight:600;}
  /* 代码块行号 */
  .code-wrap{display:flex;border-radius:8px;overflow:auto;background:#0d1117;margin:1em 0;}
  .code-gutter{flex:none;margin:0;padding:12px 8px 12px 14px;text-align:right;user-select:none;background:#161b22;color:#6e7781;border-right:1px solid #30363d;font-family:ui-monospace,monospace;font-size:13px;line-height:1.6;white-space:pre;position:sticky;left:0;}
  .code-body{flex:1;min-width:max-content;margin:0;padding:12px 14px;background:#0d1117;font-family:ui-monospace,monospace;font-size:13px;line-height:1.6;white-space:pre;overflow:visible;}
  .code-body code.hljs{background:transparent;padding:0;}
</style></head><body>${html}</body></html>`;
}

/** 17i.22：规划方案确认消息（经理汇报 + 可点击方案文件 + 步骤 + 继续按钮）。 */
function buildPlanMessage(goal: string, plan: RunPlan, onContinue: () => void, onOpenPlan: (file: string) => void): HTMLElement {
  const manager = pickManager(goal);
  const fileName = plan.planFile.split(/[\\/]/).pop() ?? plan.planFile;
  return el('div', { class: 'clarify-prompt' }, [
    el('div', { class: 'clarify-persona' }, [
      `${manager}：规划方案已经做好，这里是规划方案的具体文件：`,
      el('button', { class: 'plan-file-link', title: plan.planFile, onclick: () => onOpenPlan(plan.planFile) }, `📄 ${fileName}`),
      '。如需继续，请回复或点击下方按钮。',
    ]),
    el('div', { class: 'plan-steps' }, plan.stepNames.map((s, i) => el('div', { class: 'plan-step' }, `${i + 1}. ${s}`))),
    el('div', { class: 'clarify-actions' }, [button('继续执行 ▶', onContinue, 'send')]),
  ]);
}

/** 创建实时卡片宿主：绑定 run(ActiveRun) → 卡片 DOM 的渲染钩子（含完成后升级为最终卡片）。 */
function createLiveCardHost(cardEl: HTMLElement, run: ActiveRun): { render: () => void } {
  const controller = new LiveCardController(cardEl);
  const decide = (id: string, d: 'APPROVED' | 'REJECTED'): void => {
    void (async () => {
      try {
        if (!runApi) return;
        await runApi.decideApproval(id, d);
        const ap = run.state.approvals.find((x) => x.id === id);
        if (ap) ap.status = 'resolved';
        run.syncHook?.();
      } catch (err) {
        console.warn('[console] 审批决议失败:', err);
      }
    })();
  };
  const render = (): void => {
    if (run.done && run.resultMsg) {
      // 完成后升级为最终消息（任务卡片 / 失败错误气泡，一次性替换）
      if (cardEl.isConnected) cardEl.replaceWith(buildMsgNode(run.resultMsg));
      return;
    }
    controller.render(run.state, run.startedAt, decide, (el) => { run.elapsedEl = el; });
  };
  return { render };
}

/** 防御性提取 chat/send 结果的可读文本（executeGoal 返回结构未知）。 */
function extractReport(r: Record<string, unknown>): string {
  const report = r.report;
  if (typeof report === 'string' && report.trim()) return report;
  if (typeof report === 'object' && report !== null) return JSON.stringify(report, null, 2);
  const summary = r.summary;
  if (typeof summary === 'string' && summary.trim()) return summary;
  const output = r.output;
  if (typeof output === 'string' && output.trim()) return output;
  return '';
}

/** 结果关键元数据行（executionId / missionId / status / ok）。 */
function metaRows(r: Record<string, unknown>): Array<{ k: string; v: string }> {
  const rows: Array<{ k: string; v: string }> = [];
  for (const k of ['executionId', 'missionId', 'status', 'ok'] as const) {
    const v = r[k];
    if (v !== undefined && v !== null) rows.push({ k, v: String(v) });
  }
  return rows;
}

function buildMsgNode(m: ChatMsg): HTMLElement {
  const head = el('div', { class: 'head' }, [
    el('span', { class: 'who' }, m.role === 'user' ? '你' : 'MorPex'),
    el('span', { class: 'time' }, tsTime(m.ts)),
  ]);

  if (m.role === 'user') {
    return el('div', { class: 'chat-msg user' }, [head, el('div', { class: 'body' }, m.content)]);
  }

  const bodyNodes: Child[] = [];
  if (m.task) {
    // 17i：任务模式 → 任务卡片（含步骤/耗时/可展开实时进度）
    bodyNodes.push(el('div', { class: 'body' }, buildFinalTaskCard(m.task)));
  } else {
    bodyNodes.push(el('div', { class: 'body' }, m.content || '(无文本输出)'));
  }
  if (m.meta && m.meta.length > 0) {
    bodyNodes.push(el('div', { class: 'meta-line' }, m.meta.map((x) => `${x.k}=${x.v}`).join('  ')));
  }
  if (m.raw !== undefined) {
    bodyNodes.push(
      el('details', { class: 'raw-json' }, [
        el('summary', null, '查看原始 JSON'),
        jsonPre(m.raw),
      ]),
    );
  }
  return el('div', { class: `chat-msg assistant${m.error ? ' error' : ''}` }, [head, ...bodyNodes]);
}

// ═══ 模块级会话状态：跨标签切换存活（避免每次进会话页自动新建会话）═══
const SESSION_STORAGE_KEY = 'morpex.active-session';
let currentSessionId: string | undefined;
let messages: ChatMsg[] = [];

function persistSession(id: string): void {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, id);
  } catch {
    /* 忽略 */
  }
}
function readStoredSession(): string | undefined {
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
function clearStoredSession(): void {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* 忽略 */
  }
}

export function renderConsole(root: HTMLElement, api: ApiClient): () => void {
  apiRef = api; // P2/P3：模块级函数（refreshPendingDecisions/loadMailbox 等）复用
  let sending = false;
  let retryTimer: number | undefined;
  // 17i.29：后端就绪标志——未就绪时禁用发送，避免启动竞态 Failed to fetch
  let backendReady = false;
  function setBackendReady(ready: boolean): void {
    backendReady = ready;
    sendBtn.disabled = sending || !ready;
    // 17i.34：就绪时清除「未就绪」状态文字（此前一直残留直到发消息才被覆盖）
    if (ready) {
      if (!sending) statusEl.textContent = '';
    } else if (!sending) {
      statusEl.textContent = '后端未就绪，正在启动，自动重试中…';
    }
  }
  const pendingAttachments: PendingAttachment[] = [];

  // ── DOM ──
  const logEl = el('div', { class: 'chat-log' });
  const taskPanelEl = el('div', { class: 'task-panel' });
  // 17i.28：任务面板按会话归属——切换会话时清空（面板/已完成列表），回到该会话再重建。
  let panelSessionId: string | undefined;
  function syncPanelForSession(id: string | undefined): void {
    if (panelSessionId === id) return;
    panelSessionId = id;
    completedTasks = [];
    taskPanelEl.replaceChildren();
  }
  const sessionListEl = el('div', { class: 'session-list' });
  const statusEl = el('span', { class: 'chat-status' });
  const titleEl = el('div', { class: 'chat-title' }, '会话');
  const modelSel = el('select', { class: 'model-select', title: '切换模型（全局生效，影响之后所有对话与任务生成）' });
  // 17i.22：Goal 模式开关（全自动执行，跳过方案确认）
  const goalModeBtn = el('button', {
    class: `btn small goal-mode${goalMode ? ' on' : ''}`,
    title: goalMode ? 'Goal 模式：全自动执行（点击关闭）' : '点击开启 Goal 模式：全自动执行，跳过方案确认',
    onclick: () => {
      goalMode = !goalMode;
      try { localStorage.setItem('morpex.goal-mode', goalMode ? '1' : '0'); } catch { /* 忽略 */ }
      goalModeBtn.classList.toggle('on', goalMode);
      goalModeBtn.title = goalMode ? 'Goal 模式：全自动执行（点击关闭）' : '点击开启 Goal 模式：全自动执行，跳过方案确认';
      updateStatus(goalMode ? '⚡ Goal 模式已开启（全自动）' : 'Goal 模式已关闭');
    },
  }, goalMode ? '⚡ Goal 模式' : 'Goal 模式');
  const inputEl = el('textarea', {
    class: 'chat-input-box',
    placeholder: '输入目标，如「写一个 todo 应用的代码实现」；Enter 发送 / Shift+Enter 换行',
    oninput: () => autoResizeInput(),
    onkeydown: (e: Event) => {
      const ke = e as KeyboardEvent;
      // ═══ 会话 17h·review I1：中文输入法候选词确认时 isComposing=true，必须忽略，防半截拼音误发送 ═══
      if (ke.key === 'Enter' && !ke.shiftKey && !ke.isComposing) {
        ke.preventDefault();
        void send();
      }
    },
  });
  const sendBtn = button('发送', () => void send(), 'send');
  const newChatBtn = button('＋ 新对话', () => void newSession(), 'new-chat');
  const deleteBtn = button('删除会话', () => void deleteCurrentSession(), 'danger small');
  const fileInput = el('input', {
    type: 'file',
    multiple: true,
    class: 'file-input',
    style: 'display:none',
  });
  const attachBtn = button('📎', () => fileInput.click(), 'attach-btn');
  const attachRow = el('div', { class: 'attach-row' });

  // ═══ P1：Space 视图状态（总部/部门空间）；UI 改版：+ 'task' 任务聊天视图 ═══
  let viewMode: 'session' | 'hq' | 'dept' | 'task' = 'session';
  let spaceViewId: string | undefined; // 当前 Space id（'hq' / dept_xxx）
  let spaceDeptId: string | undefined; // 当前 Space 的 departmentId（dept 视图）
  let spaceThread: string = 'all';     // 线程过滤：'all' 或 threadId
  let spaceFull: ChatMsg[] = [];       // 当前 Space 全量消息（服务端 + 本会话新增；thread='all' 时与 messages 同引用）
  const spaceListEl = el('div', { class: 'space-tree' });
  const spaceInfoBarEl = el('div', { class: 'space-info-bar', style: 'display:none' });
  const threadBarEl = el('div', { class: 'thread-bar', style: 'display:none' });
  // UI 改版：左下角全局任务列表（替换历史会话区）
  const taskListEl = el('div', { class: 'task-list' });

  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = '';
    void uploadFiles(files);
  });

  // ── 状态/工具 ──
  /** 输入框自动增高：内容变化时按 scrollHeight 跟随（min/max-height 由 CSS 钳制）。 */
  function autoResizeInput(): void {
    inputEl.style.height = 'auto';
    inputEl.style.height = `${inputEl.scrollHeight}px`;
  }

  /** 发送后输入已清空：移除内联高度，回落 CSS min-height（42px）。 */
  function resetInputHeight(): void {
    inputEl.style.height = '';
  }

  function setSending(v: boolean): void {
    sending = v;
    sendBtn.disabled = v || !backendReady;
    inputEl.disabled = v;
    newChatBtn.disabled = v;
    statusEl.textContent = v ? '正在思考/执行…' : '';
    statusEl.classList.remove('error');
    if (!v) inputEl.focus();
  }

  function updateStatus(text?: string, isError = false): void {
    statusEl.textContent = text ?? '';
    statusEl.classList.toggle('error', isError);
  }

  function updateTitle(): void {
    if (viewMode === 'task' && currentTaskId) {
      const t = tasks.find((x) => x.id === currentTaskId);
      if (t) {
        const ic = t.status === 'done' ? '✅' : t.status === 'failed' ? '❌' : t.status === 'waiting' ? '⏸' : t.status === 'running' ? '⏳' : '·';
        titleEl.textContent = `${ic} ${t.title}`;
        return;
      }
    }
    if (viewMode !== 'session' && spaceViewId) {
      const n = spaceTree.find((s) => s.id === spaceViewId);
      titleEl.textContent = n ? `${n.icon ?? ''} ${n.name}` : '空间';
      return;
    }
    titleEl.textContent = currentSessionId ? `会话 ${currentSessionId.slice(0, 12)}` : '新会话';
  }

  /** P1：Space 视图控件同步（删除按钮在 Space 视图隐藏；返回会话视图恢复）。 */
  function syncViewControls(): void {
    const inSpace = viewMode !== 'session';
    deleteBtn.style.display = inSpace ? 'none' : '';
    if (!inSpace) {
      spaceInfoBarEl.style.display = 'none';
      threadBarEl.style.display = 'none';
    }
    // P2：协作对话旁观区——仅部门 Space 显示并拉取；总部/会话视图隐藏
    if (mailBoxRef) {
      if (viewMode === 'dept' && spaceViewId) {
        mailBoxRef.style.display = '';
        void loadMailbox(spaceViewId);
      } else {
        mailBoxRef.style.display = 'none';
      }
    }
    renderSpaceTree(); // 刷新侧栏 active 高亮
    renderTaskList();  // UI 改版：刷新任务列表高亮
    // 17k.2：任务工作台——仅任务视图显示；切走清空 + 解锁
    if (viewMode === 'task') {
      taskPanelEl.style.display = '';
    } else {
      taskPanelEl.style.display = 'none';
      taskPanelEl.replaceChildren();
      activeWorkbenchRunId = undefined;
    }
  }

  /** P1：空间消息线程过滤（thread='all' 时 messages 与 spaceFull 同引用，发送追加天然同步）。 */
  function applyThreadFilter(): void {
    if (viewMode === 'session') return;
    messages = spaceThread === 'all' ? spaceFull : spaceFull.filter((m) => m.threadId === spaceThread);
  }

  /** P1：部门 Space 线程条（按消息 threadId 分组，可切换聚焦；无线程 → 隐藏）。 */
  function renderThreadBar(): void {
    if (viewMode !== 'dept') { threadBarEl.style.display = 'none'; return; }
    const ids = Array.from(new Set(spaceFull.map((m) => m.threadId).filter((t): t is string => !!t)));
    if (ids.length === 0) { threadBarEl.style.display = 'none'; return; }
    threadBarEl.style.display = 'flex';
    const chips = [
      el('button', {
        class: `thread-chip${spaceThread === 'all' ? ' active' : ''}`,
        onclick: () => { spaceThread = 'all'; applyThreadFilter(); renderThreadBar(); renderLog(); },
      }, '全部'),
    ];
    for (const t of ids) {
      chips.push(el('button', {
        class: `thread-chip${spaceThread === t ? ' active' : ''}`,
        onclick: () => { spaceThread = t; applyThreadFilter(); renderThreadBar(); renderLog(); },
      }, `任务 ${t.slice(-10)}`));
    }
    threadBarEl.replaceChildren(el('span', { class: 'thread-bar-label' }, '任务线程：'), ...chips);
  }

  /** P1：部门 Space 信息条（经理 persona / 工位能力 / 秘书说明）。 */
  function renderSpaceInfoBar(node?: SpaceNode): void {
    if (!node) {
      spaceInfoBarEl.style.display = 'none';
      spaceInfoBarEl.replaceChildren();
      return;
    }
    spaceInfoBarEl.style.display = 'flex';
    if (node.id === 'hq' || node.departmentId === undefined) {
      spaceInfoBarEl.replaceChildren(
        el('div', { class: 'space-info-text' }, '🤖 秘书：日常闲聊 + 任务路由。任务会自动转交对应部门，进度与对话见各部门空间。'),
      );
      return;
    }
    const dept = spaceDepartments.find((d) => d.id === node.id);
    const caps = dept?.capabilities ?? [];
    spaceInfoBarEl.replaceChildren(
      el('div', { class: 'space-info-name' }, `${node.icon ?? '🏢'} ${node.name}`),
      ...(caps.length > 0
        ? [el('div', { class: 'space-info-caps' }, caps.slice(0, 8).map((c) => el('span', { class: 'cap-chip' }, c)))]
        : [el('div', { class: 'space-info-caps muted' }, '工位能力将由 AI 按任务复杂度动态编排')]),
    );
  }

  /** P1：进入 Space（总部/部门）——切视图、加载空间消息、显示信息条/线程条。 */
  function enterSpace(node: SpaceNode): void {
    viewMode = node.isDept ? 'dept' : 'hq';
    spaceViewId = node.id;
    spaceDeptId = node.isDept ? (node.departmentId ?? node.id) : undefined;
    spaceThread = 'all';
    spaceFull = [];
    currentTaskId = undefined; // 离开任务聊天视图
    updateTitle();
    syncViewControls();
    renderSpaceInfoBar(node);
    renderThreadBar();
    renderEmpty();
    void loadSpaceMessages(node.id);
  }
  // UI 改版：task.routed 事件 → 早期跳转到部门 Space（模块级处理器经此回跳当前渲染）
  spaceJumpHook = (spaceId: string) => {
    const n = spaceTree.find((s) => s.id === spaceId);
    if (n) enterSpace(n);
  };

  /** P1：加载 Space 消息（后端未支持 → 空态，优雅降级）。 */
  /** 17k.3+：切回空间/任务后重建「待你决定」卡片（plan/ask/approval 回复入口不丢）。
   * 归属过滤（第一性原理：决策项必须有归属键 spaceId/goal）——避免「所有部门都出现回答气泡」：
   *  - task 视图：仅显示 goal 匹配当前任务的 pending
   *  - dept 视图：仅显示 spaceId===当前部门 或 goal 匹配该部门任一任务的 pending
   *  - 其它（hq/session）：不显示 prompt 卡片（全局入口=header 🔔 待处理徽章） */
  function renderPendingPromptCards(ctx?: { spaceId?: string; goal?: string; deptGoals?: string[] }): void {
    const pend = pendingDecisions.filter((d) => !d.status || d.status === 'pending');
    if (pend.length === 0) return;
    // 移除旧卡片（避免每次重载堆叠）
    for (const old of logEl.querySelectorAll('.pending-prompt')) old.remove();
    const matches = (d: DecisionItem): boolean => {
      // 归属键优先 goal；兜底 meta.sessionId（旧 ask 数据把 goal 文本存进了 sessionId）
      const rawGoal = d.goal ?? '';
      const metaSid = typeof (d.meta as { sessionId?: string } | undefined)?.sessionId === 'string'
        ? (d.meta as { sessionId?: string }).sessionId ?? ''
        : '';
      const dg = rawGoal || metaSid;
      const taskEnded = (t?: TaskListItem): boolean => !!t && (t.status === 'done' || t.status === 'failed');
      // 任务已结束 → 其 pending 决策不再显示（回答无意义，避免误导「需回复」）
      if (ctx?.goal && !ctx.spaceId) {
        const cur = tasks.find((x) => x.goal === ctx.goal || (ctx.goal && x.goal && ctx.goal.includes(x.goal)));
        if (taskEnded(cur)) return false;
      }
      if (ctx?.spaceId && d.spaceId && d.spaceId === ctx.spaceId) return true;
      if (ctx?.goal && dg && (dg.includes(ctx.goal) || ctx.goal.includes(dg))) return true;
      if (ctx?.spaceId && dg && ctx.deptGoals?.some((g) => g && (g.includes(dg) || dg.includes(g)))) {
        // 部门视图：仅当匹配到「至少一个未结束任务」才显示（避免失败任务的决策污染部门页）
        const rel = tasks.filter((x) => x.deptId === ctx.spaceId && x.goal && (x.goal.includes(dg) || dg.includes(x.goal)));
        if (rel.length > 0 && rel.every(taskEnded)) return false;
        return true;
      }
      // 无归属信息（旧数据）兜底：task 视图下若当前任务在途且有 pending ask → 显示（避免用户看不到回复入口）
      if (!rawGoal && ctx?.goal && d.kind === 'ask' && ctx.deptGoals === undefined) {
        const t = tasks.find((x) => x.goal === ctx.goal || (ctx.goal && x.goal && ctx.goal.includes(x.goal)));
        if (t && t.runId && activeRuns.has(t.runId)) return true;
      }
      return false; // 无归属信息/不匹配 → 不显示（防污染其它部门/总部）
    };
    const mine = pend.filter(matches);
    if (mine.length === 0) return;
    logEl.appendChild(el('div', { class: 'pending-prompt' }, mine.map(buildDecisionCard)));
    logEl.scrollTop = logEl.scrollHeight;
  }

  async function loadSpaceMessages(spaceId: string): Promise<void> {
    try {
      const r = await api.getSpaceMessages(spaceId, currentSessionId);
      spaceFull = (r.messages ?? []).map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
        ts: m.timestamp,
        threadId: m.threadId ?? (m.kind === 'task' ? undefined : undefined),
      }));
    } catch {
      spaceFull = [];
    }
    applyThreadFilter();
    renderThreadBar();
    if (messages.length === 0) renderEmpty();
    else renderLog();
    // 17k.3+：切回空间/任务后重建「待你决定」卡片（按归属过滤；从 pendingDecisions 恢复，切视图不丢）
    let pendCtx: { spaceId?: string; goal?: string; deptGoals?: string[] } | undefined;
    if (viewMode === 'task' && currentTaskId) {
      const t = tasks.find((x) => x.id === currentTaskId);
      pendCtx = { goal: t?.goal };
    } else if (viewMode === 'dept' && spaceViewId) {
      pendCtx = { spaceId: spaceViewId, deptGoals: tasks.filter((x) => x.deptId === spaceViewId).map((x) => x.goal) };
    }
    renderPendingPromptCards(pendCtx);
    // 确保队列最新（异步拉到后再幂等重渲一次）
    void refreshPendingDecisions().then(() => renderPendingPromptCards(pendCtx));
  }

  /** P1：加载空间树（GET /api/spaces；后端未支持 → 侧栏仅历史会话）。 */
  async function loadSpaces(): Promise<void> {
    try {
      const r = await api.getSpaces();
      hqSpace = r.tree?.hq;
      spaceDepartments = r.tree?.departments ?? [];
    } catch {
      hqSpace = undefined;
      spaceDepartments = [];
    }
    renderSpaceTree();
  }

  /** P1：渲染侧栏空间树（总部 + 部门）。 */
  function renderSpaceTree(): void {
    const nodes: SpaceNode[] = [];
    if (hqSpace) nodes.push({ id: hqSpace.id || 'hq', name: hqSpace.name || '总部（秘书）', icon: hqSpace.icon ?? '🏢' });
    for (const d of spaceDepartments) {
      nodes.push({ id: d.id, name: d.name || d.id, icon: d.icon ?? '🏢', departmentId: d.departmentId, isDept: true });
    }
    spaceTree = nodes;
    if (nodes.length === 0) {
      spaceListEl.replaceChildren(el('div', { class: 'sidebar-empty' }, '暂无部门空间（未安装工作流 / 后端未支持）'));
      return;
    }
    spaceListEl.replaceChildren(...nodes.map((n) => {
      const active = viewMode !== 'session' && spaceViewId === n.id;
      const item = el('div', { class: `space-item${active ? ' active' : ''}` }, [
        el('span', { class: 'space-icon' }, n.icon ?? '🏢'),
        el('span', { class: 'space-name' }, n.name),
      ]);
      item.addEventListener('click', () => enterSpace(n));
      return item;
    }));
  }

  /** UI 改版：左下角全局任务列表（标题/状态/进度），点击切换任务聊天。 */
  // 17k.2：当前工作台所属 runId（仅任务视图/选中任务时占用 taskPanelEl；后台并发任务不占位）
  let activeWorkbenchRunId: number | undefined;

  function renderTaskList(): void {
    // 最新在前
    const sorted = [...tasks].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    taskListEl.replaceChildren(
      ...sorted.map((t) => {
        // 17k.7：waiting 状态与实际待决决策对齐——无匹配 pending 决策则降级（避免「需回复」却无回复入口）
        let eff = t.status;
        if (eff === 'waiting') {
          const hasPend = pendingDecisions.some((d) => {
            if (d.status && d.status !== 'pending') return false;
            const dg = d.goal || ((d.meta as { sessionId?: string } | undefined)?.sessionId) || '';
            const tg = t.goal || '';
            return dg && tg && (dg.includes(tg) || tg.includes(dg));
          });
          if (!hasPend) eff = 'pending';
        }
        const active = currentTaskId === t.id && viewMode !== 'session';
        const icon = eff === 'done' ? '✓' : eff === 'failed' ? '✕' : eff === 'waiting' ? '⏸' : eff === 'running' ? '⏳' : '·';
        const label = eff === 'done' ? '已完成' : eff === 'failed' ? '失败' : eff === 'waiting' ? '需回复' : eff === 'running' ? '进行中' : '待执行';
        const item = el('div', { class: `task-item${active ? ' active' : ''}` }, [
          el('div', { class: 'task-item-main' }, [
            el('div', { class: 'task-item-title' }, t.title || t.goal.slice(0, 16)),
            el('div', { class: 'task-item-meta' }, [
              ...(t.deptName ? [el('span', { class: 'task-item-dept' }, t.deptName)] : []),
              ...(t.progress ? [el('span', { class: 'task-item-progress' }, t.progress)] : []),
              ...(t.result ? [el('span', { class: 'task-item-result' }, t.result)] : []),
            ]),
          ]),
          el('span', { class: `task-item-status ${eff}` }, `${icon} ${label}`),
        ]);
        item.addEventListener('click', () => void enterTask(t));
        return item;
      }),
    );
    if (tasks.length === 0) {
      taskListEl.appendChild(el('div', { class: 'sidebar-empty' }, '暂无任务，在总部或部门下达任务'));
    }
  }

  /** UI 改版：进入任务聊天视图（按任务 threadId 过滤消息）。 */
  async function enterTask(t: TaskListItem): Promise<void> {
    const spaceId = t.deptId ?? 'hq';
    const node = spaceTree.find((s) => s.id === spaceId) ?? spaceTree.find((s) => s.id === 'hq');
    viewMode = 'task';
    spaceViewId = spaceId;
    spaceDeptId = t.deptId ?? undefined;
    currentTaskId = t.id;
    spaceThread = t.threadId || 'all'; // 无 threadId（极端）则显示该空间全部
    spaceFull = [];
    // 17k.2：进入任务 → 重建该任务工作台（在途＝实时方块；完成/历史＝静态摘要）
    activeWorkbenchRunId = t.runId;
    taskPanelEl.replaceChildren();
    if (!taskPanelEl.querySelector('.task-panel-title')) {
      taskPanelEl.prepend(el('div', { class: 'task-panel-title' }, `📋 ${truncate(t.title || t.goal, 40)}`));
    }
    const taskRun = t.runId ? activeRuns.get(t.runId) : undefined;
    if (taskRun && !taskRun.done) {
      taskPanelEl.appendChild(buildTaskWorkbench(taskRun).host);
    } else {
      taskPanelEl.appendChild(buildStaticSummaryHost(t));
    }
    updateTitle();
    syncViewControls();
    if (node) renderSpaceInfoBar(node);
    renderThreadBar();
    renderEmpty();
    await loadSpaceMessages(spaceId);
  }
  taskListHook = renderTaskList;

  /** UI 改版：追加消息到当前视图（Space/任务视图下同步 spaceFull，防切换后消息丢失）。 */
  function addMsg(m: ChatMsg): void {
    messages.push(m);
    if (spaceFull !== messages) spaceFull.push(m);
  }
  function appendMessage(m: ChatMsg): void {
    addMsg(m);
    logEl.appendChild(buildMsgNode(m));
    logEl.scrollTop = logEl.scrollHeight;
  }

  function renderLog(): void {
    logEl.replaceChildren(...messages.map(buildMsgNode));
    logEl.scrollTop = logEl.scrollHeight;
  }

  function renderEmpty(): void {
    logEl.replaceChildren(
      el('div', { class: 'chat-welcome' }, [
        el('div', { class: 'welcome-title' }, '开始和 MorPex 对话吧'),
        el('div', { class: 'welcome-sub' }, '描述你的目标：写代码、做分析、生成文档……Enter 发送，Shift+Enter 换行；可上传文件作为附件上下文。'),
      ]),
    );
  }

  // ── 会话管理 ──
  async function refreshSessions(): Promise<Array<{ id: string; name?: string; createdAt: number }> | null> {
    try {
      const r = await api.listSessions();
      sessionListEl.replaceChildren(
        ...r.sessions.map((s) => {
          const isActive = s.id === currentSessionId;
          const item = el('div', { class: `session-item${isActive ? ' active' : ''}` }, [
            el('div', { class: 'session-main' }, [
              el('div', { class: 'session-title' }, s.name || s.id.slice(0, 16)),
              el('div', { class: 'session-time' }, tsDate(s.createdAt)),
            ]),
            el('button', {
              class: 'btn session-del',
              onclick: () => void deleteSessionById(s.id),
              title: `删除会话 ${s.id}`,
              'aria-label': `删除会话 ${s.id}`,
            }, '✕'),
          ]);
          item.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('.session-del')) return;
            // P1：从 Space 视图回到历史会话视图
            viewMode = 'session';
            spaceViewId = undefined;
            spaceDeptId = undefined;
            syncViewControls();
            if (s.id !== currentSessionId) {
              currentSessionId = s.id;
              persistSession(s.id);
              updateTitle();
              void loadHistory(s.id);
            }
          });
          return item;
        }),
      );
      if (r.sessions.length === 0) {
        sessionListEl.appendChild(el('div', { class: 'sidebar-empty' }, '暂无历史会话，点击「＋ 新对话」开始'));
      }
      return r.sessions;
    } catch {
      sessionListEl.replaceChildren(el('div', { class: 'sidebar-empty' }, '会话列表加载失败'));
      return null;
    }
  }

  async function ensureSession(): Promise<void> {
    if (currentSessionId) return;
    try {
      const r = await api.createSession();
      if (currentSessionId) return; // 等待期间用户已切换/新建会话，不覆盖
      currentSessionId = r.sessionId;
      persistSession(r.sessionId);
      updateTitle();
    } catch (err) {
      updateStatus(`会话创建失败：${errMsg(err)}`, true);
    }
  }

  // ═══ 会话 17h·review I4：loadHistory 请求序号守卫（快速切换会话时防旧响应覆盖新会话）═══
  let historyToken = 0;

  async function loadHistory(id: string): Promise<void> {
    const token = ++historyToken;
    syncPanelForSession(id); // 17i.28：面板归属当前会话（切会话清空旧任务卡片）
    try {
      const r = await api.getSessionHistory(id);
      if (token !== historyToken) return; // 已有更新的切换，丢弃过期响应
      messages = r.messages.map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
        ts: m.timestamp,
      }));
    } catch {
      if (token !== historyToken) return; // 过期失败响应不得清空新会话消息
      messages = [];
    }
    if (messages.length === 0) renderEmpty();
    else renderLog();
    // ═══ 17i.2：活动运行恢复（切页回来时重建实时卡片 / 消费已完成结果）
    //     17k.1 多任务并发：本会话可能有多个 run，逐个恢复/消费 ═══
    for (const run of [...activeRuns.values()].filter((r) => r.sessionId === id)) {
      if (run.done && run.resultMsg) {
        // 已完成：把最后一条 assistant 文本升级为任务卡片版本（含步骤/时间线）
        if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
          messages[messages.length - 1] = run.resultMsg;
        } else {
          messages.push(run.resultMsg);
        }
        renderLog();
        clearRun(run.runId);
        run.syncHook = undefined;
      } else if (!run.done) {
        mountLiveCardForRun(run);
      }
    }
    await refreshSessions();
  }

  async function newSession(): Promise<void> {
    historyToken++; // 使在途 loadHistory 响应失效，防旧会话历史污染新会话空态
    currentTaskId = undefined; // UI 改版：离开任务聊天视图
    clearRun(); // 17k.1：新会话清空所有在途运行
    // P1：新对话回到历史会话视图
    viewMode = 'session';
    spaceViewId = undefined;
    spaceDeptId = undefined;
    syncViewControls();
    try {
      const r = await api.createSession();
      currentSessionId = r.sessionId;
      persistSession(r.sessionId);
      syncPanelForSession(currentSessionId); // 17i.28：面板归属新会话
      messages = [];
      renderEmpty();
      updateTitle();
      updateStatus();
      await refreshSessions();
      setSending(false);
    } catch (err) {
      updateStatus(`创建会话失败：${errMsg(err)}`, true);
    }
  }

  async function deleteSessionById(id: string): Promise<void> {
    if (!window.confirm('确定删除该会话？此操作不可恢复。')) return;
    try {
      await api.deleteSession(id);
      // 17k.1：删除会话 → 移除该会话关联的全部在途 run（live 跟踪放弃，结果仍由服务端处理）
      for (const [rid, run] of [...activeRuns.entries()]) {
        if (run.sessionId === id) clearRun(rid);
      }
      if (id === currentSessionId) {
        // 删的是当前会话 → 切到剩余最近一个；无剩余则新建
        currentSessionId = undefined;
        historyToken++; // 使在途 loadHistory 响应失效，防删除后旧历史污染空态
        messages = [];
        renderEmpty();
        updateTitle();
        clearStoredSession();
        // ═══ 会话 17h·opt：refreshSessions 返回列表，消除原先「refreshSessions + listSessions 双请求」冗余 ═══
        const remaining = await refreshSessions();
        if (remaining && remaining.length > 0) {
          currentSessionId = remaining[0].id;
          persistSession(currentSessionId);
          updateTitle();
          await loadHistory(currentSessionId);
        } else if (remaining && remaining.length === 0) {
          await ensureSession();
          if (currentSessionId) {
            persistSession(currentSessionId);
            updateTitle();
          }
        }
        // remaining === null（列表刷新失败）：保持空态，下次发送自动新建
      } else {
        await refreshSessions();
      }
    } catch (err) {
      updateStatus(`删除失败：${errMsg(err)}`, true);
    }
  }

  async function deleteCurrentSession(): Promise<void> {
    if (!currentSessionId) return;
    await deleteSessionById(currentSessionId);
  }

  // ── 模型切换（全局） ──
  async function loadModels(): Promise<void> {
    try {
      const r = await api.getModels();
      if (r.models.length === 0) {
        // 服务端就绪但模型表为空（如网关初始化失败）：与失败态同表现，禁用下拉
        modelSel.replaceChildren(el('option', { value: '' }, '模型列表不可用'));
        modelSel.disabled = true;
        return;
      }
      modelSel.disabled = false;
      modelSel.replaceChildren(
        ...r.models.map((m) =>
          el('option', { value: m.id, selected: m.isActive ? true : undefined }, modelLabel(m)),
        ),
      );
      modelSel.title = `当前模型：${r.active}`;
    } catch {
      modelSel.replaceChildren(el('option', { value: '' }, '模型列表不可用'));
      modelSel.disabled = true;
    }
  }

  function modelLabel(m: { name: string; provider: string; reasoning?: boolean }): string {
    const tag = m.reasoning ? '（本地/轻量）' : '';
    return `${m.name}（${m.provider}）${tag}`;
  }

  modelSel.addEventListener('change', async () => {
    const id = modelSel.value;
    if (!id) return;
    try {
      const r = await api.setActiveModel(id);
      modelSel.title = `当前模型：${r.active}`;
      updateStatus(`已切换模型：${r.active}`);
    } catch (err) {
      updateStatus(`模型切换失败：${errMsg(err)}`, true);
      await loadModels(); // 回滚到服务端实际 active
    }
  });

  // ── 上传文件 ──
  function renderAttachments(): void {
    attachRow.replaceChildren(
      ...pendingAttachments.map((a) =>
        el('span', { class: 'attachment-chip' }, [
          el('span', { class: 'chip-name' }, `${a.isText ? '📄' : '📦'} ${a.name}`),
          el('button', {
            class: 'chip-x',
            onclick: () => {
              const idx = pendingAttachments.indexOf(a);
              if (idx >= 0) pendingAttachments.splice(idx, 1);
              renderAttachments();
            },
          }, '✕'),
        ]),
      ),
    );
  }

  async function uploadFiles(files: File[]): Promise<void> {
    // 客户端预检（与服务端 5MB 上限一致）：避免超大文件整体读入内存转 base64
    const MAX_FILE = 5 * 1024 * 1024;
    for (const file of files) {
      try {
        if (file.size > MAX_FILE) {
          updateStatus(`上传失败（${file.name}）：文件超过 5MB 上限`, true);
          continue;
        }
        const b64 = await readFileAsBase64(file);
        const r = await api.uploadFile({ name: file.name, contentBase64: b64 });
        pendingAttachments.push({ fileId: r.fileId, name: r.name, isText: r.isText });
        if (!sending) updateStatus(`已上传：${r.name}`); // 发送中不覆盖「正在思考」状态
        renderAttachments(); // 逐文件渲染 chip（此前全量完成后才渲染）
      } catch (err) {
        updateStatus(`上传失败（${file.name}）：${errMsg(err)}`, true);
      }
    }
  }

  function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        resolve(typeof result === 'string' ? result.split(',')[1] ?? '' : '');
      };
      reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'));
      reader.readAsDataURL(file);
    });
  }

  // ── 17i.2：活动运行恢复（切页回来） ──

  /**
   * 初始同步：若存在在途运行，17k.1 多任务并发下不再禁用输入（用户可边跑边发新任务/闲聊）。
   * 仅对「本会话在途运行」由 mountLiveCardForRun 挂实时卡片；其它会话的在途运行不做 UI 阻断。
   */
  function syncFromActiveRun(): void {
    for (const run of activeRuns.values()) {
      if (run.done) continue;
      if (run.sessionId === currentSessionId) {
        mountLiveCardForRun(run);
      }
    }
  }

  /** 指定 run 在顶部任务面板挂载实时任务卡片（多任务并发：每个 run 一张卡片）。 */
  function mountLiveCardForRun(run: ActiveRun): void {
    if (!run || run.done || run.sessionId !== currentSessionId) return;
    if (run.syncHook) return; // 已有渲染钩子（本渲染已挂）
    const host = createPanelTaskCard(run);
    moduleTick();
    run.syncHook = () => {
      if (run.done) {
        host.render(); // 升级为最终卡片
        run.syncHook = undefined;
        clearRun(run.runId); // 完成后从在途集合移除（其它 run 不受影响）
      } else {
        host.render();
      }
    };
    host.render();
  }

  /** 17i.24：应用内查看文件（text/md/代码/docx/xlsx；其它提示 + 系统打开）。 */
  function openFileViewer(filePath: string): void {
    void (async () => {
      let overlay: HTMLElement | undefined;
      const close = (): void => { overlay?.remove(); };
      try {
        const r = await api.getFileView(filePath);
        const name = r.name ?? filePath.split(/[\\/]/).pop() ?? filePath;
        let body: HTMLElement;
        if (r.kind === 'text' || r.kind === 'markdown') {
          const raw = r.content ?? '';
          if (r.kind === 'markdown') {
            // 17i.24：markdown 渲染（marked → HTML，iframe 隔离展示）
            let html = '';
            try { html = marked.parse(raw) as string; } catch { html = `<pre>${raw}</pre>`; }
            const iframe = el('iframe', { class: 'viewer-iframe', sandbox: 'allow-same-origin' }) as HTMLIFrameElement;
            iframe.srcdoc = buildMarkdownDoc(html);
            body = iframe;
          } else {
            // 17i.25/26：代码文件语法高亮 + 行号
            const lang = langFromExt((filePath.split('.').pop() ?? '').toLowerCase());
            if (lang && hljs.getLanguage(lang) && raw.trim()) {
              body = buildCodeView(raw, lang);
            } else {
              body = el('pre', { class: 'plan-modal-body' }, raw || '(空文件)');
            }
          }
        } else if (r.kind === 'html') {
          const iframe = el('iframe', { class: 'viewer-iframe', sandbox: 'allow-same-origin' }) as HTMLIFrameElement;
          iframe.srcdoc = r.html ?? '';
          body = iframe;
        } else {
          body = el('div', { class: 'viewer-unsupported' }, [
            el('p', null, r.reason ?? '该类型暂不支持应用内预览'),
            button('🖥 在系统打开', () => { void api.openSystemFile(filePath); }, 'secondary'),
          ]);
        }
        overlay = el('div', {
          class: 'modal-overlay',
          onclick: (e: Event) => { if ((e.target as HTMLElement) === overlay) close(); },
        }, [
          el('div', { class: 'modal plan-modal' }, [
            el('div', { class: 'modal-head' }, [
              el('span', { class: 'modal-title' }, `📄 ${name}`),
              el('div', { class: 'row' }, [
                button('🖥 在系统打开', () => { void api.openSystemFile(filePath); }, 'secondary'),
                button('✕ 关闭', close, 'secondary'),
              ]),
            ]),
            body,
          ]),
        ]);
        document.body.appendChild(overlay);
      } catch (err) {
        updateStatus(`文件查看失败：${errMsg(err)}`, true);
      }
    })();
  }

  /** 17i.13：顶部任务面板——创建实时任务卡片宿主。（17k.1：per-run run 传入） */
  /** 17k.2 任务工作台：stepagent（工位/步骤）方块网格 + 点击展开详情。
   * 方块来源：DAG 节点（state.dag.nodes）优先，缺省回退步骤列表（state.steps）；
   * 经理（规划）＝第一个方块（A 方案），点开展开该工位对话/思考/工具/产物（复用 buildStepRow）。
   * 审批/plan/ask 交互由 P3 待处理徽章 + 聊天气泡兜住（此处只展示执行方块）。 */
  /** 17k.2 任务已结束/历史 → 静态摘要（无实时方块）。异步从 /api/tasks/:missionId 拉投影重建静态方块（P-C 恢复）。 */
  function renderStaticTaskSummary(t: TaskListItem, host: HTMLElement): void {
    const icon = t.status === 'done' ? '✅' : t.status === 'failed' ? '❌' : '⏳';
    const rows: Child[] = [
      el('div', { class: 'wb-static' }, [
        el('span', { class: 'wb-chip-icon' }, icon),
        el('span', { class: 'wb-chip-name' }, t.title || t.goal || '任务'),
      ]),
    ];
    if (t.progress) rows.push(el('div', { class: 'wb-static-meta' }, `进度：${t.progress}`));
    if (t.result) rows.push(el('div', { class: 'wb-static-meta err' }, t.result));
    if (!t.progress && !t.result) rows.push(el('div', { class: 'wb-static-meta' }, '任务已结束，查看下方聊天了解详情。'));
    host.replaceChildren(...rows);
    const mid = t.threadId;
    if (!mid) return;
    // P-C：从服务端投影恢复静态工位方块（切视图/重启后历史任务仍可看结构）
    void (async () => {
      try {
        const r = await apiRef?.getTaskProjection(mid);
        const p = r?.task;
        if (p && Array.isArray(p.steps) && p.steps.length > 0) {
          host.replaceChildren(buildStaticProjection(t, p));
        }
      } catch { /* 后端不可用：保留摘要 */ }
    })();
  }

  /** P-C：由服务端任务投影构建静态工位方块网格（无实时事件驱动，纯展示）。 */
  function buildStaticProjection(t: TaskListItem, p: TaskProjection): HTMLElement {
    const grid = el('div', { class: 'wb-grid' }, p.steps.map((s) => {
      const icon = s.status === 'done' ? '✅' : s.status === 'failed' ? '❌' : s.status === 'running' ? '⏳' : '○';
      return el('div', { class: `wb-chip ${s.status}` }, [
        el('span', { class: 'wb-chip-icon' }, icon),
        el('span', { class: 'wb-chip-name' }, s.name || s.nodeId),
      ]);
    }));
    return el('div', { class: 'workbench' }, [
      el('div', { class: 'wb-head' }, [
        el('span', { class: 'wb-title' }, `🔧 ${truncate(t.title || t.goal, 40)}`),
        el('span', { class: 'wb-stat' }, p.progress ? `进度 ${p.progress}` : ''),
      ]),
      grid,
    ]);
  }

  /** 17k.2：历史/已完成任务的静态摘要宿主（异步填充投影/摘要）。 */
  function buildStaticSummaryHost(t: TaskListItem): HTMLElement {
    const host = el('div', { class: 'workbench' });
    renderStaticTaskSummary(t, host);
    return host;
  }


  function buildTaskWorkbench(run: ActiveRun): { host: HTMLElement; update: () => void } {
    const host = el('div', { class: 'workbench' });
    const header = el('div', { class: 'wb-head' }, [
      el('span', { class: 'wb-title' }, `🔧 ${truncate(run.text, 40)}`),
      el('span', { class: 'wb-stat', id: `wb-stat-${run.runId}` }),
    ]);
    const grid = el('div', { class: 'wb-grid' });
    const detailEl = el('div', { class: 'wb-detail' });
    host.appendChild(header);
    host.appendChild(grid);
    host.appendChild(detailEl);
    let selectedKey: string | undefined;
    const chipEls = new Map<string, HTMLElement>();
    const statusOf = (it: { id: string; name: string; status: TaskStep['status'] }, steps: TaskStep[]): TaskStep['status'] => {
      const s = steps.find((x) => x.key === it.id || x.name === it.name);
      return s ? s.status : it.status;
    };
    const chipFor = (it: { id: string; name: string; status: TaskStep['status'] }): HTMLElement => {
      const icon = it.status === 'done' ? '✅' : it.status === 'failed' ? '❌' : it.status === 'running' ? '⏳' : '○';
      const chip = el('div', { class: `wb-chip ${it.status}${selectedKey === it.id ? ' active' : ''}` }, [
        el('span', { class: 'wb-chip-icon' }, icon),
        el('span', { class: 'wb-chip-name' }, it.name),
      ]);
      chip.addEventListener('click', () => {
        selectedKey = it.id;
        const step = run.state.steps.find((s) => s.key === it.id || s.name === it.name);
        detailEl.replaceChildren(
          step
            ? buildStepRow(step)
            : el('div', { class: 'timeline-empty' }, '该工位暂无详情（待开始执行）'),
        );
        for (const [k, c] of chipEls) c.classList.toggle('active', k === selectedKey);
      });
      return chip;
    };
    const renderChips = (): void => {
      const nodes = run.state.dag?.nodes;
      const steps = run.state.steps;
      const items = nodes && nodes.length > 0
        ? nodes.map((n) => ({ id: n.id, name: n.name, status: statusOf({ id: n.id, name: n.name, status: n.status }, steps) }))
        : steps.map((s) => ({ id: s.key, name: s.name, status: s.status }));
      if (items.length === 0) {
        grid.replaceChildren(el('div', { class: 'timeline-empty' }, '等待编排器拆分工位…（编排中）'));
        header.querySelector('.wb-stat')!.textContent = '⏳ 编排中';
        return;
      }
      header.querySelector('.wb-stat')!.textContent = `共 ${items.length} 个工位`;
      chipEls.clear();
      grid.replaceChildren(...items.map((it) => {
        const c = chipFor(it);
        chipEls.set(it.id, c);
        return c;
      }));
      // 展开中的详情随运行实时刷新
      if (selectedKey) {
        const step = steps.find((s) => s.key === selectedKey || s.name === selectedKey);
        detailEl.replaceChildren(
          step ? buildStepRow(step) : el('div', { class: 'timeline-empty' }, '该工位暂无详情（待开始执行）'),
        );
      }
    };
    renderChips();
    return { host, update: renderChips };
  }

  /** 17k.2 创建任务工作台卡片（替代顶部任务面板的整卡 LiveCardController——方块化）。
   * 仅当该 run 是「当前选中任务」时才占用工作台（taskPanelEl）；后台并发任务不占位。
   * 任务完成 → 工作台替换为最终消息卡片。 */
  function createPanelTaskCard(run: ActiveRun): { render: () => void } {
    if (run.runId !== activeWorkbenchRunId) {
      // 后台任务 / 未选中：不占用工作台（任务列表实时更新状态）
      return { render: () => {} };
    }
    taskPanelEl.replaceChildren();
    if (!taskPanelEl.querySelector('.task-panel-title')) {
      taskPanelEl.prepend(el('div', { class: 'task-panel-title' }, `📋 ${truncate(run.text, 40)}`));
    }
    const wb = buildTaskWorkbench(run);
    taskPanelEl.appendChild(wb.host);
    // 17k.2：保留「完整执行视图」（DAG/终端/审批）——折叠在方块工作台下方，复用 createLiveCardHost（展开即渲染）
    const fullCardEl = el('div', { class: 'wb-full' });
    const fullSummary = el('summary', null, '📄 查看完整执行视图（DAG/终端/审批）');
    const fullDetails = el('details', { class: 'wb-full-details' }, [
      fullSummary,
      fullCardEl,
    ]);
    taskPanelEl.appendChild(fullDetails);
    const fullHost = createLiveCardHost(fullCardEl, run);
    fullSummary.addEventListener('click', () => fullHost.render(), { once: true });
    activeWorkbenchRunId = run.runId; // 锁定（切走时清）
    const render = (): void => {
      if (run.done && run.resultMsg) {
        if (wb.host.isConnected && wb.host.parentElement === taskPanelEl) {
          wb.host.replaceWith(buildMsgNode(run.resultMsg));
          fullDetails.style.display = 'none';
          return;
        }
      }
      wb.update();
    };
    return { render };
  }

  /** 17i.13：渲染已完成任务的紧凑列表（面板底部）。 */
  function renderPanelCompleted(): void {
    const old = taskPanelEl.querySelector('.task-panel-completed');
    if (old) old.remove();
    if (completedTasks.length === 0) return;
    const rows = completedTasks.slice(-5).reverse().map((t) =>
      el('div', { class: `panel-task-row ${t.ok ? 'ok' : 'fail'}` }, [
        el('span', { class: 'panel-task-status' }, t.ok ? '✅' : '❌'),
        el('span', { class: 'panel-task-goal' }, truncate(t.goal, 50)),
        el('span', { class: 'panel-task-meta' }, `${formatElapsed(t.durationMs)}`),
      ]),
    );
    taskPanelEl.appendChild(el('div', { class: 'task-panel-completed' }, rows));
  }

  // ── 发送 ──
  /** 17i.11：发送核心（可带澄清重发参数）。 */
  async function doSend(opts: { text?: string; sessionId?: string; attachments?: PendingAttachment[]; clarifications?: Record<string, string>; force?: boolean } = {}): Promise<void> {
    const text = (opts.text ?? inputEl.value).trim();
    if (!text || sending) return;
    // 17i.29：后端未就绪不发（避免启动竞态 Failed to fetch）
    if (!backendReady) {
      updateStatus('后端未就绪，正在启动，请稍候再试', true);
      return;
    }
    await ensureSession();
    const sessionAtSend = opts.sessionId ?? currentSessionId;
    if (!sessionAtSend) return;
    // ═══ 会话 17h·opt：发送期间会话切换防护——historyToken 在 loadHistory 时递增，
    //     sessionAtSend 捕获真实目标会话，防止结果/失败气泡污染切换后的会话消息 ═══
    const token = historyToken;

    // 仅在用户真实输入时清空输入框/追加用户消息（澄清重发不重复追加任务）
    if (opts.text === undefined) {
      inputEl.value = '';
      resetInputHeight();
      appendMessage({ role: 'user', content: text, ts: Date.now() });
    }
    setSending(true);

    // ═══ 17i.2：建立模块级活动运行（SSE 流 + 计时器跨 tab 存活）═══
    const startedAt = Date.now();
    const state: TaskRunState = { isTask: false, steps: [], events: [], approvals: [], asks: [], plan: null, done: false };
    const runId = ++runSeq;
    // 17k.1 多任务并发：不接管旧 run——新 run 与旧 run 并存于 Map（发送框不锁定，可并发多任务）
    const run: ActiveRun = {
      runId, sessionId: sessionAtSend, text, startedAt, state, done: false,
      elapsedEl: null, syncHook: undefined, chatStreamEl: null, chatStreamStarted: false, chatLogEl: null,
    };
    activeRuns.set(runId, run);
    lastSendId = runId; // chat.stream.delta 流式归属（最近发送的 run）
    // 17k.1：全局 SSE/计时/轮询仅首开、复用（多任务并发不得重复订阅导致事件双份消费；全部 run 结束后 clearRun 关闭）
    if (!runSse) runSse = openEventStream(undefined, moduleOnStreamEvent);
    if (runTimer === undefined) runTimer = window.setInterval(moduleTick, 1000);
    // 17i.4：步骤实时输出轮询
    runApi = api;
    if (runPoller === undefined) runPoller = window.setInterval(() => { void pollStepDetails(); }, 1500);

    // 占位「思考中」气泡（不进入 messages，发送完成后被替换）
    const placeholderBody = el('div', { class: 'body thinking' }, [
      el('span', { class: 'think-spinner' }),
      el('span', { class: 'think-text' }, '正在思考/执行…'),
      (run.elapsedEl = el('span', { class: 'think-elapsed' }, '')),
    ]);
    run.chatStreamEl = placeholderBody; // 17i.32/33：流式 token 追加目标（聊天占位 / 任务总结新建）
    run.chatStreamStarted = false;
    run.chatLogEl = logEl;
    const placeholder = el('div', { class: 'chat-msg assistant' }, [
      el('div', { class: 'head' }, [
        el('span', { class: 'who' }, 'MorPex'),
        el('span', { class: 'time' }, tsTime(Date.now())),
      ]),
      placeholderBody,
    ]);
    logEl.appendChild(placeholder);
    logEl.scrollTop = logEl.scrollHeight;
    moduleTick();
    // UI 改版：为本次发送建立任务列表项（闲聊在返回后移除；任务保留并随事件更新）
    const taskItemId = `task_${runId}`;
    const sendDeptId = spaceDeptId ?? undefined;
    upsertTask({
      id: taskItemId,
      runId,
      sessionId: sessionAtSend,
      title: taskTitle(text),
      goal: text,
      deptId: sendDeptId,
      deptName: undefined,
      status: 'pending',
      progress: '',
      createdAt: Date.now(),
    });

    // 17i.13：任务卡片进顶部面板；聊天只留自然对话（经理接单语/完成语）
    let panelHost: { render: () => void } | undefined;
    let chatIntroShown = false;
    const renderedAsks = new Set<string>();
    let planRendered = false;
    const renderLive = (): void => {
      if (!run || run.done) return;
      if (!panelHost) {
        panelHost = createPanelTaskCard(run);
        if (!chatIntroShown) {
          chatIntroShown = true;
          const introText = buildManagerIntro(text);
          placeholder.replaceWith(
            el('div', { class: 'chat-msg assistant' }, [
              el('div', { class: 'head' }, [
                el('span', { class: 'who' }, 'MorPex'),
                el('span', { class: 'time' }, tsTime(Date.now())),
              ]),
              el('div', { class: 'body' }, introText),
            ]),
          );
          messages.push({ role: 'assistant', content: introText, ts: Date.now() });
        }
      }
      panelHost.render();
      // 17i.22：规划方案确认（交互模式；Goal 模式无 plan.ready）
      if (state.plan && !state.plan.confirmed && !planRendered) {
        planRendered = true;
        const p = state.plan;
        const node = el('div', { class: 'chat-msg assistant' }, [
          el('div', { class: 'head' }, [
            el('span', { class: 'who' }, 'MorPex'),
            el('span', { class: 'time' }, tsTime(Date.now())),
          ]),
          el('div', { class: 'body' }, buildPlanMessage(text, p, () => {
            p.confirmed = true;
            void api.continuePlan(p.planId);
            const body = node.querySelector('.body') as HTMLElement | null;
            if (body) body.replaceChildren(el('div', { class: 'clarify-persona' }, `${pickManager(text)}：✅ 已确认方案，继续执行。`));
          }, openFileViewer)),
        ]);
        logEl.appendChild(node);
        logEl.scrollTop = logEl.scrollHeight;
      }
      // 17i.15：LLM 自主提问 → 聊天拟人问答气泡
      for (const ask of state.asks) {
        if (ask.answered || renderedAsks.has(ask.askId)) continue;
        renderedAsks.add(ask.askId);
        const node = el('div', { class: 'chat-msg assistant' }, [
          el('div', { class: 'head' }, [
            el('span', { class: 'who' }, 'MorPex'),
            el('span', { class: 'time' }, tsTime(Date.now())),
          ]),
          el('div', { class: 'body' }, buildAskPrompt(text, ask, (answer) => {
            ask.answered = true;
            void api.answerAsk(ask.askId, answer);
            const body = node.querySelector('.body') as HTMLElement | null;
            if (body) body.replaceChildren(el('div', { class: 'clarify-persona' }, `${pickManager(text)}：✅ 已收到你的回答「${truncate(answer, 40)}」，继续执行。`));
          })),
        ]);
        logEl.appendChild(node);
        logEl.scrollTop = logEl.scrollHeight;
      }
    };
    run.syncHook = renderLive;

    const attachments = opts.attachments
      ? opts.attachments.map((a) => ({ fileId: a.fileId, name: a.name }))
      : pendingAttachments.map((a) => ({ fileId: a.fileId, name: a.name }));
    const sentAttachments = opts.attachments ? [...opts.attachments] : [...pendingAttachments]; // 完整快照（含 isText），失败时原样恢复
    if (!opts.attachments) {
      pendingAttachments.length = 0;
      renderAttachments();
    }

    try {
      // 17i.36：网络错误自动重试（Failed to fetch 等 = 请求未达服务端，未执行，重试安全）——
      //     修复「软件刚启动第一句必失败」的启动竞态
      const sendBody = {
        sessionId: sessionAtSend,
        attachments,
        ...(opts.clarifications ? { clarifications: opts.clarifications } : {}),
        ...(opts.force ? { force: true } : {}),
        goalMode, // 17i.22：Goal 模式全自动
        // P1：Space 视图发送 → 带 spaceId/departmentId，后端据此路由/落库归属
        ...(viewMode === 'hq' ? { spaceId: 'hq' } : {}),
        ...(viewMode === 'dept' && spaceViewId && spaceDeptId ? { spaceId: spaceViewId, departmentId: spaceDeptId } : {}),
      };
      // 17k.1：请求发出即解锁——编排/stepagent 只是对话，真正耗时是执行肢；任务执行期间发送框不锁定（可并发多任务）
      setSending(false);
      let r: unknown;
      let lastErr: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          r = await api.sendChat(text, sendBody);
          break;
        } catch (err) {
          lastErr = err;
          if (!isNetErrText(errMsg(err))) throw err; // 非网络错误不重试
          if (attempt < 2) await new Promise((res) => setTimeout(res, 1200 * (attempt + 1)));
        }
      }
      if (!r) throw lastErr;
      const rec = r as Record<string, unknown>;
      const isChat = rec.mode === 'chat';
      const msg: ChatMsg = {
        role: 'assistant',
        content: extractReport(rec) || JSON.stringify(rec, null, 2),
        ts: Date.now(),
        // 闲聊：不显示 ok=true 元数据、不显示原始 JSON（纯对话感）
        raw: isChat ? undefined : rec,
        meta: isChat ? [] : metaRows(rec),
        error: rec.ok === false,
      };
      // 17i：任务模式 → 回复渲染为任务卡片（含本次捕获的步骤/事件时间线）
      if (!isChat) {
        msg.task = {
          missionId: (rec.missionId as string) ?? state.missionId,
          executionId: (rec.executionId as string) ?? state.executionId,
          ok: rec.ok !== false,
          goal: state.goal || text,
          durationMs: Date.now() - startedAt,
          steps: state.steps,
          error: typeof rec.error === 'string' ? rec.error : undefined,
          events: state.events,
        };
      }
      // ═══ 17i.2：完成——若本 run 已从在途集合移除则不再更新 UI（结果仍持久化到服务端）═══
      if (!run || run.done || !activeRuns.has(runId)) return;
      run.done = true;
      run.resultMsg = msg;
      const hook = run.syncHook;
      run.syncHook = undefined;
      if (isChat) {
        // 17i.31：闲聊——直接显示回复，不进任务面板、不显示接单语/完成语
        removeTask(taskItemId); // UI 改版：闲聊不是任务，移除任务列表占位
        if (token === historyToken && currentSessionId === sessionAtSend && placeholder.isConnected) {
          placeholder.replaceWith(buildMsgNode(msg));
          addMsg(msg);
        }
      } else {
        // 任务：面板卡片 finalize（升级为最终任务卡片）+ 拟人化总结 + 已完成列表
        hook?.();
        const ok = rec.ok !== false;
        const missionId = (rec.missionId as string) ?? state.missionId;
        const routed = rec.routedTo as { spaceId?: string; departmentName?: string } | undefined;
        // UI 改版：任务列表项 finalize（threadId/状态/部门/进度）
        const ti = tasks.find((x) => x.runId === runId);
        if (ti) {
          ti.threadId = missionId ?? ti.threadId;
          ti.status = ok ? 'done' : 'failed';
          ti.result = ok ? undefined : `❌ ${truncate(typeof rec.error === 'string' ? rec.error : '执行失败', 40)}`;
          ti.deptId = routed?.spaceId ?? ti.deptId;
          ti.deptName = routed?.departmentName ?? ti.deptName;
          const total = state.dag?.nodes?.length || state.steps.length || 0;
          const doneSteps = state.steps.filter((s) => s.status === 'done' || s.status === 'failed').length;
          ti.progress = total > 0 ? `${doneSteps}/${total}` : '';
          upsertTask(ti);
        }
        // UI 改版：路由落地——task.routed 已早期跳转部门视图；此处兜底（事件丢失时）跳转 + 高亮任务
        let autoJumped = false;
        if (ok && routed?.spaceId) {
          const deptNode = spaceTree.find((s) => s.id === routed.spaceId);
          if (deptNode) {
            if (!(viewMode === 'dept' && spaceViewId === routed.spaceId)) {
              autoJumped = true;
              enterSpace(deptNode);
            }
            currentTaskId = taskItemId; // 任务列表高亮
            updateTitle();
            syncViewControls();
            renderTaskList();
          }
        }
        if (!autoJumped && viewMode === 'hq') {
          if (routed?.departmentName && token === historyToken && currentSessionId === sessionAtSend) {
            appendMessage({ role: 'assistant', content: `🤖 秘书：任务已转交 ${routed.departmentName}，可点击左侧任务查看进度。`, ts: Date.now() });
          }
        }
        // 完成语/拟人总结（未自动跳转时立即展示；已跳转则任务聊天会从服务端加载到该总结）
        if (!autoJumped && token === historyToken && currentSessionId === sessionAtSend) {
          const natural = typeof rec.naturalReport === 'string' && rec.naturalReport.trim() ? rec.naturalReport.trim() : '';
          const doneText = natural || buildManagerReport(text, ok, typeof rec.error === 'string' ? rec.error : undefined);
          if (chatIntroShown || !placeholder.isConnected) {
            appendMessage({ role: 'assistant', content: doneText, ts: Date.now(), threadId: missionId });
          } else {
            placeholder.replaceWith(buildMsgNode({ role: 'assistant', content: doneText, ts: Date.now(), threadId: missionId }));
            addMsg({ role: 'assistant', content: doneText, ts: Date.now(), threadId: missionId });
          }
        }
        completedTasks.push({
          goal: text,
          ok,
          error: typeof rec.error === 'string' ? rec.error : undefined,
          missionId: (rec.missionId as string) ?? state.missionId,
          durationMs: Date.now() - startedAt,
          ts: Date.now(),
        });
        if (completedTasks.length > 20) completedTasks.splice(0, completedTasks.length - 20);
        renderPanelCompleted();
      }
      clearRun(runId);
      setSending(false);
      await refreshSessions();
    } catch (err) {
      // 发送失败恢复附件，避免用户重新上传
      pendingAttachments.push(...sentAttachments);
      renderAttachments();
      if (!run || run.done || !activeRuns.has(runId)) return;
      const errText = errMsg(err);
      // 17i.30：网络/连接失败 → 恢复输入文本 + 标记后端断开并自动重连（不发「任务执行失败」）
      const isNetErr = isNetErrText(errText);
      if (isNetErr && opts.text === undefined) {
        inputEl.value = text;
        resetInputHeight();
      }
      const failMsg: ChatMsg = {
        role: 'assistant',
        content: `发送失败：${errText}`,
        ts: Date.now(),
        error: true,
      };
      run.done = true;
      run.resultMsg = failMsg;
      const hook = run.syncHook;
      run.syncHook = undefined;
      // 17i.28：仅真正启动了任务（检测到 mission）才在面板生成失败卡片；纯网络失败不进任务面板
      if (state.isTask) hook?.();
      // UI 改版：任务列表清理——已确认任务标失败；未确认（非任务/纯网络失败）移除占位
      if (state.isTask) {
        const ti = tasks.find((x) => x.runId === runId);
        if (ti) {
          ti.status = 'failed';
          ti.result = `❌ ${truncate(errText, 40)}`;
          upsertTask(ti);
        }
      } else {
        removeTask(taskItemId);
      }
      // 17i.30：网络失败 → 启用重连并提示；否则按任务失败汇报
      if (isNetErr) {
        setBackendReady(false);
        startHealthRetry();
        updateStatus('后端连接中断，正在自动重连…', true);
        if (token === historyToken && currentSessionId === sessionAtSend) {
          appendMessage({ role: 'assistant', content: `${pickManager(text)}：❌ 发送失败：无法连接后端，已自动重连。你的消息已恢复到输入框，就绪后请重发。`, ts: Date.now(), error: true });
        }
      } else {
        // 17i.31：非网络失败也统一报「发送失败」（不误报「任务执行失败」——聊天同样适用）
        const doneText = `${pickManager(text)}：❌ 发送失败：${errText}`;
        if (token === historyToken && currentSessionId === sessionAtSend) {
          if (chatIntroShown || !placeholder.isConnected) {
            appendMessage({ role: 'assistant', content: doneText, ts: Date.now() });
          } else {
            placeholder.replaceWith(buildMsgNode({ role: 'assistant', content: doneText, ts: Date.now() }));
            addMsg({ role: 'assistant', content: doneText, ts: Date.now() });
          }
        }
      }
      clearRun(runId);
      setSending(false);
      logEl.scrollTop = logEl.scrollHeight;
    }
  }

  /** 普通发送入口。 */
  async function send(): Promise<void> {
    await doSend();
  }

  // ── P2/P3：新增 UI 元素（装配前创建，供渲染结构与事件引用）──
  // P3-A：待处理徽章 + 下拉列表
  const pendingBadgeBtn = el('button', {
    class: 'badge-pending',
    style: 'display:none',
    title: '有待你决定的事项',
    onclick: () => {
      if (pendingPopRef) pendingPopRef.style.display = pendingPopRef.style.display === 'none' ? '' : 'none';
      void refreshPendingDecisions();
    },
  }, '🔔 待处理(0)') as HTMLButtonElement;
  pendingPopRef = el('div', { class: 'pending-pop', style: 'display:none' });
  badgeBtnRef = pendingBadgeBtn;
  pendingBadgeHook = () => {
    if (!badgeBtnRef || !pendingPopRef) return;
    const n = pendingDecisions.filter((d) => !d.status || d.status === 'pending').length;
    badgeBtnRef.style.display = n > 0 ? '' : 'none';
    badgeBtnRef.replaceChildren('🔔 待处理(' + n + ')');
    taskListHook?.(); // 17k.7：决策刷新时同步任务列表（waiting 状态与实际决策对齐）
    pendingPopRef.replaceChildren(
      ...(n === 0
        ? [el('div', { class: 'pending-empty' }, '暂无可处理事项')]
        : pendingDecisions.map((d) => {
            const k = decisionKindMeta(d.kind);
            const title = d.title || d.question || d.goal || '(无标题)';
            const actions: Child[] = [];
            if (d.kind === 'plan') {
              actions.push(el('button', { class: 'btn small ok', onclick: () => void respondViaBadge(d.id, undefined) }, '确认继续 ▶'));
            } else if (d.kind === 'approval') {
              actions.push(
                el('button', { class: 'btn small ok', onclick: () => void respondViaBadge(d.id, 'APPROVED') }, '✅ 批准'),
                el('button', { class: 'btn small danger', onclick: () => void respondViaBadge(d.id, 'REJECTED') }, '❌ 拒绝'),
              );
            } else {
              // ask 需要输入：收起列表，用户去聊天区看到的问答气泡里输入
              actions.push(el('span', { class: 'pending-ask-hint' }, '请在聊天问答气泡中输入回答'));
            }
            return el('div', { class: 'pending-item' }, [
              el('div', { class: 'pending-item-head' }, [
                el('span', { class: 'pending-item-kind' }, `${k.icon} ${k.label}`),
                el('span', { class: 'pending-item-goal' }, truncate(d.goal || title, 24)),
              ]),
              el('div', { class: 'pending-item-q' }, truncate(d.question || title, 70)),
              el('div', { class: 'pending-item-actions' }, actions),
            ]);
          })),
    );
  };

  // P2：协作对话旁观区（部门 Space 内只读；非部门隐藏）
  const mailBox = el('details', { class: 'mail-box', style: 'display:none' }, [
    el('summary', {}, '🗣 协作对话（0）'),
    (mailLogElRef = el('div', { class: 'mail-log' })),
  ]) as HTMLDetailsElement;
  mailBoxRef = mailBox;

  // P3-B：安装工作流入口（侧栏底部）
  const installWfBtn = button('➕ 安装工作流', () => void showInstallWf(), 'install-wf');
  async function showInstallWf(): Promise<void> {
    let list: InstallableWorkflow[] = [];
    try { list = (await api.getInstallableWorkflows())?.workflows ?? []; } catch { /* 后端不可用 */ }
    const overlay = el('div', { class: 'modal-overlay' }, [
      el('div', { class: 'modal-box' }, [
        el('div', { class: 'modal-head' }, [
          el('span', {}, '➕ 安装工作流（装完生成新部门 Space）'),
          el('button', { class: 'btn small', onclick: () => overlay.remove() }, '✕'),
        ]),
        el('div', { class: 'modal-body' },
          list.length === 0
            ? [el('p', { class: 'modal-empty' }, '无可用工作流（已全部安装或后端未支持）')]
            : list.map((w) => {
                const inst = w.installed === true;
                return el('div', { class: 'install-item' }, [
                  el('div', { class: 'install-item-name' }, `${w.name}${inst ? '（已安装）' : ''}`),
                  el('div', { class: 'install-item-desc' }, truncate(w.description || '', 64)),
                  inst
                    ? el('span', { class: 'install-item-installed' }, '✅')
                    : el('button', {
                        class: 'btn small ok',
                        onclick: async () => {
                          try {
                            await api.installWorkflow(w.id);
                            overlay.remove();
                            updateStatus(`✅ 已生成新部门「${w.name}」，刷新空间树`, false);
                            await loadSpaces();
                          } catch (err) {
                            updateStatus(`安装「${w.name}」失败：${errMsg(err)}`, true);
                          }
                        },
                      }, '安装 ▶'),
                ]);
              }),
        ),
      ]),
    ]);
    document.body.appendChild(overlay);
  }

  // 初始化：进入渲染拉一次决策队列 + 装配后事件订阅由 openEventStream 驱动
  void refreshPendingDecisions();

  // ── 装配 ──
  root.replaceChildren(
    el('div', { class: 'view console-view' }, [
      el('div', { class: 'console-layout' }, [
        el('aside', { class: 'chat-sidebar' }, [
          el('div', { class: 'sidebar-header' }, [
            el('span', { class: 'sidebar-brand' }, '🏢 MorPex'),
            newChatBtn,
          ]),
          el('div', { class: 'sidebar-label' }, '部门空间'),
          spaceListEl,
          el('div', { class: 'sidebar-label' }, '任务'),
          taskListEl,
          el('div', { class: 'sidebar-footer' }, [installWfBtn]),
        ]),
        el('section', { class: 'chat-main' }, [
          el('div', { class: 'chat-header' }, [
            titleEl,
            el('span', { class: 'grow' }),
            goalModeBtn,
            modelSel,
            statusEl,
            pendingBadgeBtn,
            pendingPopRef,
            deleteBtn,
          ]),
          spaceInfoBarEl,
          mailBox,
          threadBarEl,
          taskPanelEl,
          logEl,
          el('div', { class: 'chat-input-bar' }, [
            attachRow,
            el('div', { class: 'input-row' }, [
              attachBtn,
              inputEl,
              sendBtn,
            ]),
          ]),
        ]),
      ]),
    ]),
  );
  renderEmpty();
  // 侧栏初始加载占位：refreshSessions 成功后会替换为会话列表 / 空态 / 失败态
  sessionListEl.replaceChildren(el('div', { class: 'sidebar-empty' }, '加载中…'));
  // P1：空间树初始占位（loadSpaces 成功后替换）
  spaceListEl.replaceChildren(el('div', { class: 'sidebar-empty' }, '部门空间加载中…'));

  // ── 后端就绪等待（双击桌面 exe 时后端由壳异步拉起，需等 ~40s）──
  /** 17i.30：启动 5s 健康重试；成功后启用发送，可选回调（恢复会话/历史）。 */
  function startHealthRetry(afterReady?: () => Promise<void>): void {
    if (retryTimer !== undefined) return;
    retryTimer = window.setInterval(async () => {
      try {
        await api.getHealth();
        if (retryTimer !== undefined) {
          window.clearInterval(retryTimer);
          retryTimer = undefined;
        }
        setBackendReady(true);
        if (afterReady) await afterReady();
      } catch {
        /* 仍不可达，继续重试 */
      }
    }, 5000);
  }

  async function initWhenReady(): Promise<void> {
    // 恢复上次会话（localStorage / 模块内存），避免切标签/刷新后自动新建
    if (!currentSessionId) currentSessionId = readStoredSession();
    updateTitle();
    syncPanelForSession(currentSessionId); // 17i.28：面板归属恢复的会话
    void loadModels();
    // ═══ 17i.2：先同步在途运行（禁用输入 + 完成后恢复）═══
    syncFromActiveRun();
    const afterReady = async (): Promise<void> => {
      if (!currentSessionId) currentSessionId = readStoredSession();
      await ensureSession();
      updateTitle();
      await refreshSessions();
      void loadModels();
      void loadSpaces(); // P1：加载空间树（总部/部门）
      if (currentSessionId) await loadHistory(currentSessionId);
      else renderEmpty();
    };
    try {
      await api.getHealth();
      setBackendReady(true);
      await afterReady();
    } catch {
      setBackendReady(false);
      updateStatus('后端未就绪，自动重试中…（正在启动 MorPex 后端）');
      startHealthRetry(afterReady);
    }
  }

  // 17i.29：初始先禁用发送，initWhenReady 确认后端就绪后才启用
  setBackendReady(false);
  void initWhenReady();
  // UI 改版：恢复任务列表（localStorage）并首次渲染
  loadTasksFromStorage();
  renderTaskList();

  return () => {
    if (retryTimer !== undefined) {
      window.clearInterval(retryTimer);
      retryTimer = undefined;
    }
    // 17i.2：切走标签时不关闭运行资源（SSE/计时器/activeRun 模块级存活），
    //         只解除本渲染的 UI 钩子，回页后由新渲染重建。
    // 17k.1：多任务并发——仅解绑各在途 run 的渲染钩子（跨渲染存活，回页由新渲染重建）
    for (const r of activeRuns.values()) {
      r.syncHook = undefined;
      r.elapsedEl = null;
    }
    taskListHook = undefined;  // UI 改版：解绑旧渲染任务列表钩子
    spaceJumpHook = undefined; // UI 改版：解绑旧渲染 Space 跳转钩子
  };
}

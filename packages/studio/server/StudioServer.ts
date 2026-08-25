/**
 * Studio Server — 理想架构对齐版（vNext·Ideal）
 *
 * ═══ 只消费理想 10 层组件 ═══
 *   L1 入口与治理: CompanyFacade / ControlPlane / GovernanceDashboard
 *   L2 Ontology Gate: OntologyService / ForcedQueryGuard
 *   L3 规划: DeliveryPlanner（经 companyFacade.executeGoal）
 *   L4 认知: BrainFacade（经 container.brainFacade）
 *   L5 执行: UnifiedExecutionEngine
 *   L7 知识记忆: MemoryAPI / ArtifactFacade
 *   L10 基础设施: EventBus(SSE) / Observability
 *
 * 已移除（前端 UI 废弃 + 多代遗留）：
 *   - v8 MessageGateway / MissionRuntime / PersonalBrain / Twin
 *   - v9 Agent 组织平面 / AgentHarness / CrossAgent 编排
 *   - v10 LearningPlane / EventMesh
 *   - v12 departments / management / groupchat
 *   - 前端静态托管（packages/studio/ui 已废弃）
 */

import express from 'express';
import cors from 'cors';
import * as fs from 'node:fs';
import * as path from 'node:path';
import mammoth from 'mammoth';
import XLSX from 'xlsx';
import type { Server as HttpServer } from 'node:http';
import { spawn } from 'node:child_process';
import { bootstrapUnified } from '../../core/src/bootstrap-unified.js';
import { RunRegistry } from '../../core/src/execution/runtime/RunRegistry.js';
import type { UnifiedBootstrapResult } from '../../core/src/bootstrap-unified.js';
import { CostController } from '../../core/src/governance/CostController.js';
import { getSharedPiBridge } from '../../core/src/infrastructure/adapters/pi-bridge/PiBridge.js';
import { registerMemoryExtractor } from './transcript/memory-extractor.js';
import { MemoryWeightStore } from '../../memory/src/storage/MemoryWeightStore.js';
import { IntentClassifier } from '../../core/src/cognition/planning/goal-intelligence/IntentClassifier.js';
import type { Space } from '../../core/src/governance/control-plane/space-types.js';
import type { SpaceService } from '../../core/src/governance/control-plane/SpaceService.js';
import { WorkflowRegistry } from '../../core/src/workflow/WorkflowProvider.js';
import { answerAsk, getPendingAsks } from '../../core/src/execution/UserAskService.js';
import { confirmPlan, getPendingPlans, setAutoExecute } from '../../core/src/execution/PlanGateService.js';
import { listPendingDecisions } from '../../core/src/execution/DecisionStore.js';
import { loadMorpexConfig } from '../../core/src/infrastructure/adapters/pi-bridge/yamlConfig.js';
import { TranscriptStore } from './transcript/TranscriptStore.js';
import { TranscriptIndexer } from './transcript/Indexer.js';
import { ChatTranscriptService } from './transcript/ChatTranscriptService.js';
import { AgentMessageStore } from './transcript/AgentMessageStore.js';
import { createSessionToolsBridge } from './transcript/session-tools.js';
import { registerApprovalRoutes } from './transcript/approval-routes.js';
import { setTranscriptToolBridge } from '../../core/src/execution/TranscriptToolBridge.js';
import { projectEvents } from './transcript/projection.js';
import { readEntryAt } from './transcript/readAt.js';
import { SessionStore } from './SessionStore.js';
import { createObservabilityRouter } from './observability/index.js';
import { startObservabilityBridge, wireObservabilityServices } from './observability/runtime-bridge.js';
import { registerRuntimeRoutes } from './RuntimeAPI.js';

export interface StudioServerConfig {
  port?: number;
  sessionsRoot?: string;
  mirrorBasePath?: string;
  ceoId?: string;
}

// ═══════════════════════════════════════════════════════════════
// 文件上传辅助（会话页附件：base64 JSON → data/uploads/<fileId> + meta）
// ═══════════════════════════════════════════════════════════════

const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'js', 'ts', 'jsx', 'tsx',
  'py', 'java', 'c', 'cpp', 'h', 'hpp', 'go', 'rs', 'rb', 'php', 'html', 'htm',
  'css', 'scss', 'sass', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'xml',
  'sql', 'sh', 'bat', 'ps1', 'env', 'gitignore', 'properties', 'gradle', 'dockerfile',
]);

const MIME_MAP: Record<string, string> = {
  '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json', '.csv': 'text/csv',
  '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.ts': 'text/typescript', '.py': 'text/x-python', '.xml': 'application/xml', '.yaml': 'text/yaml',
  '.yml': 'text/yaml', '.sh': 'text/x-sh', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.zip': 'application/zip', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** 清洗用户文件名（防路径穿越 + 控制字符） */
function sanitizeFileName(name: string): string {
  const base = path.basename(name).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
  return base || 'file';
}

function mimeOf(name: string): string {
  return MIME_MAP[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
}

/** 文本 vs 二进制：扩展名优先，其次探测前 8KB 是否含 NUL 字节 */
function isTextLike(name: string, buf: Buffer): boolean {
  const ext = path.extname(name).toLowerCase().replace(/^\./, '');
  if (TEXT_EXTS.has(ext)) return true;
  return !buf.subarray(0, 8 * 1024).includes(0);
}

/** 应用内可预览的文本类扩展名（md/txt/代码等）。 */
function isTextViewable(ext: string): boolean {
  return (
    TEXT_EXTS.has(ext) ||
    ['c', 'h', 'cpp', 'hpp', 'cc', 'cxx', 'mjs', 'cjs', 'tsx', 'jsx', 'go', 'rs', 'java', 'rb', 'php', 'lua', 'pl', 'sql', 'csv', 'tsv', 'toml', 'ini', 'log', 'env', 'sh', 'bat', 'ps1', 'xml'].includes(ext)
  );
}

/** 17i.33：任务完成后 LLM 生成拟人化总结（流式 chat.stream.delta）——替代「==== CEO 执行报告」原始格式。 */
async function generateTaskSummary(goal: string, result: Record<string, unknown>, eventBus: { emit: (e: import('../../core/src/infrastructure/common/types.js').MorPexEvent) => void }): Promise<string> {
  const bridge = getSharedPiBridge();
  const system = [
    '你是 MorPex 的部门经理。任务已执行完毕，请用友好、拟人化的语气向用户汇报（2-4 句，纯口语，不要 ==== / 列表 / Markdown）：',
    '- 开头自然（如「搞定了！」「完成了！」）',
    '- 说明完成了什么（产物/文件/成果）',
    '- 结尾可询问是否需要调整或进一步帮忙',
    '不要提及内部架构/Agent/编排/步骤细节。',
  ].join('\n');
  const report = typeof result.report === 'string' ? result.report.slice(0, 800) : '';
  const artifacts = Array.isArray(result.artifacts) ? result.artifacts.length : 0;
  const prompt = `任务：${goal}\n\n执行结果摘要：\n${report || '(无详细报告)'}\n\n产物数：${artifacts}`;
  const full = await bridge.generateChatStream({ system, prompt }, (delta) => {
    eventBus.emit({
      id: `evt_chat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: 'chat.stream.delta',
      timestamp: Date.now(),
      executionId: 'chat',
      source: 'studio-server',
      payload: { delta },
    });
  });
  return full.trim();
}

/**
 * P1 部门 Space：任务路由（Q4=LLM 判断）。
 * 主：LLM 判断（注入各部门 routeHint，输出 dept_xxx）；失败/无匹配回退 matchGoal；再失败默认软件部。
 */
async function routeTaskToSpace(
  goal: string,
  spaceService: SpaceService,
  llmRoute: (system: string, prompt: string, opts?: { temperature?: number; maxTokens?: number }) => Promise<string>,
): Promise<Space | undefined> {
  try {
    const hint = spaceService.routingHint();
    const system = [
      '你是 MorPex 总部的秘书。用户下达了一个工作任务，请在以下可选部门中选择最合适的一个。',
      '',
      hint,
      '',
      '只输出一个部门 id（格式：dept_xxx），不要任何其它文字（不要解释、不要标点、不要引号）。',
    ].join('\n');
    const text = (await llmRoute(system, goal, { temperature: 0, maxTokens: 20 })).trim();
    const m = text.match(/\b(dept_[A-Za-z0-9_-]+)\b/);
    if (m) {
      const sp = spaceService.getSpace(m[1]);
      if (sp) return sp;
    }
  } catch {
    /* LLM 路由失败 → 回退 matchGoal */
  }
  return spaceService.routeGoal(goal) ?? spaceService.getDefaultDepartmentSpace();
}

/** 组装附件上下文：文本截断 32K 拼入，二进制仅引用；读取失败静默跳过 */
function buildAttachmentContext(attachments: Array<{ fileId: string; name?: string }>): string {
  const parts: string[] = [];
  const dir = path.resolve('data/uploads');
  for (const att of attachments) {
    if (!att || typeof att.fileId !== 'string' || !att.fileId) continue;
    const fileId = path.basename(att.fileId); // 防路径穿越
    try {
      const metaPath = path.join(dir, `${fileId}.meta.json`);
      if (!fs.existsSync(metaPath)) continue;
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as { name?: string; isText?: boolean };
      // ═══ 会话 17h·opt：att.name 由客户端提供且未清洗（可能含换行/控制符/注入语），
      //     入 prompt 前必须再过 sanitizeFileName；meta.name 写入时已清洗，双保险 ═══
      const name = att.name ? sanitizeFileName(att.name) : (meta.name || fileId);
      if (meta.isText) {
        const content = fs.readFileSync(path.join(dir, fileId), 'utf-8');
        const truncated = content.length > 32 * 1024
          ? content.slice(0, 32 * 1024) + '\n…（内容过长已截断）'
          : content;
        parts.push(`[附件: ${name}]\n${truncated}`);
      } else {
        parts.push(`[附件: ${name}]（二进制文件，已上传，未解析内容）`);
      }
    } catch {
      /* 附件读取失败则跳过，不阻断对话 */
    }
  }
  return parts.length > 0 ? parts.join('\n\n') + '\n\n' : '';
}

export class StudioServer {
  private app: express.Express;
  private config: StudioServerConfig;
  private httpServer?: HttpServer;
  private sessionStore?: SessionStore;
  private boot?: UnifiedBootstrapResult;
  private sseClients = new Map<string, { res: express.Response; connectedAt: number }>();
  private sseIdCounter = 0;

  /** ═══ T0 多轮连续：同一会话执行串行化护栏（chatSessionId → in-flight promise）═══ */
  private chatInflight = new Map<string, Promise<void>>();
  /// T7 记忆权重簿（可选：初始化失败时记忆功能仍可用，仅无沉淀/衰减）
  private memoryWeightStore?: MemoryWeightStore;
  /** ═══ T1 档案室：chat 会话绑定/索引（替代 T0 的 chat-orch-map.json，真相源 transcript_windows 表）═══ */
  private transcripts?: ChatTranscriptService;
  private transcriptStore?: TranscriptStore;
  private messageStore?: AgentMessageStore;
  private approvalRoutesRegistered = false;

  /** 会话 16c（3+4）：execution-stats 总成功率（跨模式加权） */
  private calcOverallRate(quality: Record<string, { success: number; total: number; avgDuration: number; successRate: number }>): number {
    let total = 0;
    let success = 0;
    for (const q of Object.values(quality)) {
      total += q.total;
      success += q.success;
    }
    return total > 0 ? Number((success / total).toFixed(4)) : 0;
  }

  // ── T1 档案室：chat 会话绑定（替代 T0 的 chat-orch-map.json 三方法）──

  /** 懒初始化 Transcript 档案室（依赖 boot 后的 agentSessionStore；未就绪或初始化失败返回 undefined，降级直读 jsonl） */
  private getTranscripts(): ChatTranscriptService | undefined {
    if (this.transcripts) return this.transcripts;
    const store = this.boot?.container.agentSessionStore;
    if (!store) return undefined;
    try {
      const root = path.resolve(this.config.sessionsRoot ?? 'data/sessions');
      const tstore = new TranscriptStore(path.join(root, 'transcript.db'));
      this.transcriptStore = tstore;
      const indexer = new TranscriptIndexer(tstore);
      this.transcripts = new ChatTranscriptService({
        store: tstore,
        indexer,
        openHandle: (p) => store.openHandle(p),
        // T2 回合记录：账本追加自定义条目（不进 LLM 上下文，投影层唯一放行的对话面）
        appendCustomEntry: async (p, type, data) => {
          const h = await store.openHandle(p);
          await store.appendCustom(h.session, type, data);
        },
        createOrchestratorSession: async (chatSessionId) => {
          const handle = await store.createSession({
            component: 'orchestrator',
            id: `orch_chat_${Date.now()}`,
            metadata: { chatSessionId, origin: 'chat-session-reuse' },
          });
          return { sessionId: handle.sessionId, path: handle.path };
        },
      });
    // T1 parent 链：step/executor 会话创建 → 登记 transcript_windows（父标识随回调携带，老账本按路径兑底反查）
    store.onSessionCreated = (info) => this.transcripts?.registerComponentSession(info);
    // T3 组织通信：留言表 + session_read/send_message 桥注入（core 哑工具 ← server 真实现）
    this.messageStore = new AgentMessageStore(path.join(root, 'transcript.db'));
    setTranscriptToolBridge(createSessionToolsBridge({
      store: tstore,
      indexer,
      messageStore: this.messageStore,
      appendStubTo: async (win, type, content, display) => {
        const h = await store.openHandle(win.file_path);
        await store.appendCustomMessage(h.session, type, content, display);
      },
    }));
    // 路由注册放这里（懒初始化点）：registerRoutes 时 boot 未就绪、messageStore 还不存在；
    // Express 支持监听后追加路由，首次 chat/send 触发初始化后即生效
    if (!this.approvalRoutesRegistered) {
      this.approvalRoutesRegistered = true;
      registerApprovalRoutes(this.app, { messageStore: this.messageStore, transcriptStore: tstore });
    }
    return this.transcripts;
    } catch (err) {
      // SQLite 打不开（损坏/锁/磁盘）：降级为 undefined → 绑定走旧内存路径、history 直读 jsonl（设计 §4.4 降级保底）
      console.warn('[Studio] ⚠️ Transcript 档案室初始化失败（降级：绑定不持久化/历史直读 jsonl）:', err instanceof Error ? err.message : String(err));
      return undefined;
    }
  }

  /** T2：history/events 路由用的只读索引入口（随档案室初始化；未初始化为 undefined → 路由走降级分支） */
  private getTranscriptStore(): TranscriptStore | undefined {
    this.getTranscripts(); // 确保已尝试初始化
    return this.transcriptStore;
  }

  /** T2：近期对话轮次——账本投影优先，降级旧 chat-history。供 chat 直答历史注入 */
  private loadRecentTurns(sessionId: string, limit: number): Array<{ role: string; content: string }> {
    const svc = this.getTranscripts();
    const win = svc?.findWindow(sessionId);
    if (svc && win && fs.existsSync(win.file_path)) {
      try {
        svc.indexNow(win.session_id, win.file_path);
        const store = this.getTranscriptStore();
        if (store) {
          const rows = store.eventsBySession(win.session_id);
          const projected = projectEvents(rows, win.file_path, readEntryAt);
          return projected.slice(-limit * 2).map((m) => ({ role: m.role, content: m.content }));
        }
      } catch (err) {
        console.warn('[Studio] ⚠️ 账本投影取历史失败（降级旧存储）:', (err as Error).message);
      }
    }
    return (this.sessionStore?.getChatHistory(sessionId) ?? []).slice(-limit * 2).map((m) => ({ role: String(m.role), content: String(m.content ?? '') }));
  }

  /**
   * resolveOrchestratorSessionPath — 同一 chat 会话复用同一本 orchestrator 账本（T1：绑定持久化于 transcript_windows 表）。
   * 失败/未就绪返回 undefined（降级为旧行为）。
   */
  private async resolveOrchestratorSessionPath(chatSessionId: string): Promise<{ sessionId: string; path: string } | undefined> {
    const svc = this.getTranscripts();
    if (!svc) return undefined;
    const ref = await svc.resolveOrchestratorPath(chatSessionId);
    return ref ? { sessionId: ref.sessionId, path: ref.path } : undefined;
  }

  constructor(config: StudioServerConfig = {}) {
    this.config = config;
    this.app = express();
  }

  // ── 启动 ──

  async start(): Promise<void> {
    this.app.use(cors());
    this.app.use(express.json({ limit: '10mb' }));

    // ★ 理想装配：L1-L10 全部经 bootstrapUnified 注入
    this.boot = await bootstrapUnified({ ceoId: this.config.ceoId ?? 'ceo-default' });
    const { container } = this.boot;

    // ═══ 模型切换持久化恢复：data/runtime-config.json 的 activeModel 覆盖 config 默认 ═══
    try {
      const rcPath = path.resolve('data/runtime-config.json');
      if (fs.existsSync(rcPath)) {
        const rc = JSON.parse(fs.readFileSync(rcPath, 'utf-8')) as { activeModel?: string };
        if (typeof rc.activeModel === 'string' && rc.activeModel) {
          getSharedPiBridge().setDefaultModel(rc.activeModel);
          console.log(`[Studio] ✅ 已恢复运行时模型选择: ${rc.activeModel}`);
        }
      }
    } catch (err) {
      console.warn('[Studio] ⚠️ runtime-config.json 恢复失败（忽略）:', err instanceof Error ? err.message : String(err));
    }

    // 会话持久化
    this.sessionStore = new SessionStore(this.config.sessionsRoot);
    console.log('[Studio] ✅ SessionStore 就绪');

    // L10 观测面
    this.app.use('/api/observability', createObservabilityRouter());

    // ═══ 架构可观测（S34）：接线 /audit、/replay 服务 + 核心 EventBus → 观测面桥接 ═══
    // 修复此前 archAuditor/replayEngine 从未初始化（/audit 503）+ ObservationCollector 无真实数据
    wireObservabilityServices();
    startObservabilityBridge(container.eventBus);

    // ═══ 去黑盒化（黑盒⑬）：LLM 交互追踪订阅（消费核心 DeblackboxRecorder 的 llm.call）═══
    try {
      const { llmTracer } = await import('./observability/llm-tracer.js');
      llmTracer.start();
    } catch (err) {
      console.warn('[Studio] ⚠️ llm-tracer 启动失败（忽略）:', err instanceof Error ? err.message : String(err));
    }

    // ═══ T5/T7 跨会话记忆：订阅回合收尾事件 → LLM 提取 → 四路分流（显式直写/工单/遗忘/丢弃）+ 权重簿 ═══
    if (container.companyMemoryApi) {
      let weightStore: MemoryWeightStore | undefined;
      try {
        weightStore = new MemoryWeightStore(path.join(process.cwd(), 'data', 'sessions', 'memory-weights.db'));
      } catch (err) {
        console.warn('[Studio] ⚠️ 权重簿初始化失败（记忆仍可用，仅无沉淀/衰减）：', err instanceof Error ? err.message : String(err));
      }
      registerMemoryExtractor(container.eventBus, { memoryApi: container.companyMemoryApi, weightStore });
      this.memoryWeightStore = weightStore;
      console.log('[Studio] ✅ MemoryExtractor 就绪（chat.turn.completed → LLM 提取 → 四路分流）');
    }

    // 运行时 API（RuntimeAPI：FSM/DAG/ArtifactGraph/Learning/SSE）
    // ⚠️ S24 修复：此前 registerRuntimeRoutes 从未被挂载 → 11 个路由全部不可达（死代码面）
    registerRuntimeRoutes(this.app);

    // 路由注册
    this.registerIdealRoutes();

    // SSE（L10 EventBus → 前端事件流）
    this.registerSSE(container.eventBus);

    const port = this.config.port ?? 5473;
    this.httpServer = this.app.listen(port, () => {
      console.log(`[Studio] 🚀 理想架构 Studio Server 运行在 http://localhost:${port}`);
    });
  }

  /**
   * getPort — 返回实际监听端口（配置为 0 时由 OS 分配，测试用）
   */
  getPort(): number {
    const addr = this.httpServer?.address();
    if (addr && typeof addr === 'object') return addr.port;
    return this.config.port ?? 5473;
  }

  // ── 理想层路由 ──

  private registerIdealRoutes(): void {
    const { container, companyFacade, ontology, forcedQueryGuard } = this.boot!;

    // ── 系统状态（L1/L10）──
    this.app.get('/api/health', (_req, res) => {
      res.json({
        ok: true,
        uptime: process.uptime(),
        bootedAt: this.boot ? 'ready' : 'booting',
        runtime: container.runtime.constructor.name,
      });
    });

    this.app.get('/api/status', (_req, res) => {
      const gov = container.governanceDashboard;
      res.json({
        phase: 'ideal-aligned',
        departments: companyFacade.listDepartments().length,
        artifacts: container.artifactFacade.getAll().length,
        controlPlane: {
          goal: !!container.controlPlane,
          policies: (container as any).governanceDashboard ? 1 : 0,
        },
        governance: gov ? gov.getSystemHealth() : null,
      });
    });

    this.app.get('/api/config', (_req, res) => {
      res.json({ version: 'vNext-ideal', engine: 'bootstrapUnified', port: this.config.port ?? 5473 });
    });

    // ── 治理（L1）──
    this.app.get('/api/governance', (_req, res) => {
      const gov = container.governanceDashboard;
      res.json({
        ok: true,
        health: gov?.getSystemHealth?.() ?? null,
        cost: gov?.getCostReport?.() ?? null,
        delivery: gov?.getDeliveryMetrics?.() ?? null,
      });
    });

    // ── 本体（L2）──
    this.app.get('/api/ontology/stats', (_req, res) => {
      res.json({ ok: true, guard: !!forcedQueryGuard, service: !!ontology });
    });

    // ── 会话（T2：/api/sessions = chat_index ∪ legacy 目录扫描；/history 投影自账本，无窗口降级旧存储）──
    this.app.get('/api/sessions', (_req, res) => {
      const legacy = this.sessionStore?.listSessions() ?? [];
      const svc = this.getTranscripts();
      if (!svc) return res.json({ sessions: legacy });
      const indexed = svc.listChatSessions();
      const seen = new Set(indexed.map((s) => s.id));
      // chat_index 优先（有预览/计数），legacy 补充未入索引的老会话
      const merged = [...indexed, ...legacy.filter((s) => !seen.has(s.id)).map((s) => ({ ...s, source: 'legacy' as const }))];
      return res.json({ sessions: merged });
    });

    this.app.post('/api/session/create', (req, res) => {
      const id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      if (typeof req.body?.name === 'string' && req.body.name) {
        this.sessionStore?.setSessionName(id, req.body.name);
      }
      res.json({ ok: true, sessionId: id });
    });

    // ── T2 history v2：投影自账本（morpex.turn 回合记录）；无窗口会话降级旧 chat-history ──
    // 前端零改动：路径与消息形状兼容（role user/assistant + content + timestamp），新增 cursor 字段
    this.app.get('/api/session/:id/history', (req, res) => {
      const id = req.params.id;
      const opts = {
        thinking: req.query.thinking === '1',
        tools: req.query.tools === '1',
      };
      const svc = this.getTranscripts();
      const win = svc?.findWindow(id);
      if (svc && win && fs.existsSync(win.file_path)) {
        try {
          svc.indexNow(win.session_id, win.file_path); // 懒对账：确保索引追平真相源
          const rows = this.getTranscriptStore()!.eventsBySession(win.session_id);
          const messages = projectEvents(rows, win.file_path, readEntryAt, opts);
          const lastSeq = this.getTranscriptStore()!.getWatermark(win.session_id)?.last_seq ?? 0;
          return res.json({ ok: true, messages, cursor: lastSeq, source: 'transcript' });
        } catch (err) {
          console.warn('[Studio] ⚠️ history v2 投影失败（降级直读旧存储）:', (err as Error).message);
        }
      }
      return res.json({ ok: true, messages: this.sessionStore?.getChatHistory(id) ?? [], source: 'legacy' });
    });

    // ── T4 管理面：重开会话（新窗口链旧窗口，LLM 上下文断裂，不物理删）──
    this.app.post('/api/session/:id/reset', async (req, res) => {
      const svc = this.getTranscripts();
      if (!svc) return res.status(503).json({ ok: false, error: 'transcript service unavailable' });
      const created = await svc.resetSession(req.params.id);
      if (!created) return res.status(500).json({ ok: false, error: 'reset failed (see server log)' });
      return res.json({ ok: true, sessionId: req.params.id, newLedgerSessionId: created.sessionId, path: created.path });
    });

    // ── T4 管理面：上下文压缩（pi 原生 appendCompaction；摘要经共享 PiBridge LLM 生成）──
    this.app.post('/api/session/:id/compact', async (req, res) => {
      const svc = this.getTranscripts();
      const store = this.boot?.container.agentSessionStore;
      const win = svc?.findWindow(req.params.id);
      if (!store || !win || !fs.existsSync(win.file_path)) {
        return res.status(404).json({ ok: false, error: 'session window not found' });
      }
      try {
        const keepTail = typeof req.body?.keepTail === 'number' ? req.body.keepTail : undefined;
        const result = await store.compactViaSession(
          win.file_path,
          (prompt: string) => getSharedPiBridge().generateText({ system: '你是会话摘要助手', prompt }).then((r) => r.text),
          { keepTail },
        );
        console.log(`[Transcript] 🗜️ 会话 ${req.params.id} compact: ${result.compactedCount} 条入摘要，保留 ${result.keptCount} 条`);
        return res.json({ ...result, ok: result.ok });
      } catch (err) {
        return res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    // ── T2 增量对账：SSE 断线重连后按 after=seq 拉增量（游标统一 pi entry 物理行号）──
    this.app.get('/api/session/:id/events', (req, res) => {
      const id = req.params.id;
      const after = Number(req.query.after ?? 0) || 0;
      const svc = this.getTranscripts();
      const win = svc?.findWindow(id);
      if (!svc || !win || !fs.existsSync(win.file_path)) {
        return res.json({ ok: true, messages: [], cursor: after });
      }
      try {
        svc.indexNow(win.session_id, win.file_path);
        const store = this.getTranscriptStore()!;
        const rows = store.eventsBySession(win.session_id, after);
        const messages = projectEvents(rows, win.file_path, readEntryAt, {
          thinking: req.query.thinking === '1',
          tools: req.query.tools === '1',
        });
        return res.json({ ok: true, messages, cursor: store.getWatermark(win.session_id)?.last_seq ?? after });
      } catch (err) {
        return res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    // ── P1 部门 Space：空间树（总部 + 部门）──
    this.app.get('/api/spaces', (_req, res) => {
      try {
        const tree = this.boot?.spaceService?.getTree();
        if (!tree) return res.status(503).json({ ok: false, error: '空间服务未就绪' });
        res.json({ ok: true, tree });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    // ── P3-B：工作流热插拔（安装新工作流 → 动态生成部门 Space）──
    // 已注册工作流清单（当前部门）；前端「安装工作流」入口据此展示候选。
    this.app.get('/api/space/installable', (_req, res) => {
      try {
        const spaceService = this.boot?.spaceService;
        if (!spaceService) return res.status(503).json({ ok: false, error: '空间服务未就绪' });
        const tree = spaceService.getTree();
        const registered = WorkflowRegistry.getAll().map((p) => p.name);
        res.json({ ok: true, departments: tree.departments, registered });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    // 安装：已注册 → 直接刷新生成部门；未注册 → 尽力动态 import packages/workflows/<id>/workflow-provider.ts 再注册。
    // 开发模式动态 import 可行（tsx 运行时）；打包/复杂路径失败时返回提示「重启后自动发现」。
    this.app.post('/api/space/install-workflow', async (req, res) => {
      try {
        const spaceService = this.boot?.spaceService;
        if (!spaceService) return res.status(503).json({ ok: false, error: '空间服务未就绪' });
        const workflowId = String(req.body?.workflowId ?? '').trim();
        if (!workflowId) return res.status(400).json({ ok: false, error: 'workflowId 必填' });
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(workflowId)) {
          return res.status(400).json({ ok: false, error: '非法的 workflowId' });
        }
        if (!WorkflowRegistry.get(workflowId)) {
          // 尝试动态注册（尽力而为）
          try {
            const { pathToFileURL } = await import('node:url');
            const base = path.resolve('packages/workflows', workflowId, 'workflow-provider.ts');
            const mod = await import(pathToFileURL(base).href) as Record<string, unknown>;
            const provider = (mod.workflowProvider ?? mod.default
              ?? Object.values(mod).find((v) => v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string'
                && typeof (v as { matchGoal?: unknown }).matchGoal === 'function')) as { name?: string; matchGoal?: (g: string) => number | boolean } & Record<string, unknown> | undefined;
            if (provider?.name && !WorkflowRegistry.get(provider.name)) {
              WorkflowRegistry.register(provider as never);
              console.log(`[Studio] 🔌 动态注册工作流: ${provider.name}`);
            }
          } catch { /* 动态 import 失败 → 靠重启自动发现 */ }
        }
        spaceService.refresh();
        const sp = spaceService.getDepartmentSpace(workflowId);
        if (!sp) {
          return res.status(404).json({
            ok: false,
            error: `未发现工作流「${workflowId}」的部门。请确认：1) 包已放置到 packages/workflows/${workflowId}/（含 manifest.json + workflow-provider.ts）；2) 或已注册 provider；3) 或重启（bootstrap 自动发现已注册包）。`,
          });
        }
        res.json({ ok: true, space: sp, departments: spaceService.getTree().departments });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    // ── P1 部门 Space：按空间过滤消息（无 spaceId 的旧消息归 hq；需前端传 sessionId）──
    this.app.get('/api/spaces/:id/messages', (req, res) => {
      try {
        const spaceId = req.params.id;
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(spaceId)) {
          return res.status(400).json({ ok: false, error: '非法空间 ID' });
        }
        const sessionId = (req.query?.sessionId as string | undefined) ?? '';
        if (!sessionId) return res.json({ ok: true, messages: [] });
        const all = this.sessionStore?.getChatHistory(sessionId) ?? [];
        const messages = all.filter((m) => {
          const sp = (m as Record<string, unknown>).spaceId;
          if (spaceId === 'hq') return !sp || sp === 'hq';
          return sp === spaceId;
        });
        res.json({ ok: true, messages });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    // ── P-A：任务状态投影（UI 持久化真相源；切视图/重启后前端从 data/tasks/*.json 恢复工作台）──
    this.app.get('/api/tasks', (_req, res) => {
      try {
        const list = this.boot?.taskStateProjector?.list() ?? [];
        res.json({
          ok: true,
          tasks: list.map((t) => ({
            missionId: t.missionId,
            goal: t.goal,
            progress: t.progress,
            status: t.steps.some((s) => s.status === 'running')
              ? 'running'
              : t.steps.length > 0 && t.steps.every((s) => s.status === 'done' || s.status === 'failed')
                ? 'done'
                : 'pending',
            updatedAt: t.updatedAt,
          })),
        });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });
    this.app.get('/api/tasks/:id', (req, res) => {
      try {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(req.params.id)) {
          return res.status(400).json({ ok: false, error: '非法任务 ID' });
        }
        const task = this.boot?.taskStateProjector?.get(req.params.id);
        res.json({ ok: true, task: task ?? null });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    // ── P2：跨部门/工位交流邮箱（只读旁观 + 手动发送/调试）──
    this.app.get('/api/mailbox/:spaceId', (req, res) => {
      try {
        const spaceId = req.params.spaceId;
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(spaceId)) {
          return res.status(400).json({ ok: false, error: '非法空间 ID' });
        }
        const mailbox = this.boot?.mailbox;
        if (!mailbox) return res.status(503).json({ ok: false, error: 'AgentMailbox 未就绪' });
        res.json({ ok: true, messages: mailbox.listForSpace(spaceId) });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    this.app.post('/api/mailbox/send', async (req, res) => {
      try {
        const mailbox = this.boot?.mailbox;
        if (!mailbox) return res.status(503).json({ ok: false, error: 'AgentMailbox 未就绪' });
        const body = (req.body ?? {}) as Record<string, unknown>;
        const to = typeof body.to === 'string' ? body.to.trim() : '';
        const question = typeof body.question === 'string' ? body.question.trim() : '';
        if (!to || !question) {
          return res.status(400).json({ ok: false, error: 'to 和 question 必填' });
        }
        const reply = await mailbox.sendAndWait({
          from: typeof body.from === 'string' && body.from ? body.from : 'agent:manual',
          to,
          question,
          spaceId: typeof body.spaceId === 'string' ? body.spaceId : undefined,
          taskId: typeof body.taskId === 'string' ? body.taskId : undefined,
          goal: typeof body.goal === 'string' ? body.goal : undefined,
        });
        res.json({ ok: true, reply, messages: mailbox.listForSpace(typeof body.spaceId === 'string' ? body.spaceId : undefined) });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    // ── 删除会话（幂等：不存在的会话也 200）──
    this.app.delete('/api/session/:id', (req, res) => {
      // ═══ 会话 17h·review C1：sessionId 白名单（Express 会解码 %2F → 可穿越，必须在此拦截）═══
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(req.params.id)) {
        return res.status(400).json({ ok: false, error: '非法会话 ID' });
      }
      const deleted = this.sessionStore?.deleteSession(req.params.id) ?? false;
      res.json({ ok: true, deleted });
    });

    // ── 编排组件会话（Session 化治理：多 Agent 总大脑/step-agent/执行肢持久化会话）──
    this.app.get('/api/agent-sessions', async (req, res) => {
      try {
        const component = (req.query?.component as string | undefined) as 'orchestrator' | 'step-agent' | 'executor' | undefined;
        const valid = component === undefined || component === 'orchestrator' || component === 'step-agent' || component === 'executor';
        if (!valid) {
          return res.status(400).json({ ok: false, error: 'component 必须是 orchestrator|step-agent|executor' });
        }
        const sessions = await container.agentSessionStore.list(component);
        res.json({ ok: true, sessions });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    this.app.get('/api/agent-sessions/entries', async (req, res) => {
      const path = req.query?.path;
      if (!path || typeof path !== 'string') {
        return res.status(400).json({ ok: false, error: 'path query 参数必填（会话 jsonl 绝对路径）' });
      }
      try {
        const entries = await container.agentSessionStore.readEntries(path);
        res.json({ ok: true, path, entries });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    // ── 文件上传（会话页附件）──
    this.app.post('/api/files/upload', (req, res) => {
      try {
        const name = typeof req.body?.name === 'string' ? req.body.name : '';
        const b64 = typeof req.body?.contentBase64 === 'string' ? req.body.contentBase64 : '';
        if (!name || !b64) return res.status(400).json({ ok: false, error: 'name 与 contentBase64 必填' });
        const buf = Buffer.from(b64, 'base64');
        if (buf.length === 0) return res.status(400).json({ ok: false, error: 'contentBase64 解码为空' });
        const MAX = 5 * 1024 * 1024;
        if (buf.length > MAX) {
          return res.status(413).json({ ok: false, error: `文件过大（上限 ${MAX / 1024 / 1024}MB）` });
        }
        const safe = sanitizeFileName(name);
        const isText = isTextLike(safe, buf);
        const fileId = `file_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const dir = path.resolve('data/uploads');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, fileId), buf);
        fs.writeFileSync(
          path.join(dir, `${fileId}.meta.json`),
          JSON.stringify({ name: safe, size: buf.length, mimeType: mimeOf(safe), isText, savedAt: Date.now() }, null, 2),
          'utf-8',
        );
        res.json({ ok: true, fileId, name: safe, size: buf.length, mimeType: mimeOf(safe), isText });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    // ── 模型列表 / 切换（全局生效：PiBridge 单例 defaultModel）──
    this.app.get('/api/models', async (_req, res) => {
      try {
        const bridge = getSharedPiBridge();
        await bridge.init();
        const active = bridge.defaultModel;
        const models = bridge.listModels().map((m) => ({
          id: `${m.provider}/${m.id}`,
          provider: m.provider,
          model: m.id,
          name: m.name || m.id,
          contextWindow: m.contextWindow,
          maxTokens: m.maxTokens,
          reasoning: Boolean(m.reasoning),
          isActive: `${m.provider}/${m.id}` === active,
        }));
        res.json({ ok: true, active, models });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    this.app.post('/api/models/active', async (req, res) => {
      try {
        const bridge = getSharedPiBridge();
        await bridge.init();
        const reqId = req.body?.modelId;
        let target: string;
        let persist = true;
        if (reqId === null || reqId === undefined || reqId === 'default') {
          // 恢复 config 默认：删除 override 文件且不再写回（config 保持唯一模型来源）
          const llm = loadMorpexConfig()?.llm;
          target = llm?.provider && llm.model ? `${llm.provider}/${llm.model}` : bridge.defaultModel;
          persist = false;
          try {
            fs.rmSync(path.resolve('data/runtime-config.json'), { force: true });
          } catch {
            /* ignore */
          }
        } else if (typeof reqId === 'string') {
          target = reqId;
          const known = bridge.listModels().some((m) => `${m.provider}/${m.id}` === target);
          if (!known) return res.status(400).json({ ok: false, error: `未知模型: ${target}` });
        } else {
          return res.status(400).json({ ok: false, error: 'modelId 必填' });
        }
        bridge.setDefaultModel(target);
        if (persist) {
          try {
            const rcPath = path.resolve('data/runtime-config.json');
            fs.mkdirSync(path.dirname(rcPath), { recursive: true });
            fs.writeFileSync(rcPath, JSON.stringify({ activeModel: target }, null, 2), 'utf-8');
          } catch (err) {
            console.warn('[Studio] ⚠️ runtime-config.json 写入失败:', err instanceof Error ? err.message : String(err));
          }
        }
        res.json({ ok: true, active: target });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    // ── 人工审批（ApprovalGate：web 路径高风险操作会 waitForDecision 阻塞）──
    this.app.get('/api/approval/pending', (_req, res) => {
      try {
        const approvals = container.approvalGate.getPending();
        res.json({ ok: true, approvals });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    this.app.post('/api/approval/:id/decide', (req, res) => {
      try {
        const decision = String(req.body?.decision ?? '').toUpperCase();
        if (decision !== 'APPROVED' && decision !== 'REJECTED') {
          return res.status(400).json({ ok: false, error: 'decision 必须是 APPROVED 或 REJECTED' });
        }
        const by = typeof req.body?.by === 'string' && req.body.by ? req.body.by : 'studio-web';
        const ok = container.approvalGate.decide(req.params.id, decision as 'APPROVED' | 'REJECTED', by);
        res.json({ ok, id: req.params.id, decision });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    // ── 17i.15：LLM 自主决策问用户（ask_user 工具）──
    this.app.get('/api/ask/pending', (_req, res) => {
      res.json({ ok: true, asks: getPendingAsks() });
    });
    this.app.post('/api/ask/:id/answer', (req, res) => {
      const answer = typeof req.body?.answer === 'string' && req.body.answer.trim() ? req.body.answer.trim() : '';
      if (!answer) return res.status(400).json({ ok: false, error: 'answer 必填' });
      const ok = answerAsk(req.params.id, answer);
      res.json({ ok, id: req.params.id, answer });
    });

    // ── 17i.22：规划方案确认（Goal 模式自动跳过）──
    this.app.get('/api/plan/pending', (_req, res) => {
      res.json({ ok: true, plans: getPendingPlans() });
    });
    this.app.post('/api/plan/:id/continue', (req, res) => {
      const ok = confirmPlan(req.params.id);
      res.json({ ok, id: req.params.id });
    });

    // ── P3-A：人工决策统一（HumanDecision：plan/ask/approval 三类聚合成一个「需要你决定」入口）──
    // 底层三个 service 不动（旧端点保留兼容）；这里只做「聚合查询 + 统一决议路由」，前端统一样式渲染。
    const collectHumanDecisions = (): Array<{
      id: string; kind: 'plan' | 'ask' | 'approval';
      title: string; question: string; options?: string[];
      goal?: string; meta: Record<string, unknown>;
      status: 'pending' | 'resolved'; createdAt: number;
    }> => {
      const now = Date.now();
      // P-B：先取持久化决策（含后端重启恢复的），再以三个 service 运行时 pending 去重补充（保证不重复）
      const stored = listPendingDecisions().map((d) => ({
        id: d.id, kind: d.kind,
        title: d.title ?? (d.kind === 'plan' ? '需要你确认执行方案' : d.kind === 'approval' ? '需要你审批' : '需要你回答'),
        question: d.question ?? d.goal ?? '(待处理)',
        options: d.options,
        goal: d.goal, spaceId: d.spaceId, meta: d.meta ?? {},
        status: 'pending' as const, createdAt: d.createdAt,
      }));
      const storedIds = new Set(stored.map((s) => s.id));
      const plans = getPendingPlans().filter((p) => !storedIds.has(p.id)).map((p) => ({
        id: p.id, kind: 'plan' as const,
        title: '需要你确认执行方案',
        question: `任务「${String(p.goal).slice(0, 40)}」的规划方案已就绪（${p.planFile}），是否继续执行？`,
        options: ['继续执行', '暂缓'],
        goal: p.goal, meta: { planFile: p.planFile, stepNames: p.stepNames },
        status: 'pending' as const, createdAt: now,
      }));
      const asks = getPendingAsks().filter((a) => !storedIds.has(a.id)).map((a) => ({
        id: a.id, kind: 'ask' as const,
        title: '需要你回答',
        question: a.question, options: a.options,
        goal: undefined, meta: {}, status: 'pending' as const, createdAt: now,
      }));
      const approvals = container.approvalGate.getPending().filter((a: { id: string }) => !storedIds.has(a.id)).map((a: { id: string; summary?: string; description?: string; riskLevel?: string; artifactId?: string; action?: string }) => ({
        id: a.id, kind: 'approval' as const,
        title: `需要你审批：${a.summary || a.action || a.artifactId || '操作'}`,
        question: a.description || a.summary || `风险级别：${a.riskLevel ?? '未知'}，请决定是否批准`,
        options: ['批准', '拒绝'],
        goal: undefined, meta: { riskLevel: a.riskLevel, artifactId: a.artifactId },
        status: 'pending' as const, createdAt: now,
      }));
      return [...stored, ...plans, ...asks, ...approvals];
    };
    this.app.get('/api/decisions/pending', (_req, res) => {
      try {
        res.json({ ok: true, decisions: collectHumanDecisions() });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });
    // 统一决议：kind 路由到底层（plan→confirm / ask→answer / approval→decide）；kind 缺失时按 id 探测。
    this.app.post('/api/decisions/:id/respond', (req, res) => {
      try {
        const id = req.params.id;
        const kind = String(req.body?.kind ?? '').trim();
        const answer = typeof req.body?.answer === 'string' ? req.body.answer : '';
        const decision = String(req.body?.decision ?? '').toUpperCase();
        if (kind === 'ask') {
          if (!answer.trim()) return res.status(400).json({ ok: false, error: 'answer 必填' });
          return res.json({ ok: answerAsk(id, answer), id, kind: 'ask', answer });
        }
        if (kind === 'approval') {
          if (decision !== 'APPROVED' && decision !== 'REJECTED') {
            return res.status(400).json({ ok: false, error: 'decision 必须是 APPROVED 或 REJECTED' });
          }
          return res.json({ ok: container.approvalGate.decide(id, decision as 'APPROVED' | 'REJECTED', 'user'), id, kind: 'approval', decision });
        }
        // 'plan' 或缺省 → 先试 plan（confirm 不需要额外参数）
        const okPlan = confirmPlan(id);
        if (okPlan) return res.json({ ok: true, id, kind: 'plan' });
        if (kind === 'plan') return res.json({ ok: false, id, kind: 'plan' });
        // 探测 ask / approval
        const pendingAsk = getPendingAsks().find((x) => x.id === id);
        if (pendingAsk) {
          if (!answer.trim()) return res.status(400).json({ ok: false, error: 'answer 必填' });
          return res.json({ ok: answerAsk(id, answer), id, kind: 'ask', answer });
        }
        const pendingApr = container.approvalGate.getPending().find((x: { id: string }) => x.id === id);
        if (pendingApr && (decision === 'APPROVED' || decision === 'REJECTED')) {
          return res.json({ ok: container.approvalGate.decide(id, decision as 'APPROVED' | 'REJECTED', 'user'), id, kind: 'approval', decision });
        }
        return res.status(404).json({ ok: false, error: '未找到该待决定项' });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });
    // 17i.22：读取方案文件内容（点击查看；仅允许 data/plans/ 下，防穿越）
    this.app.get('/api/plan/file', (req, res) => {
      const p = typeof req.query?.path === 'string' ? req.query.path : '';
      if (!p) return res.status(400).json({ ok: false, error: 'path 必填' });
      const plansRoot = path.resolve('data/plans');
      const target = path.resolve(p);
      if (target !== plansRoot && !target.startsWith(plansRoot + path.sep)) {
        return res.status(400).json({ ok: false, error: '仅允许访问方案目录 data/plans/' });
      }
      try {
        const content = fs.readFileSync(target, 'utf-8');
        res.json({ ok: true, path: target, content });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });
    // 17i.23：系统打开文件（office/md/txt/代码等，用系统默认应用；仅限 data/ 下已存在文件）
    this.app.post('/api/files/open', (req, res) => {
      const p = typeof req.body?.path === 'string' ? req.body.path : '';
      if (!p) return res.status(400).json({ ok: false, error: 'path 必填' });
      const dataRoot = path.resolve('data');
      const target = path.resolve(p);
      if (!target.startsWith(dataRoot + path.sep) || !fs.existsSync(target)) {
        return res.status(400).json({ ok: false, error: '仅允许打开 data/ 下已存在的文件' });
      }
      try {
        if (process.platform === 'win32') {
          const child = spawn('cmd', ['/c', 'start', '""', target], { detached: true, stdio: 'ignore' });
          child.unref();
        } else {
          const child = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [target], { detached: true, stdio: 'ignore' });
          child.unref();
        }
        res.json({ ok: true, path: target });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });
    // 17i.24：应用内查看文件（text/md/代码 → 原样；docx → HTML；xlsx → 表格；其余不支持）
    this.app.get('/api/files/view', async (req, res) => {
      const p = typeof req.query?.path === 'string' ? req.query.path : '';
      if (!p) return res.status(400).json({ ok: false, error: 'path 必填' });
      const dataRoot = path.resolve('data');
      const target = path.resolve(p);
      if (!target.startsWith(dataRoot + path.sep) || !fs.existsSync(target)) {
        return res.status(400).json({ ok: false, error: '仅允许查看 data/ 下已存在的文件' });
      }
      try {
        const ext = path.extname(target).toLowerCase().replace(/^\./, '');
        const name = path.basename(target);
        const size = fs.statSync(target).size;
        // 文本类：md/txt/代码 等 → 原样文本
        if (isTextViewable(ext)) {
          if (size > 2 * 1024 * 1024) {
            return res.json({ ok: true, path: target, kind: 'unsupported', reason: '文本文件过大（>2MB），请用系统打开', name, size });
          }
          const content = fs.readFileSync(target, 'utf-8');
          return res.json({ ok: true, path: target, kind: ext === 'md' || ext === 'markdown' ? 'markdown' : 'text', content, name, size });
        }
        // Word：docx → HTML
        if (ext === 'docx') {
          const result = await mammoth.convertToHtml({ path: target });
          return res.json({ ok: true, path: target, kind: 'html', html: result.value, name, size });
        }
        // Excel：xlsx → HTML 表格
        if (ext === 'xlsx' || ext === 'xls') {
          const wb = XLSX.readFile(target, { cellDates: true });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const html = sheet ? XLSX.utils.sheet_to_html(sheet) : '<p>（空表格）</p>';
          return res.json({ ok: true, path: target, kind: 'html', html, name, size });
        }
        return res.json({ ok: true, path: target, kind: 'unsupported', reason: '该类型暂不支持应用内预览（pptx 等），可用「在系统打开」', name, size });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    // ── 对话：意图分流在引擎级（CompanyFacade.executeGoal 内）——闲聊直答/任务执行 ──
    this.app.post('/api/chat/send', async (req, res) => {
      const goal = req.body?.message ?? req.body?.goal;
      if (!goal) return res.status(400).json({ ok: false, error: 'message required' });
      const originalMessage = String(goal).trim();
      let message = originalMessage;
      // ═══ 17i.22：Goal 模式（全自动执行，跳过方案确认）由每次请求设置 ═══
      setAutoExecute(req.body?.goalMode === true);
      try {
        const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined;
        const bridge = getSharedPiBridge();
        const llmRoute = (system: string, prompt: string, opts?: { temperature?: number; maxTokens?: number }) =>
          bridge.generateText({ system, prompt, ...(opts ?? {}) }).then((r) => r.text);
        // ═══ P1 部门 Space：意图预判（仅用于任务路由；executeGoal 内部以 intentHint 保持一致）═══
        const intent = await IntentClassifier.classify(originalMessage, llmRoute).catch(() => 'task' as const);
        let routedSpace: Space | undefined;
        if (intent === 'task' && this.boot?.spaceService) {
          routedSpace = await routeTaskToSpace(originalMessage, this.boot.spaceService, llmRoute);
        }
        // ── UI 改版：路由结果立即发 SSE（前端据此早期跳转到部门页面，而非等任务完成）──
        if (routedSpace) {
          try {
            this.boot?.container.eventBus.emit({
              id: `evt_routed_${Date.now()}`,
              type: 'task.routed',
              timestamp: Date.now(),
              executionId: `routed_${Date.now()}`,
              source: 'studio-routing',
              payload: { goal: originalMessage, spaceId: routedSpace.id, departmentName: routedSpace.name, sessionId: sessionId ?? null },
            });
          } catch (err) {
            console.warn('[Studio] ⚠️ task.routed 事件发射失败（前端将等任务完成后再跳转）:', (err as Error).message);
          }
        }
        // ═══ 17i.2 → T1 回合级落库：user 消息不再提前入账——回合收尾与 assistant 总结一次性写入，
        //     权威归属（kind/spaceId/threadId）落库即最终态，消灭"先记半句再 patch 回填"双写窗口。
        //     执行中可见性由前端本地回显 + SSE 流承担（设计 §4.2）。═══
        // ═══ 附件上下文注入：文本附件截断拼入消息，二进制仅引用 ═══
        const attachments: Array<{ fileId: string; name?: string }> = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
        if (attachments.length > 0) {
          const ctx = buildAttachmentContext(attachments);
          if (ctx) message = `${ctx}${message}`;
        }
        // 引擎级意图分流：chat → 轻量直答（不建 Mission）；task → 完整执行管线
        // 17i.15：是否问用户由 LLM 自主决定（ask_user 工具），不再预置澄清门。
        // P1：intentHint 与 executeGoal 共享预判（避免二次判断不一致）；部门 persona/capabilities 随路由注入编排器。
        // ═══ T0 多轮连续②：chat 直答路径注入近期对话历史（否则闲聊对 AI 永远无记忆）═══
        // T2：优先从账本回合记录取（与新真相源一致）；无窗口降级旧 chat-history
        if (intent === 'chat' && sessionId) {
          try {
            const hist = this.loadRecentTurns(sessionId, 8);
            // 刚刚已 append 当前这条 user 消息 → 去掉末尾同文条目，只取更早的历史
            const prior = hist.filter((m, i) => !(i === hist.length - 1 && m.role === 'user' && m.content === originalMessage));
            const recent = prior.slice(-8);
            if (recent.length > 0) {
              const lines = recent.map((m) => `${m.role === 'user' ? '用户' : 'AI'}: ${String(m.content ?? '').slice(0, 200)}`);
              message = `【近期对话记录（供上下文参考）】\n${lines.join('\n')}\n\n【用户本轮消息】\n${message}`;
            }
          } catch (err) {
            console.warn('[Studio] ⚠️ 注入聊天历史失败（按无历史处理）:', (err as Error).message);
          }
        }
        // ═══ T5/T6 跨会话记忆召回：新会话也“认识”老用户（画像+约定+术语表；放在历史注入之后 ⇒ 记忆位于最上方）═══
        // 优化：3s 超时降级 —— cognee 引擎可能慢（网络），不拖慢消息热路径（超时=本轮无记忆，语义不变）
        if (sessionId && this.boot?.container.companyMemoryApi) {
          const memApi = this.boot.container.companyMemoryApi;
          try {
            const [qr, qc] = await Promise.race([
              Promise.allSettled([
                // 拼上用户原话：mock 引擎词面匹配需要实体名重叠；cognee 语义引擎下也无害
                memApi.query({ text: `用户 姓名 称呼 偏好 画像 ${String(originalMessage).slice(0, 120)}`, limit: 5 }),
                memApi.query({ text: '协作 约定 汇报 风格 习惯', limit: 3 }),
                memApi.query({ text: '术语 澄清 含义 指的是', limit: 3 }),
              ]),
              new Promise<never>((_, rej) => setTimeout(() => rej(new Error('memory recall timeout (3s)')), 3000)),
            ]) as [
              PromiseSettledResult<{ hits: Array<{ content: string }> }>,
              PromiseSettledResult<{ hits: Array<{ content: string }> }>,
              PromiseSettledResult<{ hits: Array<{ content: string }> }>,
            ];
            const toLines = (r?: PromiseSettledResult<{ hits: Array<{ content: string }> }>) =>
              (r?.status === 'fulfilled' ? (r.value.hits ?? []) : [])
                .map((h) => String(h.content ?? '').replace(/\s+/g, ' ').slice(0, 150))
                .filter(Boolean);
            const profileLines = [
              ...toLines(qr),                                        // 画像
              ...toLines(qc).filter((c) => c.includes('约定:')),     // 协作约定（实体名前缀，见 mapCandidateEntity）
            ];
            const termLines = toLines(qc).filter((c) => c.includes('术语:'));
            // T7 权重簿：召回命中即计一次提及（mention_count++），供 30 天沉淀晋升判定；失败不阻塞
            try {
              this.memoryWeightStore?.recordMentionsFromContents([...profileLines, ...termLines]);
            } catch { /* 权重簿是可降级依赖 */ }
            let memoryBlock = '';
            if (profileLines.length > 0) {
              memoryBlock += `【用户画像与协作约定（来自长期记忆库，已经用户确认）】\n${profileLines.join('\n')}`;
            }
            if (termLines.length > 0) {
              memoryBlock += `${memoryBlock ? '\n\n' : ''}【术语表（本项目语境，已经用户澄清）】\n${termLines.join('\n')}`;
            }
            if (memoryBlock) message = `${memoryBlock}\n\n${message}`;
          } catch (err) {
            console.warn('[Studio] ⚠️ 记忆召回失败（跳过）:', (err as Error).message);
          }
        }
        // ═══ T0 多轮连续①：同一 chatSessionId 复用同一本 orchestrator 账本 + 并发护栏 ═══
        // resolve 放在排队闭包内（而非排队前）：同一会话的首次绑定被串行化，避免并发首请求各自 createSession 产生孤儿账本
        // ★ 无 sessionId 的请求不参与绑定/复用（否则会共享一个 "undefined" 账本，造成无关对话上下文串门）
        const runExecution = () => (sessionId
          ? this.resolveOrchestratorSessionPath(sessionId)
          : Promise.resolve(undefined)
        ).then((orchRef) =>
          companyFacade.executeGoal(message, {
            departmentId: routedSpace?.id ?? req.body?.departmentId,
            departmentName: req.body?.departmentName,
            managerPersona: routedSpace?.managerPersona,
            capabilities: routedSpace?.capabilities,
            intentHint: intent,
            orchestratorSessionPath: orchRef?.path,
          }).then((result) => {
            // T1：回合收尾触发增量索引（幂等，失败静默——真相源永远在 jsonl）
            if (orchRef) this.getTranscripts()?.indexNow(orchRef.sessionId, orchRef.path);
            return result;
          }),
        );
        const prevExec = sessionId ? this.chatInflight.get(sessionId) : undefined;
        const queuedResult = prevExec ? prevExec.then(runExecution, runExecution) : runExecution();
        if (sessionId) {
          const tail = queuedResult.then(() => undefined, () => undefined);
          this.chatInflight.set(sessionId, tail);
          // 护栏防泄漏：本请求仍是队尾时清除条目，否则保留链尾供后续请求接续
          void tail.finally(() => {
            if (this.chatInflight.get(sessionId!) === tail) this.chatInflight.delete(sessionId!);
          });
        }
        const result = await queuedResult;
        const isTask = result.mode !== 'chat';
        const missionId = (result as { missionId?: string }).missionId;
        // 17i.33：任务完成后 → LLM 生成拟人化总结（流式 chat.stream.delta；失败回退原始 report）
        let naturalReport: string | undefined;
        if (isTask) {
          try {
            naturalReport = await generateTaskSummary(originalMessage, result, this.boot!.container.eventBus);
          } catch (err) {
            console.warn('[Studio] ⚠️ 拟人化总结生成失败（回退原始报告）:', (err as Error).message);
          }
        }
        if (sessionId) {
          // T2 回合级落库：优先写账本回合记录（morpex.turn，投影层唯一放行的对话面）；
          // 无窗口（未绑定/降级）时回退旧 chat-history。两路互斥，消灭双写。
          const displayText = naturalReport ?? result.report ?? JSON.stringify(result);
          const turnMeta = {
            userText: originalMessage,
            assistantText: displayText,
            kind: isTask ? ('task' as const) : ('chat' as const),
            threadId: isTask ? missionId : undefined,
            spaceId: isTask ? (routedSpace?.id ?? 'hq') : 'hq',
          };
          const turn = await this.getTranscripts()?.appendDisplayTurn(sessionId, turnMeta);
          if (turn) {
            // T2 SSE 对账：回合结束携带游标（pi entry 物理行号），前端据此 events?after=seq 补拉
            try {
              this.boot?.container.eventBus.emit({
                id: `evt_turn_${Date.now()}`,
                type: 'chat.turn.completed',
                timestamp: Date.now(),
                executionId: `turn_${Date.now()}`,
                source: 'studio-chat',
                payload: { sessionId, lastSeq: turn.lastSeq, kind: turnMeta.kind, userText: originalMessage.slice(0, 500) },
              });
            } catch { /* SSE 对账事件失败不影响主流程 */ }
          } else {
            this.sessionStore?.appendChatMessage(sessionId, {
              role: 'user', content: originalMessage, timestamp: Date.now(),
              kind: isTask ? 'task' : 'chat',
              spaceId: isTask ? (routedSpace?.id ?? 'hq') : 'hq',
              threadId: isTask ? missionId : undefined,
              departmentId: isTask ? routedSpace?.id : undefined,
            });
            this.sessionStore?.appendChatMessage(sessionId, {
              role: 'system',
              content: displayText,
              timestamp: Date.now(),
              kind: isTask ? 'task' : 'chat',
              spaceId: isTask ? (routedSpace?.id ?? 'hq') : 'hq',
              threadId: isTask ? missionId : undefined,
              departmentId: isTask ? routedSpace?.id : undefined,
            });
          }
        }
        return res.json({
          ...result,
          ...(naturalReport ? { naturalReport } : {}),
          spaceId: isTask ? (routedSpace?.id ?? 'hq') : 'hq',
          routedTo: isTask && routedSpace ? { spaceId: routedSpace.id, departmentName: routedSpace.name } : undefined,
        });
      } catch (err) {
        return res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    // ── U2+U3 运行控制：pause/resume/cancel（12-Factor F6）──
    this.app.post('/api/runs/:missionId/pause', (req, res) => {
      const id = req.params.missionId;
      RunRegistry.pause(id);
      container.eventBus.emit({ id: `run-${id}-paused-${Date.now()}`, type: 'run.paused', timestamp: Date.now(), executionId: id, source: 'studio-api', payload: { missionId: id } });
      return res.json({ ok: true, missionId: id, state: 'pausing（当前步骤完成后停住）' });
    });

    this.app.post('/api/runs/:missionId/cancel', (req, res) => {
      const id = req.params.missionId;
      RunRegistry.cancel(id);
      container.eventBus.emit({ id: `run-${id}-cancelled-${Date.now()}`, type: 'run.cancelled', timestamp: Date.now(), executionId: id, source: 'studio-api', payload: { missionId: id } });
      return res.json({ ok: true, missionId: id, state: 'cancelling（pending 节点将标 skipped）' });
    });

    this.app.post('/api/runs/:missionId/resume', async (req, res) => {
      const id = req.params.missionId;
      // 情形 A：活跃循环被暂停 → 解除标志，下一轮迭代恢复调度
      if (RunRegistry.isPaused(id)) {
        RunRegistry.resume(id);
        container.eventBus.emit({ id: `run-${id}-resumed-${Date.now()}`, type: 'run.resumed', timestamp: Date.now(), executionId: id, source: 'studio-api', payload: { missionId: id } });
        return res.json({ ok: true, missionId: id, resumed: 'live-loop' });
      }
      // 情形 B：进程重启后的冷恢复 —— 从事件源重建计划与节点态，只重跑未完成步骤
      const plan = container.missionStore.getDagPlan(id);
      if (!plan) return res.status(404).json({ ok: false, error: 'no plan snapshot for mission' });
      if (container.missionStore.getRunState(id) === 'cancelled') {
        return res.status(409).json({ ok: false, error: 'mission was cancelled; 取消状态不复活' });
      }
      const states = container.missionStore.getStepStates(id);
      const dag = {
        id: `resume_${id}_${Date.now()}`,
        nodes: plan.nodes.map((n) => ({
          ...(n as Record<string, unknown>),
          deps: Array.isArray(n.deps) ? n.deps : [],
          initialStatus: states.get(String(n.id))?.status === 'success' ? 'success' : undefined,
          initialOutput: states.get(String(n.id))?.outputPreview ?? undefined,
        })),
        edges: plan.edges,
        status: 'RUNNING',
        createdAt: Date.now(),
      };
      setImmediate(() => {
        container.createRawDAGRuntime().run(dag as never, { missionId: id }).catch((err: Error) => console.warn('[RunControl] 冷恢复执行失败:', err.message));
      });
      return res.json({ ok: true, missionId: id, resumed: 'cold-restart-from-event-log' });
    });

    // ── 执行（L5 UnifiedExecutionEngine）──
    this.app.post('/api/execute', async (req, res) => {
      const goal = req.body?.goal;
      if (!goal) return res.status(400).json({ ok: false, error: 'goal required' });
      try {
        const r = await container.executionEngine.execute({
          goal: String(goal),
          departmentId: req.body?.departmentId,
          context: req.body?.context,
          // ═══ 会话 16d（P3 人机协同）：人工介入/重跑参考提示 ═══
          contextHint: typeof req.body?.contextHint === 'string' ? req.body.contextHint : undefined,
          maxTaskRerun: typeof req.body?.maxTaskRerun === 'number' ? req.body.maxTaskRerun : undefined,
        });
        return res.json(r);
      } catch (err) {
        return res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    this.app.get('/api/execution/:executionId', (req, res) => {
      const mission = container.missionController.getMission(req.params.executionId);
      res.json({ executionId: req.params.executionId, mission: mission ?? null });
    });

    // ── 会话 16c（3+4）：实时观测聚合端点（实时仪表盘 API 层）──
    // 聚合：执行质量（成功率/耗时）+ 步骤质量（空参率/重试/错误分类）+ 装配成本（耗时/字符/密度）
    //        + 成本（token/金额）——按批次/步骤类型统计，供 P3 仪表盘消费。
    this.app.get('/api/execution-stats', (_req, res) => {
      try {
        const history = container.eventBus?.getHistory?.() ?? [];

        // 1. 执行质量（引擎 executionQuality：auto/orchestrator 分模式）
        const quality = container.executionEngine.getExecutionQuality();

        // 2. 步骤质量（execution.step.result 事件：空参率/重试/错误分类）
        const stepEvents = history.filter((e: { type: string }) => e.type === 'execution.step.result');
        let emptyParamFails = 0, safetyFails = 0, stepFails = 0, totalRetries = 0;
        for (const e of stepEvents as Array<{ payload?: { success?: boolean; errorClass?: string; retries?: number } }>) {
          const p = e.payload ?? {};
          totalRetries += p.retries ?? 0;
          if (p.success === false) {
            stepFails++;
            if (p.errorClass === 'retryable') emptyParamFails++;
            if (p.errorClass === 'non-retryable') safetyFails++;
          }
        }
        const totalSteps = stepEvents.length;

        // 3. 装配成本（context.assembly.telemetry 事件：耗时/字符/信息密度）
        const asmEvents = history.filter((e: { type: string }) => e.type === 'context.assembly.telemetry');
        const asmDurations = (asmEvents as Array<{ payload?: { durationMs?: number; infoDensity?: number; fragmentCount?: number } }>)
          .map(e => ({ durationMs: e.payload?.durationMs ?? 0, infoDensity: e.payload?.infoDensity ?? 0, fragmentCount: e.payload?.fragmentCount ?? 0 }));
        const avgAsmDuration = asmDurations.length > 0 ? asmDurations.reduce((a, b) => a + b.durationMs, 0) / asmDurations.length : 0;
        const avgInfoDensity = asmDurations.length > 0 ? asmDurations.reduce((a, b) => a + b.infoDensity, 0) / asmDurations.length : 0;

        // 4. 成本（CostController 全链路 token/金额）
        const cost = CostController.getInstance();
        const tokenUsage = cost.getTokenUsage('global');

        res.json({
          ok: true,
          stats: {
            execution: {
              byMode: quality,
              totalSuccessRate: this.calcOverallRate(quality),
            },
            steps: {
              totalSteps,
              failed: stepFails,
              emptyParamFails,
              safetyFails,
              emptyParamRate: totalSteps > 0 ? Number((emptyParamFails / totalSteps).toFixed(4)) : 0,
              totalRetries,
            },
            assembly: {
              count: asmDurations.length,
              avgDurationMs: Math.round(avgAsmDuration),
              avgInfoDensity,
            },
            cost: {
              totalTokens: tokenUsage.tokens,
              totalCost: Number(cost.getTotalCost('global').toFixed(4)),
            },
            generatedAt: Date.now(),
          },
        });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    // ── 会话 16d（P3 运维）：异常告警查询 ──
    this.app.get('/api/anomalies', (_req, res) => {
      try {
        const limit = Number(_req.query?.limit) || 50;
        res.json({ ok: true, anomalies: container.anomalyDetector.getAnomalies(limit) });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    // ── 会话 16d（P3 运维）：成本与延迟归因（每任务 token/耗时/步骤/成功）──
    this.app.get('/api/execution-stats/tasks', (_req, res) => {
      try {
        const limit = Number(_req.query?.limit) || 20;
        const history = container.eventBus?.getHistory?.() ?? [];
        const started = history.filter((e: { type: string }) => e.type === 'execution.engine.started');
        const completed = history.filter((e: { type: string }) => e.type === 'execution.engine.completed' || e.type === 'execution.engine.failed');
        const tokenEvts = history.filter((e: { type: string }) => e.type === 'execution.gate.token_usage');

        // token 按 executionId 聚合
        const tokensByExec = new Map<string, number>();
        for (const e of tokenEvts as Array<{ executionId?: string; payload?: { tokens?: number } }>) {
          const id = e.executionId ?? 'orch'; // orchestrator token 事件 executionId 前缀为 orch_
          tokensByExec.set(id, (tokensByExec.get(id) ?? 0) + (e.payload?.tokens ?? 0));
        }

        const tasks = completed
          .map((e: { executionId?: string; payload?: { goal?: string; ok?: boolean; duration?: number; mode?: string } }) => ({
            executionId: e.executionId,
            goal: (e.payload?.goal ?? '').slice(0, 60),
            ok: e.payload?.ok ?? false,
            durationMs: e.payload?.duration ?? 0,
            mode: e.payload?.mode ?? 'auto',
            tokens: tokensByExec.get(e.executionId ?? '') ?? 0,
          }))
          .slice(-limit);

        res.json({ ok: true, tasks, total: completed.length });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    // ── 会话 16e（3-3 进化落地通道）：演化提案/策略可见性 ──
    this.app.get('/api/evolution/changes', (_req, res) => {
      try {
        const changes = container.evolutionSandbox.listChanges();
        res.json({
          ok: true,
          changes,
          pending: changes.filter(c => c.status === 'pending_approval').length,
          strategies: container.promptStrategyRegistry.all(),
        });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    // ── 会话 16j（E1 人工审批通道）：审批/拒绝 pending 演化提案 ──
    this.app.post('/api/evolution/:id/approve', async (req, res) => {
      try {
        const applied = await container.evolutionApplyLoop.approve(req.params.id);
        if (!applied) return res.status(400).json({ ok: false, error: '审批失败：Gate 凭证不可用或提案不存在/非 pending' });
        res.json({ ok: true, change: applied });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    this.app.post('/api/evolution/:id/reject', async (req, res) => {
      try {
        const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
        const rejected = await container.evolutionApplyLoop.reject(req.params.id, reason);
        if (!rejected) return res.status(400).json({ ok: false, error: '拒绝失败：提案不存在或不可拒绝' });
        res.json({ ok: true, change: rejected });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    // ── 产物（L7 ArtifactFacade）──
    this.app.get('/api/artifacts', (_req, res) => {
      res.json({ artifacts: container.artifactFacade.getAll() });
    });
    this.app.get('/api/artifacts/:id', (req, res) => {
      const a = container.artifactFacade.get(req.params.id);
      res.json({ artifact: a ?? null });
    });

    // ── 记忆（L7 MemoryAPI）──
    this.app.get('/api/memory/recall', async (req, res) => {
      const mem = container.companyMemoryApi;
      if (!mem) return res.json({ ok: false, error: 'memory not initialized' });
      try {
        const r = await mem.query({ text: String(req.query.q ?? ''), limit: 10 });
        return res.json({ ok: true, hits: r.hits });
      } catch (err) {
        return res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });
    this.app.post('/api/memory/remember', async (req, res) => {
      const mem = container.companyMemoryApi;
      if (!mem) return res.status(400).json({ ok: false, error: 'memory not initialized' });
      try {
        await mem.rememberEpisode(String(req.body?.content), { source: req.body?.source ?? 'api' });
        return res.json({ ok: true });
      } catch (err) {
        return res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    // ── T5 用户画像记忆：待确认工单 + 批准/拒绝（复用 MemoryApi 确认队列）──
    this.app.get('/api/memory/pending', async (_req, res) => {
      const mem = container.companyMemoryApi;
      if (!mem) return res.status(400).json({ ok: false, error: 'memory not initialized' });
      try {
        return res.json({ ok: true, tickets: await mem.listPendingConfirmations(20) });
      } catch (err) {
        return res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });
    this.app.post('/api/memory/confirm/:ticketId', async (req, res) => {
      const mem = container.companyMemoryApi;
      if (!mem) return res.status(400).json({ ok: false, error: 'memory not initialized' });
      const decision = req.body?.decision === 'accept' ? ('accept' as const) : ('reject' as const);
      try {
        await mem.confirm(String(req.params.ticketId), decision); // accept → 引擎落库；reject → 丢弃
        return res.json({ ok: true, decision });
      } catch (err) {
        return res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });
  }

  // ── SSE（L10 EventBus 事件流）──

  private registerSSE(eventBus: import('../../core/src/infrastructure/common/EventBus.js').EventBus): void {
    this.app.get('/api/stream/global', (req, res) => {
      const clientId = `sse_${++this.sseIdCounter}`;
      const filter = req.query.filter as string | undefined;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`data: ${JSON.stringify({ type: 'connected', clientId, timestamp: Date.now() })}\n\n`);
      const client = { res, connectedAt: Date.now() };
      this.sseClients.set(clientId, client);

      const unsub = eventBus.onProjected((event: any) => {
        if (filter && !event.type.startsWith(filter.replace('*', ''))) return;
        try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { this.sseClients.delete(clientId); }
      });

      const heartbeat = setInterval(() => {
        try { res.write(`:heartbeat ${Date.now()}\n\n`); }
        catch { clearInterval(heartbeat); unsub(); this.sseClients.delete(clientId); }
      }, 15000);

      const cleanup = () => { clearInterval(heartbeat); unsub(); this.sseClients.delete(clientId); };
      req.on('close', cleanup);
      res.on('close', cleanup);
    });
  }

  // ── 停止 ──

  async stop(): Promise<void> {
    if (this.httpServer) {
      await new Promise<void>((resolve) => this.httpServer!.close(() => resolve()));
    }
    const boot = this.boot;
    if (boot) {
      boot.container.companyMemoryApi?.close?.();
    }
    console.log('[Studio] ✅ stopped');
  }
}

/**
 * transcript/memory-extractor — T5 跨会话用户画像记忆·提取器
 *
 * 数据流（EventBus Only，HOOK_MAP"最安全接入点"= 订阅既有事件，不改核心链）：
 *   StudioServer(chat/send 回合收尾) emit 'chat.turn.completed'（payload 带 userText）
 *     → 本提取器订阅（防抖：每会话每分钟最多一次）
 *     → 共享 PiBridge LLM 抽取候选事实（严格 JSON 输出）
 *     → MemoryApi.upsert(confidence=0.6 < autoWrite 0.8) → 确认工单队列（pending）
 *   用户经 GET /api/memory/pending 查看 + POST /api/memory/confirm/:ticketId 批准
 *     → confirm('accept') 落库 → 此后任意新会话 memory.query 召回注入开场上下文
 *
 * 铁律：本文件不 import @earendil-works/*（LLM 经 getSharedPiBridge 封装层）；
 *       写入只走 MemoryApi 正规入口（Knowledge Gate 合规）；空结果静默跳过。
 */
import type { EventBus } from '../../../core/src/infrastructure/common/EventBus.js';
import { getSharedPiBridge } from '../../../core/src/infrastructure/adapters/pi-bridge/PiBridge.js';

/** 记忆类型（T6）：profile=画像 correction=纠错 clarification=澄清 agreement=协作约定 */
export type MemoryCandidateType = 'profile' | 'correction' | 'clarification' | 'agreement';

/** 候选事实（LLM 结构化输出） */
interface MemoryCandidate {
  /** name=用户称呼或主题词（作为实体名） */
  name: string;
  /** 单条原子事实 */
  fact: string;
  /** 记忆类型；缺省 profile（向后兼容 T5 输出） */
  type?: MemoryCandidateType;
  /** correction 专属：什么场景下的教训（作为实体名来源） */
  trigger?: string;
  /** clarification 专属：被澄清的术语（作为实体名来源） */
  term?: string;
}

/** 纠错/澄清信号词（命中时在 prompt 里附分类提示，帮助 LLM 聚焦；不拦截调用——提取本身已被防抖限频） */
const CORRECTION_SIGNALS = ['不对', '错了', '我说的是', '以后别', '应该是', '别再', '上次失败', '搞错了', '不是这个意思'];

export interface MemoryExtractorOptions {
  /** MemoryApi 最小接口（避免整包类型依赖；实际传入 container.companyMemoryApi） */
  memoryApi: {
    upsert(input: {
      name: string;
      entityType: string;
      facts?: string[];
      confidence?: number;
      kind?: string; // T6 记忆分类
    }): Promise<{ status: string; ticketId?: string }>;
  };
  /** 同会话两次提取的最小间隔（防抖），默认 60s */
  debounceMs?: number;
}

const EXTRACT_SYSTEM = [
  '你是信息抽取器，不是聊天助手。禁止回答、禁止寒暄、禁止评价，你唯一的输出是 JSON 数组。',
  '任务：从对话片段中提取「值得长期记住的信息」，分四类：',
  '  profile=用户画像（姓名/称呼/偏好/身份背景）；correction=纠错（用户纠正了错误做法，含 trigger 字段=出问题的场景）；',
  '  clarification=澄清（用户解释了某术语在本项目中的真实含义，含 term 字段=术语）；agreement=协作约定（汇报方式/工作习惯）。',
  '不提取：临时请求、任务内容、与用户本人无关的信息。',
  '输出格式示例：',
  '输入：我叫李雷。别再用 pm2 起服务了，上次就失败了，要用 maintenance 脚本',
  '输出：[{"type":"profile","name":"李雷","fact":"用户姓名是李雷"},{"type":"correction","name":"服务启动方式","trigger":"用 pm2 启动服务","fact":"本项目启动服务要用 maintenance 脚本，pm2 会失败"}]',
  '没有值得记的信息时输出：[]',
].join('\n');

/** 每会话上次提取时间（进程内防抖；重启即清零无妨——漏一次提取无害） */
const lastRunAt = new Map<string, number>();

/** 重复订阅防护：多次 boot/register 只生效一次（退订函数被上层忽略时防泄漏+防双提取） */
let registeredBus: EventBus | null = null;

const VALID_TYPES: readonly MemoryCandidateType[] = ['profile', 'correction', 'clarification', 'agreement'];

/** 解析 LLM 输出为候选数组（容错：剥 code fence / 截取首个 JSON 数组 / 逐项校验）；导出供单测 */
export function parseCandidates(raw: string): MemoryCandidate[] {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: MemoryCandidate[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === 'string' ? rec.name.trim().slice(0, 40) : '';
    const fact = typeof rec.fact === 'string' ? rec.fact.trim().slice(0, 200) : '';
    if (!name || !fact) continue;
    const type = VALID_TYPES.includes(rec.type as MemoryCandidateType)
      ? (rec.type as MemoryCandidateType)
      : 'profile'; // 缺省/非法 → profile（向后兼容 T5 输出）
    const c: MemoryCandidate = { name, fact, type };
    if (type === 'correction' && typeof rec.trigger === 'string') c.trigger = rec.trigger.trim().slice(0, 80);
    if (type === 'clarification' && typeof rec.term === 'string') c.term = rec.term.trim().slice(0, 40);
    out.push(c);
    if (out.length >= 3) break; // 上限=3 条有效候选（校验后再计数，防无效条目挤掉有效候选）
  }
  return out;
}

/**
 * 注册提取器（返回退订函数）。事件来源：StudioServer chat/send 回合收尾。
 * payload 需要 { sessionId, userText }（T5 起 chat.turn.completed 扩展字段）。
 */
export function registerMemoryExtractor(
  eventBus: EventBus,
  opts: MemoryExtractorOptions,
): () => void {
  if (registeredBus === eventBus) return () => {}; // 同一 bus 已注册 → 幂等短路
  registeredBus = eventBus;
  const debounceMs = opts.debounceMs ?? 60_000;
  return eventBus.on('chat.turn.completed', (event) => {
    void handleTurn(event, opts, debounceMs).catch((err: unknown) => {
      console.warn('[MemoryExtractor] ⚠️ 提取失败（忽略，不影响主流程）:', err instanceof Error ? err.message : String(err));
    });
  });
}

/**
 * 候选 → 实体登记参数（T6）：correction→trigger 派生名、clarification→term、其余→原 name；
 * 画像用 Person，纠错/澄清/约定语义上是"规则"→ 本体白名单 Rule。覆盖语义（MemoryApi.confirm）按此 name 键对齐失效旧条目
 */
export function mapCandidateEntity(c: MemoryCandidate): { name: string; entityType: string } {
  if (c.type === 'correction') return { name: `纠错:${c.trigger ?? c.name}`, entityType: 'Rule' };
  if (c.type === 'clarification') return { name: `术语:${c.term ?? c.name}`, entityType: 'Rule' };
  if (c.type === 'agreement') return { name: `约定:${c.name}`, entityType: 'Rule' };
  return { name: c.name, entityType: 'Person' };
}

/** 从单条用户消息提取候选（纯函数，供 handleTurn 与验收脚本复用） */
export async function extractMemoryCandidates(userText: string): Promise<MemoryCandidate[]> {
  const hint = CORRECTION_SIGNALS.some((s) => userText.includes(s))
    ? '\n（提示：检测到纠正/澄清信号词，请重点判断是否存在 correction/clarification 类信息）'
    : '';
  const prompt = `${userText.slice(0, 600)}${hint}\n\n（只输出 JSON 数组，不要回答这段话）`;
  const r = await getSharedPiBridge().generateText({
    system: EXTRACT_SYSTEM,
    prompt,
    temperature: 0,
  });
  return parseCandidates(r.text);
}

async function handleTurn(
  event: { type: string; payload?: unknown },
  opts: MemoryExtractorOptions,
  debounceMs: number,
): Promise<void> {
  if (event.type !== 'chat.turn.completed') return;
  const payload = event.payload as { sessionId?: string; userText?: string } | undefined;
  const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : '';
  const userText = typeof payload?.userText === 'string' ? payload.userText.trim() : '';
  if (!sessionId || userText.length < 2) return;

  // 防抖：同会话一分钟内只提一次；Map 上限防护（超 200 清最旧一半）
  const now = Date.now();
  const last = lastRunAt.get(sessionId) ?? 0;
  if (now - last < debounceMs) return;
  if (lastRunAt.size > 200) {
    for (const [k, v] of lastRunAt) {
      if (v <= now - debounceMs) lastRunAt.delete(k);
    }
  }
  lastRunAt.set(sessionId, now);

  const candidates = await extractMemoryCandidates(userText);
  if (candidates.length === 0) return;

  // 写入走确认工单：confidence 0.6 < autoWrite(0.8) ⇒ 一律 pending，用户批准才落库
  let enqueued = 0;
  for (const c of candidates) {
    const res = await opts.memoryApi.upsert({
      ...mapCandidateEntity(c),
      facts: [c.fact],
      confidence: 0.6,
      kind: c.type ?? 'profile',
    });
    if (res.status === 'pending_confirm') enqueued += 1;
  }
  if (enqueued > 0) {
    console.log(`[MemoryExtractor] 会话 ${sessionId} 提取 ${enqueued} 条候选记忆 → 待用户确认`);
  }
}

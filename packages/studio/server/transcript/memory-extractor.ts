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

/** 候选事实（LLM 结构化输出） */
interface MemoryCandidate {
  /** name=用户称呼或主题词（作为实体名） */
  name: string;
  /** 单条原子事实 */
  fact: string;
}

export interface MemoryExtractorOptions {
  /** MemoryApi 最小接口（避免整包类型依赖；实际传入 container.companyMemoryApi） */
  memoryApi: {
    upsert(input: {
      name: string;
      entityType: string;
      facts?: string[];
      confidence?: number;
    }): Promise<{ status: string; ticketId?: string }>;
  };
  /** 同会话两次提取的最小间隔（防抖），默认 60s */
  debounceMs?: number;
}

const EXTRACT_SYSTEM = [
  '你是信息抽取器，不是聊天助手。禁止回答、禁止寒暄、禁止评价，你唯一的输出是 JSON 数组。',
  '任务：从对话片段中提取「值得长期记住的用户信息」——姓名/称呼、明确偏好、身份背景。',
  '不提取：临时请求、任务内容、与用户本人无关的信息。',
  '输出格式示例：',
  '输入：大家好我叫李雷，平时喜欢喝美式',
  '输出：[{"name":"李雷","fact":"用户姓名是李雷"},{"name":"李雷","fact":"用户喜欢喝美式咖啡"}]',
  '没有值得记的信息时输出：[]',
].join('\n');

/** 每会话上次提取时间（进程内防抖；重启即清零无妨——漏一次提取无害） */
const lastRunAt = new Map<string, number>();

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
    if (name && fact) out.push({ name, fact });
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
  const debounceMs = opts.debounceMs ?? 60_000;
  return eventBus.on('chat.turn.completed', (event) => {
    void handleTurn(event, opts, debounceMs).catch((err: unknown) => {
      console.warn('[MemoryExtractor] ⚠️ 提取失败（忽略，不影响主流程）:', err instanceof Error ? err.message : String(err));
    });
  });
}

/** 从单条用户消息提取候选（纯函数，供 handleTurn 与验收脚本复用） */
export async function extractMemoryCandidates(userText: string): Promise<MemoryCandidate[]> {
  const prompt = `${userText.slice(0, 600)}\n\n（只输出 JSON 数组，不要回答这段话）`;
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
      name: c.name,
      entityType: 'Person', // 本体白名单内的画像实体
      facts: [c.fact],
      confidence: 0.6,
    });
    if (res.status === 'pending_confirm') enqueued += 1;
  }
  if (enqueued > 0) {
    console.log(`[MemoryExtractor] 会话 ${sessionId} 提取 ${enqueued} 条候选记忆 → 待用户确认`);
  }
}

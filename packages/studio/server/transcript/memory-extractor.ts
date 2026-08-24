/**
 * transcript/memory-extractor — T5/T6/T7 跨会话记忆·提取器
 *
 * 数据流（EventBus Only，HOOK_MAP"最安全接入点"= 订阅既有事件，不改核心链）：
 *   StudioServer(chat/send 回合收尾) emit 'chat.turn.completed'（payload 带 userText）
 *     → 本提取器订阅 → 共享 PiBridge LLM 抽取候选（严格 JSON，单次调用输出全部分类与标志位）
 *     → 四路分流（T7）：
 *         ① sensitive=true            → 丢弃不入库（日志计数）
 *         ② isForget=true             → invalidate 同主题旧条目（用户遗忘指令）
 *         ③ scope='session'           → 跳过长期库——会话账本本身就是它的存储
 *                                       （真相源已存在：多轮 resume 时 LLM 可见，无需另存）
 *         ④ isExplicit=true           → 跳过工单直接入库（confidence=1.0, source=explicit，
 *                                       用户亲口说的就是审批）→ 权重建档 base=1.0
 *         ⑤ 其余                      → MemoryApi.upsert(confidence=0.6) → 确认工单 → 权重建档
 *
 * T7 原则（用户拍板）：所有触发判断一律 LLM，禁止信号词/正则预筛（易纰漏）；
 *       敏感信息也由 LLM 在同一调用里标注 sensitive 字段。每回合都过 LLM（无防抖短路）。
 *       唯一例外 = looksLikeCredential()：入库前最后一道**安全兜底层**（非触发机制），
 *       高置信凭证格式命中即拒——宁可误杀不可漏放，与触发判断的 LLM 化原则不冲突。
 *
 * 铁律：本文件不 import @earendil-works/*（LLM 经 getSharedPiBridge 封装层）；
 *       写入只走 MemoryApi 正规入口（Knowledge Gate 合规）；空结果静默跳过。
 */
import type { EventBus } from '../../../core/src/infrastructure/common/EventBus.js';
import { getSharedPiBridge } from '../../../core/src/infrastructure/adapters/pi-bridge/PiBridge.js';

/** 记忆类型：profile=画像 correction=纠错 clarification=澄清 agreement=协作约定 */
export type MemoryCandidateType = 'profile' | 'correction' | 'clarification' | 'agreement';

/** 候选事实（LLM 结构化输出，T7 扩展标志位） */
export interface MemoryCandidate {
  /** name=用户称呼或主题词（作为实体名） */
  name: string;
  /** 单条原子事实 */
  fact: string;
  type?: MemoryCandidateType;
  /** correction 专属：什么场景下的教训 */
  trigger?: string;
  /** clarification 专属：被澄清的术语 */
  term?: string;
  /** T7：用户明确下了记忆指令（"记住xxx""以后都要yyy"）→ 免工单直接入库 */
  isExplicit?: boolean;
  /** T7：用户明确要求遗忘某条 → invalidate */
  isForget?: boolean;
  /** T7：含密钥/密码/凭证类内容 → 永不入库 */
  sensitive?: boolean;
  /** T7：session=仅本对话有效（会话账本即存储，不进长期库）；缺省 project */
  scope?: 'session' | 'project';
  /** correction/clarification 的主题键（invalidate 对齐用；缺省派生自 name） */
  subject?: string;
}

export interface MemoryExtractorOptions {
  /** MemoryApi 最小接口（避免整包类型依赖；实际传入 container.companyMemoryApi） */
  memoryApi: {
    upsert(input: {
      name: string;
      entityType: string;
      facts?: string[];
      confidence?: number;
      kind?: string;
      source?: string;
    }): Promise<{ status: string; ticketId?: string; reason?: string }>;
    /** T7 遗忘指令：登记同主题旧条目失效 */
    invalidate(name: string, validUntil?: string): Promise<void> | void;
  };
  /** T7 权重簿（可选；传入则在每次写入后建档，召回侧负责计提及晋升衰减） */
  weightStore?: {
    ensure(name: string, source: string, kind?: string): void;
  };
}

const EXTRACT_SYSTEM = [
  '你是信息抽取器，不是聊天助手。禁止回答、禁止寒暄、禁止评价，你唯一的输出是 JSON 数组。',
  '任务：从对话片段中提取「值得长期记住的信息」，逐条判断以下维度：',
  '  type: profile(用户画像：姓名/称呼/偏好/身份) | correction(纠错：用户纠正了错误做法) |',
  '        clarification(澄清：术语在本项目的真实含义) | agreement(协作约定：汇报方式/工作习惯)',
  '  correction 必须带 trigger 字段（出问题的场景）；clarification 必须带 term 字段（术语）；',
  '  isExplicit: 用户是否明确下了记忆指令（"记住xxx"/"记一下"/"以后都要"/"别忘了"及同等意思）——',
  '              只要用户表达了"要记下来"的意愿就是 true，不需要逐字命中某个词；',
  '  isForget: 用户是否明确要求遗忘/作废某条已知信息（"忘掉xxx"/"那条作废了"），content 填要忘掉的主题；',
  '  sensitive: 内容是否含密钥/密码/token/凭证等敏感凭证类文本（是则必须 true，这类永不入库）；',
  '  scope: 这条信息只在当前对话有效（如"这次先这样吧"）填 "session"；长期有效缺省/填 "project"。',
  '不提取：临时任务内容、与用户本人无关的信息。',
  '输出格式示例：',
  '输入：我叫李雷。请记住我用 mac。别再用 pm2 起服务了，上次失败了，要用 maintenance 脚本',
  '输出：[{"type":"profile","name":"李雷","fact":"用户姓名是李雷"},'+
    '{"type":"agreement","name":"操作系统","fact":"用户使用 mac","isExplicit":true},'+
    '{"type":"correction","name":"服务启动方式","trigger":"用 pm2 启动服务","fact":"启动服务要用 maintenance 脚本，pm2 会失败"}]',
  '没有值得记的信息时输出：[]',
].join('\n');

/** 重复订阅防护：多次 boot/register 只生效一次 */
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
    // 弱模型容错：裸字符串项（如 ["张三"]）→ 按画像候选兜底（后续仍走确认工单人审，误分类被人闸门拦住）
    if (typeof item === 'string') {
      const s = item.trim().slice(0, 200);
      if (s) out.push({ name: s.slice(0, 40), fact: s, type: 'profile' });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === 'string' ? rec.name.trim().slice(0, 40) : '';
    const fact = typeof rec.fact === 'string' ? rec.fact.trim().slice(0, 200) : '';
    if (!name || !fact) continue;
    const type = VALID_TYPES.includes(rec.type as MemoryCandidateType)
      ? (rec.type as MemoryCandidateType)
      : 'profile'; // 缺省/非法 → profile（向后兼容）
    const c: MemoryCandidate = { name, fact, type };
    if (type === 'correction' && typeof rec.trigger === 'string') c.trigger = rec.trigger.trim().slice(0, 80);
    if (type === 'clarification' && typeof rec.term === 'string') c.term = rec.term.trim().slice(0, 40);
    // T7 标志位：宽松布尔解析（truthy 视为 true；字段缺失=false）
    if (rec.isExplicit === true) c.isExplicit = true;
    if (rec.isForget === true) c.isForget = true;
    if (rec.sensitive === true) c.sensitive = true;
    if (rec.scope === 'session') c.scope = 'session';
    if (typeof rec.subject === 'string' && rec.subject.trim()) c.subject = rec.subject.trim().slice(0, 80);
    out.push(c);
    if (out.length >= 3) break; // 上限=3 条有效候选
  }
  return out;
}

/**
 * 注册提取器（返回退订函数）。事件来源：StudioServer chat/send 回合收尾。
 * payload 需要 { sessionId, userText }。
 */
export function registerMemoryExtractor(
  eventBus: EventBus,
  opts: MemoryExtractorOptions,
): () => void {
  if (registeredBus === eventBus) return () => {}; // 同一 bus 已注册 → 幂等短路
  registeredBus = eventBus;
  return eventBus.on('chat.turn.completed', (event) => {
    void handleTurn(event, opts).catch((err: unknown) => {
      console.warn('[MemoryExtractor] ⚠️ 提取失败（忽略，不影响主流程）:', err instanceof Error ? err.message : String(err));
    });
  });
}

/**
 * 候选 → 实体登记参数：correction→trigger/subject 派生名、clarification→term、其余→原 name；
 * 画像用 Person，纠错/澄清/约定语义上是"规则"→ 本体白名单 Rule。覆盖语义按此 name 键对齐
 */
export function mapCandidateEntity(c: MemoryCandidate): { name: string; entityType: string } {
  const subject = c.subject ?? c.trigger ?? c.term;
  if (c.type === 'correction') return { name: `纠错:${subject ?? c.name}`, entityType: 'Rule' };
  if (c.type === 'clarification') return { name: `术语:${subject ?? c.name}`, entityType: 'Rule' };
  if (c.type === 'agreement') return { name: `约定:${c.name}`, entityType: 'Rule' };
  return { name: c.name, entityType: 'Person' };
}

/** 从单条用户消息提取候选（纯函数，供 handleTurn 与验收脚本复用）。T7：无任何预筛，每回合必调 LLM */
export async function extractMemoryCandidates(userText: string): Promise<MemoryCandidate[]> {
  const r = await getSharedPiBridge().generateText({
    system: EXTRACT_SYSTEM,
    prompt: `${userText.slice(0, 600)}\n\n（只输出 JSON 数组，不要回答这段话）`,
    temperature: 0,
  });
  return parseCandidates(r.text);
}

/**
 * 高置信凭证格式硬校验（安全兜底层，非触发机制——见文件头注释）。
 * 只收高置信模式，避免误杀普通内容；宁可误杀不可漏放。
 */
export function looksLikeCredential(text: string): boolean {
  const patterns = [
    /\bsk-[A-Za-z0-9_-]{16,}/, // OpenAI 风格密钥
    /\bAKIA[0-9A-Z]{16}/, // AWS AccessKeyId
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // 私钥块
    /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|private[_-]?key)\s*[=:]\s*\S+/i,
    /\bxox[baprs]-[A-Za-z0-9-]{10,}/, // Slack token
    /\bgh[pousr]_[A-Za-z0-9]{20,}/, // GitHub token
  ];
  return patterns.some((p) => p.test(text));
}

/** 单条候选的四路分流（导出供单测）。返回动作标签供日志聚合 */
export async function routeCandidate(
  c: MemoryCandidate,
  opts: MemoryExtractorOptions,
): Promise<
  | 'dropped_sensitive'
  | 'forgotten'
  | 'skipped_session'
  | 'explicit_written'
  | 'explicit_failed'
  | 'ticket'
  | 'written'
> {
  // ① 敏感内容：永不入库（LLM 已标注；这里不做二次正则——原则统一由 LLM 判断）
  if (c.sensitive) return 'dropped_sensitive';
  // ①′ 安全兜底层（非触发机制，宁误杀不漏放）：LLM 漏标但内容含高置信凭证格式 → 硬拒
  if (looksLikeCredential(c.fact)) return 'dropped_sensitive';
  // ② 遗忘指令：invalidate 同主题旧条目
  if (c.isForget) {
    const entity = mapCandidateEntity({ ...c, type: c.type ?? 'correction' });
    await opts.memoryApi.invalidate(entity.name);
    return 'forgotten';
  }
  // ③ 会话级：跳过长期库——会话账本（transcript jsonl）本身就是其真相源，
  //    多轮 resume 时 LLM 天然可见，无需重复存储（铁律 5：不建第二份冗余真相源）
  if (c.scope === 'session') return 'skipped_session';
  const entity = mapCandidateEntity(c);
  if (c.isExplicit) {
    // ④ 显式指令：免工单直接入库（用户亲口说 = 审批），权重档最高。
    //    返回值必须检查：rejected/异常都要留痕且不阻断后续候选与回合收尾。
    try {
      const res = await opts.memoryApi.upsert({
        ...entity,
        facts: [c.fact],
        confidence: 1.0,
        kind: c.type ?? 'profile',
        source: 'explicit',
      });
      if (res.status === 'rejected') {
        console.warn(
          `[MemoryExtractor] 显式入库被拒（${res.reason ?? '未知原因'}）：${entity.name} —— 不建权重档`,
        );
        return 'explicit_failed';
      }
      opts.weightStore?.ensure(entity.name, 'explicit', c.type);
      return 'explicit_written';
    } catch (err) {
      console.warn(`[MemoryExtractor] 显式入库异常（不影响回合收尾）：${entity.name}`, err);
      return 'explicit_failed';
    }
  }
  // ⑤ 默认：低置信走确认工单（confidence 0.6 < autoWrite 0.8 ⇒ pending）
  const res = await opts.memoryApi.upsert({
    ...entity,
    facts: [c.fact],
    confidence: 0.6,
    kind: c.type ?? 'profile',
  });
  opts.weightStore?.ensure(entity.name, 'llm', c.type);
  return res.status === 'written' ? 'written' : 'ticket';
}

async function handleTurn(
  event: { type: string; payload?: unknown },
  opts: MemoryExtractorOptions,
): Promise<void> {
  if (event.type !== 'chat.turn.completed') return;
  const payload = event.payload as { sessionId?: string; userText?: string } | undefined;
  const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : '';
  const userText = typeof payload?.userText === 'string' ? payload.userText.trim() : '';
  if (!sessionId || userText.length < 2) return;

  const candidates = await extractMemoryCandidates(userText);
  if (candidates.length === 0) return;

  // 四路分流聚合（单条失败不阻断其余候选与回合收尾）
  let forgotten = 0, dropped = 0, explicitWritten = 0, ticketed = 0, sessionSkipped = 0, failed = 0;
  for (const c of candidates) {
    let action: string;
    try {
      action = await routeCandidate(c, opts);
    } catch (err) {
      console.warn(`[MemoryExtractor] 候选分流异常（跳过该条）：`, err);
      failed += 1;
      continue;
    }
    if (action === 'dropped_sensitive') dropped += 1;
    else if (action === 'forgotten') forgotten += 1;
    else if (action === 'skipped_session') sessionSkipped += 1;
    else if (action === 'explicit_written') explicitWritten += 1;
    else if (action === 'explicit_failed') failed += 1;
    else if (action === 'ticket') ticketed += 1;
  }
  const parts = [
    explicitWritten > 0 ? `显式入库 ${explicitWritten}` : '',
    ticketed > 0 ? `待确认 ${ticketed}` : '',
    forgotten > 0 ? `遗忘 ${forgotten}` : '',
    sessionSkipped > 0 ? `会话级跳过 ${sessionSkipped}` : '',
    dropped > 0 ? `敏感丢弃 ${dropped}` : '',
    failed > 0 ? `入库失败 ${failed}` : '',
  ].filter(Boolean);
  if (parts.length > 0) {
    console.log(`[MemoryExtractor] 会话 ${sessionId}: ${parts.join('｜')}`);
  }
}

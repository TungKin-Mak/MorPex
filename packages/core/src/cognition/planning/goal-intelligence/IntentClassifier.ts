/**
 * IntentClassifier — 意图判别器（目标智能层）
 *
 * 区分「闲聊/问候/寒暄」（chat）与「要执行的任务/目标」（task）。
 *
 * 策略（12-Factor U1 改造：全 LLM 化）：
 *   1. 主路径：LLM 结构化输出判定（每个带 LLM 提供器的调用都过模型，无预筛短路）
 *   2. 兜底：LLM 失败/超时/未注入时降级启发式正则（触发时打 warn 可观测）
 */
import { CHAT_SYSTEM } from '../../prompts/intent-prompts.js';

export type IntentKind = 'chat' | 'task';

type LLMFn = (
  system: string,
  prompt: string,
  opts?: { temperature?: number; maxTokens?: number },
) => Promise<string>;

const CHAT_HINT_RE =
  /^(你(好|们好|是谁|是做什么的|能干什么|可以做什么|在吗|在么|吃了没|好啊)|嗨|哈喽|hello|hi|hey|good\s*(morning|afternoon|evening)|thanks|thank you|谢谢|感谢|再见|拜拜|bye|晚安|早上好|下午好|晚上好|怎么用|如何使用|你好呀|今天天气|天气怎么样)/i;

const TASK_HINT_RE =
  /(写|做|创建|生成|开发|实现|搭建|分析|检查|审查|部署|翻译|总结|计算|查询|搜索|告诉|帮|请|设计|规划|修复|调试|测试|优化|对比|编译|打包|上线|write|create|build|develop|implement|analyze|check|deploy|translate|summarize|calculate|search|design|plan|fix|debug|test|optimize|make|install)/i;

/** 17i.35：铁定任务 = 强任务动词 + 具体内容（非疑问句才判定，疑问交给 LLM）。 */
const STRONG_TASK_RE =
  /(写|做|生成|创建|开发|实现|搭建|部署|翻译|总结|计算|修复|调试|测试|安装|分析|设计|规划|制作|构建|编写).{1,20}/i;

/** 17i.35：疑问/能力询问类（能…什么/…吗/什么是…/怎么…/有什么功能 等）→ 交给 LLM 判，正则不再硬判。 */
function isQuestionLike(t: string): boolean {
  return (
    /[?？]$/.test(t) ||
    /(能|会|可以).{0,6}(什么|吗)|什么是|怎么样|怎么用|能不能|会不会|有什么(功能|用|本事|能力)/i.test(t)
  );
}

/** 启发式快速判定：只判**铁定**场景（问候/强任务），疑问/歧义 → unknown（交给 LLM）。 */
function heuristic(message: string): IntentKind | 'unknown' {
  const t = message.trim();
  // 铁定任务：强动词 + 具体对象 + 非疑问 → task（0 成本）
  if (!isQuestionLike(t) && STRONG_TASK_RE.test(t)) return 'task';
  // 铁定闲聊：问候/道谢/再见 → chat（0 成本）
  if (CHAT_HINT_RE.test(t)) return 'chat';
  // T2 校准：记忆/自我介绍/闲聊追问 → chat（非疑问句也直答，不再交 LLM 偏判）
  if (MEMORY_CHAT_RE.test(t) && !STRONG_TASK_RE.test(t)) return 'chat';
  // 极短且非任务/非疑问 → 闲聊（0 成本）
  if (t.length <= 6 && !isQuestionLike(t) && !TASK_HINT_RE.test(t)) return 'chat';
  // 疑问/歧义 → 交给 LLM
  return 'unknown';
}

/** T2 校准：记忆/自我介绍/闲聊追问类（此前被 LLM 偏向判成 task，致 chat 直答分支零实测） */
const MEMORY_CHAT_RE =
  /(我(叫|姓|是)|请?记住|记一下|记得|你知道吗|你喜欢|你觉得(怎么样|如何)?|陪我|聊聊|说说话|讲个|猜猜)/i;

/** LLM 判定超时（防拖慢消息入口；超时走降级） */
const INTENT_LLM_TIMEOUT_MS = 5_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`intent-llm-timeout:${ms}ms`)), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }, (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

/** 降级告警限流：首次必报，之后每 20 次报一次（LLM 网关故障时不刷屏但可观测） */
let fallbackCount = 0;
function intentFallbackWarn(reason: string): string | null {
  fallbackCount += 1;
  if (fallbackCount === 1 || fallbackCount % 20 === 0) {
    return `[IntentClassifier] LLM ${reason}，降级启发式正则兜底（累计 ${fallbackCount} 次）`;
  }
  return null; // 限流：不产生日志噪音
}

/** @internal 仅测试用：重置降级告警限流计数 */
export function resetIntentFallbackWarnForTest(): void {
  fallbackCount = 0;
}

export class IntentClassifier {
  /**
   * 判定用户消息意图。
   * @param message 用户原始消息
   * @param llm 可选 LLM 提供器。U1 起主路径：有则全量走 LLM（无预筛）；失败/超时/未注入降级启发式正则
   */
  static async classify(message: string, llm?: LLMFn): Promise<IntentKind> {
    // 空/纯空白消息不是闲聊：走 goal 路径让下游校验拒绝（U1 回归修复：
    // 否则空白被启发式默认判 chat，sendTask 空任务不再被拒绝）
    if (!message || !message.trim()) return 'task';
    if (llm) {
      try {
        const text = await withTimeout(
          llm(
            CHAT_SYSTEM,
            `用户消息：${message.slice(0, 500)}\n\n意图类别：`,
            { temperature: 0, maxTokens: 10 },
          ),
          INTENT_LLM_TIMEOUT_MS,
        );
        const m = text.trim().toLowerCase().match(/\b(chat|task)\b/);
        if (m) return m[1] as IntentKind;
        // 输出无法解析也视为失败 → 降级
        { const w = intentFallbackWarn('输出不可解析'); if (w) console.warn(w); }
      } catch {
        { const w = intentFallbackWarn('判定失败/超时'); if (w) console.warn(w); }
      }
    }
    // ── 降级兜底：启发式正则（原逻辑保留）──
    const h = heuristic(message);
    if (h !== 'unknown') return h;
    // 17i.35：疑问类 → chat（别把问题当任务执行）；其余 task（避免漏执行）
    return isQuestionLike(message.trim()) ? 'chat' : 'task';
  }
}

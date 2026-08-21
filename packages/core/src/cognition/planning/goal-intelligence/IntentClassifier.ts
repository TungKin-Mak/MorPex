/**
 * IntentClassifier — 意图判别器（目标智能层）
 *
 * 区分「闲聊/问候/寒暄」（chat）与「要执行的任务/目标」（task）。
 * 这是 MorPex 引擎缺失的关键一环：此前所有输入一律走 executeGoal 编排，
 * 导致「你好」也被当作任务建 Mission/团队/产物。
 *
 * 策略（兼顾速度与准确）：
 *   1. 启发式快速判定：明确问候 → chat；含任务动词 → task（0 LLM 调用）
 *   2. 歧义时用 LLM 判别（若注入 llm），失败/未注入回退 task
 */
export type IntentKind = 'chat' | 'task';

type LLMFn = (
  system: string,
  prompt: string,
  opts?: { temperature?: number; maxTokens?: number },
) => Promise<string>;

const CHAT_SYSTEM = [
  '你是 MorPex 的意图判别器。判断用户消息属于哪一类：',
  '- chat：闲聊、问候、寒暄、简单问句（不要求执行具体任务）',
  '- task：要求写代码/做分析/生成文档/部署/翻译/总结等具体任务',
  '只回答一个词：chat 或 task。',
].join('\n');

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
  // 极短且非任务/非疑问 → 闲聊（0 成本）
  if (t.length <= 6 && !isQuestionLike(t) && !TASK_HINT_RE.test(t)) return 'chat';
  // 疑问/歧义 → 交给 LLM
  return 'unknown';
}

export class IntentClassifier {
  /**
   * 判定用户消息意图。
   * @param message 用户原始消息
   * @param llm 可选 LLM 提供器（歧义时用；失败回退启发式）
   */
  static async classify(message: string, llm?: LLMFn): Promise<IntentKind> {
    const h = heuristic(message);
    if (h !== 'unknown') return h;

    if (llm) {
      try {
        const text = await llm(CHAT_SYSTEM, `用户消息：${message}\n\n意图类别：`, {
          temperature: 0,
          maxTokens: 10,
        });
        const m = text.trim().toLowerCase().match(/\b(chat|task)\b/);
        if (m) return m[1] as IntentKind;
      } catch {
        // LLM 失败 → 回退
      }
    }
    // 17i.35：LLM 失败回退——疑问类 → chat（别把问题当任务执行）；其余 task（避免漏执行）
    return isQuestionLike(message.trim()) ? 'chat' : 'task';
  }
}

/**
 * error-compactor — 统一错误/结果压缩器（12-Factor U1 · G2）
 *
 * 解决：喂给 LLM 的错误/步骤结果无结构、无截断，长任务多步失败会撑爆上下文
 * （审计锚点：OrchestratorAgent.formatResults 曾 JSON.stringify 直拼）。
 *
 * 输出契约：四段结构 {失败了什么/为什么/试过什么/建议下一步}，总长有上界，
 * 堆栈只保留关键帧。这是"格式化"不是"触发"，故不违反"触发全 LLM 化"原则。
 */

/** 通用截断（与 StepAgentExecutor.previewText 同语义；此处导出供跨文件复用） */
export function clip(v: unknown, max = 2000): string {
  if (v === undefined || v === null) return '';
  let s: string;
  if (typeof v === 'string') {
    s = v;
  } else {
    try {
      s = JSON.stringify(v);
    } catch {
      // 循环引用/BigInt 等不可序列化对象：不能让格式化炸掉编排回合
      s = `[不可序列化对象: ${typeof v}]`;
    }
  }
  return s.length > max ? `${s.slice(0, max)}…[截断]` : s;
}

/** 单条失败压缩后的总长上界 */
export const COMPACT_FAILURE_MAX = 800;

/** 从堆栈提取关键帧（最多 maxFrames 行，剥掉 node_modules 噪音） */
function keyStackFrames(err: unknown, maxFrames = 3): string {
  const st = (err as { stack?: string })?.stack;
  if (typeof st !== 'string') return '';
  return st
    .split('\n')
    .slice(1)
    .filter((l) => !l.includes('node_modules'))
    .slice(0, maxFrames)
    .map((l) => l.trim())
    .join(' | ');
}

/** 按错误关键词给出建议（格式化规则，非触发机制） */
function advise(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('timeout') || m.includes('超时')) return '检查目标服务可用性与超时配置，必要时重试';
  if (m.includes('econnrefused') || m.includes('enotfound') || m.includes('network')) return '检查网络连通性/主机端口是否正确';
  if (m.includes('permission') || m.includes('eacces') || m.includes('权限')) return '检查文件/目录权限或执行身份';
  if (m.includes('not found') || m.includes('enoent') || m.includes('不存在')) return '确认路径/资源是否存在，先补齐前置产物';
  return '结合失败原因修正输入后重试，或转人工确认前置条件';
}

export interface CompactFailureInput {
  /** 失败步骤名 */
  step: string;
  /** 原始错误（Error/string/任意） */
  err: unknown;
  /** 已尝试次数（如有） */
  attempts?: number;
}

/**
 * 把一次失败压缩成四段结构（总长 ≤ COMPACT_FAILURE_MAX）：
 * 【失败了什么】【为什么】【试过什么】【建议下一步】
 */
export function compactFailure(input: CompactFailureInput): string {
  const rawMsg =
    input.err instanceof Error
      ? input.err.message
      : typeof input.err === 'string'
        ? input.err
        : clip(input.err, 300) || '(未知错误)';
  const why = keyStackFrames(input.err) || '（无堆栈信息）';
  const tried =
    typeof input.attempts === 'number' && input.attempts > 0
      ? `已自动重试 ${input.attempts} 次`
      : '尚未自动重试';

  const out = [
    `【失败了什么】${input.step}：${clip(rawMsg, 300)}`,
    `【为什么】${clip(why, 240)}`,
    `【试过什么】${tried}`,
    `【建议下一步】${advise(rawMsg)}`,
  ].join('\n');

  return out.length > COMPACT_FAILURE_MAX ? `${out.slice(0, COMPACT_FAILURE_MAX)}…[截断]` : out;
}

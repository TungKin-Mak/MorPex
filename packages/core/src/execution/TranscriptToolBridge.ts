/**
 * TranscriptToolBridge — 会话工具桥（T3 session_read / send_message 的服务端实现注入点）
 *
 * 模式对齐 getMailbox()/setAskEventBus()：core 定义接口 + 单例持有；StudioServer 启动时
 * setTranscriptToolBridge(bridge) 注入真实实现（权限矩阵/账本读取/留言落库都在 server 侧，
 * core 保持哑工具）。未注入时 primitiveAgentTools 不注册这两个工具。
 *
 * 铁律：本文件不 import @earendil-works/*；不 import studio/server（依赖方向 core ← server 注入）。
 */

export type SessionReadMode = 'full' | 'summary';

export interface TranscriptToolBridge {
  /**
   * 读取目标会话内容（已脱敏）。
   * 权限矩阵在实现内判定（docs/SINGLE_TRANSCRIPT_DESIGN.md §4.5）：
   *   上司→下属 全文 / 同树兄弟 摘要 / 经理↔经理 不可翻账 / 跨树 拒绝。
   * 无权时 throw Error('DENIED: ...')，工具层转为 isError 结果回填 LLM。
   */
  sessionRead(requesterSessionPath: string, targetSessionId: string, mode: SessionReadMode): Promise<string>;
  /**
   * 跨会话留言：写 agent_messages 一行 + 双方账本各追加存根 custom_message。
   * 返回确认文本（含 messageId）；目标不存在 throw Error('NOT_FOUND: ...')。
   */
  sendMessage(requesterSessionPath: string, toSessionId: string, body: string): Promise<string>;
}

let bridge: TranscriptToolBridge | null = null;

export function setTranscriptToolBridge(b: TranscriptToolBridge): void {
  bridge = b;
}

export function getTranscriptToolBridge(): TranscriptToolBridge | null {
  return bridge;
}

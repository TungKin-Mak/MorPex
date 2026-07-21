/**
 * GatewayMissionHandler — 将 MessageGateway 连接到 MissionRuntime
 *
 * P0 架构完善: 连接 Interaction Gateway → Mission Runtime
 *
 * MessageGateway 通过 MessageHandler 接口委托消息处理。
 * 此处理器将用户消息转换为 Mission，触发 Mission 的完整生命周期。
 *
 * 使用方式：
 *   const handler = new GatewayMissionHandler(missionRuntime);
 *   messageGateway.setMessageHandler(handler.handle.bind(handler));
 *
 * Message Flow:
 *   IncomingMessage → createMission() → executeMission() → OutgoingMessage
 */

import type { MessageHandler } from '../../../interaction/gateway/MessageGateway.js';
import type { IncomingMessage, OutgoingMessage } from '../../../interaction/types.js';
import type { MissionRuntime } from '../MissionRuntime.js';
import { MissionState } from '../types.js';

export class GatewayMissionHandler {
  /** MissionRuntime 实例 */
  private missionRuntime: MissionRuntime;

  /** 是否异步执行（立即返回，后台执行） */
  private asyncExecution: boolean;

  /**
   * @param missionRuntime - MissionRuntime 实例
   * @param asyncExecution - 是否异步执行（默认 true）
   */
  constructor(missionRuntime: MissionRuntime, asyncExecution: boolean = true) {
    this.missionRuntime = missionRuntime;
    this.asyncExecution = asyncExecution;
  }

  /**
   * handle — MessageHandler 接口实现
   *
   * 将 IncomingMessage 转换为 Mission，触发完整生命周期：
   *   CREATED → PLANNING → EXECUTING → VERIFYING → COMPLETED
   *
   * 异步模式（默认）：立即返回 Mission 创建确认，
   *   Mission 在后台执行。
   * 同步模式：等待 Mission 执行完成后返回结果。
   *
   * @param msg - 来自 MessageGateway 的入站消息
   * @returns OutgoingMessage
   */
  async handle(msg: IncomingMessage): Promise<OutgoingMessage> {
    console.log(`[GatewayMissionHandler] 📨 Received from ${msg.channel}: "${msg.content.substring(0, 80)}"`);

    try {
      // Step 1: 从用户消息创建 Mission
      const mission = await this.missionRuntime.createMission(msg);
      console.log(`[GatewayMissionHandler] ✅ Mission created: ${mission.id}`);

      if (this.asyncExecution) {
        // Step 2a: 异步执行 — 后台启动执行，立即返回
        this.missionRuntime.executeMission(mission.id).catch(err => {
          console.error(`[GatewayMissionHandler] ❌ Async execution failed: ${mission.id}`, err);
        });

        return {
          channel: msg.channel,
          userId: msg.userId,
          sessionId: msg.sessionId,
          content: `✅ Mission created: "${mission.goal.substring(0, 80)}". Execution started.`,
          type: 'dag',
          metadata: {
            missionId: mission.id,
            state: MissionState.CREATED,
            goal: mission.goal,
            async: true,
          },
        };
      } else {
        // Step 2b: 同步执行 — 等待执行完成
        const result = await this.missionRuntime.executeMission(mission.id);

        const output = result.state === MissionState.COMPLETED
          ? (typeof result.output === 'string'
              ? result.output
              : result.output
                ? JSON.stringify(result.output).substring(0, 2000)
                : `✅ Mission completed: ${result.stepsCompleted}/${result.stepsTotal} steps.`)
          : `❌ Mission ${result.state}: ${result.error || 'Unknown error'}`;

        return {
          channel: msg.channel,
          userId: msg.userId,
          sessionId: msg.sessionId,
          content: output,
          type: result.state === MissionState.COMPLETED ? 'text'
            : result.state === MissionState.FAILED ? 'error'
            : 'dag',
          metadata: {
            missionId: mission.id,
            state: result.state,
            stepsCompleted: result.stepsCompleted,
            stepsTotal: result.stepsTotal,
            duration: result.duration,
            error: result.error,
          },
        };
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[GatewayMissionHandler] ❌ Handler error: ${errorMsg}`);

      return {
        channel: msg.channel,
        userId: msg.userId,
        sessionId: msg.sessionId,
        content: `❌ Error: ${errorMsg}`,
        type: 'error',
        metadata: { error: errorMsg },
      };
    }
  }
}

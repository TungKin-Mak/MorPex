/**
 * MemoryBusListener — 事件驱动的记忆归档器（v2.4）
 *
 * 监听 EventBus 上的 agent.reflection_created 和 artifact.updated 事件，
 * 异步触发 VectorStore 向量化归档。
 * 替代手动调用 remember()，实现完全解耦的记忆写入。
 *
 * 遵循迁移铁律：
 *   0.4 (删除优先法则): 使用 EventBus 事件驱动而非主动调用
 */

import type { EventBus, MorPexEvent } from '../common/types.js';

/**
 * MemoryBusListener — 事件驱动的记忆归档器
 *
 * 监听 EventBus 事件 → 异步 VectorStore upsert。
 * 由 Kernel 或编排器在启动时注册。
 *
 * @example
 * ```typescript
 * const listener = new MemoryBusListener(eventBus, vectorStore);
 * listener.start();
 * ```
 */
export class MemoryBusListener {
  private unsubscribers: Array<() => void> = [];

  constructor(
    private eventBus: EventBus,
    private vectorStore: {
      upsert: (id: string, text: string, tags?: string[]) => Promise<boolean>;
      search?: (text: string, topK: number) => Promise<string[]>;
    },
  ) {}

  /**
   * start — 注册事件监听
   */
  start(): void {
    this.unsubscribers.push(
      this.eventBus.on('agent.reflection_created', async (event: MorPexEvent) => {
        const payload = event.payload as any;
        if (payload?.content) {
          try {
            await this.vectorStore.upsert(
              event.id,
              payload.content,
              ['reflection', payload.domainId ?? 'unknown'].filter(Boolean),
            );
          } catch (err) {
            console.error('[MemoryBusListener] reflection upsert 失败:', err);
          }
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('artifact.updated', async (event: MorPexEvent) => {
        const payload = event.payload as any;
        if (payload?.artifactId && payload?.content) {
          try {
            await this.vectorStore.upsert(
              payload.artifactId,
              typeof payload.content === 'string' ? payload.content : JSON.stringify(payload.content),
              ['artifact', payload.artifactType ?? 'unknown'].filter(Boolean),
            );
          } catch (err) {
            console.error('[MemoryBusListener] artifact upsert 失败:', err);
          }
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('agent.end', async (event: MorPexEvent) => {
        const payload = event.payload as any;
        if (payload?.messages) {
          const text = extractMessagesText(payload.messages);
          if (text) {
            try {
              await this.vectorStore.upsert(
                event.executionId,
                text,
                ['conversation', payload.domainId ?? 'default'].filter(Boolean),
              );
            } catch (err) {
              console.error('[MemoryBusListener] agent.end upsert 失败:', err);
            }
          }
        }
      }),
    );
  }

  /**
   * stop — 取消所有事件监听
   */
  stop(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
  }
}

function extractMessagesText(messages: any[]): string {
  return messages
    .filter((m: any) => m.role === 'assistant' || m.role === 'user')
    .map((m: any) => {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) {
        return m.content
          .filter((p: any) => p?.type === 'text')
          .map((p: any) => p.text ?? '')
          .join(' ');
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

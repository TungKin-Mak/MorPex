/**
 * Memory Plugin — 记忆系统插件 (v2)
 *
 * v2 变更：
 *   - 移除旧 MemoryEngine，改用 MemoryBus（Cognee 风格三维一体）
 *   - 新增 v2 事件: memory.feedback, memory.stage_complete, memory.plan_stages, 
 *     memory.audit, memory.intercept_input
 *
 * 事件协议：
 *   - 监听: 'memory.store'           ← 存储记忆
 *   - 监听: 'memory.query'           ← 查询记忆
 *   - 监听: 'memory.feedback'        ← 闭环反馈 (v2)
 *   - 监听: 'memory.stage_complete'  ← 阶段完成 (v2)
 *   - 监听: 'memory.plan_stages'     ← 阶段规划 (v2)
 *   - 监听: 'memory.audit'           ← 门控审计 (v2)
 *   - 监听: 'memory.intercept_input' ← 输入拦截 (v2)
 *   - 广播: 'memory.stored'          → 记忆已存储
 *   - 广播: 'memory.recalled'        → 召回结果
 *   - 广播: 'memory.stats'           → 统计信息
 */

import type {
  MorPexPlugin,
  PluginContext,
  EventBus,
  MorPexEvent,
} from '../../../common/types.js';
import { MemoryBus } from '../../../../../memory/src/index.js';
import type { MemoryBusConfig, MemoryPayload, RecallQuery } from '../../../../../memory/src/index.js';

/** 默认配置 */
const DEFAULT_MEMORY_BUS_CONFIG: MemoryBusConfig = {
  dataDir: './data/memory-bus',
  embedUrl: 'http://localhost:3100',
  writeGateThreshold: 2,
};

/**
 * MemoryPlugin — 记忆系统 (v2: 使用 MemoryBus)
 */
export class MemoryPlugin implements MorPexPlugin {
  name = 'memory-plugin';
  version = '2.0.0';
  dependencies: string[] = [];

  private bus!: MemoryBus;
  private eventBus!: EventBus;
  private identity!: { createEventId(): string };
  private unsubscribers: Array<() => void> = [];
  private initialized = false;

  async initialize(context: PluginContext): Promise<void> {
    this.eventBus = context.eventBus;
    this.identity = context.executionIdentity;

    const userConfig = (context.config?.memory ?? {}) as Partial<MemoryBusConfig>;
    const config: MemoryBusConfig = { ...DEFAULT_MEMORY_BUS_CONFIG, ...userConfig };

    this.bus = new MemoryBus(config);

    // 注入向量存储
    try {
      const { ZVecStorage } = await import('../../../../../memory/src/index.js');
      const vs = new ZVecStorage({
        dataPath: config.dataDir ? `${config.dataDir}/zvec` : './data/zvec',
        embedUrl: config.embedUrl,
      });
      await vs.initialize();
      this.bus.setVectorStore(vs);
    } catch { /* zvec 不可用时降级 */ }

    await this.bus.initialize();

    // 引擎回调 → EventBus
    this.bus.onMemoryStored = (entry) => {
      this.emitEvent('memory.stored', { entry, memType: entry.memType });
    };

    this.bus.onMemoryRecalled = (query, results) => {
      this.emitEvent('memory.recalled', { query, resultCount: results.items.length, source: results.source });
    };

    this.initialized = true;
    console.log('[MemoryPlugin v2] 已初始化 (MemoryBus)');
    console.log(`  ├─ 数据目录: ${config.dataDir}`);
    console.log(`  └─ 写闸门阈值: ${config.writeGateThreshold}`);
  }

  async start(): Promise<void> {
    if (!this.initialized) {
      throw new Error('[MemoryPlugin] 请在 start() 前调用 initialize()');
    }

    // ── 基础操作 ──

    // 存储记忆
    this.unsubscribers.push(
      this.eventBus.on('memory.store', async (event: MorPexEvent) => {
        const data = event.payload as any;
        if (data?.content) {
          const payload: MemoryPayload = {
            content: data.content,
            source: data.source ?? 'event',
            sourceId: data.sourceId ?? event.executionId,
            tags: data.tags ?? [],
            importance: data.importance ?? 3,
            metadata: data.metadata,
            memType: data.memType,
            references: data.references,
          };
          const entry = await this.bus.remember(payload);
          if (!entry) {
            this.emitEvent('memory.rejected', { reason: 'write_gate', payload });
          }
        }
      }),
    );

    // 查询记忆
    this.unsubscribers.push(
      this.eventBus.on('memory.query', async (event: MorPexEvent) => {
        const query = (event.payload?.query ?? event.payload) as RecallQuery & { text?: string; limit?: number };
        if (query?.text) {
          const results = await this.bus.recall({
            text: query.text,
            strategy: (event.payload?.strategy as any) || 'hybrid-rag',
            topK: query.limit ?? query.topK ?? 10,
            includeArchive: query.includeArchive ?? false,
          });
          this.emitEvent('memory.query_results', { query, results });
        }
      }),
    );

    // 统计查询
    this.unsubscribers.push(
      this.eventBus.on('memory.get_stats', () => {
        this.emitEvent('memory.stats', { stats: this.bus.getStats() });
      }),
    );

    // ── v2 新增事件 ──

    // 闭环反馈
    this.unsubscribers.push(
      this.eventBus.on('memory.feedback', (event: MorPexEvent) => {
        const { id, useful } = event.payload ?? {};
        if (id) {
          const result = this.bus.feedback(id, useful ?? true);
          this.emitEvent('memory.feedback_result', result);
        }
      }),
    );

    // 阶段完成
    this.unsubscribers.push(
      this.eventBus.on('memory.stage_complete', async (event: MorPexEvent) => {
        const { summary, output } = event.payload ?? {};
        if (summary) {
          await this.bus.stageComplete(summary, output ?? '');
          this.emitEvent('memory.stage_completed', { summary });
        }
      }),
    );

    // 阶段规划
    this.unsubscribers.push(
      this.eventBus.on('memory.plan_stages', (event: MorPexEvent) => {
        const { stages } = event.payload ?? {};
        if (Array.isArray(stages)) {
          this.bus.planStages(stages);
          this.emitEvent('memory.stages_planned', { count: stages.length });
        }
      }),
    );

    // 门控审计
    this.unsubscribers.push(
      this.eventBus.on('memory.audit', (event: MorPexEvent) => {
        const { query, targetStage } = event.payload ?? {};
        if (query) {
          const signal = this.bus.audit(query, targetStage);
          this.emitEvent('memory.audit_result', signal);
        }
      }),
    );

    // 输入拦截
    this.unsubscribers.push(
      this.eventBus.on('memory.intercept_input', async (event: MorPexEvent) => {
        const { query } = event.payload ?? {};
        if (query) {
          const corrections = await this.bus.interceptInput(query);
          this.emitEvent('memory.intercept_result', { corrections, count: corrections.length });
        }
      }),
    );

    console.log('[MemoryPlugin v2] 已启动，正在监听 memory.* 事件');
  }

  async stop(): Promise<void> {
    for (const unsub of this.unsubscribers) {
      try { unsub(); } catch { /* ignore */ }
    }
    this.unsubscribers = [];
    await this.bus.shutdown();
    console.log('[MemoryPlugin v2] 已停止');
  }

  /** 获取 MemoryBus 实例（供 StudioServer 等外部直接调用） */
  getBus(): MemoryBus {
    return this.bus;
  }

  private emitEvent(type: string, payload: any): void {
    const event: MorPexEvent = {
      id: this.identity.createEventId(),
      type,
      timestamp: Date.now(),
      executionId: 'memory-plugin',
      source: 'memory-plugin',
      payload,
    };
    this.eventBus.emit(event);
  }
}

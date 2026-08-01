/**
 * Industry Plugin — 行业适配器插件
 *
 * 偏置层：提供意图提示、工作流模板、工具建议。
 * 不做执行逻辑。
 *
 * 事件协议：
 *   - 监听: 'industry.guess'          ← 猜测行业
 *   - 监听: 'industry.get_workflows'  ← 获取工作流
 *   - 监听: 'industry.get_hints'      ← 获取意图提示
 *   - 监听: 'industry.get_tools'      ← 获取建议工具
 *   - 广播: 'industry.guess_result'   → 行业猜测结果
 *   - 广播: 'industry.workflows'      → 工作流模板
 *   - 广播: 'industry.hints'          → 意图提示
 *   - 广播: 'industry.tools'          → 建议工具
 */

import type { MorPexPlugin, PluginContext, EventBus, MorPexEvent } from '../common/types.js';
import { IndustryRegistry } from './IndustryRegistry.js';
import type { IndustryPluginConfig, IndustryType } from './types.js';
import type { ExecutionIdentity } from '../common/ExecutionIdentity.js';

export class IndustryPlugin implements MorPexPlugin {
  name = 'industry-plugin';
  version = '0.1.0';
  dependencies: string[] = [];

  private registry!: IndustryRegistry;
  private eventBus!: EventBus;
  private identity!: { createEventId(): string };
  private unsubscribers: Array<() => void> = [];
  private initialized = false;

  async initialize(context: PluginContext): Promise<void> {
    this.eventBus = context.eventBus;
    this.identity = context.executionIdentity;
    const config = (context.config?.industry ?? {}) as IndustryPluginConfig;
    this.registry = new IndustryRegistry(config.enabledIndustries);

    this.initialized = true;
    console.log('[IndustryPlugin] 已初始化');
    console.log(`  ├─ 已启用: ${this.registry.getAll().map(i => i.type).join(', ')}`);
  }

  async start(): Promise<void> {
    if (!this.initialized) throw new Error('必须先 initialize');

    this.unsubscribers.push(
      this.eventBus.on('industry.guess', (event: MorPexEvent) => {
        const input = event.payload?.input ?? event.payload;
        if (typeof input === 'string') {
          const result = this.registry.guessIndustry(input);
          this.emitEvent('industry.guess_result', result);
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('industry.get_workflows', (event: MorPexEvent) => {
        const type = event.payload?.type as IndustryType;
        if (type) {
          const workflows = this.registry.getWorkflows(type);
          this.emitEvent('industry.workflows', { type, workflows });
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('industry.get_hints', (event: MorPexEvent) => {
        const type = event.payload?.type as IndustryType;
        if (type) {
          const hints = this.registry.getIntentHints(type);
          this.emitEvent('industry.hints', { type, hints });
        } else {
          // 未指定行业 → 返回全部提示
          this.emitEvent('industry.hints', { hints: this.registry.getAllIntentHints() });
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('industry.get_tools', (event: MorPexEvent) => {
        const type = event.payload?.type as IndustryType;
        if (type) {
          const tools = this.registry.getSuggestedTools(type);
          this.emitEvent('industry.tools', { type, tools });
        }
      }),
    );

    console.log('[IndustryPlugin] 已启动');
  }

  async stop(): Promise<void> {
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
  }

  getRegistry(): IndustryRegistry { return this.registry; }

  private emitEvent(type: string, payload: any, executionId?: string): void {
    this.eventBus.emit({
      id: this.identity.createEventId(),
      type,
      timestamp: Date.now(),
      executionId: executionId ?? 'industry-plugin',
      source: 'industry-plugin',
      payload,
    });
  }
}

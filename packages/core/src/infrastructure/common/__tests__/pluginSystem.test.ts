/**
 * infrastructure/common/__tests__/pluginSystem.test.ts — PluginSystem 接线测试
 *
 * 覆盖：
 *   1. getInstance 单例：首次需注入 eventBus+executionIdentity；重复调用返回同一实例
 *   2. register → startAll → getStatus 闭环（含依赖顺序）
 *   3. stopAll 逆序调用 stop（可逆效果挂载点）
 *   4. resetSingleton 隔离（测试沙箱/演化沙箱可热重置）
 *
 * import 用 `.js` 后缀；全部内存数据。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { EventBus as EventBusView, MorPexPlugin } from '../types.js';
import { PluginSystem } from '../PluginSystem.js';
import { EventBus } from '../EventBus.js';
import { ExecutionIdentity } from '../ExecutionIdentity.js';

function makePlugin(name: string, log: string[], deps: string[] = []): MorPexPlugin {
  return {
    name,
    version: '1.0.0-test',
    dependencies: deps,
    initialize: async () => { log.push(`init:${name}`); },
    start: async () => { log.push(`start:${name}`); },
    stop: async () => { log.push(`stop:${name}`); },
  };
}

describe('PluginSystem — 单例与生命周期', () => {
  beforeEach(() => {
    PluginSystem.resetSingleton();
  });

  it('getInstance 首次必须注入依赖；重复调用返回同一实例', () => {
    const bus = new EventBus();
    expect(() => PluginSystem.getInstance()).toThrow(/eventBus/);
    const a = PluginSystem.getInstance(bus as unknown as EventBusView, new ExecutionIdentity());
    const b = PluginSystem.getInstance(); // 依赖已注入，忽略后续参数
    expect(a).toBe(b);
  });

  it('register → startAll → getStatus：依赖拓扑先 init/start 后置插件', async () => {
    const log: string[] = [];
    const sys = PluginSystem.getInstance(new EventBus() as unknown as EventBusView, new ExecutionIdentity());
    // b 依赖 a
    sys.register(makePlugin('base.a', log));
    sys.register(makePlugin('dep.b', log, ['base.a']));
    await sys.startAll();

    expect(log.indexOf('init:base.a')).toBeLessThan(log.indexOf('init:dep.b'));
    expect(log.indexOf('start:base.a')).toBeLessThan(log.indexOf('start:dep.b'));
    const status = sys.getStatus();
    expect(status.find((s) => s.name === 'dep.b')?.status).toBe('running');
    expect(sys.count).toBe(2);
  });

  it('stopAll 逆序调用 stop（可逆效果挂载点）', async () => {
    const log: string[] = [];
    const sys = PluginSystem.getInstance(new EventBus() as unknown as EventBusView, new ExecutionIdentity());
    sys.register(makePlugin('base.a', log));
    sys.register(makePlugin('dep.b', log, ['base.a']));
    await sys.startAll();
    await sys.stopAll();

    // 逆序停止：先停依赖者(dep.b)、后停被依赖者(base.a)——正确卸载顺序（依赖最后收）
    expect(log.lastIndexOf('stop:dep.b')).toBeLessThan(log.lastIndexOf('stop:base.a'));
    expect(sys.getStatus().find((s) => s.name === 'dep.b')?.status).toBe('stopped');
  });
});

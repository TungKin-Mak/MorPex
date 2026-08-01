/**
 * architecture-audit-fixes.test.ts — S22 架构审计修复验证
 *
 * 覆盖 3 处审计发现的接线缺陷：
 * 1. L8：ActiveEvolutionTrigger 注入 SelfImprovementLoop 后 autoEvolve 真正触发（不再跳过）
 * 2. L4：BrainFacade 注入 reflectionEngine/metaLearner 后字段非 null；Synthesizer 装配可实例化
 * 3. L1：ControlPlane.checkAll 传 capability 时走 AgentController 能力门禁
 */
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../src/common/EventBus.js';
import { ActiveEvolutionTrigger } from '../src/evolution/ActiveEvolutionTrigger.js';
import { BrainFacade } from '../src/cognition/BrainFacade.js';
import { ControlPlane } from '../src/control-plane/ControlPlane.js';
import { ReflectionEngine } from '../src/cognition/ReflectionEngine.js';
import { MetaLearner } from '../src/cognition/MetaLearner.js';
import { SelfImprovementLoop } from '../src/cognition/SelfImprovementLoop.js';
import { CrossDepartmentKnowledgeSynthesizer } from '../src/cognition/CrossDepartmentKnowledgeSynthesizer.js';

describe('S22 架构审计修复', () => {
  it('L8: 注入 SelfImprovementLoop 后 autoEvolve 不再跳过', async () => {
    const bus = new EventBus();
    const trigger = new ActiveEvolutionTrigger(bus);
    // 未注入 → isReady=false（跳过 autoEvolve）
    expect((trigger as any).isReady()).toBe(false);
    // 注入 → 激活
    trigger.setSelfImprovementLoop(new SelfImprovementLoop());
    expect((trigger as any).selfImprovementLoop).toBeTruthy();
    // autoEvolve 分支：selfImprovementLoop 存在则不再走「跳过」return
    expect((trigger as any).isReady()).toBe(true);
  });

  it('L4: BrainFacade 注入 reflectionEngine/metaLearner 后字段非 null', () => {
    const bus = new EventBus();
    const brain = new BrainFacade(bus);
    const re = new ReflectionEngine(bus);
    const ml = new MetaLearner(bus);
    brain.setReflectionEngine(re as any);
    brain.setMetaLearner(ml as any);
    const stats = brain.getStats();
    // 反射/元学习注入后，reflect/learn 不应因缺引擎降级为空
    expect((brain as any).reflectionEngine).toBe(re);
    expect((brain as any).metaLearner).toBe(ml);
    expect(stats.systems.memoryActivation).toBeDefined();
  });

  it('L4: CrossDepartmentKnowledgeSynthesizer 装配可实例化（自订阅激活）', () => {
    const bus = new EventBus();
    const synth = new CrossDepartmentKnowledgeSynthesizer(bus);
    expect(synth).toBeInstanceOf(CrossDepartmentKnowledgeSynthesizer);
    expect(typeof synth.synthesizeAcrossDepartments).toBe('function');
  });

  it('L1: checkAll 传 capability → AgentController 能力门禁生效', async () => {
    const plane = new ControlPlane();
    // 不存在的能力 → 拒绝
    const denied = await plane.checkAll('部署到 AWS', { estimatedCost: 50, capability: 'nonexistent_cap_xyz' });
    expect(denied.approved).toBe(false);
    expect(denied.rejection).toContain('能力不可用');
    // 不传 capability → 走原门禁（默认行为不变）
    const normal = await plane.checkAll('写爬虫', { estimatedCost: 50 });
    expect(normal.approved).toBe(true);
  });
});

describe('S22 goal→capability 自动推断', () => {
  it('开启推断：识别到能力且不可用 → 拒绝', async () => {
    const plane = new ControlPlane();
    // 'amazon' 命中 Amazon Listing 能力的领域词；Agent 未注册该能力 → 拒绝
    const denied = await plane.checkAll('创建 amazon 商品上架', { estimatedCost: 50, enableCapabilityInference: true });
    expect(denied.approved).toBe(false);
    expect(denied.rejection).toContain('能力不可用（自动推断）');
  });

  it('开启推断：识别不到能力（通用 goal）→ 放行', async () => {
    const plane = new ControlPlane();
    const ok = await plane.checkAll('写一个爬虫脚本', { estimatedCost: 50, enableCapabilityInference: true });
    expect(ok.approved).toBe(true);
  });

  it('默认关闭推断：不因能力缺失拒绝', async () => {
    const plane = new ControlPlane();
    const ok = await plane.checkAll('创建 amazon 商品上架', { estimatedCost: 50 });
    expect(ok.approved).toBe(true);
  });
});

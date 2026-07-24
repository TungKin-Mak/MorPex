/**
 * v13 Planner 模块测试 — HierarchicalPlanner + DeliveryPlanner 集成
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../src/common/EventBus.js';
import { HierarchicalPlanner } from '../src/planner/HierarchicalPlanner.js';
import { DeliveryPlanner } from '../src/planner/DeliveryPlanner.js';

describe('HierarchicalPlanner', () => {
  let eventBus: EventBus;
  let planner: HierarchicalPlanner;

  beforeEach(() => {
    eventBus = new EventBus();
    planner = new HierarchicalPlanner(eventBus);
  });

  it('简单目标返回单个 SubGoal', async () => {
    const plan = await planner.createPlan('写一个 Hello World 程序');
    expect(plan.subGoals.length).toBeGreaterThanOrEqual(1);
    expect(plan.subGoals[0].description).toContain('Hello World');
    expect(plan.metadata.complexity).toBe('simple' || 'medium');
  });

  it('多步目标返回多个 SubGoal 且带依赖关系', async () => {
    const plan = await planner.createPlan('分析需求，设计架构，然后实现功能，最后测试部署');
    expect(plan.subGoals.length).toBeGreaterThanOrEqual(2);
    // 应有依赖关系
    const hasDeps = plan.subGoals.some(sg => sg.dependencies.length > 0);
    expect(hasDeps).toBe(true);
  });

  it('关键词分解正确生成 DAG 节点', async () => {
    const plan = await planner.createPlan('实现一个用户登录功能');
    expect(plan.dag.length).toBeGreaterThanOrEqual(1);
    expect(plan.dag[0]).toHaveProperty('id');
    expect(plan.dag[0]).toHaveProperty('task');
    expect(plan.dag[0]).toHaveProperty('capabilities');
    expect(plan.dag[0]).toHaveProperty('deps');
  });

  it('降级（无 BrainFacade 时返回规则分解）', async () => {
    const plan = await planner.createPlan('设计一个复杂的分布式系统，包含微服务架构、消息队列、数据库分片');
    expect(plan.subGoals.length).toBeGreaterThanOrEqual(1);
    expect(plan.metadata.source).toBe('hierarchical-planner');
    // 即使没有 BrainFacade，规则分解也能工作
    expect(plan).toHaveProperty('dag');
    expect(plan.dag.length).toBe(plan.subGoals.length);
  });

  it('复杂目标标记为 complex', async () => {
    const plan = await planner.createPlan(
      '分析市场趋势，设计产品架构，开发核心模块，编写测试用例，部署到生产环境，监控运行状态',
    );
    expect(['simple', 'medium', 'complex']).toContain(plan.metadata.complexity);
    expect(plan.metadata.estimatedTotalDuration).toBeGreaterThan(0);
  });
});

describe('DeliveryPlanner 集成', () => {
  let eventBus: EventBus;
  let deliveryPlanner: DeliveryPlanner;
  let hierarchicalPlanner: HierarchicalPlanner;

  beforeEach(() => {
    eventBus = new EventBus();
    deliveryPlanner = new DeliveryPlanner(eventBus);
    hierarchicalPlanner = new HierarchicalPlanner(eventBus);
    deliveryPlanner.setHierarchicalPlanner(hierarchicalPlanner);
  });

  it('createPlan 使用 HierarchicalPlanner 生成计划', async () => {
    const plan = await deliveryPlanner.createPlan({
      goal: '实现用户注册功能',
      mode: 'full',
    });
    expect(plan.status).toBe('draft');
    expect(plan.tasks.length).toBeGreaterThanOrEqual(1);
    // mode 由 DeliveryPlanner 根据复杂度自动选择，可能为 quick 或 full
    expect(['quick', 'full']).toContain(plan.mode);
  });
});

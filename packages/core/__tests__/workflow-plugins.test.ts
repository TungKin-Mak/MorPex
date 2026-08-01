/**
 * workflow-plugins.test.ts — L9 领域插件冒烟测试
 *
 * 验证：4 个 Workflow 插件（ecommerce/hardware/software/xjmcu）可加载、
 * provider 可发现、ActionPrimitive 在无外部凭证时以 mock 优雅降级（不抛错）。
 *
 * 真实集成：.env.example 配置凭证（AMAZON_SP_API_KEY / AWS_* / GITHUB_TOKEN 等）后，
 * 各 action 实现应切换真实调用——本测试仅验证无凭证时骨架不崩。
 */
import { describe, it, expect } from 'vitest';

describe('L9 Workflow 插件（无凭证 mock 降级）', () => {
  it('4 个 WorkflowProvider 均可加载且暴露 actions', async () => {
    const { ecommerceWorkflowProvider } = await import('../../workflows/ecommerce/workflow-provider.js');
    const { hardwareWorkflowProvider } = await import('../../workflows/hardware/workflow-provider.js');
    const { softwareWorkflowProvider } = await import('../../workflows/software/workflow-provider.js');
    const { xjmcuWorkflowProvider } = await import('../../workflows/xjmcu/workflow-provider.js');

    const providers = [ecommerceWorkflowProvider, hardwareWorkflowProvider, softwareWorkflowProvider, xjmcuWorkflowProvider];
    for (const p of providers) {
      expect(p.name).toBeTruthy();
      expect(p.getActions().length).toBeGreaterThan(0);
      expect(typeof p.matchGoal).toBe('function');
    }
  });

  it('ecommerce ActionPrimitive：命中关键词 + mock execute 不崩', async () => {
    const { CreateListingAction } = await import('../../workflows/ecommerce/src/actions/amazon-primitives.js');
    const action = new CreateListingAction();
    expect(action.canHandle('帮我上架一个 Amazon 商品')).toBeGreaterThan(0);
    const res = await action.execute({ title: '测试商品', price: 99 }, { departmentId: 'dept_x' });
    expect(res.success).toBe(true);
    // mock 降级：返回 mock listingId，不抛错
    expect((res.data as { listingId?: string }).listingId).toMatch(/^mock_/);
  });

  it('software ActionPrimitive：mock 部署不依赖真实凭证', async () => {
    const { GithubCreateRepoAction } = await import('../../workflows/software/src/actions/software-actions.js');
    const action = new GithubCreateRepoAction();
    expect(action.canHandle('创建 github 仓库')).toBeGreaterThan(0);
    const res = await action.execute({ name: 'demo-repo' });
    expect(res.success).toBe(true);
    expect((res.data as { status?: string }).status).toBe('mock');
  });

  // 注：bootstrap.js 注册入口不在测试中直接 import——它拉入完整 Kernel 链（@morpex/contracts
  // 在测试环境不可解析）；装配层已由 bootstrapUnified + 运行中后端日志验证（4 插件已注册）。
});

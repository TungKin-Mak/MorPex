/**
 * Software Workflow Bootstrap — 注册 ActionPrimitive（理想架构第 9 层）
 *
 * 由 bootstrapUnified 在启动时调用；幂等（DomainPrimitiveRegistry 覆盖注册）。
 */
import { DomainPrimitiveRegistry } from '@morpex/core';
import { GithubCreateRepoAction, DockerBuildImageAction, CloudDeployAction } from './actions/software-actions.js';
import { registerSoftwareDetectors } from './rules/custom-detectors.js';

export async function bootstrapSoftwareWorkflow(_domain = 'software'): Promise<void> {
  DomainPrimitiveRegistry.registerMultiple([
    new GithubCreateRepoAction(),
    new DockerBuildImageAction(),
    new CloudDeployAction(),
  ]);
  registerSoftwareDetectors();
  console.log('[Workflow:software] ✅ 插件已就绪（3 个 ActionPrimitive 已注册）');
}

export default bootstrapSoftwareWorkflow;

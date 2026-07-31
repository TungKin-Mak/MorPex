/**
 * Software WorkflowProvider — 软件开发工作流插件（旧接口兼容层）
 *
 * 理想架构第 9 层：领域逻辑完全隔离在 packages/workflows/software/。
 * 此 provider 供旧 WorkflowRegistry 发现；新路径请用 src/bootstrap.ts 注册 ActionPrimitive。
 */
import type { WorkflowProvider, WorkflowAction } from '@morpex/core';
import { GithubCreateRepoAction, DockerBuildImageAction, CloudDeployAction } from './src/actions/software-actions.js';

const actions: WorkflowAction[] = [
  { name: 'github.create_repo', description: '创建 GitHub 仓库', execute: (p) => new GithubCreateRepoAction().execute(p) },
  { name: 'docker.build_image', description: '构建 Docker 镜像', execute: (p) => new DockerBuildImageAction().execute(p) },
  { name: 'cloud.deploy', description: '部署到云环境', execute: (p) => new CloudDeployAction().execute(p) },
];

export const softwareWorkflowProvider: WorkflowProvider = {
  name: 'software',
  version: '1.0.0',
  description: '软件开发工作流：GitHub、Docker、Cloud 部署',
  getActions: () => actions,
  getArtifactTypes: () => ['SourceCode', 'DockerImage', 'DeploymentConfig'],
  getValidators: () => ['CodeReviewer', 'SecurityScanner'],
  matchGoal: (goal: string) => {
    const lower = goal.toLowerCase();
    const keywords = ['software', '软件开发', 'github', 'docker', '云部署', '部署', 'repo', '代码'];
    return keywords.some((k) => lower.includes(k));
  },
};

export default softwareWorkflowProvider;

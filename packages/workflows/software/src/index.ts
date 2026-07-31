/**
 * Software Workflow — 软件开发插件（理想架构第 9 层）
 *
 * 领域逻辑完全隔离在 packages/workflows/software/。
 */
export {
  GithubCreateRepoAction,
  DockerBuildImageAction,
  CloudDeployAction,
} from './actions/software-actions.js';
export { bootstrapSoftwareWorkflow } from './bootstrap.js';

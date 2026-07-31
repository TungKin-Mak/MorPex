/**
 * Software Workflow — 软件开发插件（理想架构第 9 层）
 *
 * GitHub / Docker / Cloud 部署 ActionPrimitive（mock 实现，可替换为真实集成）。
 * 领域逻辑完全隔离在 packages/workflows/software/。
 */
import type { ActionPrimitive, ActionResult } from '@morpex/core';

export class GithubCreateRepoAction implements ActionPrimitive {
  name = 'github.create_repo';
  description = '创建 GitHub 仓库（mock）';
  inputSchema = {
    type: 'object',
    properties: {
      name: { type: 'string', description: '仓库名' },
      private: { type: 'boolean', description: '是否私有' },
    },
    required: ['name'],
  };

  canHandle(task: string): number {
    const t = task.toLowerCase();
    return /github|仓库|repo|git/.test(t) ? 0.85 : 0;
  }

  async execute(params: Record<string, unknown>, _context?: { departmentId?: string }): Promise<ActionResult> {
    const name = params.name as string | undefined;
    if (!name) return { success: false, error: 'github.create_repo: name 必填' };
    return {
      success: true,
      data: { repoName: name, private: params.private === true, url: `https://github.com/morpex/${name}`, status: 'mock' },
    };
  }
}

export class DockerBuildImageAction implements ActionPrimitive {
  name = 'docker.build_image';
  description = '构建 Docker 镜像（mock）';
  inputSchema = {
    type: 'object',
    properties: {
      image: { type: 'string', description: '镜像名' },
      tag: { type: 'string', description: '标签（默认 latest）' },
      context: { type: 'string', description: '构建上下文路径' },
    },
    required: ['image'],
  };

  canHandle(task: string): number {
    const t = task.toLowerCase();
    return /docker|镜像|image|container/.test(t) ? 0.85 : 0;
  }

  async execute(params: Record<string, unknown>, _context?: { departmentId?: string }): Promise<ActionResult> {
    const image = params.image as string | undefined;
    if (!image) return { success: false, error: 'docker.build_image: image 必填' };
    const tag = (params.tag as string) || 'latest';
    return {
      success: true,
      data: { image: `${image}:${tag}`, digest: `sha256:${Math.random().toString(16).slice(2, 66)}`, status: 'mock' },
    };
  }
}

export class CloudDeployAction implements ActionPrimitive {
  name = 'cloud.deploy';
  description = '部署到云环境（mock）';
  inputSchema = {
    type: 'object',
    properties: {
      target: { type: 'string', description: '部署目标（如 prod/staging）' },
      image: { type: 'string', description: '镜像引用' },
      replicas: { type: 'number', description: '副本数' },
    },
  };

  canHandle(task: string): number {
    const t = task.toLowerCase();
    return /deploy|部署|cloud|云|发布/.test(t) ? 0.8 : 0;
  }

  async execute(params: Record<string, unknown>, _context?: { departmentId?: string }): Promise<ActionResult> {
    const target = (params.target as string) || 'staging';
    return {
      success: true,
      data: { target, image: params.image ?? null, replicas: params.replicas ?? 1, status: 'deployed(mock)' },
    };
  }
}

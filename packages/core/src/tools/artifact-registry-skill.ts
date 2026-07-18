/**
 * artifact-registry-skill — 产物注册 AgentTool
 *
 * 将 ArtifactRegistry 封装为 AgentTool，
 * 使 Agent 产出文件后可以显式调用此工具注册产物。
 *
 * 遵循迁移铁律 0.2（类型来源法则）：所有类型从 pi 包获取。
 */

import { Type } from '../adapters/pi-ai-types.js';
import type { AgentTool } from '../adapters/pi-types.js';
import { ArtifactRegistry } from '../planes/knowledge-plane/artifacts/ArtifactRegistry.js';
import type { ArtifactInstance } from '../planes/knowledge-plane/artifacts/types.js';

/**
 * 创建产物注册工具
 *
 * @param registry - ArtifactRegistry 实例
 * @returns AgentTool
 */
export function createArtifactRegistrySkill(registry: ArtifactRegistry): AgentTool {
  return {
    name: 'save_artifact',
    label: '注册产物',
    description: '将 Agent 产出的文件注册到全局产物注册表。在完成文件产出后调用此工具注册产物。',
    parameters: Type.Object({
      name: Type.String({ description: '产物名称' }),
      type: Type.String({ description: '产物类型 (code, doc, config, data, image, other)' }),
      content: Type.String({ description: '产物内容或路径' }),
      tags: Type.Optional(Type.Array(Type.String(), { description: '标签列表' })),
    }),
    execute: async (_toolCallId: string, params: unknown) => {
      const { name, type, content, tags } = params as { name: string; type: string; content: string; tags?: string[] };
      try {
        const now = Date.now();
        const artifact: ArtifactInstance = {
          id: `art_${now}_${Math.random().toString(36).slice(2, 10)}`,
          name: name,
          type: type as any,
          content: content,
          version: 1,
          status: 'draft',
          createdAt: now,
          updatedAt: now,
          metadata: { source: 'agent-tool', tags: tags ?? [] },
        };

        await registry.register(artifact);
        console.log(`[save_artifact] ✅ 已注册: ${artifact.id} (${name})`);

        return {
          content: [{ type: 'text' as const, text: `产物已注册: ${artifact.id} (${name})` }],
          details: { success: true, artifactId: artifact.id, name: name },
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `注册产物失败: ${err.message}` }],
          details: { success: false, error: err.message },
        };
      }
    },
  };
}

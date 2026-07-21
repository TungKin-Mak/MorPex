/**
 * artifact-registry-skill — 产物注册 AgentTool (Phase 11: Harness-aware)
 *
 * 将 ArtifactRegistry 封装为 AgentTool。
 * 优先通过 AgentHarness 注册（权限+上下文），回退到直接 registry 访问。
 */

import { Type } from '../adapters/pi-ai-types.js';
import type { AgentTool } from '../adapters/pi-types.js';
import { ArtifactRegistry } from '../planes/knowledge-plane/artifacts/ArtifactRegistry.js';
import type { ArtifactInstance } from '../planes/knowledge-plane/artifacts/types.js';
import type { AgentHarness } from '../planes/agent-plane/AgentHarness.js';

export function createArtifactRegistrySkill(
  registry: ArtifactRegistry,
  harness?: AgentHarness | null,
): AgentTool {
  return {
    name: 'save_artifact',
    label: '注册产物',
    description: '将 Agent 产出的文件注册到全局产物注册表。',
    parameters: Type.Object({
      name: Type.String({ description: '产物名称' }),
      type: Type.String({ description: '产物类型 (code, doc, config, data, image, other)' }),
      content: Type.String({ description: '产物内容或路径' }),
      tags: (Type as any).Optional(Type.Array(Type.String({ description: '标签列表' }))),
    }),
    execute: async (_toolCallId: string, params: unknown) => {
      const { name, type, content, tags } = params as { name: string; type: string; content: string; tags?: string[] };
      try {
        // Phase 11: Harness-first path
        if (harness?.isInitialized) {
          const result = await harness.registerArtifact({ name, type, content, tags });
          return {
            content: [{ type: 'text' as const, text: `产物已注册(通过Harness): ${result.id} (${name})` }],
            details: { success: true, artifactId: result.id, name, path: 'harness' },
          };
        }
        // Fallback: direct registry access
        const now = Date.now();
        const artifact: ArtifactInstance = {
          id: `art_${now}_${Math.random().toString(36).slice(2, 10)}`,
          name, type: type as any, content,
          version: 1, status: 'draft', createdAt: now, updatedAt: now,
          metadata: { source: 'agent-tool', tags: tags ?? [] },
        };
        await registry.register(artifact);
        return {
          content: [{ type: 'text' as const, text: `产物已注册: ${artifact.id} (${name})` }],
          details: { success: true, artifactId: artifact.id, name },
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

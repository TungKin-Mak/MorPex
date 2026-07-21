/**
 * ReadArtifactTool — 按需读取 Artifact 工具 (Phase 11: Harness-aware)
 *
 * 优先通过 AgentHarness 读取（权限检查），回退到直接 ArtifactRegistry 访问。
 */

import type { AgentTool, AgentToolResult as _AgentToolResult } from '../adapters/pi-types.js';
type AgentToolResultAny = _AgentToolResult;
import { Type, optionalProp } from '../adapters/pi-ai-types.js';
import { ArtifactRegistry } from '../planes/knowledge-plane/artifacts/ArtifactRegistry.js';
import type { ArtifactInstance } from '../planes/knowledge-plane/artifacts/types.js';
import type { AgentHarness } from '../planes/agent-plane/AgentHarness.js';

export class ReadArtifactTool implements AgentTool {
  name = 'ReadArtifact';
  label = '读取产物';
  description = '按需读取上游产物的指定章节。产物 URI 格式: artifact://{domain}/{type}/{id}';

  parameters = Type.Object({
    uri: Type.String({ description: '产物 URI' }),
    section: optionalProp(Type.String({ description: '章节名，不指定时返回摘要' })),
  });

  private registry: ArtifactRegistry;
  private harness: AgentHarness | null;

  constructor(registry: ArtifactRegistry, harness?: AgentHarness | null) {
    this.registry = registry;
    this.harness = harness ?? null;
  }

  async execute(
    _toolCallId: string,
    params: unknown,
    _signal?: AbortSignal,
    _onUpdate?: ((data: unknown) => void),
  ): Promise<AgentToolResultAny> {
    const { uri, section } = (params || {}) as { uri: string; section?: string };

    const parsed = ArtifactRegistry.parseURI(uri);
    if (!parsed) {
      throw new Error(`无效的 Artifact URI: "${uri}"。格式应为 artifact://{domain}/{type}/{id}`);
    }

    // Phase 11: Harness-first path (with permission check)
    let artifact: ArtifactInstance | null = null;
    if (this.harness?.isInitialized) {
      artifact = this.harness.getArtifact(uri) as ArtifactInstance | null;
    }
    // Fallback
    if (!artifact) {
      artifact = this.registry.resolve(uri) ?? null;
    }
    if (!artifact) {
      throw new Error(`产物不存在: ${uri}`);
    }

    const content = section
      ? this.extractSection(artifact.content, section)
      : this.getSummary(artifact);

    const availableSections = this.getSections(artifact.content);

    return {
      content: [{ type: 'text' as const, text: this.formatContent(artifact, content, section) }],
      details: {
        artifactId: artifact.id, artifactType: artifact.type,
        domain: parsed.domain, version: artifact.version, status: artifact.status,
        fullSize: typeof artifact.content === 'string' ? artifact.content.length : JSON.stringify(artifact.content).length,
        availableSections,
        path: this.harness?.isInitialized ? 'harness' : 'direct',
      },
    };
  }

  private getSummary(artifact: ArtifactInstance): string {
    const content = artifact.content;
    if (typeof content === 'string') {
      return content.length > 500
        ? content.substring(0, 500) + `\n\n... [共 ${content.length} 字符，使用 section 参数读取特定章节]`
        : content;
    }
    if (typeof content === 'object' && content !== null) {
      const keys = Object.keys(content);
      const summary: Record<string, any> = {};
      for (const key of keys.slice(0, 5)) {
        summary[key] = typeof content[key] === 'string' && content[key].length > 200
          ? content[key].substring(0, 200) + '...'
          : content[key];
      }
      return JSON.stringify(summary, null, 2) +
        `\n\n... [共 ${keys.length} 个字段，使用 section 参数读取特定章节]`;
    }
    return String(content);
  }

  private extractSection(content: string | Record<string, unknown>, section: string): string {
    if (typeof content === 'string') {
      const sectionRegex = new RegExp(`##+\\s*${this.escapeRegex(section)}[\\s\\S]*?(?=\\n##+|$)`, 'i');
      const match = content.match(sectionRegex);
      if (match) return match[0].trim();
      const lines = content.split('\n');
      const sectionLines: string[] = [];
      let inSection = false;
      for (const line of lines) {
        if (line.toLowerCase().includes(section.toLowerCase())) inSection = true;
        if (inSection) {
          sectionLines.push(line);
          if (line.trim().startsWith('---') || (line.trim() === '' && sectionLines.length > 20)) break;
        }
      }
      if (sectionLines.length > 0) return sectionLines.join('\n');
    }
    if (typeof content === 'object' && content !== null) {
      const sectionKey = Object.keys(content).find(k => k.toLowerCase() === section.toLowerCase());
      if (sectionKey) {
        const val = content[sectionKey];
        return typeof val === 'string' ? val : JSON.stringify(val, null, 2);
      }
    }
    return `章节 "${section}" 未找到。可用章节: ${this.getSections(content).join(', ')}`;
  }

  private getSections(content: string | Record<string, unknown>): string[] {
    if (typeof content === 'string') {
      const headings = content.match(/^##+\s+(.+)$/gm);
      return headings ? headings.map(h => h.replace(/^##+\s+/, '').trim()) : ['（全文）'];
    }
    if (typeof content === 'object' && content !== null) return Object.keys(content);
    return [];
  }

  private formatContent(artifact: ArtifactInstance, content: string, section?: string): string {
    const header = `📄 ${artifact.name} (v${artifact.version})\n` +
      `类型: ${artifact.type}  |  状态: ${artifact.status}\nID: ${artifact.id}\n`;
    return section ? `${header}\n─── ${section} ───\n\n${content}` : `${header}\n─── 摘要 ───\n\n${content}`;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

export function createReadArtifactTool(
  registry: ArtifactRegistry,
  harness?: AgentHarness | null,
): ReadArtifactTool {
  return new ReadArtifactTool(registry, harness);
}

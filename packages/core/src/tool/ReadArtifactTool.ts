/**
 * ReadArtifactTool — 按需读取 Artifact 工具（Lazy VFS）
 *
 * 下游 Agent 的 systemPrompt 注入产物摘要 + ReadArtifact 工具。
 * LLM 需要细节时按 section 惰性加载，避免一次性加载大产物。
 *
 * URI 格式: artifact://{domain}/{artifactType}/{artifactId}
 *
 * 遵循迁移铁律：
 *   0.2 (类型来源法则): 类型基于 pi-agent-core 扩展
 *   0.4 (删除优先法则): 使用已有的 ArtifactRegistry 而非重写
 */

import type { AgentTool, AgentToolResult } from '../adapters/pi-types.js';
import { Type } from '../adapters/pi-ai-types.js';
import { ArtifactRegistry } from '../planes/knowledge-plane/artifacts/ArtifactRegistry.js';

/**
 * ReadArtifactTool — 按需读取 Artifact
 *
 * 用法：
 *   const tool = new ReadArtifactTool(artifactRegistry);
 *   // 注册到 AgentHarness 的工具列表
 */
export class ReadArtifactTool implements AgentTool {
  name = 'ReadArtifact';
  label = '读取产物';
  description = '按需读取上游产物的指定章节。产物 URI 格式: artifact://{domain}/{type}/{id}';

  parameters = Type.Object({
    uri: Type.String({ description: '产物 URI，格式: artifact://{domain}/{type}/{id}' }),
    section: Type.Optional(Type.String({ description: '章节名，如 BOM/PCB/Firmware。不指定时返回摘要' })),
  });

  private registry: ArtifactRegistry;

  constructor(registry: ArtifactRegistry) {
    this.registry = registry;
  }

  async execute(
    _toolCallId: string,
    params: unknown,
    _signal?: AbortSignal,
    _onUpdate?: any,
  ): Promise<AgentToolResult<any>> {
    const { uri, section } = (params || {}) as { uri: string; section?: string };

    // 解析 URI
    const parsed = ArtifactRegistry.parseURI(uri);
    if (!parsed) {
      throw new Error(`无效的 Artifact URI: "${uri}"。格式应为 artifact://{domain}/{type}/{id}`);
    }

    // 解析 Artifact
    const artifact = this.registry.resolve(uri);
    if (!artifact) {
      throw new Error(`产物不存在: ${uri}`);
    }

    // 按 section 或返回摘要
    const content = section
      ? this.extractSection(artifact.content, section)
      : this.getSummary(artifact);

    // 提取可用章节列表
    const availableSections = this.getSections(artifact.content);

    return {
      content: [{ type: 'text' as const, text: this.formatContent(artifact, content, section) }],
      details: {
        artifactId: artifact.id,
        artifactType: artifact.type,
        domain: parsed.domain,
        version: artifact.version,
        status: artifact.status,
        fullSize: typeof artifact.content === 'string' ? artifact.content.length : JSON.stringify(artifact.content).length,
        availableSections,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════════

  /**
   * getSummary — 获取产物摘要
   */
  private getSummary(artifact: any): string {
    const content = artifact.content;

    // 如果内容是字符串，取前 500 字符作为摘要
    if (typeof content === 'string') {
      return content.length > 500
        ? content.substring(0, 500) + `\n\n... [共 ${content.length} 字符，使用 section 参数读取特定章节]`
        : content;
    }

    // 如果内容是对象，尝试提取 summary 或前几个字段
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

  /**
   * extractSection — 提取产物的指定章节
   */
  private extractSection(content: any, section: string): string {
    if (typeof content === 'string') {
      // 尝试按 Markdown 标题分割
      const sectionRegex = new RegExp(`##+\\s*${this.escapeRegex(section)}[\\s\\S]*?(?=\\n##+|$)`, 'i');
      const match = content.match(sectionRegex);
      if (match) return match[0].trim();

      // 尝试按关键词搜索
      const lines = content.split('\n');
      const sectionLines: string[] = [];
      let inSection = false;
      for (const line of lines) {
        if (line.toLowerCase().includes(section.toLowerCase())) {
          inSection = true;
        }
        if (inSection) {
          sectionLines.push(line);
          if (line.trim().startsWith('---') || (line.trim() === '' && sectionLines.length > 20)) {
            break;
          }
        }
      }
      if (sectionLines.length > 0) return sectionLines.join('\n');
    }

    if (typeof content === 'object' && content !== null) {
      const sectionKey = Object.keys(content).find(
        k => k.toLowerCase() === section.toLowerCase()
      );
      if (sectionKey) {
        const val = content[sectionKey];
        return typeof val === 'string' ? val : JSON.stringify(val, null, 2);
      }
    }

    return `章节 "${section}" 未找到。可用章节: ${this.getSections(content).join(', ')}`;
  }

  /**
   * getSections — 获取产物的可用章节列表
   */
  private getSections(content: any): string[] {
    if (typeof content === 'string') {
      const headings = content.match(/^##+\s+(.+)$/gm);
      return headings
        ? headings.map(h => h.replace(/^##+\s+/, '').trim())
        : ['（全文）'];
    }
    if (typeof content === 'object' && content !== null) {
      return Object.keys(content);
    }
    return [];
  }

  /**
   * formatContent — 格式化输出内容
   */
  private formatContent(artifact: any, content: string, section?: string): string {
    const header = `📄 ${artifact.name} (v${artifact.version})\n` +
      `类型: ${artifact.type}  |  状态: ${artifact.status}\n` +
      `ID: ${artifact.id}\n`;

    if (section) {
      return `${header}\n─── ${section} ───\n\n${content}`;
    }

    return `${header}\n─── 摘要 ───\n\n${content}`;
  }

  /**
   * escapeRegex — 转义正则特殊字符
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

/**
 * createReadArtifactTool — ReadArtifact 工厂函数
 */
export function createReadArtifactTool(registry: ArtifactRegistry): ReadArtifactTool {
  return new ReadArtifactTool(registry);
}

/**
 * FileSystemConnector — v11 File System Connector
 *
 * Provides safe, validated access to the file system.
 * All paths are validated against the allowed root to prevent path traversal.
 *
 * Capabilities:
 *   - fs.read: Read file contents
 *   - fs.write: Write file contents
 *   - fs.delete: Delete a file
 *   - fs.list: List directory contents
 *   - fs.exists: Check if file exists
 *   - fs.mkdir: Create directory
 *   - fs.copy: Copy file or directory
 *   - fs.move: Move file or directory
 *   - fs.stat: Get file stats
 *
 * @packageDocumentation
 */

import { BaseConnector } from './BaseConnector.js';
import type { ConnectorCapability } from './types.js';

const CAPABILITIES: ConnectorCapability[] = [
  {
    name: 'fs.read',
    description: 'Read file contents as string',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
    destructive: false,
  },
  {
    name: 'fs.write',
    description: 'Write content to a file',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        encoding: { type: 'string', enum: ['utf-8', 'base64'] },
      },
      required: ['path', 'content'],
    },
    destructive: true,
  },
  {
    name: 'fs.delete',
    description: 'Delete a file',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
    destructive: true,
    requiresApproval: true,
  },
  {
    name: 'fs.list',
    description: 'List directory contents',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        recursive: { type: 'boolean' },
      },
      required: ['path'],
    },
    destructive: false,
  },
  {
    name: 'fs.exists',
    description: 'Check if a file or directory exists',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
    destructive: false,
  },
  {
    name: 'fs.mkdir',
    description: 'Create a directory',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        recursive: { type: 'boolean' },
      },
      required: ['path'],
    },
    destructive: false,
  },
  {
    name: 'fs.copy',
    description: 'Copy file or directory',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string' },
        destination: { type: 'string' },
      },
      required: ['source', 'destination'],
    },
    destructive: false,
  },
  {
    name: 'fs.move',
    description: 'Move file or directory',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string' },
        destination: { type: 'string' },
      },
      required: ['source', 'destination'],
    },
    destructive: true,
  },
  {
    name: 'fs.stat',
    description: 'Get file or directory stats',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
    destructive: false,
  },
];

/**
 * FileSystemConnector — Safe file system operations
 *
 * All paths are resolved relative to the allowed root.
 * Path traversal attacks are prevented by strict validation.
 */
export class FileSystemConnector extends BaseConnector {
  private allowedRoot: string;
  private fs: typeof import('node:fs/promises') | null = null;

  constructor(allowedRoot: string = process.cwd()) {
    super('filesystem', 'File System Connector', '1.0.0', CAPABILITIES);
    this.allowedRoot = allowedRoot;
  }

  async initialize(): Promise<void> {
    this.fs = await import('node:fs/promises');
    this.initialized = true;
  }

  protected async executeAction(action: string, params: Record<string, unknown>): Promise<unknown> {
    const fs = this.fs ?? await import('node:fs/promises');

    switch (action) {
      case 'fs.read': {
        const safePath = this.resolvePath(params.path as string);
        return fs.readFile(safePath, 'utf-8');
      }

      case 'fs.write': {
        const safePath = this.resolvePath(params.path as string);
        const content = params.content as string;
        const encoding = (params.encoding as string) ?? 'utf-8';
        await fs.writeFile(safePath, content, encoding as BufferEncoding);
        return { path: safePath, size: content.length };
      }

      case 'fs.delete': {
        const safePath = this.resolvePath(params.path as string);
        await fs.unlink(safePath);
        return { deleted: safePath };
      }

      case 'fs.list': {
        const safePath = this.resolvePath(params.path as string);
        const recursive = params.recursive as boolean ?? false;
        if (recursive) {
          const entries: string[] = [];
          await this.walkDir(fs, safePath, entries);
          return entries;
        }
        return fs.readdir(safePath);
      }

      case 'fs.exists': {
        const safePath = this.resolvePath(params.path as string);
        return fs.stat(safePath).then(() => true).catch(() => false);
      }

      case 'fs.mkdir': {
        const safePath = this.resolvePath(params.path as string);
        const recursive = params.recursive as boolean ?? false;
        await fs.mkdir(safePath, { recursive });
        return { path: safePath };
      }

      case 'fs.copy': {
        const source = this.resolvePath(params.source as string);
        const dest = this.resolvePath(params.destination as string);
        await fs.cp(source, dest, { recursive: true });
        return { source, destination: dest };
      }

      case 'fs.move': {
        const source = this.resolvePath(params.source as string);
        const dest = this.resolvePath(params.destination as string);
        await fs.rename(source, dest);
        return { source, destination: dest };
      }

      case 'fs.stat': {
        const safePath = this.resolvePath(params.path as string);
        const stat = await fs.stat(safePath);
        return {
          size: stat.size,
          isDirectory: stat.isDirectory(),
          isFile: stat.isFile(),
          created: stat.birthtime,
          modified: stat.mtime,
          mode: stat.mode,
        };
      }

      default:
        throw new Error(`Unsupported action: ${action}`);
    }
  }

  /**
   * resolvePath — Resolve and validate a path against the allowed root
   *
   * Prevents path traversal attacks by ensuring the resolved path
   * stays within the allowed root directory.
   */
  private resolvePath(inputPath: string): string {
    const pathMod = requireNodePath();
    const resolved = pathMod.resolve(this.allowedRoot, inputPath);

    // Ensure the resolved path is within the allowed root
    if (!resolved.startsWith(this.allowedRoot)) {
      throw new Error(`Path traversal detected: "${inputPath}" resolves outside allowed root`);
    }

    return resolved;
  }

  /**
   * walkDir — Recursively walk a directory
   */
  private async walkDir(
    fs: typeof import('node:fs/promises'),
    dir: string,
    entries: string[]
  ): Promise<void> {
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = `${dir}/${item.name}`;
      entries.push(fullPath);
      if (item.isDirectory()) {
        await this.walkDir(fs, fullPath, entries);
      }
    }
  }
}

/**
 * requireNodePath — Get the Node.js path module
 */
function requireNodePath(): typeof import('node:path') {
  // Use dynamic import to avoid ESM issues
  const pathMod = {
    resolve: (...paths: string[]): string => {
      const { resolve } = requireActualPath();
      return resolve(...paths);
    },
  };
  return pathMod as typeof import('node:path');
}

function requireActualPath(): typeof import('node:path') {
  // Inline path.resolve that handles the common cases
  const { resolve } = (() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('node:path');
      return path;
    } catch (err) {
      console.warn('FileSystemConnector: node:path require failed, using fallback path resolution', err);
      return {
        resolve: (...paths: string[]): string => {
          let result = '';
          for (const p of paths) {
            if (!p) continue;
            if (p.startsWith('/')) {
              result = p;
            } else if (result.length > 0 && !result.endsWith('/')) {
              result += '/';
              result += p;
            } else {
              result += p;
            }
          }
          return result || '.';
        },
      };
    }
  })();
  return resolve;
}

type BufferEncoding = 'utf-8' | 'base64' | 'utf8' | 'ascii' | 'hex';

/**
 * ArtifactRegistry — Artifact 注册中心 (v2: 支持 URI 引用)
 *
 * Phase 11.3 升级：标准化 URI 格式
 *   - URI 格式: artifact://{domain}/{artifactType}/{artifactId}
 *   - resolve(uri) — 通过 URI 解析 ArtifactInstance
 *   - listByDomain(domainId) — 列出指定领域的所有产物
 *
 * 管理所有 Artifact 的注册、查找、追踪。
 * 维护 Artifact 图谱（parent / child / supersedes）。
 * 通过 EventBus 广播 artifact.* 事件。
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  ArtifactInstance,
  ArtifactType,
  ArtifactStatus,
  ArtifactQuery,
  ArtifactRelation,
  ArtifactRelationRecord,
  ArtifactVersion,
  ArtifactPluginConfig,
} from './types.js';
import { createVersionSnapshot } from './ArtifactVersion.js';
import { ExecutionIdentity } from '../../../common/ExecutionIdentity.js';
import { AsyncResourceLocker, VersionConflictError } from '../../../utils/AsyncResourceLocker.js';

/** URI 解析结果 */
export interface ArtifactURIResult {
  domain: string;
  artifactType: string;
  artifactId: string;
  uri: string;
}

/** 注册中心配置 */
interface RegistryConfig {
  maxVersions: number;
}

/**
 * ArtifactRegistry — 注册中心 (v2)
 *
 * 负责 Artifact 的生命周期管理。
 * Phase 11.3: 支持标准化 URI 引用。
 */
export class ArtifactRegistry {
  private artifacts: Map<string, ArtifactInstance> = new Map();
  private versions: Map<string, ArtifactVersion[]> = new Map(); // artifactId → versions
  private relations: ArtifactRelationRecord[] = [];
  /** 按领域索引: domainId → ArtifactInstance[] */
  private domainIndex: Map<string, ArtifactInstance[]> = new Map();
  private config: RegistryConfig;
  private dataDir: string;

  /** 事件回调 */
  onArtifactCreated: ((artifact: ArtifactInstance) => void) | null = null;
  onArtifactUpdated: ((artifact: ArtifactInstance, prevVersion: number) => void) | null = null;
  onArtifactStatusChanged: ((artifactId: string, status: ArtifactStatus, prevStatus: ArtifactStatus) => void) | null = null;
  onRelationCreated: ((relation: ArtifactRelationRecord) => void) | null = null;

  /** URI 协议常量 */
  static readonly URI_SCHEME = 'artifact://';

  /** L1: per-resource async mutex for concurrent write isolation */
  private _locker: AsyncResourceLocker;
  private _externalLocker: boolean;

  /** P3: 自动持久化 — 延迟刷盘定时器 */
  private _dirty = false;
  private _autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly AUTO_SAVE_DELAY_MS = 2000;

  constructor(config?: ArtifactPluginConfig, locker?: AsyncResourceLocker) {
    this.config = {
      maxVersions: config?.maxVersions ?? 10,
    };
    this.dataDir = config?.dataDir ?? './data/artifacts';
    this._locker = locker ?? new AsyncResourceLocker();
    this._externalLocker = !!locker;
  }

  /** P3: 标记脏数据并调度自动刷盘（最后一次变更后 2s） */
  private _scheduleAutoSave(): void {
    this._dirty = true;
    if (this._autoSaveTimer) clearTimeout(this._autoSaveTimer);
    this._autoSaveTimer = setTimeout(() => {
      this.saveToDisk().catch(err => {
        console.error('[ArtifactRegistry] 自动刷盘失败:', err.message);
      });
    }, this.AUTO_SAVE_DELAY_MS);
  }

  // ── 注册 ──

  /** 注册 Artifact（可指定所属领域） */
  async register(artifact: ArtifactInstance, domainId?: string): Promise<void> {
    await this._locker.withLock(artifact.id, async () => {
      if (this.artifacts.has(artifact.id)) {
        throw new Error(`Artifact ${artifact.id} 已注册`);
      }

      this.artifacts.set(artifact.id, artifact);

      // 按领域索引
      if (domainId) {
        if (!this.domainIndex.has(domainId)) {
          this.domainIndex.set(domainId, []);
        }
        this.domainIndex.get(domainId)!.push(artifact);
      }

      // 创建初始版本快照
      const version = createVersionSnapshot(artifact, '初始版本');
      this.versions.set(artifact.id, [version]);

      this.onArtifactCreated?.(artifact);
      this._scheduleAutoSave();
    });
  }

  /** 更新 Artifact，支持乐观锁 expectedVersion */
  async update(artifact: ArtifactInstance, changeLog?: string, expectedVersion?: number): Promise<void> {
    await this._locker.withLock(artifact.id, async () => {
      const existing = this.artifacts.get(artifact.id);
      if (!existing) {
        throw new Error(`Artifact ${artifact.id} 未注册`);
      }

      // L2: 乐观锁 — 如果调用方传了 expectedVersion，校验当前版本
      if (expectedVersion !== undefined && existing.version !== expectedVersion) {
        throw new VersionConflictError(artifact.id, expectedVersion, existing.version);
      }

      const prevVersion = existing.version;
      const prevStatus = existing.status;

      this.artifacts.set(artifact.id, artifact);

      // 创建版本快照
      const version = createVersionSnapshot(artifact, changeLog);
      const versions = this.versions.get(artifact.id) ?? [];
      versions.push(version);

      // 限制版本数
      while (versions.length > this.config.maxVersions) {
        versions.shift();
      }

      this.versions.set(artifact.id, versions);

      this.onArtifactUpdated?.(artifact, prevVersion);

      if (prevStatus !== artifact.status) {
        this.onArtifactStatusChanged?.(artifact.id, artifact.status, prevStatus);
      }

      this._scheduleAutoSave();
    });
  }

  // ── 查询 ──

  /** 获取 Artifact */
  get(id: string): ArtifactInstance | undefined {
    return this.artifacts.get(id);
  }

  /** 搜索 Artifact */
  search(query: ArtifactQuery): ArtifactInstance[] {
    let results = [...this.artifacts.values()];

    if (query.type) results = results.filter(a => a.type === query.type);
    if (query.status) results = results.filter(a => a.status === query.status);
    if (query.name) results = results.filter(a => a.name.includes(query.name!));
    if (query.createdBy) results = results.filter(a => a.createdBy === query.createdBy);

    // 排序：最新的在前
    results.sort((a, b) => b.createdAt - a.createdAt);

    const offset = query.offset ?? 0;
    const limit = query.limit ?? results.length;
    return results.slice(offset, offset + limit);
  }

  /** 获取所有 Artifact */
  getAll(): ArtifactInstance[] {
    return [...this.artifacts.values()];
  }

  /** 获取 Artifact 的版本历史 */
  getVersions(artifactId: string): ArtifactVersion[] {
    return [...(this.versions.get(artifactId) ?? [])];
  }

  /** 获取 Artifact 数量 */
  get count(): number {
    return this.artifacts.size;
  }

  // ── 图谱 ──

  /** 创建 Artifact 关系 */
  createRelation(from: string, to: string, type: ArtifactRelation): void {
    if (!this.artifacts.has(from) || !this.artifacts.has(to)) {
      throw new Error('关系两端 Artifact 必须已注册');
    }

    const relation: ArtifactRelationRecord = {
      from, to, type, createdAt: Date.now(),
    };

    this.relations.push(relation);
    this.onRelationCreated?.(relation);
    this._scheduleAutoSave();
  }

  /** 获取 Artifact 的关系 */
  getRelations(artifactId: string): ArtifactRelationRecord[] {
    return this.relations.filter(r => r.from === artifactId || r.to === artifactId);
  }

  /** 获取 Artifact 的图谱（父子链） */
  getGraph(artifactId: string): { parents: string[]; children: string[]; supersedes: string[] } {
    const parents: string[] = [];
    const children: string[] = [];
    const supersedes: string[] = [];

    for (const r of this.relations) {
      if (r.from === artifactId && r.type === 'child') children.push(r.to);
      if (r.to === artifactId && r.type === 'parent') parents.push(r.from);
      if (r.from === artifactId && r.type === 'supersedes') supersedes.push(r.to);
    }

    return { parents, children, supersedes };
  }

  // ── Phase 11.3: 标准化 URI 引用 ──

  /**
   * buildURI — 构建标准化 Artifact URI
   *
   * 格式: artifact://{domain}/{artifactType}/{artifactId}
   */
  static buildURI(domain: string, artifactType: string, artifactId: string): string {
    return `${ArtifactRegistry.URI_SCHEME}${domain}/${artifactType}/${artifactId}`;
  }

  /**
   * parseURI — 解析标准化 Artifact URI
   */
  static parseURI(uri: string): ArtifactURIResult | null {
    if (!uri.startsWith(ArtifactRegistry.URI_SCHEME)) {
      return null;
    }
    const rest = uri.slice(ArtifactRegistry.URI_SCHEME.length);
    const parts = rest.split('/');
    if (parts.length < 3) {
      return null;
    }
    return {
      domain: parts[0],
      artifactType: parts[1],
      artifactId: parts.slice(2).join('/'),
      uri,
    };
  }

  /**
   * resolve — 通过 URI 解析 ArtifactInstance
   */
  resolve(uri: string): ArtifactInstance | undefined {
    const parsed = ArtifactRegistry.parseURI(uri);
    if (!parsed) return undefined;
    return this.artifacts.get(parsed.artifactId);
  }

  /**
   * listByDomain — 列出指定领域的所有产物
   */
  listByDomain(domainId: string): ArtifactInstance[] {
    return [...(this.domainIndex.get(domainId) ?? [])];
  }

  // ── 统计 ──

  /** 获取按类型分组的统计 */
  getStatsByType(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const a of this.artifacts.values()) {
      stats[a.type] = (stats[a.type] ?? 0) + 1;
    }
    return stats;
  }

  // ── 持久化 ──

  /**
   * saveToDisk — 保存所有 Artifact 和关系到 JSONL 文件
   */
  async saveToDisk(): Promise<void> {
    // P3: 取消待处理的自动刷盘定时器
    if (this._autoSaveTimer) {
      clearTimeout(this._autoSaveTimer);
      this._autoSaveTimer = null;
    }
    this._dirty = false;

    const dir = path.resolve(this.dataDir);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 写入 artifacts
    const artFile = path.join(dir, 'artifacts.jsonl');
    const artLines: string[] = [];
    for (const artifact of this.artifacts.values()) {
      artLines.push(JSON.stringify(artifact));
    }
    fs.writeFileSync(artFile, artLines.join('\n') + '\n', 'utf-8');

    // 写入关系
    const relFile = path.join(dir, 'relations.jsonl');
    const relLines: string[] = [];
    for (const relation of this.relations) {
      relLines.push(JSON.stringify(relation));
    }
    fs.writeFileSync(relFile, relLines.join('\n') + '\n', 'utf-8');
  }

  /**
   * loadFromDisk — 从 JSONL 文件加载 Artifact 和关系
   *
   * @returns 加载统计 { artifacts, relations }
   */
  async loadFromDisk(): Promise<{ artifacts: number; relations: number }> {
    let artifactCount = 0;
    let relationCount = 0;

    const dir = path.resolve(this.dataDir);
    if (!fs.existsSync(dir)) {
      return { artifacts: 0, relations: 0 };
    }

    // 加载 artifacts
    const artFile = path.join(dir, 'artifacts.jsonl');
    if (fs.existsSync(artFile)) {
      const content = fs.readFileSync(artFile, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const artifact: ArtifactInstance = JSON.parse(line);
          if (!this.artifacts.has(artifact.id)) {
            this.artifacts.set(artifact.id, artifact);
            // 重建版本初始快照
            const version = createVersionSnapshot(artifact, '从磁盘加载');
            this.versions.set(artifact.id, [version]);
            artifactCount++;
          }
        } catch { /* 跳过损坏行 */ }
      }
    }

    // 加载关系
    const relFile = path.join(dir, 'relations.jsonl');
    if (fs.existsSync(relFile)) {
      const content = fs.readFileSync(relFile, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const relation: ArtifactRelationRecord = JSON.parse(line);
          if (this.artifacts.has(relation.from) && this.artifacts.has(relation.to)) {
            this.relations.push(relation);
            relationCount++;
          }
        } catch { /* 跳过损坏行 */ }
      }
    }

    console.log(`[ArtifactRegistry] ✅ 从磁盘加载: ${artifactCount} 个 Artifact, ${relationCount} 个关系`);
    return { artifacts: artifactCount, relations: relationCount };
  }

  /** 清空所有数据 */
  clear(): void {
    // P3: 取消自动刷盘定时器
    if (this._autoSaveTimer) {
      clearTimeout(this._autoSaveTimer);
      this._autoSaveTimer = null;
    }
    this._dirty = false;

    this.artifacts.clear();
    this.versions.clear();
    this.relations = [];
    this.domainIndex.clear();
  }

  // ── 静态工厂方法 ──

  private static _identity = new ExecutionIdentity();

  /** 创建 Artifact Instance */
  static createArtifact(overrides: {
    name: string;
    type: ArtifactType;
    content: any;
    sourceNodeId?: string;
    sourceToolCallId?: string;
    createdBy?: string;
    metadata?: Record<string, any>;
  }): ArtifactInstance {
    const now = Date.now();
    return {
      id: ArtifactRegistry._identity.createArtifactId(),
      name: overrides.name,
      type: overrides.type,
      content: overrides.content,
      sourceNodeId: overrides.sourceNodeId,
      sourceToolCallId: overrides.sourceToolCallId,
      version: 1,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      createdBy: overrides.createdBy,
      metadata: overrides.metadata,
    };
  }

  /** 更新 Artifact 内容（自动升级版本） */
  static updateContent(artifact: ArtifactInstance, newContent: any): ArtifactInstance {
    return { ...artifact, content: newContent, version: artifact.version + 1, status: 'draft' as ArtifactStatus, updatedAt: Date.now() };
  }

  /** 变更 Artifact 状态 */
  static changeStatus(artifact: ArtifactInstance, newStatus: ArtifactStatus): ArtifactInstance {
    return { ...artifact, status: newStatus, updatedAt: Date.now() };
  }
}

export { VersionConflictError } from '../../../utils/AsyncResourceLocker.js';

/**
 * ArtifactPlane — 产物管理平面（门面）
 *
 * v9.1: 独立产物管理平面的统一入口。
 *
 * 提供对产物生命周期的完整管理能力：
 *   - 创建、查询、归档、废弃
 *   - 两阶段提交（stage → verify → commit）
 *   - 版本管理
 *   - 血缘追踪
 *   - 事件监听
 *
 * 使用方式：
 *   const plane = new ArtifactPlane()
 *   const artifact = plane.create({ meta: { name: 'report.pdf', type: 'document' }, content: '...', createdBy: 'alice' })
 *   const stageId = plane.stage(artifact.id, 'new content', 'alice')
 *   await plane.verify(stageId)
 *   const updated = plane.commit(stageId, 'Fixed typo')
 */

import type { ArtifactRecord, ArtifactQuery, ArtifactMeta, ArtifactEventType, ArtifactEvent } from './types.js'
import type { CreateArtifactInput, ArtifactManagerConfig } from './ArtifactManager.js'
import { ArtifactManager } from './ArtifactManager.js'
import { ArtifactRepository } from './ArtifactRepository.js'
import { ArtifactStagingArea } from './ArtifactStagingArea.js'
import { ArtifactValidator } from './ArtifactValidator.js'
import { ArtifactVerifier } from './ArtifactVerifier.js'
import { ArtifactVersionService } from './ArtifactVersionService.js'
import { ArtifactEventEmitter } from './ArtifactEventEmitter.js'
import { ArtifactLineageTracker } from './ArtifactLineageTracker.js'
import type { LineageRelation, LineagePath } from './ArtifactLineageTracker.js'

// ── EventCallback — 事件回调 ──

export type ArtifactPlaneEventCallback = (event: ArtifactEvent) => void

// ── ArtifactPlaneConfig ──

export interface ArtifactPlaneConfig {
  manager?: Partial<ArtifactManagerConfig>
}

// ── ArtifactPlane ──

export class ArtifactPlane {
  private manager: ArtifactManager
  private lineageTracker: ArtifactLineageTracker

  constructor(config?: ArtifactPlaneConfig) {
    this.manager = new ArtifactManager(
      undefined, undefined, undefined, undefined, undefined, undefined,
      config?.manager
    )
    this.lineageTracker = new ArtifactLineageTracker()
  }

  // ═══════════════════════════════════════════════════════════════
  // 产物 CRUD
  // ═══════════════════════════════════════════════════════════════

  /**
   * create — 创建产物
   */
  create(input: CreateArtifactInput): ArtifactRecord {
    const record = this.manager.create(input)
    return record
  }

  /**
   * get — 获取产物
   */
  get(id: string): ArtifactRecord | undefined {
    return this.manager.get(id)
  }

  /**
   * query — 查询产物
   */
  query(q: ArtifactQuery): ArtifactRecord[] {
    return this.manager.query(q)
  }

  /**
   * archive — 归档产物
   */
  archive(id: string, actor: string): ArtifactRecord | undefined {
    return this.manager.archive(id, actor)
  }

  /**
   * deprecate — 废弃产物
   */
  deprecate(id: string, actor: string): ArtifactRecord | undefined {
    return this.manager.deprecate(id, actor)
  }

  // ═══════════════════════════════════════════════════════════════
  // 两阶段提交
  // ═══════════════════════════════════════════════════════════════

  /**
   * stage — 暂存新版本（Phase 1）
   */
  stage(artifactId: string, newContent: unknown, stagedBy: string): string {
    return this.manager.stage(artifactId, newContent, stagedBy)
  }

  /**
   * verify — 验证暂存内容（Phase 2）
   */
  async verify(stageId: string): Promise<any> {
    return this.manager.verify(stageId)
  }

  /**
   * commit — 提交暂存内容（Phase 3）
   */
  commit(stageId: string, changeLog?: string): ArtifactRecord {
    return this.manager.commit(stageId, changeLog)
  }

  /**
   * rollback — 回滚暂存
   */
  rollback(stageId: string): void {
    return this.manager.rollback(stageId)
  }

  // ═══════════════════════════════════════════════════════════════
  // 版本管理
  // ═══════════════════════════════════════════════════════════════

  /**
   * getHistory — 获取版本历史
   */
  getHistory(artifactId: string): import('./ArtifactVersionService.js').VersionInfo[] {
    return this.manager.getHistory(artifactId)
  }

  /**
   * getVersion — 获取指定版本
   */
  getVersion(artifactId: string, version: number): import('./ArtifactVersionService.js').VersionInfo | undefined {
    return this.manager.getVersion(artifactId, version)
  }

  // ═══════════════════════════════════════════════════════════════
  // 血缘追踪
  // ═══════════════════════════════════════════════════════════════

  /**
   * addRelation — 添加血缘关系
   */
  addRelation(fromId: string, toId: string, relation: LineageRelation, weight?: number): void {
    this.lineageTracker.addRelation(fromId, toId, relation, weight)
  }

  /**
   * getUpstream — 获取上游血缘
   */
  getUpstream(artifactId: string, maxDepth?: number): LineagePath {
    return this.lineageTracker.getUpstream(artifactId, maxDepth, this.getRecordMap())
  }

  /**
   * getDownstream — 获取下游血缘
   */
  getDownstream(artifactId: string, maxDepth?: number): LineagePath {
    return this.lineageTracker.getDownstream(artifactId, maxDepth, this.getRecordMap())
  }

  /**
   * getFullLineage — 获取完整血缘
   */
  getFullLineage(artifactId: string, maxDepth?: number): {
    upstream: LineagePath
    downstream: LineagePath
  } {
    return this.lineageTracker.getFullLineage(artifactId, maxDepth, this.getRecordMap())
  }

  /**
   * findLCA — 查找最近公共祖先
   */
  findLCA(idA: string, idB: string): ArtifactRecord | undefined {
    return this.lineageTracker.findLCA(idA, idB, this.getRecordMap())
  }

  /**
   * areSiblings — 判断是否同源
   */
  areSiblings(idA: string, idB: string): boolean {
    return this.lineageTracker.areSiblings(idA, idB)
  }

  // ═══════════════════════════════════════════════════════════════
  // 事件
  // ═══════════════════════════════════════════════════════════════

  /**
   * on — 监听产物事件
   */
  on(type: ArtifactEventType, callback: ArtifactPlaneEventCallback): () => void {
    return this.manager.getEventEmitter().on(type, callback)
  }

  /**
   * onAny — 监听所有产物事件
   */
  onAny(callback: ArtifactPlaneEventCallback): () => void {
    return this.manager.getEventEmitter().onAny(callback)
  }

  // ═══════════════════════════════════════════════════════════════
  // 内部
  // ═══════════════════════════════════════════════════════════════

  getManager(): ArtifactManager { return this.manager }
  getLineageTracker(): ArtifactLineageTracker { return this.lineageTracker }

  private getRecordMap(): Map<string, ArtifactRecord> {
    const map = new Map<string, ArtifactRecord>()
    const all = this.manager.getRepository().all()
    for (const r of all) {
      map.set(r.id, r)
    }
    return map
  }
}

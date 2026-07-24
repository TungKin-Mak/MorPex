/**
 * NodeIdentity — 联邦节点身份管理
 *
 * MorPex v10 Phase 5: 管理节点的联邦身份。
 * 每个节点在集群中拥有唯一身份，包含节点 ID、集群名、角色和版本。
 *
 * 设计：
 *   - 节点 ID 基于 hostname + PID 生成，保证唯一性
 *   - 集群名和角色从环境变量或配置读取
 *   - 支持基于共享密钥的身份验证
 *
 * 事件：
 *   - federation.identity.registered
 */

import * as os from 'node:os';
import type { FederationIdentity, FederationRole, FederationConfig } from './types.js';
import type { EventBus } from '../../../core/src/common/EventBus.js';

// ── 事件常量 ──

const EVT_IDENTITY_REGISTERED = 'federation.identity.registered';

// ── 默认版本 ──

const DEFAULT_VERSION = '1.0.0';

// ═══════════════════════════════════════════════════════════════
// NodeIdentity
// ═══════════════════════════════════════════════════════════════

export class NodeIdentity {
  private identity: FederationIdentity;
  private bus: EventBus | null;
  private startTime: number;
  private sharedSecret: string | null;

  constructor(bus?: EventBus, config?: FederationConfig) {
    this.bus = bus ?? null;
    this.startTime = Date.now();
    this.sharedSecret = config?.sharedSecret ?? process.env['MORPEX_FEDERATION_SECRET'] ?? null;

    const nodeId = this.generateNodeId();
    const clusterName = config?.clusterName ?? process.env['MORPEX_CLUSTER'] ?? 'default';
    const role = config?.role ?? (process.env['MORPEX_ROLE'] as FederationRole | undefined) ?? 'worker';
    const version = config?.version ?? process.env['MORPEX_VERSION'] ?? DEFAULT_VERSION;

    this.identity = {
      nodeId,
      clusterName,
      role,
      version,
      publicKey: undefined,
    };

    console.log(`[NodeIdentity] Initialized: ${nodeId}@${clusterName} (${role})`);

    // 发射注册事件
    this.emitEvent(EVT_IDENTITY_REGISTERED, {
      nodeId: this.identity.nodeId,
      clusterName: this.identity.clusterName,
      role: this.identity.role,
      version: this.identity.version,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 公共 API
  // ═══════════════════════════════════════════════════════════════

  /** 获取联邦身份 */
  getIdentity(): FederationIdentity {
    return { ...this.identity };
  }

  /** 获取节点 ID */
  getNodeId(): string {
    return this.identity.nodeId;
  }

  /** 获取集群名 */
  getClusterName(): string {
    return this.identity.clusterName;
  }

  /** 获取角色 */
  getRole(): FederationRole {
    return this.identity.role;
  }

  /** 更新角色 */
  setRole(role: FederationRole): void {
    this.identity.role = role;
    this.emitEvent(EVT_IDENTITY_REGISTERED, {
      nodeId: this.identity.nodeId,
      clusterName: this.identity.clusterName,
      role: this.identity.role,
      version: this.identity.version,
      changed: 'role',
    });
  }

  /** 验证对端身份 */
  authenticate(challenge: string, response: string): boolean {
    if (!this.sharedSecret) return true; // 无密钥时不验证
    const expected = this.hashChallenge(challenge, this.sharedSecret);
    return response === expected;
  }

  /** 生成身份验证挑战 */
  createChallenge(): { challenge: string; expected: string } {
    const challenge = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const expected = this.sharedSecret
      ? this.hashChallenge(challenge, this.sharedSecret)
      : '';
    return { challenge, expected };
  }

  /** 健康检查 */
  health(): { ok: boolean; name: string; uptime: number; identity: FederationIdentity } {
    return {
      ok: true,
      name: 'NodeIdentity',
      uptime: this.startTime,
      identity: this.getIdentity(),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 私有方法
  // ═══════════════════════════════════════════════════════════════

  /** 生成唯一节点 ID */
  private generateNodeId(): string {
    const hostname = os.hostname().replace(/[^a-zA-Z0-9_-]/g, '_');
    const pid = process.pid;
    const suffix = Math.random().toString(36).slice(2, 6);
    return `node_${hostname}_${pid}_${suffix}`;
  }

  /** 计算挑战哈希 */
  private hashChallenge(challenge: string, secret: string): string {
    // 简单 HMAC 风格的验证
    let hash = 0;
    const data = `${challenge}:${secret}`;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
  }

  /** 发射事件 */
  private emitEvent(type: string, payload: Record<string, unknown>): void {
    if (!this.bus) return;
    try {
      this.bus.emit({
        id: `evt_ni_${Date.now()}`,
        type,
        timestamp: Date.now(),
        executionId: 'federation',
        source: 'node-identity',
        payload,
      });
    } catch (err: any) {
      console.warn('[NodeIdentity] Failed to emit event:', err.message);
    }
  }
}

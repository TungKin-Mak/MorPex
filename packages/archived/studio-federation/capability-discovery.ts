/**
 * CapabilityDiscovery — 联邦能力发现
 *
 * MorPex v10 Phase 5: 跨节点能力发现服务。
 *
 * 基于 v9.2 CapabilityGraph（本地能力图）扩展到联邦范围：
 *   - 定期从其他节点拉取能力列表
 *   - 支持按能力名搜索：返回所有拥有该能力的节点
 *   - 自动发现模式：定时扫描集群中的能力
 *   - 选择最佳节点（基于能力匹配度 + 延迟）
 *
 * 与 CapabilityGraph 的关系：
 *   - CapabilityGraph 管理本地能力层级
 *   - CapabilityDiscovery 管理跨节点的能力分布
 *
 * 事件：
 *   - federation.discovery.started
 *   - federation.discovery.completed
 *   - federation.discovery.updated
 */

import type { EventBus } from '../../../core/src/common/EventBus.js';
import { CapabilityGraph } from '../../../core/src/agent/capability/CapabilityGraph.js';
import type { Capability } from '../../../core/src/agent/capability/Capability.js';
import { AgentTransport } from '../../../core/src/agent/distributed/AgentTransport.js';
import type {
  FederationNode,
  CapabilityDiscoveryResult,
  CapabilitySnapshot,
  FederationConfig,
} from './types.js';

// ── 事件常量 ──

const EVT_DISCOVERY_STARTED = 'federation.discovery.started';
const EVT_DISCOVERY_COMPLETED = 'federation.discovery.completed';
const EVT_DISCOVERY_UPDATED = 'federation.discovery.updated';

// ── 默认配置 ──

const DEFAULT_DISCOVERY_INTERVAL = 30_000; // 30s

// ═══════════════════════════════════════════════════════════════
// CapabilityDiscovery
// ═══════════════════════════════════════════════════════════════

export class CapabilityDiscovery {
  private localGraph: CapabilityGraph;
  private transport: AgentTransport;
  private bus: EventBus | null;
  private localNodeId: string;
  private nodeCapabilities: Map<string, string[]>;
  private snapshots: Map<string, CapabilitySnapshot>;
  private discoveryInterval: ReturnType<typeof setInterval> | null;
  private enableAutoDiscovery: boolean;
  private startTime: number;

  constructor(
    localNodeId: string,
    localGraph: CapabilityGraph,
    transport: AgentTransport,
    bus?: EventBus,
    config?: FederationConfig
  ) {
    this.localNodeId = localNodeId;
    this.localGraph = localGraph;
    this.transport = transport;
    this.bus = bus ?? null;
    this.nodeCapabilities = new Map();
    this.snapshots = new Map();
    this.discoveryInterval = null;
    this.enableAutoDiscovery = config?.enableAutoDiscovery ?? true;
    this.startTime = Date.now();

    // 注册本地能力
    const localCaps = this.scanLocalCapabilities();
    this.nodeCapabilities.set(localNodeId, localCaps);

    console.log(`[CapabilityDiscovery] Initialized (${localCaps.length} local capabilities)`);

    // 启动自动发现
    if (this.enableAutoDiscovery) {
      this.startAutoDiscovery(config?.discoveryInterval ?? DEFAULT_DISCOVERY_INTERVAL);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 公共 API
  // ═══════════════════════════════════════════════════════════════

  /**
   * discover — 发现拥有指定能力的节点
   *
   * 搜索所有已知节点，返回拥有该能力的节点列表，并推荐最佳节点。
   */
  discover(capability: string): CapabilityDiscoveryResult {
    const nodes: FederationNode[] = [];

    for (const node of this.transport.listNodes()) {
      if (node.status === 'offline') continue;

      const nodeCaps = this.nodeCapabilities.get(node.nodeId) ?? [];
      // 检查直接匹配 + 本地图父能力匹配
      if (this.matchesCapability(nodeCaps, capability)) {
        nodes.push({
          nodeId: node.nodeId,
          identity: {
            nodeId: node.nodeId,
            clusterName: '',
            role: 'worker',
            version: '',
          },
          status: node.status,
          address: node.address,
          transport: node.transport,
          capabilities: nodeCaps,
          joinedAt: 0,
          lastHeartbeat: node.lastHeartbeat,
          metadata: {},
        });
      }
    }

    // 选择最佳节点（最低延迟优先）
    let bestNode: FederationNode | undefined;
    if (nodes.length > 0) {
      bestNode = nodes.reduce((best, curr) =>
        curr.lastHeartbeat > best.lastHeartbeat ? curr : best
      );
    }

    return { capability, nodes, bestNode };
  }

  /**
   * getAllCapabilities — 获取所有已知能力
   */
  getAllCapabilities(): string[] {
    const all = new Set<string>();
    for (const caps of this.nodeCapabilities.values()) {
      for (const c of caps) {
        all.add(c);
      }
    }
    return [...all].sort();
  }

  /**
   * getNodeCapabilities — 获取指定节点的能力列表
   */
  getNodeCapabilities(nodeId: string): string[] {
    return this.nodeCapabilities.get(nodeId) ?? [];
  }

  /**
   * getCapabilityDistribution — 获取能力分布统计
   */
  getCapabilityDistribution(): Record<string, number> {
    const distribution: Record<string, number> = {};
    for (const caps of this.nodeCapabilities.values()) {
      for (const c of caps) {
        distribution[c] = (distribution[c] ?? 0) + 1;
      }
    }
    return distribution;
  }

  /**
   * refreshNodeCapabilities — 刷新指定节点的能力（触发发现）
   */
  async refreshNodeCapabilities(nodeId: string): Promise<string[]> {
    this.emitEvent(EVT_DISCOVERY_STARTED, { nodeId });

    // 从传输层获取该节点的能力
    const node = this.transport.getNode(nodeId);
    const caps = node?.capabilities ?? [];

    // 记录快照
    this.nodeCapabilities.set(nodeId, caps);
    this.snapshots.set(nodeId, {
      nodeId,
      capabilities: caps,
      discoveredAt: Date.now(),
    });

    this.emitEvent(EVT_DISCOVERY_COMPLETED, {
      nodeId,
      capabilityCount: caps.length,
      capabilities: caps,
    });

    return caps;
  }

  /**
   * refreshAllNodes — 刷新所有节点的能力
   */
  async refreshAllNodes(): Promise<void> {
    this.emitEvent(EVT_DISCOVERY_STARTED, { nodeId: '__all__' });

    // 重扫本地
    this.nodeCapabilities.set(this.localNodeId, this.scanLocalCapabilities());

    // 扫描所有在线节点
    for (const node of this.transport.listNodes()) {
      if (node.nodeId !== this.localNodeId && node.status === 'online') {
        await this.refreshNodeCapabilities(node.nodeId);
      }
    }

    this.emitEvent(EVT_DISCOVERY_COMPLETED, {
      nodeId: '__all__',
      totalNodes: this.nodeCapabilities.size,
      totalCapabilities: this.getAllCapabilities().length,
    });
  }

  /**
   * registerLocalCapability — 注册本地能力
   */
  registerLocalCapability(cap: Capability): void {
    this.localGraph.register(cap);

    // 更新本地能力列表
    const caps = this.scanLocalCapabilities();
    this.nodeCapabilities.set(this.localNodeId, caps);

    this.emitEvent(EVT_DISCOVERY_UPDATED, {
      nodeId: this.localNodeId,
      capability: cap.name,
      totalLocal: caps.length,
    });
  }

  /**
   * getSnapshots — 获取所有能力快照
   */
  getSnapshots(): CapabilitySnapshot[] {
    return [...this.snapshots.values()];
  }

  /**
   * startAutoDiscovery — 启动自动发现
   */
  startAutoDiscovery(intervalMs: number = DEFAULT_DISCOVERY_INTERVAL): void {
    if (this.discoveryInterval) clearInterval(this.discoveryInterval);

    this.discoveryInterval = setInterval(async () => {
      try {
        await this.refreshAllNodes();
      } catch (err: any) {
        console.warn('[CapabilityDiscovery] Auto-discovery error:', err.message);
      }
    }, intervalMs);

    console.log(`[CapabilityDiscovery] Auto-discovery enabled (interval: ${intervalMs}ms)`);
  }

  /**
   * stopAutoDiscovery — 停止自动发现
   */
  stopAutoDiscovery(): void {
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = null;
    }
  }

  /**
   * health — 健康检查
   */
  health(): {
    ok: boolean;
    name: string;
    uptime: number;
    elapsed: number;
    knownNodes: number;
    totalCapabilities: number;
    autoDiscoveryEnabled: boolean;
  } {
    return {
      ok: true,
      name: 'CapabilityDiscovery',
      uptime: this.startTime,
      elapsed: Date.now() - this.startTime,
      knownNodes: this.nodeCapabilities.size,
      totalCapabilities: this.getAllCapabilities().length,
      autoDiscoveryEnabled: this.enableAutoDiscovery,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 私有方法
  // ═══════════════════════════════════════════════════════════════

  /**
   * scanLocalCapabilities — 扫描本地 CapabilityGraph 中的所有能力
   */
  private scanLocalCapabilities(): string[] {
    const caps: string[] = [];

    // 从 CapabilityGraph 提取所有注册的能力名
    const hierarchy = this.localGraph.getHierarchy();
    for (const [parent, children] of Object.entries(hierarchy)) {
      if (!caps.includes(parent)) caps.push(parent);
      for (const child of children) {
        if (!caps.includes(child)) caps.push(child);
      }
    }

    // 如果本地图为空，注册一些默认能力
    if (caps.length === 0) {
      const defaults = ['planning', 'execution', 'coding', 'analysis', 'reporting'];
      caps.push(...defaults);
    }

    return caps;
  }

  /**
   * matchesCapability — 检查能力列表是否匹配需求（支持父能力匹配）
   */
  private matchesCapability(agentCapabilities: string[], requiredCapability: string): boolean {
    // 直接匹配
    if (agentCapabilities.includes(requiredCapability)) return true;

    // 父能力匹配：通过本地 CapabilityGraph
    return this.localGraph.matchesCapability(agentCapabilities, requiredCapability);
  }

  /**
   * emitEvent — 发射事件
   */
  private emitEvent(type: string, payload: Record<string, unknown>): void {
    if (!this.bus) return;
    try {
      this.bus.emit({
        id: `evt_cd_${Date.now()}`,
        type,
        timestamp: Date.now(),
        executionId: 'federation',
        source: 'capability-discovery',
        payload,
      });
    } catch (err: any) {
      console.warn('[CapabilityDiscovery] Failed to emit event:', err.message);
    }
  }
}

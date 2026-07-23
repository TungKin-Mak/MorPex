/**
 * FederationManager — 联邦管理器（主编排器）
 *
 * MorPex v10 Phase 5: 联邦运行时的统一入口。
 *
 * 编排三个子模块：
 *   1. NodeIdentity — 节点身份管理
 *   2. RemoteExecutor — 远程执行
 *   3. CapabilityDiscovery — 能力发现
 *
 * 职责：
 *   - 启动/停止联邦运行时
 *   - 管理节点注册和心跳
 *   - 集成 EventBus 发射所有联邦事件
 *   - 集成数据库持久化（可选）
 *   - 提供统一的状态查询和健康检查
 *
 * 事件：
 *   - federation.manager.started
 *   - federation.manager.stopped
 *   - federation.node.joined
 *   - federation.node.left
 *   - federation.node.status_changed
 */

import type { EventBus } from '../../../core/src/common/EventBus.js';
import { AgentTransport } from '../../../core/src/agent/distributed/AgentTransport.js';
import { CapabilityGraph } from '../../../core/src/agent/capability/CapabilityGraph.js';
import type { Capability } from '../../../core/src/agent/capability/Capability.js';
import type Database from 'better-sqlite3';

import { NodeIdentity } from './node-identity.js';
import { RemoteExecutor } from './remote-executor.js';
import { CapabilityDiscovery } from './capability-discovery.js';
import type {
  FederationNode,
  FederationConfig,
  FederationRole,
  FederationStatus,
  NodeStatus,
  TransportType,
  RemoteExecutionRequest,
  RemoteExecutionResponse,
  CapabilityDiscoveryResult,
} from './types.js';

// ── 事件常量 ──

const EVT_MANAGER_STARTED = 'federation.manager.started';
const EVT_MANAGER_STOPPED = 'federation.manager.stopped';
const EVT_NODE_JOINED = 'federation.node.joined';
const EVT_NODE_LEFT = 'federation.node.left';
const EVT_NODE_STATUS_CHANGED = 'federation.node.status_changed';

// ── 默认配置 ──

const DEFAULT_HEARTBEAT_INTERVAL = 5_000; // 5s

// ═══════════════════════════════════════════════════════════════
// FederationManager
// ═══════════════════════════════════════════════════════════════

export class FederationManager {
  // 子模块
  public identity: NodeIdentity;
  public executor: RemoteExecutor;
  public discovery: CapabilityDiscovery;

  // 基础设施
  private transport: AgentTransport;
  private localGraph: CapabilityGraph;
  private bus: EventBus | null;
  private db: Database.Database | null;

  // 运行时
  private config: Required<FederationConfig>;
  private heartbeatTimer: ReturnType<typeof setInterval> | null;
  private missedHeartbeats: Map<string, number>;
  private started: boolean;
  private startTime: number;
  private nodes: Map<string, FederationNode>;

  constructor(
    bus?: EventBus,
    db?: Database.Database,
    config?: FederationConfig
  ) {
    this.bus = bus ?? null;
    this.db = db ?? null;
    this.config = {
      clusterName: config?.clusterName ?? process.env['MORPEX_CLUSTER'] ?? 'default',
      role: config?.role ?? (process.env['MORPEX_ROLE'] as FederationRole | undefined) ?? 'worker',
      heartbeatInterval: config?.heartbeatInterval ?? DEFAULT_HEARTBEAT_INTERVAL,
      discoveryInterval: config?.discoveryInterval ?? 30_000,
      enableAutoDiscovery: config?.enableAutoDiscovery ?? true,
      version: config?.version ?? '1.0.0',
      sharedSecret: config?.sharedSecret ?? process.env['MORPEX_FEDERATION_SECRET'] ?? null!,
    };

    this.transport = new AgentTransport();
    this.localGraph = new CapabilityGraph();
    this.heartbeatTimer = null;
    this.missedHeartbeats = new Map();
    this.started = false;
    this.startTime = Date.now();
    this.nodes = new Map();

    // 初始化子模块
    this.identity = new NodeIdentity(bus, config);
    this.executor = new RemoteExecutor(this.identity.getNodeId(), this.transport, bus);
    this.discovery = new CapabilityDiscovery(
      this.identity.getNodeId(),
      this.localGraph,
      this.transport,
      bus,
      config
    );

    console.log(`[FederationManager] Initialized for cluster "${this.config.clusterName}"`);
  }

  // ═══════════════════════════════════════════════════════════════
  // 生命周期
  // ═══════════════════════════════════════════════════════════════

  /**
   * start — 启动联邦运行时
   *
   * 1. 注册本地节点
   * 2. 开始心跳广播
   * 3. 持久化到数据库（可选）
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    const nodeId = this.identity.getNodeId();

    // 1. 注册本地节点到传输层
    this.transport.registerNode({
      nodeId,
      address: 'local',
      transport: 'local',
      status: 'online',
      capabilities: this.discovery.getAllCapabilities(),
      connectedAgents: [],
      lastHeartbeat: Date.now(),
      latency: 0,
    });

    // 持久化到数据库
    if (this.db) {
      try {
        this.db.prepare(`
          INSERT OR REPLACE INTO agent_instances (node_id, agent_id, status, last_heartbeat, address, capabilities_json, load)
          VALUES (?, 'federation-manager', 'online', ?, 'local', ?, 0)
        `).run(nodeId, Date.now(), JSON.stringify(this.discovery.getAllCapabilities()));
      } catch (err: any) {
        console.warn('[FederationManager] DB persist failed:', err.message);
      }
    }

    // 2. 开始心跳
    this.heartbeatTimer = setInterval(() => {
      this.broadcastHeartbeat();
      this.detectOfflineNodes();
    }, this.config.heartbeatInterval);

    // 发射开始事件
    this.emitEvent(EVT_MANAGER_STARTED, {
      nodeId,
      clusterName: this.config.clusterName,
      role: this.config.role,
      capabilities: this.discovery.getAllCapabilities(),
    });

    console.log(`[FederationManager] Started (node: ${nodeId}, cluster: ${this.config.clusterName})`);
  }

  /**
   * stop — 停止联邦运行时
   */
  stop(): void {
    if (!this.started) return;
    this.started = false;

    // 停止心跳
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // 停止自动发现
    this.discovery.stopAutoDiscovery();

    // 标记本地节点离线
    const node = this.transport.getNode(this.identity.getNodeId());
    if (node) {
      node.status = 'offline';
    }

    this.emitEvent(EVT_MANAGER_STOPPED, {
      nodeId: this.identity.getNodeId(),
      uptime: Date.now() - this.startTime,
    });

    console.log('[FederationManager] Stopped');
  }

  /**
   * isStarted — 检查是否已启动
   */
  isStarted(): boolean {
    return this.started;
  }

  // ═══════════════════════════════════════════════════════════════
  // 节点管理
  // ═══════════════════════════════════════════════════════════════

  /**
   * registerNode — 注册外部节点
   */
  registerNode(
    nodeId: string,
    address: string,
    transportType: TransportType,
    capabilities: string[] = []
  ): boolean {
    if (this.transport.getNode(nodeId)) {
      console.warn(`[FederationManager] Node ${nodeId} already registered`);
      return false;
    }

    // 注册到传输层
    this.transport.registerNode({
      nodeId,
      address,
      transport: transportType as any,
      status: 'online',
      capabilities,
      connectedAgents: [],
      lastHeartbeat: Date.now(),
      latency: 0,
    });

    // 记录到本地节点表
    const fedNode: FederationNode = {
      nodeId,
      identity: {
        nodeId,
        clusterName: this.config.clusterName,
        role: 'worker',
        version: this.config.version,
      },
      status: 'online',
      address,
      transport: transportType,
      capabilities,
      joinedAt: Date.now(),
      lastHeartbeat: Date.now(),
      metadata: {},
    };
    this.nodes.set(nodeId, fedNode);
    this.missedHeartbeats.set(nodeId, 0);

    // 更新能力发现
    this.discovery.refreshNodeCapabilities(nodeId);

    // 持久化
    if (this.db) {
      try {
        this.db.prepare(`
          INSERT OR REPLACE INTO agent_instances (node_id, agent_id, status, last_heartbeat, address, capabilities_json, load)
          VALUES (?, 'remote-node', 'online', ?, ?, ?, 0)
        `).run(nodeId, Date.now(), address, JSON.stringify(capabilities));
      } catch {}
    }

    this.emitEvent(EVT_NODE_JOINED, {
      nodeId,
      address,
      transport: transportType,
      capabilities,
    });

    return true;
  }

  /**
   * unregisterNode — 注销节点
   */
  unregisterNode(nodeId: string): boolean {
    const removed = this.transport.unregisterNode(nodeId);
    if (removed) {
      this.nodes.delete(nodeId);
      this.missedHeartbeats.delete(nodeId);

      this.emitEvent(EVT_NODE_LEFT, { nodeId });
    }
    return removed;
  }

  /**
   * listNodes — 列出所有已知节点
   */
  listNodes(): FederationNode[] {
    const result: FederationNode[] = [];

    // 先在传输层中查找
    const transportNodes = this.transport.listNodes();
    const seen = new Set<string>();

    for (const tn of transportNodes) {
      seen.add(tn.nodeId);
      const fedNode = this.nodes.get(tn.nodeId);
      result.push(fedNode ?? {
        nodeId: tn.nodeId,
        identity: {
          nodeId: tn.nodeId,
          clusterName: this.config.clusterName,
          role: 'worker',
          version: this.config.version,
        },
        status: tn.status,
        address: tn.address,
        transport: tn.transport,
        capabilities: tn.capabilities,
        joinedAt: 0,
        lastHeartbeat: tn.lastHeartbeat,
        metadata: {},
      });
    }

    // 再补充本地登记但不在传输层的节点
    for (const [nodeId, fedNode] of this.nodes) {
      if (!seen.has(nodeId)) {
        result.push(fedNode);
      }
    }

    return result;
  }

  /**
   * getNode — 获取指定节点信息
   */
  getNode(nodeId: string): FederationNode | undefined {
    const tn = this.transport.getNode(nodeId);
    const fedNode = this.nodes.get(nodeId);
    if (tn && fedNode) return fedNode;
    if (tn) {
      return {
        nodeId: tn.nodeId,
        identity: {
          nodeId: tn.nodeId,
          clusterName: this.config.clusterName,
          role: 'worker',
          version: this.config.version,
        },
        status: tn.status,
        address: tn.address,
        transport: tn.transport,
        capabilities: tn.capabilities,
        joinedAt: 0,
        lastHeartbeat: tn.lastHeartbeat,
        metadata: {},
      };
    }
    return fedNode;
  }

  /**
   * getLocalNode — 获取本地节点信息
   */
  getLocalNode(): FederationNode {
    const nodeId = this.identity.getNodeId();
    return {
      nodeId,
      identity: this.identity.getIdentity(),
      status: 'online',
      address: 'local',
      transport: 'local',
      capabilities: this.discovery.getAllCapabilities(),
      joinedAt: this.startTime,
      lastHeartbeat: Date.now(),
      metadata: {},
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 远程执行（委托）
  // ═══════════════════════════════════════════════════════════════

  /**
   * executeRemotely — 远程执行（委托给 RemoteExecutor）
   */
  async executeRemotely(request: RemoteExecutionRequest): Promise<RemoteExecutionResponse> {
    return this.executor.execute(request);
  }

  // ═══════════════════════════════════════════════════════════════
  // 能力发现（委托）
  // ═══════════════════════════════════════════════════════════════

  /**
   * discoverCapability — 发现能力（委托给 CapabilityDiscovery）
   */
  discoverCapability(capability: string): CapabilityDiscoveryResult {
    return this.discovery.discover(capability);
  }

  /**
   * getAllCapabilities — 获取所有已知能力
   */
  getAllCapabilities(): string[] {
    return this.discovery.getAllCapabilities();
  }

  /**
   * registerCapability — 注册能力到本地图
   */
  registerCapability(cap: Capability): void {
    this.discovery.registerLocalCapability(cap);
  }

  // ═══════════════════════════════════════════════════════════════
  // 状态查询
  // ═══════════════════════════════════════════════════════════════

  /**
   * getStatus — 获取联邦集群状态
   */
  getStatus(): FederationStatus {
    const nodes = this.listNodes();
    return {
      clusterName: this.config.clusterName,
      localNodeId: this.identity.getNodeId(),
      localRole: this.identity.getRole(),
      nodes,
      onlineCount: nodes.filter(n => n.status === 'online').length,
      totalCapabilities: this.discovery.getAllCapabilities(),
      uptime: Date.now() - this.startTime,
    };
  }

  /**
   * health — 健康检查
   */
  health(): {
    ok: boolean;
    name: string;
    uptime: number;
    elapsed: number;
    started: boolean;
    submodules: Record<string, { ok: boolean; name: string }>;
    nodeCount: number;
  } {
    const identityHealth = this.identity.health();
    const executorHealth = this.executor.health();
    const discoveryHealth = this.discovery.health();

    const submodules: Record<string, { ok: boolean; name: string }> = {
      'NodeIdentity': { ok: identityHealth.ok, name: identityHealth.name },
      'RemoteExecutor': { ok: executorHealth.ok, name: executorHealth.name },
      'CapabilityDiscovery': { ok: discoveryHealth.ok, name: discoveryHealth.name },
    };

    return {
      ok: this.started && Object.values(submodules).every(m => m.ok),
      name: 'FederationManager',
      uptime: this.startTime,
      elapsed: Date.now() - this.startTime,
      started: this.started,
      submodules,
      nodeCount: this.transport.listNodes().length,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 私有方法
  // ═══════════════════════════════════════════════════════════════

  /**
   * broadcastHeartbeat — 广播心跳
   */
  private broadcastHeartbeat(): void {
    this.transport.broadcast(this.identity.getNodeId(), 'heartbeat', {
      nodeId: this.identity.getNodeId(),
      clusterName: this.config.clusterName,
      role: this.config.role,
      capabilities: this.discovery.getAllCapabilities(),
      timestamp: Date.now(),
    });
  }

  /**
   * detectOfflineNodes — 检测离线节点
   */
  private detectOfflineNodes(): void {
    const now = Date.now();
    for (const node of this.transport.listNodes()) {
      if (node.nodeId === this.identity.getNodeId()) continue;

      const timeSinceHeartbeat = now - node.lastHeartbeat;
      if (timeSinceHeartbeat > 15_000) {
        const missed = (this.missedHeartbeats.get(node.nodeId) ?? 0) + 1;
        this.missedHeartbeats.set(node.nodeId, missed);

        const prevStatus = node.status;
        if (missed >= 3) {
          node.status = 'offline';

          if (prevStatus !== 'offline') {
            this.emitEvent(EVT_NODE_STATUS_CHANGED, {
              nodeId: node.nodeId,
              from: prevStatus,
              to: 'offline',
              reason: 'missed_heartbeats',
            });
          }
        } else if (missed >= 1) {
          node.status = 'degraded';

          if (prevStatus === 'online') {
            this.emitEvent(EVT_NODE_STATUS_CHANGED, {
              nodeId: node.nodeId,
              from: prevStatus,
              to: 'degraded',
              reason: 'delayed_heartbeat',
            });
          }
        }
      } else {
        // 节点恢复
        this.missedHeartbeats.set(node.nodeId, 0);
        if (node.status !== 'online') {
          const prevStatus = node.status;
          node.status = 'online';

          this.emitEvent(EVT_NODE_STATUS_CHANGED, {
            nodeId: node.nodeId,
            from: prevStatus,
            to: 'online',
            reason: 'heartbeat_recovered',
          });
        }
      }
    }
  }

  /**
   * emitEvent — 发射事件
   */
  private emitEvent(type: string, payload: Record<string, unknown>): void {
    if (!this.bus) return;
    try {
      this.bus.emit({
        id: `evt_fm_${Date.now()}`,
        type,
        timestamp: Date.now(),
        executionId: 'federation',
        source: 'federation-manager',
        payload,
      });
    } catch (err: any) {
      console.warn('[FederationManager] Failed to emit event:', err.message);
    }
  }
}

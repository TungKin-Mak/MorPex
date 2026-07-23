/**
 * CapabilityDiscovery — 单元测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CapabilityDiscovery } from '../capability-discovery.js';
import { CapabilityGraph } from '../../../../core/src/agent/capability/CapabilityGraph.js';
import type { Capability } from '../../../../core/src/agent/capability/Capability.js';
import { AgentTransport } from '../../../../core/src/agent/distributed/AgentTransport.js';

describe('CapabilityDiscovery', () => {
  let graph: CapabilityGraph;
  let transport: AgentTransport;
  let discovery: CapabilityDiscovery;
  const localNodeId = 'node_local_test_0000';
  const remoteNodeId = 'node_remote_test_0000';

  const mockBus = {
    emit: (event: any) => { /* silent */ },
  };

  beforeEach(() => {
    graph = new CapabilityGraph();
    transport = new AgentTransport();

    // 注册本地能力
    const cap1: Capability = { name: 'planning', level: 4, cost: 0.3, successRate: 0.9, parentCapabilities: [] };
    const cap2: Capability = { name: 'execution', level: 5, cost: 0.5, successRate: 0.95, parentCapabilities: [] };
    const cap3: Capability = { name: 'coding', level: 3, cost: 0.4, successRate: 0.85, parentCapabilities: [] };
    const cap4: Capability = { name: 'debug', level: 3, cost: 0.4, successRate: 0.8, parentCapabilities: ['coding'] };
    graph.register(cap1);
    graph.register(cap2);
    graph.register(cap3);
    graph.register(cap4);

    // 注册本地节点
    transport.registerNode({
      nodeId: localNodeId,
      address: 'local',
      transport: 'local',
      status: 'online',
      capabilities: ['planning', 'execution', 'coding'],
      connectedAgents: ['agent_1'],
      lastHeartbeat: Date.now(),
      latency: 0,
    });

    // 注册远程节点（具有分析和报告能力）
    transport.registerNode({
      nodeId: remoteNodeId,
      address: 'remote:8080',
      transport: 'local',
      status: 'online',
      capabilities: ['analysis', 'reporting'],
      connectedAgents: ['agent_2'],
      lastHeartbeat: Date.now(),
      latency: 10,
    });

    discovery = new CapabilityDiscovery(
      localNodeId,
      graph,
      transport,
      mockBus as any,
      { enableAutoDiscovery: false }
    );
  });

  it('should discover capabilities on local node', () => {
    const result = discovery.discover('planning');
    expect(result.nodes.length).toBeGreaterThanOrEqual(1);
    expect(result.capability).toBe('planning');
    expect(result.bestNode).toBeDefined();
  });

  it('should discover parent-matched capabilities', () => {
    // 'debug' 的父能力是 'coding'，本地节点有 'coding'
    const result = discovery.discover('debug');
    expect(result.nodes.length).toBeGreaterThanOrEqual(1);
  });

  it('should return all capabilities', () => {
    const all = discovery.getAllCapabilities();
    expect(all.length).toBeGreaterThan(0);
    expect(all).toContain('planning');
    expect(all).toContain('execution');
  });

  it('should return node capabilities', () => {
    const caps = discovery.getNodeCapabilities(localNodeId);
    expect(caps.length).toBeGreaterThan(0);
  });

  it('should return capability distribution', () => {
    const dist = discovery.getCapabilityDistribution();
    // 本地节点至少有 planning, execution, coding
    expect(Object.keys(dist).length).toBeGreaterThanOrEqual(3);
  });

  it('should refresh node capabilities', async () => {
    const caps = await discovery.refreshNodeCapabilities(remoteNodeId);
    expect(caps).toContain('analysis');
    expect(caps).toContain('reporting');
  });

  it('should refresh all nodes', async () => {
    await discovery.refreshAllNodes();
    const all = discovery.getAllCapabilities();
    expect(all).toContain('planning');
    expect(all).toContain('analysis');
  });

  it('should register new local capability', () => {
    const newCap: Capability = { name: 'research', level: 3, cost: 0.3, successRate: 0.9, parentCapabilities: [] };
    discovery.registerLocalCapability(newCap);

    const all = discovery.getAllCapabilities();
    expect(all).toContain('research');
  });

  it('should return snapshots', () => {
    const snapshots = discovery.getSnapshots();
    expect(Array.isArray(snapshots)).toBe(true);
  });

  it('should expose health check', () => {
    const health = discovery.health();
    expect(health.ok).toBe(true);
    expect(health.name).toBe('CapabilityDiscovery');
    expect(health.knownNodes).toBeGreaterThanOrEqual(1);
    expect(health.totalCapabilities).toBeGreaterThan(0);
  });

  it('should start and stop auto discovery', () => {
    discovery.startAutoDiscovery(60_000);
    discovery.stopAutoDiscovery();
    expect(discovery.health().ok).toBe(true);
  });
});

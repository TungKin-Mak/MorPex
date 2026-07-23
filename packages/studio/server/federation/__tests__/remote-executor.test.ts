/**
 * RemoteExecutor — 单元测试
 *
 * 使用 Mock AgentTransport 测试远程执行流程，避免真实网络。
 * 对于需要等待响应的测试，使用自定义 Transport Mock 来模拟响应。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { RemoteExecutor } from '../remote-executor.js';
import { AgentTransport } from '../../../../core/src/agent/distributed/AgentTransport.js';
import type { RemoteExecutionRequest } from '../types.js';

/**
 * MockTransport — 可控的模拟传输层
 *
 * 捕获发送的消息并立即注入响应，避免超时等待。
 */
class MockTransport extends AgentTransport {
  public sentMessages: any[] = [];
  public autoRespond = false;
  public respondWith: any = { success: true, result: { mocked: true }, duration: 10 };
  public respondAfterMs = 0;

  async sendMessage(msg: any): Promise<boolean> {
    this.sentMessages.push(msg);

    if (this.autoRespond) {
      // 异步注入响应消息
      setTimeout(() => {
        const response = {
          id: `resp_${Date.now()}`,
          fromNode: msg.fromNode === 'node_local_test' ? 'node_remote_test' : msg.toNode,
          toNode: msg.fromNode,
          type: 'task_response' as const,
          payload: this.respondWith,
          timestamp: Date.now(),
          correlationId: msg.id,
        };
        // 直接追加到消息队列
        const msgs = (this as any).messages ?? [];
        msgs.push(response);
        (this as any).messages = msgs;
      }, this.respondAfterMs);
    }

    return super.sendMessage(msg);
  }
}

describe('RemoteExecutor', () => {
  let transport: AgentTransport;
  let executor: RemoteExecutor;
  const localNodeId = 'node_local_test';
  const remoteNodeId = 'node_remote_test';

  const mockBus = {
    emit: (event: any) => { /* silent */ },
  };

  beforeEach(() => {
    transport = new AgentTransport();
    executor = new RemoteExecutor(localNodeId, transport, mockBus as any);

    // 注册本地节点
    transport.registerNode({
      nodeId: localNodeId,
      address: 'local',
      transport: 'local',
      status: 'online',
      capabilities: ['planning', 'execution'],
      connectedAgents: ['agent_1'],
      lastHeartbeat: Date.now(),
      latency: 0,
    });

    // 注册远程节点
    transport.registerNode({
      nodeId: remoteNodeId,
      address: 'remote-host:8080',
      transport: 'local',
      status: 'online',
      capabilities: ['coding', 'analysis'],
      connectedAgents: ['agent_remote_1'],
      lastHeartbeat: Date.now(),
      latency: 10,
    });
  });

  it('should execute remote request with auto-respond transport', async () => {
    // 使用 MockTransport 自动响应
    const mockTransport = new MockTransport();
    mockTransport.registerNode({
      nodeId: localNodeId, address: 'local', transport: 'local',
      status: 'online', capabilities: [], connectedAgents: [],
      lastHeartbeat: Date.now(), latency: 0,
    });
    mockTransport.registerNode({
      nodeId: remoteNodeId, address: 'remote:8080', transport: 'local',
      status: 'online', capabilities: ['coding'], connectedAgents: ['agent_r'],
      lastHeartbeat: Date.now(), latency: 10,
    });
    mockTransport.autoRespond = true;
    mockTransport.respondAfterMs = 50;

    const exec = new RemoteExecutor(localNodeId, mockTransport, mockBus as any);
    const request: RemoteExecutionRequest = {
      targetNodeId: remoteNodeId,
      agentId: 'agent_r',
      action: 'process_data',
      payload: { source: 'input.csv' },
      timeout: 5000,
    };

    const response = await exec.execute(request);

    expect(response.success).toBe(true);
    expect(response.nodeId).toBeDefined();
    expect(response.duration).toBeGreaterThanOrEqual(0);
  });

  it('should fail when target node does not exist', async () => {
    const request: RemoteExecutionRequest = {
      targetNodeId: 'node_nonexistent',
      agentId: 'agent_x',
      action: 'do_something',
      payload: {},
    };

    const response = await executor.execute(request);

    expect(response.success).toBe(false);
    expect(response.error).toContain('not found');
  });

  it('should fail when target node is offline', async () => {
    const node = transport.getNode(remoteNodeId)!;
    node.status = 'offline';

    const request: RemoteExecutionRequest = {
      targetNodeId: remoteNodeId,
      agentId: 'agent_remote_1',
      action: 'do_something',
      payload: {},
    };

    const response = await executor.execute(request);

    expect(response.success).toBe(false);
    expect(response.error).toContain('offline');
  });

  it('should track pending requests with auto-respond', async () => {
    const mockTransport = new MockTransport();
    mockTransport.registerNode({
      nodeId: localNodeId, address: 'local', transport: 'local',
      status: 'online', capabilities: [], connectedAgents: [],
      lastHeartbeat: Date.now(), latency: 0,
    });
    mockTransport.registerNode({
      nodeId: remoteNodeId, address: 'remote:8080', transport: 'local',
      status: 'online', capabilities: ['coding'], connectedAgents: ['agent_r'],
      lastHeartbeat: Date.now(), latency: 10,
    });
    mockTransport.autoRespond = true;
    mockTransport.respondAfterMs = 50;

    const exec = new RemoteExecutor(localNodeId, mockTransport, mockBus as any);

    expect(exec.getPendingRequests().length).toBe(0);

    const request: RemoteExecutionRequest = {
      targetNodeId: remoteNodeId,
      agentId: 'agent_r',
      action: 'process',
      payload: { task: 'test' },
      timeout: 5000,
    };

    await exec.execute(request);

    // 完成后应该已移除
    expect(exec.getPendingRequests().length).toBe(0);
  });

  it('should support cancel request', () => {
    // 未发送的请求无法取消
    const result = executor.cancelRequest('nonexistent');
    expect(result).toBe(false);
  });

  it('should expose health check', () => {
    const health = executor.health();
    expect(health.ok).toBe(true);
    expect(health.name).toBe('RemoteExecutor');
    expect(health.uptime).toBeGreaterThan(0);
    expect(health.pendingRequests).toBe(0);
  });
});

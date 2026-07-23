/**
 * NodeIdentity — 单元测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { NodeIdentity } from '../node-identity.js';

describe('NodeIdentity', () => {
  let identity: NodeIdentity;

  const mockBus = {
    emit: (event: any) => { /* silent */ },
  };

  beforeEach(() => {
    identity = new NodeIdentity(mockBus as any, {
      clusterName: 'test-cluster',
      role: 'worker',
      version: '1.0.0',
    });
  });

  it('should generate valid node ID', () => {
    const nodeId = identity.getNodeId();
    expect(nodeId).toMatch(/^node_/);
    expect(nodeId.length).toBeGreaterThan(10);
  });

  it('should return identity with correct cluster name', () => {
    const id = identity.getIdentity();
    expect(id.clusterName).toBe('test-cluster');
    expect(id.role).toBe('worker');
    expect(id.version).toBe('1.0.0');
  });

  it('should support role update', () => {
    expect(identity.getRole()).toBe('worker');
    identity.setRole('leader');
    expect(identity.getRole()).toBe('leader');
  });

  it('should authenticate with shared secret', () => {
    identity = new NodeIdentity(mockBus as any, {
      clusterName: 'test',
      role: 'worker',
      sharedSecret: 'secret123',
    });

    const { challenge, expected } = identity.createChallenge();
    const result = identity.authenticate(challenge, expected);
    expect(result).toBe(true);
  });

  it('should reject wrong authentication', () => {
    identity = new NodeIdentity(mockBus as any, {
      clusterName: 'test',
      role: 'worker',
      sharedSecret: 'secret123',
    });

    const { challenge } = identity.createChallenge();
    const result = identity.authenticate(challenge, 'wrong_response');
    expect(result).toBe(false);
  });

  it('should pass authentication when no secret configured', () => {
    const { challenge } = identity.createChallenge();
    const result = identity.authenticate(challenge, 'anything');
    expect(result).toBe(true);
  });

  it('should expose health check', () => {
    const health = identity.health();
    expect(health.ok).toBe(true);
    expect(health.name).toBe('NodeIdentity');
    expect(health.uptime).toBeGreaterThan(0);
    expect(health.identity.nodeId).toBeTruthy();
  });
});

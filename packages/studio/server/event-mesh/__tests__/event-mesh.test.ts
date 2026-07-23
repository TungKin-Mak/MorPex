/**
 * EventMesh — 集成测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { EventMesh } from '../event-mesh.js';
import type { MorpexEventV10 } from '../types.js';

describe('EventMesh', () => {
  let db: Database.Database;
  const capturedEvents: any[] = [];
  const mockBus = { emit: (e: any) => { capturedEvents.push(e); } };
  const eventSource = () => [
    { id: 'e1', type: 'mission.created', timestamp: 1000, executionId: 'mis_1', source: 'test', payload: {} },
  ];

  beforeEach(() => {
    db = new Database(':memory:');
    capturedEvents.length = 0;
  });

  it('should initialize with default schemas', () => {
    const mesh = new EventMesh(mockBus as any, eventSource, db);
    const registry = mesh.getRegistry();

    expect(registry.listTypes().length).toBeGreaterThan(0);
    expect(registry.listTypes()).toContain('mission.created');
  });

  it('should publish valid events', () => {
    const mesh = new EventMesh(mockBus as any, eventSource, db);

    const event: MorpexEventV10 = {
      id: 'evt_pub_1',
      type: 'mission.created',
      version: 1,
      timestamp: Date.now(),
      traceId: 'trace_pub',
      missionId: 'mis_pub',
      payload: { missionId: 'mis_pub', goal: 'Publish test' },
    };

    const result = mesh.publish(event);
    expect(result).toBeUndefined(); // no error
    expect(capturedEvents.length).toBe(1);
    expect(capturedEvents[0].type).toBe('mission.created');
  });

  it('should reject invalid events', () => {
    const mesh = new EventMesh(mockBus as any, eventSource, db);

    const event: MorpexEventV10 = {
      id: 'evt_bad',
      type: 'mission.created',
      version: 1,
      timestamp: Date.now(),
      traceId: 'trace_bad',
      missionId: 'mis_bad',
      payload: { owner: 'no_required_fields' },
    };

    const result = mesh.publish(event);
    expect(result).toBeDefined();
    expect(result!.valid).toBe(false);
    expect(capturedEvents.length).toBe(0); // not published
  });

  it('should support replay', async () => {
    const mesh = new EventMesh(mockBus as any, eventSource, db, { enableSchemaValidation: false });
    const result = await mesh.replay({});

    expect(result.totalEvents).toBe(1);
    expect(result.processed).toBe(1);
  });

  it('should expose submodules', () => {
    const mesh = new EventMesh(mockBus as any, eventSource, db);

    expect(mesh.getRegistry()).toBeDefined();
    expect(mesh.getValidator()).toBeDefined();
    expect(mesh.getReplayEngine()).toBeDefined();
  });

  it('should expose health check', () => {
    const mesh = new EventMesh(mockBus as any, eventSource, db);
    const health = mesh.health();

    expect(health.ok).toBe(true);
    expect(health.name).toBe('EventMesh');
    expect(health.schemaCount).toBeGreaterThan(0);
    expect(Object.keys(health.submodules)).toHaveLength(3);
  });
});

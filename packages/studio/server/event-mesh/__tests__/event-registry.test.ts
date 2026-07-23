/**
 * EventRegistry — 测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { EventRegistry } from '../event-registry.js';

describe('EventRegistry', () => {
  let db: Database.Database;
  let registry: EventRegistry;

  beforeEach(() => {
    db = new Database(':memory:');
    registry = new EventRegistry(db);
  });

  it('should register event schema', () => {
    const schema = registry.register('mission.created', {
      type: 'object',
      properties: { missionId: { type: 'string' }, goal: { type: 'string' } },
      required: ['missionId'],
    });

    expect(schema.type).toBe('mission.created');
    expect(schema.version).toBe(1);
    expect(schema.backwardCompatible).toBe(true);
  });

  it('should auto-increment version', () => {
    registry.register('mission.created', { properties: { a: { type: 'string' } } });
    const v2 = registry.register('mission.created', { properties: { a: { type: 'string' }, b: { type: 'number' } } });

    expect(v2.version).toBe(2);
  });

  it('should retrieve schema by type and version', () => {
    registry.register('mission.created', { properties: { a: { type: 'string' } } });

    const schema = registry.getSchema('mission.created', 1);
    expect(schema).toBeDefined();
    expect(schema!.version).toBe(1);
  });

  it('should list registered types', () => {
    registry.register('mission.created', { properties: {} });
    registry.register('mission.completed', { properties: {} });

    const types = registry.listTypes();
    expect(types).toContain('mission.created');
    expect(types).toContain('mission.completed');
  });

  it('should list schemas optionally filtered by type', () => {
    registry.register('mission.created', { properties: { a: { type: 'string' } } });
    registry.register('mission.created', { properties: { a: { type: 'string' }, b: { type: 'number' } } });
    registry.register('plan.created', { properties: {} });

    const missionSchemas = registry.listSchemas('mission.created');
    expect(missionSchemas).toHaveLength(2);

    const allSchemas = registry.listSchemas();
    expect(allSchemas).toHaveLength(3);
  });

  it('should expose health check', () => {
    const health = registry.health();
    expect(health.ok).toBe(true);
    expect(health.name).toBe('EventRegistry');
    expect(health.schemaCount).toBe(0);
  });
});

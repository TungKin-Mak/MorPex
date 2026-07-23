/**
 * SchemaValidator — 测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { EventRegistry } from '../event-registry.js';
import { SchemaValidator } from '../schema-validator.js';
import type { MorpexEventV10 } from '../types.js';

describe('SchemaValidator', () => {
  let registry: EventRegistry;
  let validator: SchemaValidator;

  beforeEach(() => {
    registry = new EventRegistry();
    validator = new SchemaValidator(registry);

    // Register test schema
    registry.register('mission.created', {
      type: 'object',
      properties: {
        missionId: { type: 'string' },
        goal: { type: 'string' },
        owner: { type: 'string' },
        priority: { type: 'number' },
      },
      required: ['missionId', 'goal'],
    });
  });

  it('should validate a valid event', () => {
    const event: MorpexEventV10 = {
      id: 'evt_1',
      type: 'mission.created',
      version: 1,
      timestamp: Date.now(),
      traceId: 'trace_1',
      missionId: 'mis_1',
      payload: { missionId: 'mis_1', goal: 'Test mission', owner: 'user1' },
    };

    const result = validator.validate(event);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject event missing required fields', () => {
    const event: MorpexEventV10 = {
      id: 'evt_2',
      type: 'mission.created',
      version: 1,
      timestamp: Date.now(),
      traceId: 'trace_2',
      missionId: 'mis_2',
      payload: { owner: 'user1' }, // missing missionId and goal
    };

    const result = validator.validate(event);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.path.includes('missionId'))).toBe(true);
    expect(result.errors.some(e => e.path.includes('goal'))).toBe(true);
  });

  it('should reject type mismatches', () => {
    const event: MorpexEventV10 = {
      id: 'evt_3',
      type: 'mission.created',
      version: 1,
      timestamp: Date.now(),
      traceId: 'trace_3',
      missionId: 'mis_3',
      payload: { missionId: 'mis_3', goal: 'Test', priority: 'high' }, // priority should be number
    };

    const result = validator.validate(event);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.path.includes('priority'))).toBe(true);
  });

  it('should warn for unknown schema', () => {
    const event: MorpexEventV10 = {
      id: 'evt_4',
      type: 'unknown.event',
      version: 1,
      timestamp: Date.now(),
      traceId: 'trace_4',
      missionId: 'mis_4',
      payload: {},
    };

    const result = validator.validate(event);
    expect(result.valid).toBe(true); // no schema = no errors
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('should validate batch', () => {
    const valid: MorpexEventV10 = {
      id: 'evt_5', type: 'mission.created', version: 1, timestamp: Date.now(),
      traceId: 't5', missionId: 'm5', payload: { missionId: 'm5', goal: 'Test' },
    };
    const invalid: MorpexEventV10 = {
      id: 'evt_6', type: 'mission.created', version: 1, timestamp: Date.now(),
      traceId: 't6', missionId: 'm6', payload: {},
    };

    const result = validator.validateBatch([valid, invalid]);
    expect(result.valid).toBe(1);
    expect(result.invalid).toBe(1);
  });

  it('should expose health check', () => {
    const health = validator.health();
    expect(health.ok).toBe(true);
    expect(health.name).toBe('SchemaValidator');
  });
});

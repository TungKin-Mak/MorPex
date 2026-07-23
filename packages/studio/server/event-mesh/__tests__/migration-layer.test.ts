/**
 * MigrationLayer — 测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MigrationLayer } from '../migration-layer.js';

describe('MigrationLayer', () => {
  let migration: MigrationLayer;

  beforeEach(() => {
    migration = new MigrationLayer();
  });

  it('should register custom migration', () => {
    migration.registerMigration('custom.event', {
      fromVersion: 1,
      toVersion: 2,
      description: 'Add field X',
      migrate: (event: any) => ({
        ...event,
        payload: { ...event.payload, fieldX: 'default' },
        version: 2,
      }),
    });

    const steps = migration.getAvailableMigrations('custom.event');
    expect(steps).toHaveLength(1);
    expect(steps[0].description).toBe('Add field X');
  });

  it('should migrate event to target version', () => {
    migration.registerMigration('test.event', {
      fromVersion: 1,
      toVersion: 2,
      description: 'Add newField',
      migrate: (event: any) => ({
        ...event,
        payload: { ...event.payload, newField: 'migrated' },
        version: 2,
      }),
    });

    const event = { type: 'test.event', version: 1, payload: { oldField: 'value' } };
    const result = migration.migrate(event, 2);

    expect(result.version).toBe(2);
    expect(result.payload.newField).toBe('migrated');
    expect(result.payload.oldField).toBe('value');
  });

  it('should skip migration if already at target version', () => {
    const event = { type: 'test.event', version: 2, payload: {} };
    const result = migration.migrate(event, 2);

    expect(result).toBe(event); // same reference
  });

  it('should migrate batch', () => {
    migration.registerMigration('test.event', {
      fromVersion: 1,
      toVersion: 2,
      description: 'test',
      migrate: (e: any) => ({ ...e, version: 2 }),
    });

    const events = [
      { type: 'test.event', version: 1, payload: {} },
      { type: 'test.event', version: 2, payload: {} },
      { type: 'other.event', version: 1, payload: {} },
    ];

    const result = migration.migrateBatch(events, 2);
    expect(result.migrated).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.failed).toBe(0);
  });

  it('should have default migrations registered', () => {
    const steps = migration.getAvailableMigrations('mission.created');
    expect(steps.length).toBeGreaterThan(0);
  });

  it('should expose health check', () => {
    const health = migration.health();
    expect(health.ok).toBe(true);
    expect(health.name).toBe('MigrationLayer');
    expect(health.registeredMigrations).toBeGreaterThan(0);
  });
});

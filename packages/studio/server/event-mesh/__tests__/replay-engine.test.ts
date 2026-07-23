/**
 * ReplayEngine — 测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ReplayEngine } from '../replay-engine.js';

describe('ReplayEngine', () => {
  const capturedEvents: any[] = [];
  const mockBus = {
    emit: (event: any) => { capturedEvents.push(event); },
  };

  const eventSource = () => [
    { id: 'e1', type: 'mission.created', timestamp: 1000, executionId: 'mis_1', source: 'test', payload: { goal: 'Task 1' } },
    { id: 'e2', type: 'plan.created', timestamp: 1100, executionId: 'mis_1', source: 'test', payload: { steps: 3 } },
    { id: 'e3', type: 'execution.started', timestamp: 1200, executionId: 'mis_1', source: 'test', payload: {} },
    { id: 'e4', type: 'mission.created', timestamp: 2000, executionId: 'mis_2', source: 'test', payload: { goal: 'Task 2' } },
    { id: 'e5', type: 'plan.created', timestamp: 2100, executionId: 'mis_2', source: 'test', payload: { steps: 5 } },
    { id: 'e6', type: 'mission.completed', timestamp: 3000, executionId: 'mis_2', source: 'test', payload: { score: 95 } },
  ];

  beforeEach(() => {
    capturedEvents.length = 0;
  });

  it('should replay all events', async () => {
    const engine = new ReplayEngine(mockBus as any, eventSource);
    const result = await engine.replay({});

    expect(result.totalEvents).toBe(6);
    expect(result.processed).toBe(6);
    expect(result.failed).toBe(0);
    expect(capturedEvents.length).toBe(6);
  });

  it('should filter by event type', async () => {
    const engine = new ReplayEngine(mockBus as any, eventSource);
    const result = await engine.replayByType(['mission.created']);

    expect(result.totalEvents).toBe(2);
    expect(result.processed).toBe(2);
  });

  it('should filter by mission ID', async () => {
    const engine = new ReplayEngine(mockBus as any, eventSource);
    const result = await engine.replayByMission('mis_2');

    expect(result.totalEvents).toBe(3);
    expect(result.processed).toBe(3);
  });

  it('should filter by time range', async () => {
    const engine = new ReplayEngine(mockBus as any, eventSource);
    const result = await engine.replay({ startTime: 1500, endTime: 2500 });

    expect(result.totalEvents).toBe(2);
    expect(result.processed).toBe(2);
  });

  it('should handle empty event source', async () => {
    const engine = new ReplayEngine(mockBus as any, () => []);
    const result = await engine.replay({});

    expect(result.totalEvents).toBe(0);
    expect(result.processed).toBe(0);
  });

  it('should mark replayed events', async () => {
    const engine = new ReplayEngine(mockBus as any, eventSource);
    await engine.replayByMission('mis_1');

    expect(capturedEvents.length).toBe(3);
    for (const evt of capturedEvents) {
      expect(evt.source).toBe('replay-engine');
      expect(evt.payload.__replayed).toBe(true);
    }
  });

  it('should expose health check', () => {
    const engine = new ReplayEngine(mockBus as any, eventSource);
    const health = engine.health();
    expect(health.ok).toBe(true);
    expect(health.name).toBe('ReplayEngine');
  });
});

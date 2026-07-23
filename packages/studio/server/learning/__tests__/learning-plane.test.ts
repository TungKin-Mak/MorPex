/**
 * LearningPlane — 单元测试
 */
import { describe, it, expect } from 'vitest';
import { LearningPlane } from '../learning-plane.js';

describe('LearningPlane', () => {
  it('should initialize with all submodules', () => {
    const plane = new LearningPlane();
    expect(plane.experience).toBeDefined();
    expect(plane.workflow).toBeDefined();
    expect(plane.preference).toBeDefined();
  });

  it('should expose health check', () => {
    const plane = new LearningPlane();
    const health = plane.health();
    expect(health.ok).toBe(true);
    expect(health.name).toBe('LearningPlane');
    expect(Object.keys(health.submodules)).toHaveLength(3);
  });

  it('should handle emitLearningUpdated without bus', () => {
    const plane = new LearningPlane();
    // Should not throw
    plane.emitLearningUpdated('experience', { missionId: 'test' });
  });

  it('should have functioning experience learning health', () => {
    const plane = new LearningPlane();
    const health = plane.experience.health();
    expect(health.ok).toBe(true);
  });

  it('should have functioning workflow learning health', () => {
    const plane = new LearningPlane();
    const health = plane.workflow.health();
    expect(health.ok).toBe(true);
  });

  it('should have functioning preference learning health', () => {
    const plane = new LearningPlane();
    const health = plane.preference.health();
    expect(health.ok).toBe(true);
  });
});

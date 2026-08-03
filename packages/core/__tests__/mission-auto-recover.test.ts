/**
 * mission-auto-recover 测试 — Mission 恢复回路接线（autoRecover）
 *
 * 审计发现：MissionController.recover/resolveBlock 零外部调用 → 阻塞后无恢复回路。
 * 修复：新增 autoRecover（非人工阻塞自动恢复）+ MorPexRuntime soft 分支接线。
 */
import { describe, it, expect } from 'vitest';
import { MissionController } from '../src/execution/runtime/mission/MissionController.js';
import { EventBus } from '../src/infrastructure/common/EventBus.js';

function setup() {
  const bus = new EventBus();
  const mc = new MissionController(bus);
  return { mc };
}

describe('MissionController.autoRecover', () => {
  it('非人工阻塞（RESOURCE_UNAVAILABLE）→ 自动恢复 ACTIVE', async () => {
    const { mc } = setup();
    const m = await mc.createMission('g1', '测试任务');
    mc.addBlock(m.missionId, 'RESOURCE_UNAVAILABLE', '资源不足');
    expect(mc.getMission(m.missionId)!.status).toBe('BLOCKED');

    const r = mc.autoRecover(m.missionId);
    expect(r.recovered).toBe(true);
    expect(r.needsHuman).toBe(false);
    expect(mc.getMission(m.missionId)!.status).toBe('ACTIVE');
  });

  it('非人工阻塞（QUALITY_FAILED）→ 自动恢复（recover 推荐 replan）', async () => {
    const { mc } = setup();
    const m = await mc.createMission('g2', '测试任务');
    mc.addBlock(m.missionId, 'QUALITY_FAILED', '质量不达标');
    const r = mc.autoRecover(m.missionId);
    expect(r.recovered).toBe(true);
    expect(mc.getMission(m.missionId)!.status).toBe('ACTIVE');
  });

  it('人工阻塞（HUMAN_WAITING）→ 不自动恢复（needsHuman=true，保持等待）', async () => {
    const { mc } = setup();
    const m = await mc.createMission('g3', '测试任务');
    mc.addBlock(m.missionId, 'HUMAN_WAITING', '等待审批');
    const r = mc.autoRecover(m.missionId);
    expect(r.recovered).toBe(false);
    expect(r.needsHuman).toBe(true);
    expect(mc.getMission(m.missionId)!.status).toBe('BLOCKED');
  });

  it('人工阻塞（COMPLIANCE_BLOCKED）→ 不自动恢复', async () => {
    const { mc } = setup();
    const m = await mc.createMission('g4', '测试任务');
    mc.addBlock(m.missionId, 'COMPLIANCE_BLOCKED', '合规拦截');
    const r = mc.autoRecover(m.missionId);
    expect(r.recovered).toBe(false);
    expect(r.needsHuman).toBe(true);
    expect(mc.getMission(m.missionId)!.status).toBe('BLOCKED');
  });

  it('无阻塞 → recovered=true continue', async () => {
    const { mc } = setup();
    const m = await mc.createMission('g5', '测试任务');
    const r = mc.autoRecover(m.missionId);
    expect(r.recovered).toBe(true);
    expect(r.recommended).toBe('continue');
  });
});

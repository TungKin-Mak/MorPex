import re

with open('/e/Morpex/packages/core/src/runtime/mission/MissionRuntime.ts', 'r') as f:
    content = f.read()

old = """    // 发射 APPROVAL_GRANTED 事件
    this.bus.emit({
      id: `evt_${missionId}_approved`,
      type: EventType.APPROVAL_GRANTED,
      timestamp: Date.now(),
      executionId: missionId,
      source: 'mission-runtime',
      payload: { missionId, goal: mission.goal, approvedBy: by },
    });

    // 恢复执行
    return this.executeMission(missionId);"""

new = """    // 发射 APPROVAL_GRANTED 事件
    this.bus.emit({
      id: `evt_${missionId}_approved`,
      type: EventType.APPROVAL_GRANTED,
      timestamp: Date.now(),
      executionId: missionId,
      source: 'mission-runtime',
      payload: { missionId, goal: mission.goal, approvedBy: by },
    });

    // v8.5 Fix: Resume execution with existing plan (skip planning phase)
    await this.transitionState(mission, MissionState.EXECUTING, 'approval_granted_resume');
    console.log(`[MissionRuntime] Resuming ${missionId} with existing plan`);

    this.bus.emit({
      id: `evt_${missionId}_resume`,
      type: EventType.EXECUTION_STARTED,
      timestamp: Date.now(),
      executionId: missionId,
      source: 'mission-runtime',
      payload: { missionId, goal: mission.goal, stepsTotal: mission.plan?.steps.length || 0 },
    });

    if (!this.executor) {
      throw new Error('[MissionRuntime] No executor registered.');
    }
    const execResult = await this.executor.execute(mission, mission.plan);
    const resumeStartTime = Date.now();

    await this.transitionState(mission, MissionState.VERIFYING, 'execution_complete');

    if (execResult.state === MissionState.FAILED) {
      mission.error = execResult.error;
      await this.transitionState(mission, MissionState.FAILED, execResult.error || 'execution_failed');
      this.bus.emit({
        id: `evt_${missionId}_resume_fail`,
        type: EventType.EXECUTION_FAILED,
        timestamp: Date.now(),
        executionId: missionId,
        source: 'mission-runtime',
        payload: { missionId, goal: mission.goal, error: execResult.error },
      });
    } else {
      mission.completedAt = Date.now();
      await this.transitionState(mission, MissionState.COMPLETED, 'all_steps_completed');
      this.bus.emit({
        id: `evt_${missionId}_resume_done`,
        type: EventType.MISSION_COMPLETED,
        timestamp: Date.now(),
        executionId: missionId,
        source: 'mission-runtime',
        payload: {
          missionId, goal: mission.goal,
          stepsCompleted: execResult.stepsCompleted,
          stepsTotal: execResult.stepsTotal,
          duration: Date.now() - resumeStartTime,
          artifacts: execResult.artifacts,
        },
      });
    }

    return {
      missionId,
      state: mission.state,
      stepsCompleted: execResult.stepsCompleted,
      stepsTotal: execResult.stepsTotal,
      output: execResult.output,
      artifacts: execResult.artifacts,
      duration: Date.now() - resumeStartTime,
      error: mission.error,
    };"""

if old in content:
    content = content.replace(old, new)
    with open('/e/Morpex/packages/core/src/runtime/mission/MissionRuntime.ts', 'w') as f:
        f.write(content)
    print("Fixed approveMission - replaced with inline resume path")
else:
    print("ERROR: Could not find old text in file")
    # Debug: show partial match
    idx = content.find("return this.executeMission(missionId)")
    if idx >= 0:
        print(f"Found 'return this.executeMission' at position {idx}")
        print(content[idx-200:idx+200])

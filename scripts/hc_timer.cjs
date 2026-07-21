const fs = require('fs');
let c = fs.readFileSync('packages/studio/server/StudioServer.ts', 'utf8');

const oldTimer = `  private runBehaviorTwinCheck(): void {
    if (!this.v8BehaviorTwin || !this.v8PersonalBrain) return;
    try {
      const profile = this.v8BehaviorTwin.buildProfile();
      this.v8PersonalBrain.storeFact(
        'BehaviorTwin periodic check: planningStyle=' + profile.planningStyle +
        ', riskTolerance=' + profile.riskTolerance +
        ', taskDecomposition=' + profile.taskDecomposition +
        ', evidenceCount=' + profile.evidenceCount +
        ', confidence=' + profile.confidence.toFixed(2),
        ['behavior-twin', 'periodic-check', profile.planningStyle]
      ).catch(() => {});
      if (this.kernel?.eventBus) {
        this.kernel.eventBus.emit({
          id: 'evt_behavior_check_' + Date.now(),
          type: 'behavior.drift',
          timestamp: Date.now(),
          executionId: 'behavior-twin-scheduler',
          source: 'studio-server',
          payload: {
            action: 'periodic_check',
            planningStyle: profile.planningStyle,
            riskTolerance: profile.riskTolerance,
            taskDecomposition: profile.taskDecomposition,
            evidenceCount: profile.evidenceCount,
            confidence: profile.confidence,
          },
        });
      }
      console.log('[BehaviorTwin] 周期检查完成: ' + profile.planningStyle +
        ', risk=' + profile.riskTolerance +
        ', evidence=' + profile.evidenceCount +
        ', confidence=' + profile.confidence.toFixed(2));
    } catch (err: unknown) {
      console.warn('[BehaviorTwin] 周期检查异常:', (err as Error).message);
    }
  }`;

const newTimer = `  private runBehaviorTwinCheck(): void {
    // ★ v8.5 人控模式：通过 CognitiveLoop.checkDrift() 检测漂移
    // 漂移结果存入待确认队列，需人工 accept/reject
    if (this.v8CognitiveLoop) {
      try {
        const drift = this.v8CognitiveLoop.checkDrift();
        if (drift) {
          console.log('[BehaviorTwin] 漂移待确认: ' + drift.changes.join(', '));
        }
      } catch (err: unknown) {
        console.warn('[BehaviorTwin] checkDrift 异常:', (err as Error).message);
      }
      return;
    }
    // Fallback: 如果 CognitiveLoop 未就绪，仍记录到 PersonalBrain
    if (!this.v8BehaviorTwin || !this.v8PersonalBrain) return;
    try {
      const profile = this.v8BehaviorTwin.buildProfile();
      this.v8PersonalBrain.storeFact(
        'BehaviorTwin periodic check: ' + profile.planningStyle,
        ['behavior-twin', 'periodic-check']
      ).catch(() => {});
    } catch (err: unknown) {
      console.warn('[BehaviorTwin] 周期检查异常:', (err as Error).message);
    }
  }`;

c = c.replace(oldTimer, newTimer);

fs.writeFileSync('packages/studio/server/StudioServer.ts', c);
console.log('Timer updated to use checkDrift()');

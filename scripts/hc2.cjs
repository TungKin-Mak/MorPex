const fs = require('fs');
let c = fs.readFileSync('packages/core/src/runtime/cognitive-loop/CognitiveLoop.ts', 'utf8');

const api = `
  // ── Human Control API ──
  getPendingCandidates(): WorkflowCandidateEntry[] { return this.pendingWf.filter(function(x) { return x.status === 'pending'; }); }
  getAllCandidates(): WorkflowCandidateEntry[] { return this.pendingWf.slice(); }
  approveCandidate(id, by) {
    var e = this.pendingWf.find(function(x) { return x.id === id; });
    if (!e || e.status !== 'pending') return undefined;
    e.status = 'approved'; e.approvedBy = by || 'human'; e.approvedAt = Date.now();
    if (this.workflowRegistry) {
      this.workflowRegistry.register({ name: e.name, description: e.description, steps: [], confidence: e.confidence, sourceMissionIds: e.sourceMissionIds, detectedAt: e.detectedAt, suggestedFrequency: 'regular' });
    }
    return e;
  }
  denyCandidate(id, by) {
    var e = this.pendingWf.find(function(x) { return x.id === id; });
    if (!e || e.status !== 'pending') return undefined;
    e.status = 'denied'; e.approvedBy = by || 'human'; e.approvedAt = Date.now(); return e;
  }
  getPendingDrifts() { return this.pendingDrift.filter(function(x) { return x.status === 'pending'; }); }
  acceptDrift(id, by) {
    var e = this.pendingDrift.find(function(x) { return x.id === id; });
    if (!e || e.status !== 'pending') return undefined;
    e.status = 'accepted'; e.confirmedBy = by || 'human'; e.confirmedAt = Date.now(); this.lastProfile = e.currentProfile; return e;
  }
  rejectDrift(id, by) {
    var e = this.pendingDrift.find(function(x) { return x.id === id; });
    if (!e || e.status !== 'pending') return undefined;
    e.status = 'rejected'; e.confirmedBy = by || 'human'; e.confirmedAt = Date.now(); return e;
  }
  checkDrift() {
    if (!this.behaviorTwin) return null;
    var cur = this.behaviorTwin.buildProfile();
    if (!this.lastProfile) { this.lastProfile = cur; return null; }
    var ch = [];
    if (this.lastProfile.planningStyle !== cur.planningStyle) ch.push('planningStyle: ' + this.lastProfile.planningStyle + '->' + cur.planningStyle);
    if (this.lastProfile.riskTolerance !== cur.riskTolerance) ch.push('riskTolerance: ' + this.lastProfile.riskTolerance + '->' + cur.riskTolerance);
    if (this.lastProfile.taskDecomposition !== cur.taskDecomposition) ch.push('taskDecomposition: ' + this.lastProfile.taskDecomposition + '->' + cur.taskDecomposition);
    if (ch.length === 0) return null;
    var e = { id: 'bd_' + Date.now(), detectedAt: Date.now(), changes: ch, previousProfile: this.lastProfile, currentProfile: cur, status: 'pending' };
    this.pendingDrift.push(e);
    this.bus.emit({ id: 'evt_drift_' + e.id, type: 'behavior.drift', timestamp: Date.now(), executionId: 'bt', source: 'cl', payload: { driftId: e.id, changes: ch, pending: true } });
    return e;
  }
  async execWfManual(wfId) {
    if (!this.workflowExecutor) return { success: false, error: 'not ready' };
    try { var r = await this.workflowExecutor.execute(wfId); return { success: r.success, missionId: r.missionId, error: r.error }; }
    catch (err) { return { success: false, error: err ? err.message : String(err) }; }
  }
  getHCConfig() { return { autoReg: this.autoReg, autoExec: this.autoExec, pendingWf: this.getPendingCandidates().length, pendingDrift: this.getPendingDrifts().length }; }
`;

c = c.replace('\n  getStats(): LoopStats', api + '\n  getStats(): LoopStats');

fs.writeFileSync('packages/core/src/runtime/cognitive-loop/CognitiveLoop.ts', c);
console.log('Part 2 done, lines:', c.split('\n').length);

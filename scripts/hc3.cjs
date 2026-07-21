const fs = require('fs');
let c = fs.readFileSync('packages/core/src/runtime/cognitive-loop/CognitiveLoop.ts', 'utf8');

// Fix: add type annotations to all human-control methods
c = c.replace(
  "approveCandidate(id, by) {",
  "approveCandidate(id: string, by?: string): WorkflowCandidateEntry | undefined {"
);
c = c.replace(
  "denyCandidate(id, by) {",
  "denyCandidate(id: string, by?: string): WorkflowCandidateEntry | undefined {"
);
c = c.replace(
  "acceptDrift(id, by) {",
  "acceptDrift(id: string, by?: string): BehaviorDriftEntry | undefined {"
);
c = c.replace(
  "rejectDrift(id, by) {",
  "rejectDrift(id: string, by?: string): BehaviorDriftEntry | undefined {"
);
c = c.replace(
  "getPendingDrifts() {",
  "getPendingDrifts(): BehaviorDriftEntry[] {"
);
c = c.replace(
  "checkDrift() {",
  "checkDrift(): BehaviorDriftEntry | null {"
);
c = c.replace(
  "async execWfManual(wfId) {",
  "async execWfManual(wfId: string): Promise<{ success: boolean; missionId?: string; error?: string }> {"
);
// Fix the BehaviorDriftEntry assignment - need to match the interface
c = c.replace(
  "var e = { id: 'bd_' + Date.now(), detectedAt: Date.now(), changes: ch, previousProfile: this.lastProfile, currentProfile: cur, status: 'pending' };",
  "var e: BehaviorDriftEntry = { id: 'bd_' + Date.now(), detectedAt: Date.now(), changes: ch, previousProfile: this.lastProfile, currentProfile: cur, status: 'pending' };"
);

fs.writeFileSync('packages/core/src/runtime/cognitive-loop/CognitiveLoop.ts', c);
console.log('Types fixed');

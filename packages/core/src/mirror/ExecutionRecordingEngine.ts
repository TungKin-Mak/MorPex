/**
 * ExecutionRecordingEngine — STUB (ghost module, removed during v4→v9 refactor)
 * @deprecated No longer used. Execution traces are handled by ExecutionMirror + EventStore.
 */
export class ExecutionRecordingEngine {
  name = 'ExecutionRecordingEngine';
  version = '1.0.0';
  constructor(_opts?: any) {}
  startRecording(_sessionId: string, _execId: string) { return 'rec_1'; }
  stopRecording() { return {}; }
  getStats() { return { totalRecordings: 0 }; }
}

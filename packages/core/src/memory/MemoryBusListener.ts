/**
 * MemoryBusListener — STUB (removed during v4→v9 refactor)
 * @deprecated Memory hooks are now handled by MemoryHooks directly.
 */
export class MemoryBusListener {
  name = 'MemoryBusListener';
  version = '1.0.0';
  constructor(_opts?: any) {}
  async start() {}
  async stop() {}
  getStats() { return { totalEvents: 0 }; }
}

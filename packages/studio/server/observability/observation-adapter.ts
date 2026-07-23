/**
 * ObservationAdapter — 旧 traceBus/TraceEvent → 新 Observation 桥接
 *
 * 双写期间保留旧路径，同时将数据喂入新的 ObservationCollector。
 * 迁移完成后可删除此文件，所有入口直接使用 RuntimeInvoker/ObservableModule。
 */

import { ObservationCollector } from './observation.js';
import type { TraceEvent } from './types.js';

export function adaptTraceEvent(event: TraceEvent): void {
  const obsType =
    event.eventType === 'MODULE_START' ? 'SPAN' :
    event.eventType === 'MODULE_END' ? 'SPAN' :
    event.eventType === 'ERROR' ? 'EVENT' :
    event.eventType === 'STATE_CHANGE' ? 'STATE' :
    event.eventType === 'TOOL_CALL' ? 'SPAN' :
    'EVENT';

  ObservationCollector.collect({
    id: event.id,
    traceId: event.executionId || event.taskId,
    executionId: event.executionId || '',
    taskId: event.taskId,
    type: obsType,
    source: {
      module: event.module.name,
      layer: event.module.layer,
      version: event.module.version,
    },
    operation: event.eventType,
    timestamp: event.timestamp,
    duration: event.metadata?.latency as number | undefined,
    status: event.eventType === 'ERROR' ? 'failed' :
            event.eventType === 'MODULE_END' ? 'success' :
            'started',
    payload: event.output ?? event.input,
    metadata: event.metadata as Record<string, unknown> | undefined,
  });
}

/**
 * Wire the adapter into traceBus.
 * Call once during startup — after this, all traceBus.emit() calls
 * automatically feed into ObservationCollector.
 */
export function wireObservationAdapter(traceBus: { onEvent: (fn: (e: TraceEvent) => void) => void }): void {
  traceBus.onEvent((event) => {
    adaptTraceEvent(event);
  });
  console.log('[ObservationAdapter] ✅ traceBus → ObservationCollector bridge active');
}

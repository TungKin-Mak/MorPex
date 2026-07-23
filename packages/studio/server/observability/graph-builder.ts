/**
 * GraphBuilder — 运行时图构建器
 *
 * 从 TraceEvent 流中重建每个 Task 的执行图。
 * 节点按模块聚合，边按事件顺序链接。
 */

import { type TraceEvent, type GraphNode, type TaskTimelineEntry } from './types';
import { type TraceStore } from './trace-store';

export class GraphBuilder {
  constructor(private store: TraceStore) {}

  buildTaskGraph(taskId: string): GraphNode[] {
    const events = this.store.getEventsByTask(taskId);
    const nodes = new Map<string, GraphNode>();
    let prevModule: string | null = null;

    for (const event of events) {
      if (event.eventType === 'MODULE_START') {
        const nodeId = `${taskId}_${event.module.name}`;
        const existing = nodes.get(nodeId);
        if (!existing) {
          const node: GraphNode = {
            id: nodeId,
            moduleName: event.module.name,
            layer: event.module.layer,
            status: 'running',
            taskId,
            startTime: event.timestamp,
            input: event.input,
            children: [],
            parents: [],
          };
          nodes.set(nodeId, node);
        } else {
          existing.status = 'running';
          existing.startTime = event.timestamp;
        }

        // Link to previous module in the same task
        if (prevModule && prevModule !== event.module.name) {
          const prevNodeId = `${taskId}_${prevModule}`;
          const currNodeId = `${taskId}_${event.module.name}`;
          const prevNode = nodes.get(prevNodeId);
          const currNode = nodes.get(currNodeId);
          if (prevNode && currNode) {
            if (!prevNode.children.includes(event.module.name)) {
              prevNode.children.push(event.module.name);
            }
            if (!currNode.parents.includes(prevModule)) {
              currNode.parents.push(prevModule);
            }
          }
        }
        prevModule = event.module.name;
      } else if (event.eventType === 'MODULE_END') {
        const nodeId = `${taskId}_${event.module.name}`;
        const node = nodes.get(nodeId);
        if (node) {
          node.status = 'success';
          node.endTime = event.timestamp;
          node.output = event.output;
        }
      } else if (event.eventType === 'ERROR') {
        const nodeId = `${taskId}_${event.module.name}`;
        const node = nodes.get(nodeId);
        if (node) {
          node.status = 'failed';
          node.endTime = event.timestamp;
          node.output = event.output;
        }
      } else if (event.eventType === 'STATE_CHANGE') {
        // STATE_CHANGE can indicate retry
        const nodeId = `${taskId}_${event.module.name}`;
        const node = nodes.get(nodeId);
        if (node && node.status === 'failed') {
          node.status = 'retry';
        }
      }
    }

    return Array.from(nodes.values());
  }

  buildAllTaskGraphs(): Map<string, GraphNode[]> {
    const tasks = new Set<string>();
    const allEvents = this.store.getAllEvents(5000);

    for (const event of allEvents) {
      if (event.taskId) tasks.add(event.taskId);
    }

    const result = new Map<string, GraphNode[]>();
    for (const taskId of tasks) {
      result.set(taskId, this.buildTaskGraph(taskId));
    }
    return result;
  }

  getTimeline(): TaskTimelineEntry[] {
    const taskGraphs = this.buildAllTaskGraphs();
    const timeline: TaskTimelineEntry[] = [];

    for (const [taskId, nodes] of taskGraphs) {
      const moduleNames = nodes.map(n => n.moduleName);
      const startTimes = nodes
        .map(n => n.startTime)
        .filter((t): t is number => t !== undefined);
      const endTimes = nodes
        .map(n => n.endTime)
        .filter((t): t is number => t !== undefined);

      if (startTimes.length === 0) continue;

      timeline.push({
        taskId,
        modules: moduleNames,
        startTime: Math.min(...startTimes),
        endTime: endTimes.length > 0 ? Math.max(...endTimes) : undefined,
      });
    }

    timeline.sort((a, b) => a.startTime - b.startTime);
    return timeline;
  }
}

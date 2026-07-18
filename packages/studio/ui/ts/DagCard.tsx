/* ═══════════════════════════════════════════════════════════════════════
   DagCard.tsx — 内联任务列表
   ★ v3.2 改造：节点点击触发 openNodeInZoneB，不再内联 TaskShell。
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useState, useMemo } from 'react';
import type { DagPlanData, DagNodeMeta } from './types';

interface DagCardProps {
  executionId: string;
  dag: DagPlanData;
  /** 从外部流入的节点实时状态（SSE 驱动） */
  nodeStatuses?: Record<string, { status: string; result?: any; error?: string }>;
  /** ★ v3.2: 节点点击回调（由 ZoneD 传入，触发 openNodeInZoneB） */
  onNodeClick?: (taskId: string, goal: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#666',
  running: '#4488ff',
  completed: '#33cc55',
  failed: '#ff3333',
  awaiting_input: '#ffbb33',
  interrupted: '#ff8800',
};

const STATUS_LABELS: Record<string, string> = {
  pending: '等待',
  running: '执行中',
  completed: '已完成',
  failed: '异常',
  awaiting_input: '需输入',
  interrupted: '中断',
};

/* ── 主组件 ── */
const DagCard: React.FC<DagCardProps> = ({ executionId, dag, nodeStatuses, onNodeClick }) => {
  const [expanded, setExpanded] = useState(false);
  const nodes = dag.nodes || [];

  // 合并外部状态
  const enrichedNodes = useMemo(() =>
    nodes.map((n) => {
      const extStatus = nodeStatuses?.[n.taskId]?.status;
      return {
        ...n,
        status: (extStatus || n.status || 'pending') as DagNodeMeta['status'],
        result: nodeStatuses?.[n.taskId]?.result || n.result,
        error: nodeStatuses?.[n.taskId]?.error || n.error,
      };
    }),
  [nodes, nodeStatuses]);

  const completedCount = enrichedNodes.filter((n) => n.status === 'completed').length;
  const failedCount = enrichedNodes.filter((n) => n.status === 'failed').length;
  const runningCount = enrichedNodes.filter((n) => n.status === 'running').length;
  const interruptedCount = enrichedNodes.filter((n) => n.status === 'interrupted').length;

  // 计算最新状态摘要
  const latestStatus = useMemo(() => {
    const fmtGoal = (g: string) => g.length > 20 ? g.slice(0, 18) + '…' : g;
    const awaiting = enrichedNodes.filter(n => n.status === 'awaiting_input');
    if (awaiting.length > 0) {
      const idx = enrichedNodes.indexOf(awaiting[0]) + 1;
      return `任务${idx}:❓ ${fmtGoal(awaiting[0].goal || awaiting[0].taskId)} 需输入`;
    }
    const running = enrichedNodes.filter(n => n.status === 'running');
    if (running.length > 0) {
      const idx = enrichedNodes.indexOf(running[0]) + 1;
      return `任务${idx}:● ${fmtGoal(running[0].goal || running[0].taskId)} 执行中`;
    }
    const interrupted = enrichedNodes.filter(n => n.status === 'interrupted');
    if (interrupted.length > 0) {
      return `⚡ ${interrupted.length}个中断`;
    }
    const failed = enrichedNodes.filter(n => n.status === 'failed');
    if (failed.length > 0) {
      return `✗ ${failed.length}个失败`;
    }
    return '';
  }, [enrichedNodes]);

  // 点击节点行：触发 onNodeClick（打开 ZoneB node tab）
  const handleNodeClick = (taskId: string, goal: string) => {
    onNodeClick?.(taskId, goal);
  };

  return (
    <div className="dag-card">
      {/* ── 头部：点击展开/收起节点列表 ── */}
      <div className="dag-card-header" onClick={() => setExpanded(!expanded)}>
        <div className="dag-card-title-row">
          <span className="dag-card-icon">{expanded ? '▼' : '▶'}</span>
          <span className="dag-card-title">
            {dag.globalIntent || '任务规划'}
          </span>
          {dag.agent && <span className="dag-card-agent">[{dag.agent.replace('@', '')}]</span>}
        </div>
        <div className="dag-card-meta">
          <span className="dag-card-count"><span className="num-red">{nodes.length}</span>个节点</span>
          <span className="dag-card-badge" style={{ color: '#a855f7', borderColor: '#a855f7' }}>{dag.isMultiDomain ? '跨域' : '单域'}</span>
          <span className="dag-card-progress">
            <span className="num-red">{completedCount}/{nodes.length}</span>完成
          </span>
          {latestStatus && <span className="dag-card-status">{latestStatus}</span>}
        </div>
        <div className="dag-card-id">{executionId}</div>
      </div>

      {/* ── 展开后：节点列表（点击触发 openNodeInZoneB） ── */}
      {expanded && (
        <div className="dag-card-body">
          {enrichedNodes.map((node, idx) => {
            const st = node.status || 'pending';
            return (
              <div
                key={node.taskId}
                className="dag-node-row"
                onClick={(e) => {
                  e.stopPropagation();
                  handleNodeClick(node.taskId, node.goal || node.taskId);
                }}
              >
                <span className="dag-node-index">#{idx + 1}</span>
                <span className="dag-node-status" style={{ color: STATUS_COLORS[st] || '#666' }}>
                  ● {STATUS_LABELS[st] || st}
                </span>
                <span className="dag-node-domain">[{node.domain}]</span>
                <span className="dag-node-goal">{node.goal || node.taskId}</span>
                {node.deps && node.deps.length > 0 && (
                  <span className="dag-node-deps">依赖: {node.deps.join(', ')}</span>
                )}
                <span className="dag-node-detail-arrow">›</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DagCard;

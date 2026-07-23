/* ═══════════════════════════════════════════════════════════════════════
   debug/RuntimeGraph.tsx — 运行时图 v9.1.3
   
   纯 DOM 渲染 DAG（不再依赖 ECharts Graph 系列）。
   
   节点状态着色：
     灰 #30363d = idle
     蓝 #58a6ff = running
     绿 #3fb950 = success
     红 #f85149 = failed
     黄 #d29922 = retry
   
   连接线使用 CSS border + 伪元素绘制。
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useRef, useEffect, useMemo, useState } from 'react';
import type { GraphNode } from './types';

interface Props {
  graphs: Map<string, GraphNode[]>;
  selectedTask: string | null;
  onSelectTask: (taskId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  idle:     '#30363d',
  running:  '#58a6ff',
  success:  '#3fb950',
  failed:   '#f85149',
  retry:    '#d29922',
};

const LAYER_TAGS: Record<string, { bg: string; fg: string }> = {
  'control-plane': { bg: 'rgba(88,166,255,0.10)', fg: '#58a6ff' },
  'runtime':       { bg: 'rgba(63,185,80,0.10)',  fg: '#3fb950' },
  'knowledge':     { bg: 'rgba(188,140,255,0.10)', fg: '#bc8cff' },
  'evolution':     { bg: 'rgba(210,153,34,0.10)',  fg: '#d29922' },
  'interaction':   { bg: 'rgba(248,81,73,0.10)',   fg: '#f85149' },
};

// ── Layout engine: arrange nodes top→bottom, center horizontally ──

interface LayoutNode {
  node: GraphNode;
  x: number;
  y: number;
  level: number;
}

function computeLayout(nodes: GraphNode[]): LayoutNode[] {
  if (nodes.length === 0) return [];

  // Build adjacency
  const nodeMap = new Map(nodes.map(n => [n.moduleName, n]));
  
  // Compute level via longest path from sources (parents.length === 0)
  const levels = new Map<string, number>();
  
  function getLevel(name: string, visited: Set<string>): number {
    if (levels.has(name)) return levels.get(name)!;
    if (visited.has(name)) return 0; // cycle guard
    visited.add(name);
    
    const node = nodeMap.get(name);
    if (!node) { levels.set(name, 0); return 0; }
    
    if (node.parents.length === 0) {
      levels.set(name, 0);
      return 0;
    }
    
    let maxParent = 0;
    for (const p of node.parents) {
      maxParent = Math.max(maxParent, getLevel(p, new Set(visited)) + 1);
    }
    levels.set(name, maxParent);
    return maxParent;
  }
  
  for (const n of nodes) {
    getLevel(n.moduleName, new Set());
  }

  // Group by level
  const byLevel = new Map<number, GraphNode[]>();
  for (const n of nodes) {
    const lvl = levels.get(n.moduleName) || 0;
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl)!.push(n);
  }

  const maxLevel = Math.max(...Array.from(byLevel.keys()), 0);
  const layout: LayoutNode[] = [];
  const NODE_W = 150;
  const NODE_H = 56;
  const H_GAP = 40;
  const V_GAP = 60;

  for (let lvl = 0; lvl <= maxLevel; lvl++) {
    const levelNodes = byLevel.get(lvl) || [];
    const totalWidth = levelNodes.length * NODE_W + (levelNodes.length - 1) * H_GAP;
    const startX = -totalWidth / 2;
    
    levelNodes.forEach((n, i) => {
      layout.push({
        node: n,
        x: startX + i * (NODE_W + H_GAP),
        y: lvl * (NODE_H + V_GAP),
        level: lvl,
      });
    });
  }

  return layout;
}

// ── SVG connector lines between nodes ──

function Connectors({ layout, nodeMap }: { layout: LayoutNode[]; nodeMap: Map<string, LayoutNode> }) {
  const NODE_W = 150;
  const NODE_H = 56;

  const lines: Array<{ x1: number; y1: number; x2: number; y2: number; key: string; status: string }> = [];

  for (const ln of layout) {
    const childSet = new Set(ln.node.children);
    for (const childName of childSet) {
      const childLN = nodeMap.get(childName);
      if (!childLN) continue;
      
      const x1 = ln.x + NODE_W / 2;
      const y1 = ln.y + NODE_H;
      const x2 = childLN.x + NODE_W / 2;
      const y2 = childLN.y;
      
      const key = `${ln.node.moduleName}→${childName}`;
      const status = ln.node.status === 'running' ? 'running' : 'idle';
      lines.push({ x1, y1, x2, y2, key, status });
    }
  }

  if (lines.length === 0) return null;

  // Compute bounding box for SVG
  const padding = 200;
  const allXs = lines.flatMap(l => [l.x1, l.x2]);
  const allYs = lines.flatMap(l => [l.y1, l.y2]);
  const minX = Math.min(...allXs) - padding;
  const minY = Math.min(...allYs) - padding;
  const maxX = Math.max(...allXs) + padding;
  const maxY = Math.max(...allYs) + padding;
  const w = Math.max(maxX - minX, 100);
  const h = Math.max(maxY - minY, 100);

  return (
    <svg
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
        overflow: 'visible',
      }}
      viewBox={`${minX} ${minY} ${w} ${h}`}
    >
      <defs>
        <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="rgba(139,148,158,0.5)" />
        </marker>
        <marker id="arrowhead-running" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="rgba(88,166,255,0.7)" />
        </marker>
      </defs>
      {lines.map(l => (
        <line
          key={l.key}
          x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
          stroke={l.status === 'running' ? 'rgba(88,166,255,0.6)' : 'rgba(139,148,158,0.35)'}
          strokeWidth={l.status === 'running' ? 2 : 1.2}
          markerEnd={l.status === 'running' ? 'url(#arrowhead-running)' : 'url(#arrowhead)'}
        />
      ))}
    </svg>
  );
}

// ── Main component ──

export default function RuntimeGraph({ graphs, selectedTask, onSelectTask }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const taskIds = useMemo(() => Array.from(graphs.keys()), [graphs]);

  const selectedNodes = useMemo(() => {
    if (!selectedTask) return [];
    return graphs.get(selectedTask) || [];
  }, [graphs, selectedTask]);

  const layout = useMemo(() => computeLayout(selectedNodes), [selectedNodes]);
  const nodeMap = useMemo(() => {
    const m = new Map<string, LayoutNode>();
    for (const ln of layout) m.set(ln.node.moduleName, ln);
    return m;
  }, [layout]);

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale(s => Math.min(3, Math.max(0.2, s * delta)));
  };

  // Pan
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return; // only drag on background
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setOffset(o => ({ x: o.x + dx, y: o.y + dy }));
  };
  const handleMouseUp = () => { dragging.current = false; };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Task selector bar */}
      <div style={{
        padding: '5px 10px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-secondary)', display: 'flex',
        alignItems: 'center', gap: 5, flexWrap: 'wrap', minHeight: 32,
      }}>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
          textTransform: 'uppercase', letterSpacing: 1,
          color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap',
        }}>
          Runtime Graph
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>
          {selectedNodes.length > 0 ? `${selectedNodes.length} nodes` : ''}
        </span>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', maxHeight: 26, overflow: 'auto' }}>
          {taskIds.slice(-30).map(tid => (
            <button
              key={tid} title={tid}
              onClick={() => onSelectTask(tid)}
              style={{
                padding: '1px 5px', borderRadius: 3,
                border: `1px solid ${selectedTask === tid ? 'var(--accent-blue)' : 'var(--border)'}`,
                background: selectedTask === tid ? 'rgba(88,166,255,0.1)' : 'transparent',
                color: selectedTask === tid ? 'var(--accent-blue)' : 'var(--text-secondary)',
                fontSize: 9, fontFamily: "'JetBrains Mono', monospace",
                cursor: 'pointer', whiteSpace: 'nowrap', lineHeight: '18px',
              }}
            >
              {tid.length > 12 ? tid.slice(-12) : tid}
            </button>
          ))}
        </div>
      </div>

      {/* Graph area */}
      <div
        ref={containerRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          flex: 1, minHeight: 0, position: 'relative',
          overflow: 'hidden', cursor: dragging.current ? 'grabbing' : 'grab',
          background: 'var(--bg-primary)',
        }}
      >
        {layout.length === 0 ? (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            {selectedTask ? 'No nodes for this task' : 'Select a task to view graph'}
          </div>
        ) : (
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              transformOrigin: '0 0',
              transition: dragging.current ? 'none' : 'transform 0.15s ease',
            }}
          >
            {/* SVG connectors */}
            <Connectors layout={layout} nodeMap={nodeMap} />

            {/* Nodes */}
            {layout.map(ln => {
              const n = ln.node;
              const color = STATUS_COLORS[n.status] || STATUS_COLORS.idle;
              const layerTag = LAYER_TAGS[n.layer] || LAYER_TAGS['runtime'];
              const isRunning = n.status === 'running';

              return (
                <div
                  key={n.id}
                  title={`${n.moduleName}\nLayer: ${n.layer}\nStatus: ${n.status}\n${n.output ? JSON.stringify(n.output).slice(0, 60) : ''}`}
                  style={{
                    position: 'absolute',
                    left: ln.x,
                    top: ln.y,
                    width: 140,
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: 'var(--bg-secondary)',
                    border: `1.5px solid ${color}`,
                    boxShadow: isRunning ? `0 0 12px ${color}44, 0 0 4px ${color}88` : `0 2px 6px rgba(0,0,0,0.3)`,
                    zIndex: 2,
                    cursor: 'default',
                    animation: isRunning ? 'nodePulse 1.5s ease-in-out infinite' : undefined,
                  }}
                >
                  {/* Module name */}
                  <div style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10, fontWeight: 600, color: 'var(--text-primary)',
                    marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {n.moduleName}
                  </div>
                  {/* Layer tag */}
                  <div style={{
                    display: 'inline-block', padding: '1px 5px', borderRadius: 2,
                    background: layerTag.bg, color: layerTag.fg,
                    fontSize: 8, fontFamily: "'JetBrains Mono', monospace",
                    marginBottom: 3,
                  }}>
                    {n.layer}
                  </div>
                  {/* Status dot + duration */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    fontSize: 8, fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-muted)',
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
                    <span style={{ textTransform: 'capitalize' }}>{n.status}</span>
                    {n.startTime && n.endTime && (
                      <span>{n.endTime - n.startTime}ms</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{
        padding: '3px 10px', borderTop: '1px solid var(--border)',
        background: 'var(--bg-secondary)', display: 'flex',
        gap: 10, fontSize: 9, fontFamily: "'JetBrains Mono', monospace", flexWrap: 'wrap',
      }}>
        {Object.entries(STATUS_COLORS).map(([status, color]) => (
          <span key={status} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
            <span style={{ color: 'var(--text-muted)', textTransform: 'capitalize' }}>{status}</span>
          </span>
        ))}
        <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>
          🖱 Scroll=Zoom · Drag=Pan
        </span>
      </div>

      {/* Pulse animation */}
      <style>{`
        @keyframes nodePulse {
          0%, 100% { box-shadow: 0 0 12px rgba(88,166,255,0.27), 0 0 4px rgba(88,166,255,0.53); }
          50% { box-shadow: 0 0 20px rgba(88,166,255,0.45), 0 0 8px rgba(88,166,255,0.8); }
        }
      `}</style>
    </div>
  );
}

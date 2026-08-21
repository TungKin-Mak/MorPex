/**
 * DecisionStore — 未决决策持久化（P-B：第一性原理「真相源」）
 *
 * 现状：plan/ask/approval 三类人工门的 pending 都存在各自 service 的**内存 Map**，
 * 后端重启即丢 → 任务可能卡死（无「需回复」恢复）。
 *
 * 本服务：以 data/decisions.jsonl（append 事件行）持久化三类决策；
 *   启动 restore() 重放重建内存视图；未决项后端重启后可恢复（/api/decisions/pending 继续可用）。
 *
 * 键 = 各 service 原始 id（planId / askId / approval requestId），resolve 幂等。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface StoredDecision {
  id: string;
  kind: 'plan' | 'ask' | 'approval';
  goal?: string;
  spaceId?: string;
  title?: string;
  question?: string;
  options?: string[];
  meta?: Record<string, unknown>;
  status: 'pending' | 'resolved';
  createdAt: number;
  resolvedAt?: number;
}

let dataRoot = path.resolve(process.cwd(), 'data');
const byId = new Map<string, StoredDecision>();

function filePath(): string {
  return path.join(dataRoot, 'decisions.jsonl');
}

function appendLine(obj: unknown): void {
  try {
    fs.mkdirSync(dataRoot, { recursive: true });
    fs.appendFileSync(filePath(), JSON.stringify(obj) + '\n', 'utf-8');
  } catch (err) {
    console.warn('[DecisionStore] ⚠️ 决策落盘失败:', (err as Error).message);
  }
}

/** 设置数据根（StudioServer/bootstrap 装配；测试可换目录隔离）。 */
export function setDecisionStoreRoot(root?: string): void {
  if (root) dataRoot = path.resolve(root);
}

/** 登记一项未决决策（plan/ask/approval 各自 service 在创建 pending 时调用）。幂等。 */
export function recordDecision(d: { id: string; kind: StoredDecision['kind']; goal?: string; spaceId?: string; title?: string; question?: string; options?: string[]; meta?: Record<string, unknown> }): void {
  if (byId.has(d.id)) return;
  const rec: StoredDecision = {
    ...d,
    status: 'pending',
    createdAt: Date.now(),
  };
  byId.set(rec.id, rec);
  appendLine({ op: 'record', d: rec });
}

/** 决议一项（confirm/answer/decide 时调用）。幂等。 */
export function resolveDecision(id: string): void {
  const rec = byId.get(id);
  if (!rec || rec.status === 'resolved') return;
  rec.status = 'resolved';
  rec.resolvedAt = Date.now();
  appendLine({ op: 'resolve', id });
}

/** 查询全部未决决策（/api/decisions/pending 数据源）。 */
export function listPendingDecisions(): StoredDecision[] {
  return [...byId.values()].filter((d) => d.status === 'pending');
}

/** 启动恢复：重放 data/decisions.jsonl 重建内存视图（未决项后端重启后可恢复）。 */
export function restoreDecisions(): void {
  try {
    if (!fs.existsSync(filePath())) return;
    const lines = fs.readFileSync(filePath(), 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const row = JSON.parse(line) as { op?: string; d?: StoredDecision; id?: string };
        if (row.op === 'record' && row.d?.id) {
          byId.set(row.d.id, row.d);
        } else if (row.op === 'resolve' && row.id) {
          const rec = byId.get(row.id);
          if (rec) { rec.status = 'resolved'; rec.resolvedAt = rec.resolvedAt ?? Date.now(); }
        }
      } catch { /* 单行损坏跳过 */ }
    }
  } catch { /* 目录不存在等，忽略 */ }
}

/** 测试/调试：清空（避免污染）。 */
export function clearDecisions(): void {
  byId.clear();
}
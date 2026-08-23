/**
 * approval-routes — T3 审批 + 留言的 HTTP 路由（docs/SINGLE_TRANSCRIPT_DESIGN.md §6.3/§4.5）
 *
 * 解耦设计：不直接挂到 StudioServer（并行任务地盘红线）——导出 registerApprovalRoutes(app, deps)，
 * 由调度器在 StudioServer 初始化后一行接线：
 *   registerApprovalRoutes(this.app, { messageStore: this.messageStore!, transcriptStore: this.getTranscriptStore()! });
 *
 * 决策复用既有 DecisionStore 模式：POST /api/decisions/:id/respond 已存在（StudioServer:782），
 * 本路由额外提供审批专用语义（resolveToolApproval 唤醒内存队列）与未读留言查询。
 */

import type { Express } from 'express';
import { resolveToolApproval, listPendingToolApprovals } from '../../../core/src/execution/ToolCallApprovalService.js';
import type { AgentMessageStore } from './AgentMessageStore.js';
import type { TranscriptStore } from './TranscriptStore.js';

export interface ApprovalRoutesDeps {
  messageStore: AgentMessageStore;
  transcriptStore: TranscriptStore;
}

export function registerApprovalRoutes(app: Express, deps: ApprovalRoutesDeps): void {
  // 注：挂载前缀 /api/tool-approval/*（与既有 L5 approvalGate 的 /api/approval/* 语义区分，不抢占路由）
  // 审批决策（幂等：已超时/已决的 id 返回 false）
  app.post('/api/tool-approval/:id/decision', (req, res) => {
    const decision = req.body?.decision === 'approve' ? 'approve' : req.body?.decision === 'deny' ? 'deny' : null;
    if (!decision) {
      res.status(400).json({ error: "decision 必须是 'approve' | 'deny'" });
      return;
    }
    const ok = resolveToolApproval(req.params.id, decision);
    res.json({ ok, id: req.params.id, note: ok ? undefined : '请求不存在或已超时/已决' });
  });

  // 未决审批列表（前端轮询渲染审批卡片）
  app.get('/api/tool-approval/pending', (_req, res) => {
    res.json({ pending: listPendingToolApprovals() });
  });

  // 指定会话的未读留言
  app.get('/api/messages/unread/:sessionId', (req, res) => {
    if (!deps.transcriptStore.findWindowById(req.params.sessionId)) {
      res.status(404).json({ error: `NOT_FOUND: 会话未登记 ${req.params.sessionId}` });
      return;
    }
    res.json({ unread: deps.messageStore.listUnread(req.params.sessionId) });
  });

  // 标记已读
  app.post('/api/messages/mark-read', (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    if (ids.length === 0) {
      res.status(400).json({ error: 'ids 必须是非空字符串数组' });
      return;
    }
    res.json({ updated: deps.messageStore.markRead(ids) });
  });
}

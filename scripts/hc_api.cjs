const fs = require('fs');
let c = fs.readFileSync('packages/studio/server/StudioServer.ts', 'utf8');

const insertAfter = "    // ── POST /api/v8/mission/:missionId/deny — 拒绝 Mission ──";

const newEndpoints = `
    // ═══════════════════════════════════════════════════════
    // ★ v8.5 人控开关 API
    // ═══════════════════════════════════════════════════════

    // ── GET /api/v8/human-control/status — 人控状态 ──
    this.app.get('/api/v8/human-control/status', (_req, res) => {
      if (!this.v8CognitiveLoop) return res.status(503).json({ ok: false, error: 'CognitiveLoop 未就绪' });
      return res.json({ ok: true, ...this.v8CognitiveLoop.getHCConfig() });
    });

    // ── GET /api/v8/workflow-candidates — 待审批工作流候选 ──
    this.app.get('/api/v8/workflow-candidates', (_req, res) => {
      if (!this.v8CognitiveLoop) return res.status(503).json({ ok: false, error: 'CognitiveLoop 未就绪' });
      return res.json({ ok: true, candidates: this.v8CognitiveLoop.getAllCandidates() });
    });

    // ── POST /api/v8/workflow-candidates/:id/approve — 批准候选 ──
    this.app.post('/api/v8/workflow-candidates/:id/approve', (req, res) => {
      if (!this.v8CognitiveLoop) return res.status(503).json({ ok: false, error: 'CognitiveLoop 未就绪' });
      const result = this.v8CognitiveLoop.approveCandidate(req.params.id, req.body?.by);
      if (!result) return res.status(404).json({ ok: false, error: '候选不存在或已处理' });
      return res.json({ ok: true, candidate: result });
    });

    // ── POST /api/v8/workflow-candidates/:id/deny — 拒绝候选 ──
    this.app.post('/api/v8/workflow-candidates/:id/deny', (req, res) => {
      if (!this.v8CognitiveLoop) return res.status(503).json({ ok: false, error: 'CognitiveLoop 未就绪' });
      const result = this.v8CognitiveLoop.denyCandidate(req.params.id, req.body?.by);
      if (!result) return res.status(404).json({ ok: false, error: '候选不存在或已处理' });
      return res.json({ ok: true, candidate: result });
    });

    // ── GET /api/v8/behavior-drifts — 待确认行为漂移 ──
    this.app.get('/api/v8/behavior-drifts', (_req, res) => {
      if (!this.v8CognitiveLoop) return res.status(503).json({ ok: false, error: 'CognitiveLoop 未就绪' });
      return res.json({ ok: true, drifts: this.v8CognitiveLoop.getPendingDrifts() });
    });

    // ── POST /api/v8/behavior-drifts/:id/accept — 接受漂移 ──
    this.app.post('/api/v8/behavior-drifts/:id/accept', (req, res) => {
      if (!this.v8CognitiveLoop) return res.status(503).json({ ok: false, error: 'CognitiveLoop 未就绪' });
      const result = this.v8CognitiveLoop.acceptDrift(req.params.id, req.body?.by);
      if (!result) return res.status(404).json({ ok: false, error: '漂移不存在或已处理' });
      return res.json({ ok: true, drift: result });
    });

    // ── POST /api/v8/behavior-drifts/:id/reject — 拒绝漂移 ──
    this.app.post('/api/v8/behavior-drifts/:id/reject', (req, res) => {
      if (!this.v8CognitiveLoop) return res.status(503).json({ ok: false, error: 'CognitiveLoop 未就绪' });
      const result = this.v8CognitiveLoop.rejectDrift(req.params.id, req.body?.by);
      if (!result) return res.status(404).json({ ok: false, error: '漂移不存在或已处理' });
      return res.json({ ok: true, drift: result });
    });

    // ── POST /api/v8/workflow/:id/execute — 手动执行工作流 ──
    this.app.post('/api/v8/workflow/:id/execute', async (req, res) => {
      if (!this.v8CognitiveLoop) return res.status(503).json({ ok: false, error: 'CognitiveLoop 未就绪' });
      const result = await this.v8CognitiveLoop.execWfManual(req.params.id);
      return res.json({ ok: result.success, ...result });
    });

`;

// Find the deny mission endpoint and insert after it
const denyIdx = c.indexOf(insertAfter);
if (denyIdx >= 0) {
  // Find end of this endpoint block (next '// ── POST /api/chat')
  const nextBlock = c.indexOf('    // ── POST /api/chat/message', denyIdx);
  if (nextBlock > denyIdx) {
    c = c.substring(0, nextBlock) + newEndpoints + '\n' + c.substring(nextBlock);
  }
}

fs.writeFileSync('packages/studio/server/StudioServer.ts', c);
console.log('API endpoints added');

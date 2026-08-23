/**
 * T3 组织通信与审批门测试（docs/SINGLE_TRANSCRIPT_DESIGN.md §4.5/§6）
 *
 * 覆盖：
 *   1. session_read 权限矩阵四情形（全文/摘要/message-only/deny）
 *   2. send_message：同树放行 + 双存根落账；跨树非经理拒绝；未读查询
 *   3. 审批门：高危判定 / approve 放行 / deny 阻断 / timeout 兜底
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TranscriptStore } from '../transcript/TranscriptStore.js';
import { AgentMessageStore } from '../transcript/AgentMessageStore.js';
import {
  checkPermission,
  createSessionToolsBridge,
  readTranscriptMessages,
} from '../transcript/session-tools.js';
import {
  needsToolApproval,
  createToolCallApprovalHook,
  resolveToolApproval,
  listPendingToolApprovals,
} from '../../../core/src/execution/ToolCallApprovalService.js';

let dir: string;
let store: TranscriptStore;
let messages: AgentMessageStore;

/** 测试树：
 *  chat:conv1 (root, orchestrator mgr1)
 *    ├─ agent:step-agent:s1  （工位A，账本含中文+thinking）
 *    └─ agent:step-agent:s2  （工位B）
 *  chat:conv2 (root, orchestrator mgr2 —— 另一个部门)
 */
const W = {
  root1: 'win_root1', s1: 'win_s1', s2: 'win_s2', root2: 'win_root2',
};

function seedWindows(): void {
  const now = Date.now();
  const mk = (session_id: string, session_key: string, parent: string | null, component: string, file_path = ''): void => {
    store.upsertWindow({ session_id, session_key, file_path, component, parent_session_id: parent, reason: 'initial' });
  };
  mk(W.root1, 'chat:conv1', null, 'orchestrator');
  mk(W.root2, 'chat:conv2', null, 'orchestrator');
  mk(W.s1, `agent:step-agent:${W.s1}`, W.root1, 'step-agent');
  mk(W.s2, `agent:step-agent:${W.s2}`, W.root1, 'step-agent');
  expect(now).toBeTypeOf('number');
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 't3-approval-'));
  store = new TranscriptStore(path.join(dir, 'transcript.db'));
  messages = new AgentMessageStore(path.join(dir, 'transcript.db'));
  seedWindows();
});

afterAll(() => {
  store.close();
  messages.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('权限矩阵（§4.5）', () => {
  it('上司→下属 全文', () => {
    const mgr = store.findWindowById(W.root1)!;
    const sub = store.findWindowById(W.s1)!;
    expect(checkPermission(store, mgr, sub)).toBe('full');
  });

  it('同树兄弟 摘要（即使请求 full 也降级为 summary——由调用方处理）', () => {
    const a = store.findWindowById(W.s1)!;
    const b = store.findWindowById(W.s2)!;
    expect(checkPermission(store, a, b)).toBe('summary');
  });

  it('经理↔经理 message-only（不可翻对方账本）', () => {
    const m1 = store.findWindowById(W.root1)!;
    const m2 = store.findWindowById(W.root2)!;
    // 注意：不同树的 manager 对，sameTree=false 但 component 均 orchestrator 且键为 agent:* 才 message-only；
    // 本例 root 键是 chat:*（chat 树根），跨树 → deny。构造 agent:* 经理对验证特例分支：
    store.upsertWindow({
      session_id: 'mgr_x', session_key: 'agent:orchestrator:mgr_x', file_path: '', component: 'orchestrator', reason: 'initial',
    });
    store.upsertWindow({
      session_id: 'mgr_y', session_key: 'agent:orchestrator:mgr_y', file_path: '', component: 'orchestrator', reason: 'initial',
    });
    const mx = store.findWindowById('mgr_x')!;
    const my = store.findWindowById('mgr_y')!;
    expect(checkPermission(store, mx, my)).toBe('message-only');
    expect(checkPermission(store, m1, m2)).toBe('deny');
  });

  it('跨树 拒绝', () => {
    const outsider = store.findWindowById(W.s1)!;
    const otherRoot = store.findWindowById(W.root2)!;
    expect(checkPermission(store, otherRoot, outsider)).toBe('deny');
  });
});

describe('sessionRead / sendMessage（bridge 实现）', () => {
  let bridge: ReturnType<typeof createSessionToolsBridge>;
  const stubs: Array<{ win: string; type: string; content: unknown }> = [];

  beforeAll(() => {
    // 写一本含中文 + thinking 的账本给 s1
    const p1 = path.join(dir, 's1.jsonl');
    const lines = [
      JSON.stringify({ type: 'message', message: { role: 'user', content: '我是工位A的上下文：暗号是芝麻开门' } }),
      JSON.stringify({ type: 'message', message: { role: 'assistant', content: [
        { type: 'thinking', thinking: '用户给了暗号，要记住'.repeat(200), thinkingSignature: 'SECRET-SIG' },
        { type: 'text', text: '收到' },
      ] } }),
      '{broken line', // 半行容错
    ];
    fs.writeFileSync(p1, lines.join('\n') + '\n{no-trailing-newline');
    store.upsertWindow({ session_id: W.s1, session_key: `agent:step-agent:${W.s1}`, file_path: p1, component: 'step-agent', parent_session_id: W.root1 });

    bridge = createSessionToolsBridge({
      store,
      indexer: null as never, // sessionRead/sendMessage 不触索引；类型上要求传入，测试置空
      messageStore: messages,
      appendStubTo: async (win, type, content) => stubs.push({ win: win.session_id, type, content }),
    });
  });

  it('上司读下属全文：中文按行完整读回、signature 已删、坏行跳过', async () => {
    const out = await bridge.sessionRead(path.join(dir, 'mgr1.jsonl-unused'), W.s1, 'full').catch((e: Error) => e.message);
    // 发起方必须已登记——用真实登记的窗口路径重试：先给 root1 登记一个文件
    if (String(out).startsWith('FORBIDDEN')) {
      const pr = path.join(dir, 'root1.jsonl');
      fs.writeFileSync(pr, '{"type":"message","message":{"role":"user","content":"x"}}\n');
      store.upsertWindow({ session_id: W.root1, session_key: 'chat:conv1', file_path: pr, component: 'orchestrator', reason: 'initial' });
    }
    const text = await bridge.sessionRead(path.join(dir, 'root1.jsonl'), W.s1, 'full');
    expect(text).toContain('芝麻开门');
    expect(text).not.toContain('SECRET-SIG');
    expect(text).not.toContain('broken');
  });

  it('兄弟只能拿摘要', async () => {
    const ps2 = path.join(dir, 's2.jsonl');
    fs.writeFileSync(ps2, '{"type":"message","message":{"role":"user","content":"B 工位开工"}}\n');
    store.upsertWindow({ session_id: W.s2, session_key: `agent:step-agent:${W.s2}`, file_path: ps2, component: 'step-agent', parent_session_id: W.root1 });
    const text = await bridge.sessionRead(ps2, W.s1, 'full'); // 请求 full → 服务端降级 summary
    expect(text).toContain('模式=summary');
  });

  it('跨树拒绝', async () => {
    const ps2 = path.join(dir, 's2.jsonl');
    await expect(bridge.sessionRead(ps2, W.root2, 'full')).rejects.toThrow(/DENIED|NOT_FOUND/);
  });

  it('sendMessage 同树放行 + 双存根 + 未读查询；跨树非经理拒绝', async () => {
    const confirm = await bridge.sendMessage(
      path.join(dir, 's2.jsonl'), W.s1, '请把测试结果写到共享目录',
    );
    expect(confirm).toContain('messageId=');
    expect(stubs.filter(s => s.type === 'morpex.message_stub')).toHaveLength(2);
    expect(messages.listUnread(W.s1)).toHaveLength(1);

    // 跨树非经理：s2 → root2（另一部门）
    await expect(bridge.sendMessage(path.join(dir, 's2.jsonl'), W.root2, 'hi')).rejects.toThrow(/DENIED/);

    // 已读
    const unread = messages.listUnread(W.s1);
    expect(messages.markRead(unread.map(m => m.id))).toBe(1);
    expect(messages.listUnread(W.s1)).toHaveLength(0);
  });
});

describe('readTranscriptMessages 摘要模式', () => {
  it('summary 截断且限条数', () => {
    const p = path.join(dir, 'long.jsonl');
    const lines: string[] = [];
    for (let i = 0; i < 20; i++) {
      lines.push(JSON.stringify({ type: 'message', message: { role: 'user', content: '长'.repeat(500) + String(i) } }));
    }
    fs.writeFileSync(p, lines.join('\n'));
    const msgs = readTranscriptMessages(p, { mode: 'summary' });
    expect(msgs.length).toBeLessThanOrEqual(12);
    expect(msgs[0].text.length).toBeLessThanOrEqual(301);
  });
});

describe('审批门（§6）', () => {
  it('needsToolApproval 判定', () => {
    expect(needsToolApproval('shell', {})).toBe(true);
    expect(needsToolApproval('file', { operation: 'write' })).toBe(true);
    expect(needsToolApproval('file', { operation: 'read' })).toBe(false);
    expect(needsToolApproval('api', { method: 'POST' })).toBe(true);
    expect(needsToolApproval('api', { method: 'GET' })).toBe(false);
    expect(needsToolApproval('knowledge', { query: 'x' })).toBe(false);
  });

  it('deny 阻断 + 存根成对落账', async () => {
    const stubs2: Array<{ type: string }> = [];
    const hook = createToolCallApprovalHook({
      sessionId: 's-test',
      recordStub: async (type) => { stubs2.push({ type }); },
      timeoutMs: 60_000,
    });
    const p = hook({ toolCallId: 'c1', toolName: 'shell', args: { command: 'rm -rf /tmp/x' } });
    // 等一拍让 request 注册进队列
    await new Promise(r => setTimeout(r, 10));
    expect(listPendingToolApprovals()).toHaveLength(1);
    resolveToolApproval(listPendingToolApprovals()[0]!.id, 'deny');
    const r = await p;
    expect(r?.block).toBe(true);
    expect(stubs2.map(s => s.type)).toEqual(['morpex.approval_request', 'morpex.approval_decision']);
    expect(listPendingToolApprovals()).toHaveLength(0);
  });

  it('approve 放行', async () => {
    const hook = createToolCallApprovalHook({ timeoutMs: 60_000 });
    const p = hook({ toolCallId: 'c2', toolName: 'shell', args: { command: 'ls' } });
    await new Promise(r => setTimeout(r, 10));
    resolveToolApproval(listPendingToolApprovals()[0]!.id, 'approve');
    expect((await p)?.block).toBeUndefined();
  });

  it('timeout 兜底=拒绝', async () => {
    const hook = createToolCallApprovalHook({ timeoutMs: 30 });
    const r = await hook({ toolCallId: 'c3', toolName: 'shell', args: { command: 'sleep' } });
    expect(r?.block).toBe(true);
    expect(r?.reason).toContain('超时');
  });

  it('低危工具不触发审批', async () => {
    const hook = createToolCallApprovalHook({ timeoutMs: 1000 });
    const r = await hook({ toolCallId: 'c4', toolName: 'knowledge', args: { query: '技术栈' } });
    expect(r).toBeUndefined();
    expect(listPendingToolApprovals()).toHaveLength(0);
  });
});

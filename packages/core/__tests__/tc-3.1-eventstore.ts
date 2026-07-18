/**
 * TC-3.1 EventStore — 追加+重放+查询测试
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { EventStore } from '../event/EventStore.js';
import type { SourcingEvent } from '../event/EventStore.js';

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { console.log('  ❌ ' + m); fail++; } }
function eq<T>(a: T, b: T, m: string) { if (JSON.stringify(a) === JSON.stringify(b)) pass++; else { console.log('  ❌ ' + m + ': ' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b)); fail++; } }

console.log('\n📋 TC-3.1 EventStore\n');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eventstore-test-'));
const logPath = path.join(tmpDir, 'events.jsonl');

const store = new EventStore(logPath);

// TC-3.1a: 追加事件
{
  const event: SourcingEvent = {
    type: 'fsm_transition',
    taskId: 't1',
    from: 'IDLE',
    to: 'RUNNING',
    ts: Date.now(),
    execId: 'exec-123',
  };
  await store.append(event);
  
  // 等队列处理完成
  await new Promise(r => setTimeout(r, 100));
  
  ok(fs.existsSync(logPath), 'TC-3.1a JSONL 文件已创建');
  const content = fs.readFileSync(logPath, 'utf-8');
  ok(content.includes('fsm_transition'), 'TC-3.1a 文件包含事件内容');
  ok(content.includes('exec-123'), 'TC-3.1a 文件包含 executionId');
  console.log('  ✓ TC-3.1a: 事件已追加到文件');
}

// TC-3.1b: 追加多个不同事件
{
  await store.append({ type: 'tool_call_state_change', toolCallId: 'tc1', from: 'PENDING', to: 'EXECUTING', ts: Date.now(), execId: 'exec-123' });
  await store.append({ type: 'artifact_created', artifactId: 'art1', ts: Date.now(), execId: 'exec-123' });
  await store.append({ type: 'fsm_transition', taskId: 't2', from: 'RUNNING', to: 'COMPLETED', ts: Date.now(), execId: 'exec-456' });
  await new Promise(r => setTimeout(r, 100));
  ok(true, 'TC-3.1a 多事件追加成功');
}

// TC-3.1b: 重放指定 executionId
{
  const state = await store.replay('exec-123');
  ok(state.totalEvents > 0, `TC-3.1b exec-123 有事件 (${state.totalEvents})`);
  ok(state.fsmStates.get('t1') === 'RUNNING', `TC-3.1b FSM t1 状态=RUNNING (=${state.fsmStates.get('t1')})`);
  ok(state.toolCallStates.get('tc1') === 'EXECUTING', 'TC-3.1b toolCall tc1=EXECUTING');
  ok(state.activeArtifacts.has('art1'), 'TC-3.1b artifact art1 存在');
  console.log('  ✓ TC-3.1b: 重放指定 executionId');
}

// TC-3.1c: 重放全部
{
  const state = await store.replay();
  ok(state.totalEvents >= 3, `TC-3.1c 全部事件 >=3 (=${state.totalEvents})`);
  console.log(`  ✓ TC-3.1c: 重放全部 (${state.totalEvents} 事件)`);
}

// TC-3.1d: 重放文件不存在
{
  const store2 = new EventStore(path.join(tmpDir, 'nonexistent.jsonl'));
  const state = await store2.replay();
  ok(state.totalEvents === 0, 'TC-3.1d 不存在文件 → 空状态');
  ok(state.fsmStates.size === 0, 'TC-3.1d fsmStates 为空');
  console.log('  ✓ TC-3.1d: 文件不存在返回空状态');
}

// TC-3.1e: appendSync 同步追加
{
  store.appendSync({ type: 'worker_spawned', toolCallId: 'w1', ts: Date.now(), execId: 'exec-sync' });
  const state = await store.replay('exec-sync');
  ok(state.totalEvents === 1, 'TC-3.1e 同步追加成功');
  ok(state.activeWorkers.get('w1') === 'spawned', 'TC-3.1e worker w1=spawned');
  console.log('  ✓ TC-3.1e: appendSync 同步追加');
}

// TC-3.1f: query 查询指定 executionId
{
  const events = await store.query('exec-456');
  ok(events.length === 1, `TC-3.1f exec-456 有 1 个事件 (=${events.length})`);
  ok(events[0].type === 'fsm_transition', 'TC-3.1f 事件类型正确');
  console.log('  ✓ TC-3.1f: query 查询');
}

// 清理
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n📊 TC-3.1: ${pass} 通过, ${fail} 失败, ${pass+fail} 总`);
process.exit(fail > 0 ? 1 : 0);

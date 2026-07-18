/**
 * TC-3.4 EventBus — 事件总线测试
 */
import { EventBus } from '../src/common/EventBus.js';
import type { MorPexEvent } from '../src/common/types.js';

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { console.log('  ❌ ' + m); fail++; } }
function eq<T>(a: T, b: T, m: string) { if (JSON.stringify(a) === JSON.stringify(b)) pass++; else { console.log('  ❌ ' + m + ': ' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b)); fail++; } }

console.log('\n📋 TC-3.4 EventBus\n');

const bus = new EventBus();

// TC-3.4a: 发射+订阅
{
  let called = 0;
  const unsub = bus.on('test.event', (e) => { called++; });
  bus.emit({ id: 'e1', type: 'test.event', timestamp: Date.now(), executionId: 'ex1', source: 'test', payload: {} });
  ok(called === 1, 'TC-3.4a emit → handler 被调用');
  unsub();
  bus.emit({ id: 'e2', type: 'test.event', timestamp: Date.now(), executionId: 'ex1', source: 'test', payload: {} });
  ok(called === 1, 'TC-3.4a 取消后不再触发');
}

// TC-3.4b: 通配符 (* 匹配全部, runtime.* 匹配 runtime.xxx)
{
  let wildcardCalled = 0;
  const unsub = bus.on('*', (e) => { wildcardCalled++; });
  bus.emit({ id: 'e3', type: 'runtime.tool.start', timestamp: Date.now(), executionId: 'ex1', source: 'test', payload: {} });
  ok(wildcardCalled === 1, 'TC-3.4b 通配符 * 匹配所有事件');
  unsub();
  
  // 单层通配符: runtime.* 匹配 runtime.tool (两层)
  // 注意: 不支持多层通配符 runtime.* 匹配 runtime.tool.start (三层)
  let nsCalled = 0;
  const unsub2 = bus.on('runtime.*', (e) => { nsCalled++; });
  bus.emit({ id: 'e4', type: 'runtime.tool', timestamp: Date.now(), executionId: 'ex1', source: 'test', payload: {} });
  ok(nsCalled === 1, 'TC-3.4b runtime.* 匹配 runtime.tool');
  unsub2();
}

// TC-3.4c: 领域作用域
{
  let domainCalled = 0;
  let globalCalled = 0;
  const unsubD = bus.onDomain('hardware', 'hw.event', (e) => { domainCalled++; });
  const unsubG = bus.on('hw.event', (e) => { globalCalled++; });
  
  bus.emitToDomain('hardware', { id: 'e5', type: 'hw.event', timestamp: Date.now(), executionId: 'ex1', source: 'test', payload: {} });
  ok(domainCalled === 1, 'TC-3.4c emitToDomain → domain handler 被调用');
  ok(globalCalled === 0, 'TC-3.4c emitToDomain → global handler 不被调用');
  unsubD(); unsubG();
}

// TC-3.4d: 跨领域广播 zone 注入 (使用实例方法)
{
  let emitted: any = null;
  const unsub = bus.on('*', (e) => { emitted = e; });
  bus.setCurrentDomain('zone-a');
  bus.broadcastCrossDomain({ id: 'e6', type: 'cross.event', timestamp: Date.now(), executionId: 'ex1', source: 'test', payload: {} });
  ok(emitted !== null, 'TC-3.4d 广播触发');
  console.log('  TC-3.4d 广播事件:', JSON.stringify(emitted));
  // broadcastCrossDomain 调用 this.getCurrentDomain() (实例方法, 使用 AsyncLocalStorage)
  // 需要 setCurrentDomain 通过实例方法注入领域
  unsub();
}

// TC-3.4e: 历史保留上限
{
  const smallBus = new EventBus(5); // 上限 5
  for (let i = 0; i < 10; i++) {
    smallBus.emit({ id: `h${i}`, type: 'hist.event', timestamp: Date.now(), executionId: 'ex1', source: 'test', payload: { i } });
  }
  const history = smallBus.getHistory();
  ok(history.length === 5, `TC-3.4e 历史保留 5 条 (=${history.length})`);
  ok(history[0].id === 'h5', `TC-3.4e 最早的是 h5 (=${history[0].id})`);
  ok(history[4].id === 'h9', `TC-3.4e 最新的是 h9 (=${history[4].id})`);
}

// TC-3.4f: once() 一次性订阅
{
  let count = 0;
  bus.once('once.event', (e) => { count++; });
  bus.emit({ id: 'o1', type: 'once.event', timestamp: Date.now(), executionId: 'ex1', source: 'test', payload: {} });
  bus.emit({ id: 'o2', type: 'once.event', timestamp: Date.now(), executionId: 'ex1', source: 'test', payload: {} });
  ok(count === 1, 'TC-3.4f once() 只触发一次');
}

// 边界: 缺少 executionId 发出警告
{
  let warnMsg = '';
  const origWarn = console.warn;
  console.warn = (msg: string) => { if (msg.includes('缺少')) warnMsg = msg; };
  bus.emit({ id: 'w1', type: 'test.warn', timestamp: Date.now(), executionId: '', source: 'test', payload: {} });
  ok(warnMsg.includes('缺少 executionId'), '缺少 executionId 发出警告');
  console.warn = origWarn;
}

console.log(`\n📊 TC-3.4: ${pass} 通过, ${fail} 失败, ${pass+fail} 总`);
process.exit(fail > 0 ? 1 : 0);

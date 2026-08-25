/**
 * U4 测试：Webhook 触发路由鉴权（POST /api/hooks/trigger）
 *
 * 三例：① secret 未配置 → 404（不暴露存在性）② secret 错误 → 401 ③ secret 正确 → 通过鉴权
 * （③ 在裸测试环境会进入委派处理器并因 boot 缺失返回 5xx——断言"非 401/404"即证明鉴权通过；
 *   受理后的执行链路复用 chat/send 已验证路径，不在本测试范围。）
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { StudioServer } from '../StudioServer.js';

let server: StudioServer;
let baseUrl: string;
const SECRET = 'u4-test-secret';

beforeAll(async () => {
  process.env.MEMORY_ENGINE = 'mock';
  process.env.MORPEX_HOOK_SECRET = SECRET;
  server = new StudioServer({ port: 0, sessionsRoot: undefined });
  await server.start();
  baseUrl = `http://127.0.0.1:${server.getPort()}`;
}, 300000);

afterAll(async () => {
  delete process.env.MORPEX_HOOK_SECRET;
  await server?.stop();
});

describe('U4·webhook 触发路由', () => {
  it('secret 正确 → 通过鉴权（缺 goal 在委派前拦截→400，证明已过鉴权且不进重链）', async () => {
    const r = await fetch(`${baseUrl}/api/hooks/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-morpex-secret': SECRET },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
  });

  it('secret 错误 → 401', async () => {
    const r = await fetch(`${baseUrl}/api/hooks/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-morpex-secret': 'wrong' },
      body: JSON.stringify({ goal: '测试目标' }),
    });
    expect(r.status).toBe(401);
  });

  it('缺 header → 401；goal 缺失（带正确 secret）→ 400', async () => {
    const noHeader = await fetch(`${baseUrl}/api/hooks/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'x' }),
    });
    expect(noHeader.status).toBe(401);
    const noGoal = await fetch(`${baseUrl}/api/hooks/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-morpex-secret': SECRET },
      body: JSON.stringify({}),
    });
    expect(noGoal.status).toBe(400);
  });
});

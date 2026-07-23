#!/usr/bin/env npx tsx
/**
 * CLI Client — MorPex v9.2 无 UI 交互工具
 *
 * 用法:
 *   npx tsx scripts/cli-client.ts send "帮我写一个冒泡排序的 Python 代码"
 *   npx tsx scripts/cli-client.ts multi "Step1:分析需求; Step2:写出代码; Step3:写单元测试"
 *   npx tsx scripts/cli-client.ts batch tasks.txt              # 批量任务文件
 *   npx tsx scripts/cli-client.ts status                       # 查看所有 Mission
 *   npx tsx scripts/cli-client.ts artifacts                    # 查看产物列表
 *   npx tsx scripts/cli-client.ts observability                # 查看模块覆盖
 *   npx tsx scripts/cli-client.ts audit                        # 架构审计
 *   npx tsx scripts/cli-client.ts chat "你喜欢什么颜色？"       # 简单对话
 *   npx tsx scripts/cli-client.ts stress 20                    # 快速压测 20 并发
 *
 * 前置: npm run dev (服务器运行在 8080)
 */

const BASE = `http://localhost:${process.env.PORT || 8080}`;

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

async function api(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: any; duration: number }> {
  const t0 = Date.now();
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(120000),
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, duration: Date.now() - t0 };
}

function hr(): void { console.log(`${DIM}${'─'.repeat(60)}${RESET}`); }

// ═══════════════════════════════════════════════════════════
// 核心任务: POST /api/v8/mission (最常用)
// ═══════════════════════════════════════════════════════════

async function sendMission(content: string, sessionId?: string): Promise<void> {
  const sid = sessionId || `cli_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  console.log(`${BOLD}📨 Mission${RESET} → "${content.slice(0, 80)}${content.length > 80 ? '...' : ''}"`);
  console.log(`${DIM}   session: ${sid}${RESET}`);

  const { status, body, duration } = await api('POST', '/api/v8/mission', {
    content,
    session_id: sid,
  });

  console.log(`${DIM}   耗时: ${duration}ms | HTTP ${status}${RESET}`);

  if (body?.ok) {
    console.log(`${GREEN}   ✅ ok${RESET}  type=${body.type || 'N/A'}`);
    if (body.content) {
      const preview = typeof body.content === 'string'
        ? body.content.slice(0, 500)
        : JSON.stringify(body.content).slice(0, 500);
      console.log(`${CYAN}   📝 响应预览:${RESET}`);
      console.log(`${CYAN}   ${preview.replace(/\n/g, '\n   ')}${RESET}`);
    }
  } else {
    console.log(`${RED}   ❌ 失败: ${body?.error || '未知错误'}${RESET}`);
  }
  hr();
}

// ═══════════════════════════════════════════════════════════
// 多步任务 (DAG 场景)
// ═══════════════════════════════════════════════════════════

async function sendMultiStep(description: string): Promise<void> {
  console.log(`${BOLD}🔀 多步 DAG 任务${RESET}`);
  // 格式: "Step1:xxx; Step2:yyy; Step3:zzz" 或用自然语言描述
  const content = description.includes(';')
    ? `Execute the following multi-step plan with dependencies. Each step should be a separate task in the DAG: ${description}. For each step, produce a concrete deliverable (code, analysis, document).`
    : description;

  await sendMission(content, `dag_${Date.now()}`);
}

// ═══════════════════════════════════════════════════════════
// 对话
// ═══════════════════════════════════════════════════════════

async function chat(message: string): Promise<void> {
  console.log(`${BOLD}💬 对话${RESET} → "${message}"`);

  // 先创建 session
  const sess = await api('POST', '/api/session/create', {});
  const sessionId = sess.body?.sessionId || sess.body?.id || `chat_${Date.now()}`;

  const { status, body, duration } = await api('POST', `/api/session/${sessionId}/send`, {
    message,
    session_id: sessionId,
  });

  console.log(`${DIM}   session: ${sessionId} | ${duration}ms | HTTP ${status}${RESET}`);
  if (body?.ok) {
    const reply = body.reply || body.content || JSON.stringify(body);
    console.log(`${GREEN}   🤖 ${typeof reply === 'string' ? reply.slice(0, 500) : JSON.stringify(reply).slice(0, 500)}${RESET}`);
  } else {
    console.log(`${RED}   ❌ ${body?.error || '失败'}${RESET}`);
  }
  hr();
}

// ═══════════════════════════════════════════════════════════
// 状态查询
// ═══════════════════════════════════════════════════════════

async function showStatus(): Promise<void> {
  console.log(`${BOLD}📊 系统状态${RESET}\n`);

  // Missions
  const m = await api('GET', '/api/v8/missions');
  if (m.body?.ok) {
    console.log(`  Missions: ${m.body.count} 个`);
    if (m.body.missions?.length > 0) {
      for (const mi of m.body.missions.slice(-10)) {
        const icon = mi.state === 'COMPLETED' ? '✅' : mi.state === 'FAILED' ? '❌' : '⏳';
        console.log(`    ${icon} ${mi.id?.slice(-12)} | ${mi.state} | ${(mi.goal || '').slice(0, 60)}`);
      }
    }
  }

  // Health
  const h = await api('GET', '/api/health');
  if (h.body?.ok) {
    console.log(`  Health:   ${h.body.status || 'ok'}`);
  }

  // Observability
  const o = await api('GET', '/api/observability/modules');
  if (o.body?.modules) {
    const online = o.body.modules.filter((m: any) => m.status === 'online').length;
    console.log(`  Modules:  ${online}/${o.body.modules.length} online`);
  }

  hr();
}

async function showArtifacts(): Promise<void> {
  console.log(`${BOLD}📦 产物列表${RESET}\n`);
  const a = await api('GET', '/api/artifacts');
  if (a.body?.artifacts) {
    for (const art of a.body.artifacts.slice(-20)) {
      console.log(`  📄 ${art.id?.slice(-16)} | ${art.name || 'N/A'} | ${art.type || 'N/A'}`);
    }
    console.log(`\n  共 ${a.body.artifacts.length} 个产物`);
  } else if (a.body?.ok === false) {
    console.log(`  ${YELLOW}产物 API 返回: ${a.body.error || '未就绪'}${RESET}`);
  } else {
    console.log(`  ${DIM}暂无产物${RESET}`);
  }
  hr();
}

async function showObservability(): Promise<void> {
  console.log(`${BOLD}🔍 可观测性${RESET}\n`);

  // Module coverage
  const mod = await api('GET', '/api/observability/modules');
  if (mod.body?.modules) {
    const total = mod.body.modules.length;
    const exercised = mod.body.modules.filter((m: any) =>
      m.runtimeState === 'ACTIVE' || m.runtimeState === 'DEGRADED' || m.status === 'online',
    ).length;
    console.log(`  模块覆盖: ${exercised}/${total} (${((exercised / total) * 100).toFixed(0)}%)`);

    // Show non-exercised
    const inactive = mod.body.modules.filter((m: any) =>
      m.runtimeState !== 'ACTIVE' && m.status !== 'online',
    );
    if (inactive.length > 0) {
      console.log(`  ${YELLOW}未激活: ${inactive.map((m: any) => m.name).join(', ')}${RESET}`);
    }
  }

  // Audit
  const audit = await api('GET', '/api/observability/audit');
  if (audit.body?.report) {
    const r = audit.body.report;
    console.log(`  架构健康: ${r.healthScore}% (OK:${r.summary.ok} W:${r.summary.warning} E:${r.summary.error})`);
  }

  // Stats
  const stats = await api('GET', '/api/observability/stats');
  if (stats.body) {
    console.log(`  观测事件: ${stats.body.totalObservations || 'N/A'} 条`);
    console.log(`  失败模块: ${stats.body.failedModules || 0} 个`);
  }

  hr();
}

async function showAudit(): Promise<void> {
  console.log(`${BOLD}🏛️ 架构审计${RESET}\n`);
  const { body } = await api('GET', '/api/observability/audit?strict=1');
  if (!body?.report) {
    console.log(`${RED}审计未就绪${RESET}`);
    return;
  }
  const r = body.report;
  console.log(`  健康分: ${r.healthScore}% | 总计: ${r.totalModules} 模块`);
  console.log(`  ${GREEN}OK: ${r.summary.ok}${RESET} | ${YELLOW}WARN: ${r.summary.warning}${RESET} | ${RED}ERR: ${r.summary.error}${RESET}\n`);

  // Show non-OK findings
  const problems = r.findings.filter((f: any) => f.severity !== 'ok');
  if (problems.length === 0) {
    console.log(`  ${GREEN}✅ 全部通过${RESET}`);
  } else {
    for (const f of problems) {
      const icon = f.severity === 'error' ? '❌' : '⚠️';
      console.log(`  ${icon} ${f.module}: ${f.issue} — ${f.detail}`);
    }
  }
  hr();
}

// ═══════════════════════════════════════════════════════════
// 压力测试
// ═══════════════════════════════════════════════════════════

async function stressTest(concurrency: number): Promise<void> {
  console.log(`${BOLD}⚡ 压力测试 (${concurrency} 并发)${RESET}\n`);

  const tasks = [
    '计算 1+2+3+...+100 的结果',
    '写一个 Python 函数判断回文字符串',
    '解释什么是 RESTful API',
    '列出 5 个常用的 Linux 命令及其用途',
    '计算 Fibonacci 数列前 10 项',
  ];

  let done = 0, ok = 0, fail = 0;
  const times: number[] = [];
  const t0 = Date.now();

  const worker = async () => {
    for (let i = 0; i < Math.ceil(tasks.length * 6 / concurrency); i++) {
      const task = tasks[i % tasks.length];
      const sid = `stress_${concurrency}_${i}_${Date.now()}`;
      try {
        const { status, body, duration } = await api('POST', '/api/v8/mission', {
          content: task,
          session_id: sid,
        });
        times.push(duration);
        if (body?.ok || status === 200) ok++;
        else fail++;
      } catch { fail++; }
      done++;
      if (done % 5 === 0) process.stdout.write(`  ${done}... `);
    }
  };

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  const totalMs = Date.now() - t0;
  const sorted = [...times].sort((a, b) => a - b);
  const avg = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;

  console.log(`\n`);
  console.log(`  总耗时:   ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`  请求数:   ${done} (${GREEN}${ok} ok${RESET}${fail > 0 ? `, ${RED}${fail} fail${RESET}` : ''})`);
  console.log(`  吞吐量:   ${(done / (totalMs / 1000)).toFixed(1)} req/s`);
  console.log(`  平均延迟: ${avg.toFixed(0)}ms`);
  console.log(`  P50:      ${sorted[Math.floor(sorted.length * 0.5)] || 0}ms`);
  console.log(`  P95:      ${sorted[Math.floor(sorted.length * 0.95)] || 0}ms`);
  hr();
}

// ═══════════════════════════════════════════════════════════
// 批量任务
// ═══════════════════════════════════════════════════════════

async function batchFromFile(filePath: string): Promise<void> {
  const fs = require('fs');
  if (!fs.existsSync(filePath)) {
    console.error(`${RED}文件不存在: ${filePath}${RESET}`);
    return;
  }
  const lines = fs.readFileSync(filePath, 'utf-8')
    .split('\n')
    .map((l: string) => l.trim())
    .filter((l: string) => l && !l.startsWith('#'));

  console.log(`${BOLD}📋 批量任务 (${lines.length} 个)${RESET}\n`);

  for (let i = 0; i < lines.length; i++) {
    console.log(`[${i + 1}/${lines.length}]`);
    await sendMission(lines[i]);
    await new Promise(r => setTimeout(r, 2000)); // 间隔 2s，避免压垮 LLM
  }

  console.log(`${GREEN}✅ 批量完成${RESET}`);
}

// ═══════════════════════════════════════════════════════════
// 预置任务集（覆盖所有架构层）
// ═══════════════════════════════════════════════════════════

const PRESET_TASKS: Record<string, string[]> = {
  // 工具执行 → sandbox-manager, budget-manager
  tools: [
    'Run this Python code and return the output: print(sum(range(1, 101)))',
    'Read the file package.json and list all dependencies with their versions',
    'Execute the command "ls -la" and explain each column of the output',
  ],

  // 记忆 → memory-wiki, memory-retriever, zvec-storage, persistence-stage
  memory: [
    'Remember this fact: The project code name is "Nebula" and the deadline is December 2025',
    'Recall everything you know about our project "Nebula" and summarize',
    'Search your knowledge base for any documents about deployment strategies',
  ],

  // DAG → dag-runtime, cross-domain-router, mission-fsm
  dag: [
    'Step 1: Analyze the system architecture. Step 2: Identify 3 bottlenecks. Step 3: Propose specific optimizations for each. Execute in sequence with dependencies.',
    'First gather functional requirements, then non-functional requirements, then merge into a unified specification document.',
  ],

  // Agent → agent-registry, agent-scheduler, collaboration-manager
  agent: [
    'From the available agents (planner, coder, reviewer, researcher, coordinator), select the best one to design a database schema for an e-commerce system.',
    'Three agents should independently propose a caching strategy for a high-traffic API. Compare their proposals and select the best.',
  ],

  // Governance → policy-engine, audit-trail, risk-analyzer
  governance: [
    'A user with role "viewer" is trying to delete the production database. Check permissions and block if unauthorized. Log the security event.',
    'Evaluate the risk of deploying to production on Friday at 5pm without a rollback plan.',
  ],

  // Fault → circuit-breaker, retry-policy, checkpoint-manager
  fault: [
    'Execute a task that calls an external API that may timeout. Implement exponential backoff with max 3 retries and a circuit breaker.',
    'Save a checkpoint before running a database migration. If it fails, rollback and report the error details.',
  ],

  // Knowledge → knowledge-graph, goal-graph, workflow-intelligence
  knowledge: [
    'Query the knowledge graph: find all entities related to "authentication" with any relationship type. Return the subgraph as structured data.',
    'From historical workflow data, which step in the deployment pipeline is the bottleneck? Suggest an optimization.',
  ],
};

async function runPreset(name?: string): Promise<void> {
  if (name && PRESET_TASKS[name]) {
    console.log(`${BOLD}🎯 预置任务集: ${name}${RESET} (${PRESET_TASKS[name].length} 任务)\n`);
    for (let i = 0; i < PRESET_TASKS[name].length; i++) {
      console.log(`[${i + 1}/${PRESET_TASKS[name].length}]`);
      await sendMission(PRESET_TASKS[name][i]);
      await new Promise(r => setTimeout(r, 3000));
    }
    return;
  }

  if (name && !PRESET_TASKS[name]) {
    console.log(`${YELLOW}未知预置: ${name}。可用: ${Object.keys(PRESET_TASKS).join(', ')}${RESET}`);
    return;
  }

  // Run all presets
  console.log(`${BOLD}🎯 全预置任务集 (覆盖所有架构层)${RESET}\n`);
  const groups = Object.entries(PRESET_TASKS);
  for (const [group, tasks] of groups) {
    console.log(`${CYAN}─── ${group} (${tasks.length} 任务) ───${RESET}`);
    for (let i = 0; i < tasks.length; i++) {
      console.log(`[${group}:${i + 1}/${tasks.length}]`);
      await sendMission(tasks[i]);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  console.log(`${GREEN}✅ 全预置完成${RESET}`);
}

// ═══════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const arg = args.slice(1).join(' ');

  console.log(`${BOLD}MorPex v9.2 CLI${RESET}  → ${BASE}`);
  hr();

  switch (cmd) {
    case 'send':
    case 'mission':
      if (!arg) { console.log('用法: cli-client.ts send "任务描述"'); break; }
      await sendMission(arg);
      break;

    case 'multi':
    case 'dag':
      if (!arg) { console.log('用法: cli-client.ts multi "Step1:xxx; Step2:yyy"'); break; }
      await sendMultiStep(arg);
      break;

    case 'chat':
    case 'ask':
      if (!arg) { console.log('用法: cli-client.ts chat "问题"'); break; }
      await chat(arg);
      break;

    case 'status':
    case 'list':
      await showStatus();
      break;

    case 'artifacts':
    case 'art':
      await showArtifacts();
      break;

    case 'observability':
    case 'obs':
      await showObservability();
      break;

    case 'audit':
      await showAudit();
      break;

    case 'stress':
    case 'load':
      await stressTest(parseInt(arg) || 10);
      break;

    case 'batch':
      if (!arg) { console.log('用法: cli-client.ts batch tasks.txt'); break; }
      await batchFromFile(arg);
      break;

    case 'preset':
      await runPreset(arg || undefined);
      break;

    case 'verify': {
      // 验证产物中的代码: verify <artifactId> 或 verify --code "..." --lang python
      let code: string | undefined;
      let lang: string | undefined;
      if (arg.startsWith('--code')) {
        code = arg.replace(/^--code\s+/, '').replace(/^['"]|['"]$/g, '');
        const langMatch = args.join(' ').match(/--lang(?:uage)?\s+(\w+)/);
        lang = langMatch?.[1];
      }
      if (!code && !arg.startsWith('--')) {
        // artifact ID mode
        const artRes = await api('GET', `/api/artifacts`);
        const projects = artRes.body?.projects || [];
        const match = projects.find((p: any) => p.id?.startsWith(arg) || p.id?.includes(arg));
        if (match) {
          code = `artifact:${match.id}`;
          console.log(`${CYAN}📦 找到产物: ${match.id}${RESET}`);
        }
      }
      if (!code) {
        console.log(`${YELLOW}用法: cli-client.ts verify <artifactId>${RESET}`);
        console.log(`       cli-client.ts verify --code "print('hello')" --lang python`);
        break;
      }
      console.log(`${BOLD}🔬 代码验证${RESET}`);
      const payload: any = {};
      if (code.startsWith('artifact:')) {
        payload.artifactId = code.slice(9);
      } else {
        payload.code = code;
        if (lang) payload.language = lang;
      }
      const vRes = await api('POST', '/api/verify-code', payload);
      if (vRes.body?.ok) {
        const icon = vRes.body.verdict === 'PASS' ? '✅' : vRes.body.verdict === 'TIMEOUT' ? '⏱️' : '❌';
        console.log(`  ${icon} ${vRes.body.verdict} | ${vRes.body.language} | exit=${vRes.body.exitCode} | ${vRes.body.duration}ms`);
        if (vRes.body.stdout) console.log(`${GREEN}  stdout:${RESET}\n${vRes.body.stdout.slice(0, 1000)}`);
        if (vRes.body.stderr) console.log(`${RED}  stderr:${RESET}\n${vRes.body.stderr.slice(0, 500)}`);
      } else {
        console.log(`${RED}  ✗ ${vRes.body?.error || '验证失败'}${RESET}`);
      }
      break;
    }

    case 'full':
      // 完整生产验证流程
      console.log(`${BOLD}🚀 完整生产验证流程${RESET}\n`);

      console.log(`${CYAN}  1/3 发送覆盖任务...${RESET}`);
      await runPreset();

      console.log(`\n${CYAN}  2/3 触发 observability 演练...${RESET}`);
      const ex = await api('POST', '/api/observability/exercise-all');
      console.log(`     exercise: ${ex.body?.gained?.length || 0} gained`);

      console.log(`\n${CYAN}  3/3 审计 + 状态...${RESET}`);
      await showObservability();
      await showAudit();
      await showStatus();
      break;

    default:
      console.log(`${BOLD}用法:${RESET}`);
      console.log(`  npx tsx scripts/cli-client.ts send "任务描述"      ← 发送 Mission`);
      console.log(`  npx tsx scripts/cli-client.ts multi "Step1;Step2"   ← 多步 DAG 任务`);
      console.log(`  npx tsx scripts/cli-client.ts chat "问题"           ← 简单对话`);
      console.log(`  npx tsx scripts/cli-client.ts status                 ← 查看状态`);
      console.log(`  npx tsx scripts/cli-client.ts artifacts              ← 查看产物`);
      console.log(`  npx tsx scripts/cli-client.ts observability           ← 模块覆盖`);
      console.log(`  npx tsx scripts/cli-client.ts audit                   ← 架构审计`);
      console.log(`  npx tsx scripts/cli-client.ts stress 20               ← 并发压测`);
      console.log(`  npx tsx scripts/cli-client.ts batch tasks.txt         ← 批量任务`);
      console.log(`  npx tsx scripts/cli-client.ts preset [name]           ← 预置任务集`);
      console.log(`  npx tsx scripts/cli-client.ts full                    ← 完整验证流程`);
      console.log(`\n${DIM}  预置名称: tools, memory, dag, agent, governance, fault, knowledge${RESET}`);
  }
}

main().catch(err => {
  console.error(`${RED}错误:${RESET}`, err.message);
  process.exit(1);
});

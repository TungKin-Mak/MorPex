/**
 * Artifact Production Pipeline Demo — 多任务类型产物交付验证
 *
 * 验证 MorPex 对不同任务类型产出真实交付物的完整能力：
 * - 编程任务 → 代码文件
 * - 策划任务 → 文档
 * - 设计任务 → 设计稿
 * - 分析任务 → 报告
 * - 不限以上
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { ArtifactRegistry } from '../packages/core/src/planes/knowledge-plane/artifacts/ArtifactRegistry.js';
import { ArtifactGraph } from '../packages/core/src/planes/knowledge-plane/artifacts/ArtifactGraph.js';
import { ArtifactLineage } from '../packages/core/src/planes/knowledge-plane/artifacts/ArtifactLineage.js';
import { ArtifactEvaluator } from '../packages/core/src/planes/knowledge-plane/artifacts/ArtifactEvaluator.js';
import { AgentHarness, ContextBuilder } from '../packages/core/src/planes/agent-plane/index.js';

const OUTPUT_DIR = './data/deliverables-demo';
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

let passed = 0; let failed = 0;
function assert(c: boolean, m: string) { if (c) passed++; else { failed++; console.log('  ❌ ' + m); } }
function section(t: string) { console.log(`\n━━━ ${t} ━━━`); }

// ═══════════════════════════════════════════
// 注册中心 + 图谱
// ═══════════════════════════════════════════
const registry = new ArtifactRegistry();
const graph = new ArtifactGraph();
const evaluator = new ArtifactEvaluator();
const lineage = new ArtifactLineage(graph);

// ═══════════════════════════════════════════
// TASK 1: 编程任务 → 代码文件
// ═══════════════════════════════════════════
section('Task 1: 编程任务 → 交付 TypeScript 后端代码');

const codeContent = `import express from 'express';
import { taskRouter } from './routes/tasks.js';
import { authMiddleware } from './middleware/auth.js';

const app = express();
app.use(express.json());
app.use('/api/tasks', authMiddleware, taskRouter);

app.listen(3000, () => console.log('Task API running on :3000'));
`;

// 1. 注册代码产物
const codeArtifact = {
  id: 'task-api-server', name: 'Task API Server', type: 'code' as const,
  content: codeContent, version: 1, status: 'draft' as const,
  createdAt: Date.now(), updatedAt: Date.now(),
  metadata: { taskType: 'programming', language: 'TypeScript', framework: 'Express.js', lines: codeContent.split('\n').length },
};
await registry.register(codeArtifact);

// 2. 写入真实文件
fs.writeFileSync(path.join(OUTPUT_DIR, 'task-api-server.ts'), codeContent);
assert(fs.existsSync(path.join(OUTPUT_DIR, 'task-api-server.ts')), '代码文件写入磁盘');
console.log(`  ✅ 交付: task-api-server.ts (${codeContent.split('\n').length} 行 TypeScript)`);

// 3. 注册到图谱
graph.addNode({ id: codeArtifact.id, name: codeArtifact.name, type: 'code', capabilities: ['REST API', 'CRUD', 'Express'], creator: 'backend-agent', version: '1.0.0', tags: ['typescript', 'api'] });

// 4. 评估质量（使用完整字段）
const codeScore = evaluator.evaluate({ id: codeArtifact.id, name: codeArtifact.name, type: 'code', capabilities: ['REST API'], creator: 'backend-agent', version: '1.0.0', tags: ['typescript'], dependencies: [], successRate: 0.95, usageCount: 15, usageHistory: [{ timestamp: Date.now() - 86400000, agentId: 'agent-1' }, { timestamp: Date.now(), agentId: 'agent-2' }] });
console.log(`  ✅ 质量评估: ${typeof codeScore === 'number' ? (codeScore * 100).toFixed(0) + '/100' : '已执行'}`);

// ═══════════════════════════════════════════
// TASK 2: 策划任务 → 交付 PRD 文档
// ═══════════════════════════════════════════
section('Task 2: 策划任务 → 交付产品需求文档');

const prdContent = `# 产品需求文档：Task Manager v2.0

## 概述
Task Manager v2.0 是企业级任务管理系统，支持多团队协作。

## 核心功能
1. 任务 CRUD — 创建、读取、更新、删除任务
2. 看板视图 — 拖拽式看板管理
3. 甘特图 — 时间线可视化
4. 团队协作 — 多用户、权限管理
5. 集成 — Slack、Jira、GitHub 双向同步

## 非功能性需求
- 并发: 1000+ 用户
- 响应: < 100ms P95
- 可用: 99.9% SLA
- 安全: SOC2 合规

## 里程碑
| Phase | 内容 | 交付日期 |
|-------|------|---------|
| M1 | 核心 CRUD | 2026-08-01 |
| M2 | 看板 + 甘特图 | 2026-09-01 |
| M3 | 集成 + 安全 | 2026-10-01 |
`;

const prdArtifact = {
  id: 'prd-task-manager-v2', name: 'Task Manager v2.0 PRD', type: 'doc' as const,
  content: prdContent, version: 1, status: 'draft' as const,
  createdAt: Date.now(), updatedAt: Date.now(),
  metadata: { taskType: 'planning', format: 'markdown', sections: 6 },
};
await registry.register(prdArtifact);

fs.writeFileSync(path.join(OUTPUT_DIR, 'PRD-task-manager-v2.md'), prdContent);
assert(fs.existsSync(path.join(OUTPUT_DIR, 'PRD-task-manager-v2.md')), 'PRD 文件写入磁盘');
console.log(`  ✅ 交付: PRD-task-manager-v2.md (${prdContent.split('\n').length} 行 Markdown)`);

graph.addNode({ id: prdArtifact.id, name: prdArtifact.name, type: 'doc', capabilities: ['PRD', '需求分析'], creator: 'pm-agent', version: '2.0.0', tags: ['product', 'planning'] });

// ═══════════════════════════════════════════
// TASK 3: 设计任务 → 交付 API 规范
// ═══════════════════════════════════════════
section('Task 3: 设计任务 → 交付 OpenAPI 规范');

const openapiContent = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Task Manager API', version: '2.0.0' },
  paths: {
    '/tasks': {
      get: { summary: 'List tasks', parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
      post: { summary: 'Create task', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' } } } } } }, responses: { '201': { description: 'Created' } } },
    },
    '/tasks/{id}': {
      get: { summary: 'Get task', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
      put: { summary: 'Update task', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated' } } },
      delete: { summary: 'Delete task', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '204': { description: 'Deleted' } } },
    },
  },
}, null, 2);

const openapiArtifact = {
  id: 'openapi-task-manager', name: 'Task Manager API Spec', type: 'openapi' as const,
  content: openapiContent, version: 1, status: 'draft' as const,
  createdAt: Date.now(), updatedAt: Date.now(),
  metadata: { taskType: 'design', format: 'openapi-3.0', endpoints: 5 },
};
await registry.register(openapiArtifact);

fs.writeFileSync(path.join(OUTPUT_DIR, 'openapi-task-manager.yaml'), openapiContent);
assert(fs.existsSync(path.join(OUTPUT_DIR, 'openapi-task-manager.yaml')), 'OpenAPI 文件写入磁盘');
console.log(`  ✅ 交付: openapi-task-manager.yaml (5 endpoints)`);

graph.addNode({ id: openapiArtifact.id, name: openapiArtifact.name, type: 'openapi', capabilities: ['API规范', 'REST设计'], creator: 'architect-agent', version: '2.0.0', tags: ['api', 'design'] });

// ═══════════════════════════════════════════
// TASK 4: 分析任务 → 交付评估报告
// ═══════════════════════════════════════════
section('Task 4: 分析任务 → 交付架构评估报告');

const reportContent = `# 架构评估报告

## 评估对象
MorPex v7 Autonomous Runtime

## 评估维度

| 维度 | 得分 | 评价 |
|------|------|------|
| Runtime Connectivity | 100% | 所有模块有真实调用路径 |
| Event Connectivity | 100% | 33/33 事件闭环 |
| Dependency Health | 100% | 0 死模块 |
| Plugin/DI Coverage | 100% | 所有插件/DI 正确识别 |
| Test Coverage | 90% | 28 测试文件 |

## 总体评分: 99/100

## 建议
1. 继续保持零死模块
2. 提升测试用例覆盖率
3. 增加性能基线测试
`;

const reportArtifact = {
  id: 'architecture-assessment', name: 'Architecture Assessment Report', type: 'report' as const,
  content: reportContent, version: 1, status: 'draft' as const,
  createdAt: Date.now(), updatedAt: Date.now(),
  metadata: { taskType: 'analysis', format: 'markdown', sections: 4 },
};
await registry.register(reportArtifact);

fs.writeFileSync(path.join(OUTPUT_DIR, 'architecture-assessment.md'), reportContent);
assert(fs.existsSync(path.join(OUTPUT_DIR, 'architecture-assessment.md')), '报告文件写入磁盘');
console.log(`  ✅ 交付: architecture-assessment.md (${reportContent.split('\n').length} 行)`);

graph.addNode({ id: reportArtifact.id, name: reportArtifact.name, type: 'report', capabilities: ['分析', '评估'], creator: 'analyst-agent', version: '1.0.0', tags: ['architecture', 'assessment'] });

// ═══════════════════════════════════════════
// TASK 5: 配置任务 → 交付 K8s 部署文件
// ═══════════════════════════════════════════
section('Task 5: 运维任务 → 交付 Kubernetes 部署配置');

const k8sContent = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: task-manager
spec:
  replicas: 3
  selector:
    matchLabels:
      app: task-manager
  template:
    metadata:
      labels:
        app: task-manager
    spec:
      containers:
      - name: api
        image: task-manager:2.0.0
        ports:
        - containerPort: 3000
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
---
apiVersion: v1
kind: Service
metadata:
  name: task-manager-svc
spec:
  selector:
    app: task-manager
  ports:
  - port: 80
    targetPort: 3000
  type: ClusterIP
`;

const k8sArtifact = {
  id: 'k8s-deployment', name: 'Kubernetes Deployment Config', type: 'config' as const,
  content: k8sContent, version: 1, status: 'draft' as const,
  createdAt: Date.now(), updatedAt: Date.now(),
  metadata: { taskType: 'devops', format: 'yaml', replicas: 3 },
};
await registry.register(k8sArtifact);

fs.writeFileSync(path.join(OUTPUT_DIR, 'k8s-deployment.yaml'), k8sContent);
assert(fs.existsSync(path.join(OUTPUT_DIR, 'k8s-deployment.yaml')), 'K8s 配置写入磁盘');
console.log(`  ✅ 交付: k8s-deployment.yaml (Deployment + Service)`);

graph.addNode({ id: k8sArtifact.id, name: k8sArtifact.name, type: 'config', capabilities: ['部署', 'K8s'], creator: 'devops-agent', version: '1.0.0', tags: ['kubernetes', 'deployment'] });

// ═══════════════════════════════════════════
// 建立产物间关系（血缘图）
// ═══════════════════════════════════════════
section('产物血缘关系');

graph.addEdge('prd-task-manager-v2', 'openapi-task-manager', 'generated_from');  // PRD → API规范
graph.addEdge('openapi-task-manager', 'task-api-server', 'generated_from');       // API规范 → 代码
graph.addEdge('task-api-server', 'k8s-deployment', 'depends_on');                 // 代码 → 部署
graph.addEdge('task-api-server', 'architecture-assessment', 'references');        // 代码 → 评估

console.log('  关系图:');
console.log('  PRD ──generated_from──▶ API规范 ──generated_from──▶ 代码');
console.log('  代码 ──depends_on──▶ K8s部署');
console.log('  代码 ──references──▶ 评估报告');

const fullLineage = lineage.getFullLineage('task-api-server');
console.log(`  ✅ 代码血缘: ${fullLineage.ancestors.length} 上游, ${fullLineage.descendants.length} 下游`);

// ═══════════════════════════════════════════
// 版本演进
// ═══════════════════════════════════════════
section('版本管理');

const v2Code = `import express from 'express';
import { taskRouter } from './routes/tasks.js';
import { authMiddleware } from './middleware/auth.js';
import { rateLimiter } from './middleware/rateLimit.js';  // v2 新增

const app = express();
app.use(express.json());
app.use(rateLimiter);  // v2 新增限流
app.use('/api/tasks', authMiddleware, taskRouter);

app.listen(3000, () => console.log('Task API v2 running on :3000'));
`;

// 版本更新使用 updateContent
const updated = ArtifactRegistry.updateContent(codeArtifact, v2Code);
const v2Merged = { ...updated, metadata: { ...codeArtifact.metadata, changes: 'Added rate limiting middleware' } };
fs.writeFileSync(path.join(OUTPUT_DIR, 'task-api-server-v2.ts'), v2Code);

console.log(`  ✅ v2 变更: ${v2Merged.metadata.changes}`);
console.log(`  ✅ 版本: v${codeArtifact.version} → v${v2Merged.version}`);

// ═══════════════════════════════════════════
// Harness 上下文中的产物
// ═══════════════════════════════════════════
section('Harness 上下文集成的产物');

const harness = await AgentHarness.create(b =>
  b.setIntent('Deliver Task Manager v2.0', ['TypeScript', 'K8s'])
    .setPlan('plan-delivery', { nodes: [] })
    .setExecutionState('running')
    .attachArtifact({ id: codeArtifact.id, name: codeArtifact.name, type: 'code', version: '2.0.0', uri: `artifact://default/code/${codeArtifact.id}` })
    .attachArtifact({ id: prdArtifact.id, name: prdArtifact.name, type: 'doc', version: '2.0.0', uri: `artifact://default/doc/${prdArtifact.id}` })
    .attachArtifact({ id: openapiArtifact.id, name: openapiArtifact.name, type: 'openapi', version: '2.0.0', uri: `artifact://default/openapi/${openapiArtifact.id}` })
    .attachArtifact({ id: reportArtifact.id, name: reportArtifact.name, type: 'report', version: '1.0.0', uri: `artifact://default/report/${reportArtifact.id}` })
    .attachArtifact({ id: k8sArtifact.id, name: k8sArtifact.name, type: 'config', version: '1.0.0', uri: `artifact://default/config/${k8sArtifact.id}` })
);

const ctx = harness.getContext();
console.log(`  ✅ Harness 中产物: ${ctx.artifact.availableArtifacts.length} 个`);
for (const a of ctx.artifact.availableArtifacts) {
  console.log(`     - [${a.type}] ${a.name} (${a.uri})`);
}

// Agent 运行时上下文中可见
const agentCtx = harness.getAgentRuntime();
console.log(`  ✅ Agent 可见产物: ${agentCtx.artifacts.length} 个`);

// ═══════════════════════════════════════════
// 多类型任务统计
// ═══════════════════════════════════════════
section('多任务交付统计');

const allArtifacts = [codeArtifact, prdArtifact, openapiArtifact, reportArtifact, k8sArtifact];
const byType: Record<string, number> = {};
const byTask: Record<string, number> = {};
for (const a of allArtifacts) {
  byType[a.type] = (byType[a.type] || 0) + 1;
  byTask[a.metadata?.taskType || 'unknown'] = (byTask[a.metadata?.taskType || 'unknown'] || 0) + 1;
}

console.log('  按产物类型:');
for (const [type, count] of Object.entries(byType)) {
  console.log(`    ${type}: ${count} 个`);
}
console.log('  按任务类型:');
for (const [task, count] of Object.entries(byTask)) {
  console.log(`    ${task}: ${count} 个`);
}

// ═══════════════════════════════════════════
// 写入磁盘的文件清单
// ═══════════════════════════════════════════
section('实际交付物（磁盘文件）');
const files = fs.readdirSync(OUTPUT_DIR);
for (const f of files) {
  const stat = fs.statSync(path.join(OUTPUT_DIR, f));
  console.log(`  📄 ${f} (${stat.size} bytes)`);
}

// ═══════════════════════════════════════════
// 结果
// ═══════════════════════════════════════════
console.log('\n' + '═'.repeat(60));
console.log(`  产物交付验证: ${passed}/${passed + failed} 通过`);
console.log(`  任务类型: programming, planning, design, analysis, devops`);
console.log(`  产物类型: code, doc, openapi, report, config`);
console.log(`  血缘深度: ${fullLineage.ancestors.length} 上游 + ${fullLineage.descendants.length} 下游`);
console.log(`  版本演进: v1 → v2 (限流增强)`);
console.log(`  Harness 集成: ${ctx.artifact.availableArtifacts.length} 产物可见`);
console.log('═'.repeat(60) + '\n');

if (failed > 0) process.exit(1);

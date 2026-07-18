# MorPex E2E 全自动测试指南

## 概述

MorPex 使用 **Playwright** 进行端到端（E2E）UI 自动化测试。测试覆盖：

- **API 端点** — 后端 27 个核心端点可达性、响应结构验证
- **MatrixGrid 新 UI** — 五面板渲染、OmniTerminal、无旧 UI 残留
- **前端渲染** — 页面加载、组件渲染、无 JS 错误
- **SSE 事件流** — SSE 连接、事件类型验证
- **会话管理** — 创建/查询/删除会话、持久化验证
- **记忆系统** — 记忆统计/搜索
- **知识图谱** — 节点和边数据
- **搜索** — 搜索统计/查询
- **可观测性** — Metrics/Traces
- **错误边界** — 404 处理
- **性能基线** — 响应时间验证

---

## 快速开始

### 一键全自动运行（推荐）

```bash
# 运行全部测试（自动启动/停止服务）
npm test

# 带浏览器窗口（可视化调试）
npm run test:headed

# 仅运行关键测试（快速验证）
npm run test:quick

# CI 模式
npm run test:ci
```

全自动运行器会自动：
1. 清理残留进程
2. 启动 StudioServer（后端）
3. 启动 Vite 开发服务器（前端）
4. 等待服务就绪（健康检查）
5. 运行选定的 Playwright 测试
6. 生成测试报告
7. 停止所有服务

### 手动模式（服务已运行）

```bash
# 终端 1: 启动后端
npm run studio:server

# 终端 2: 启动前端
npm run studio:dev

# 终端 3: 运行测试
cd packages/studio/ui && npx playwright test                  # 全部测试
cd packages/studio/ui && npx playwright test --headed         # 带浏览器
cd packages/studio/ui && npx playwright test e2e/integration.spec.ts  # 单个文件
```

---

## 测试命令参考

### 全自动运行器

| 命令 | 说明 |
|------|------|
| `npm test` | 全自动运行全部测试 |
| `npm run test:headed` | 全自动 + 带浏览器窗口 |
| `npm run test:quick` | 仅运行关键测试（快速） |
| `npm run test:ci` | CI 模式 |

### 手动运行（服务需已启动）

| 命令 | 说明 |
|------|------|
| `npm run test:all` | 运行全部 E2E 测试 |
| `npm run test:all:headed` | 带浏览器运行全部测试 |
| `npm run test:frontend` | 运行 API + 前端渲染测试 (morpex-v2) |
| `npm run test:spec "MatrixGrid"` | 按名称匹配运行测试 |

### 高级用法

```bash
# 只运行匹配特定名称的测试
npm run test:spec "页面加载"

# 运行指定 spec 文件（全自动）
npx tsx scripts/run-e2e-tests.ts --spec=matrix-grid

# 构建前端后运行测试
npx tsx scripts/run-e2e-tests.ts --build

# 使用已运行的服务（不自动启停）
npx tsx scripts/run-e2e-tests.ts --no-server
```

---

## 测试套件详情

| 测试文件 | 套件名称 | 覆盖范围 | 关键 |
|---------|---------|---------|:---:|
| `morpex-v2.spec.ts` | API + UI 核心 | 27个测试：24个API端点（health/status/agents/sessions/memory/search/observability等）+ 前端渲染 + 性能基线 | ✅ |
| `matrix-grid.spec.ts` | MatrixGrid 新 UI | 10个测试：五面板渲染、TopBar、OmniTerminal、旧UI移除验证、API数据流 | ✅ |

---

## 测试架构

```
┌──────────────────────────────────────────────────────────┐
│                     run-e2e-tests.ts                      │
│                    (全自动测试运行器)                       │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ 启动后端     │  │ 启动前端     │  │ 健康检查     │   │
│  │ StudioServer │ →│ Vite Dev     │ →│ 等待就绪     │   │
│  │ :8080        │  │ :3000        │  │              │   │
│  └──────────────┘  └──────────────┘  └──────┬───────┘   │
│                                             │            │
│  ┌──────────────────────────────────────────▼────────┐   │
│  │              Playwright Test Runner                │   │
│  │                                                    │   │
│  │  ┌────────────────┐  ┌────────────────┐           │   │
│  │  │ morpex-v2       │  │ matrix-grid     │           │   │
│  │  │   .spec.ts      │  │   .spec.ts     │           │   │
│  │  └────────────────┘  └────────────────┘           │   │
│  └────────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ 生成报告     │  │ 停止服务     │  │ 退出码       │   │
│  │ HTML + JSON  │ →│ 清理进程     │ →│ 0/1          │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
└──────────────────────────────────────────────────────────┘
```

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `8080` | StudioServer 端口 |
| `VITE_PORT` | `3000` | 前端端口 |
| `BACKEND_URL` | `http://127.0.0.1:8080` | 后端 URL |
| `FRONTEND_URL` | `http://127.0.0.1:3000` | 前端 URL |
| `HEADLESS` | `true` | 是否无头模式 |
| `PLAYWRIGHT_CHROME_PATH` | 自动检测 | Chrome 可执行路径 |
| `CI` | 未设置 | 设为 `true` 启用 CI 模式 |

---

## 测试报告

每次运行后生成：

1. **控制台输出** — 实时显示测试进度
2. **HTML 报告** — `packages/studio/ui/e2e/report/index.html`
3. **JSON 报告** — `packages/studio/ui/e2e/report/results.json`
4. **截图** — 失败时自动截图，保存在 `packages/studio/ui/e2e/screenshots/`
5. **视频** — 失败时录制回放，保存在测试报告目录
6. **日志文件** — `logs/e2e-run-{timestamp}.log`
7. **测试报告摘要** — `logs/e2e-report-{timestamp}.txt`

---

## CI/CD 集成

项目包含 GitHub Actions CI 配置 (`.github/workflows/e2e-tests.yml`)：

- **触发条件**: push 到 main/develop、pull request 到 main
- **运行内容**: 快速模式（关键测试）
- **产物**: 测试报告、失败截图、日志（保留 7 天）

---

## 编写新测试

### 测试文件位置

```
packages/studio/ui/e2e/
├── *.spec.ts                        # 测试文件
├── playwright.config.ts             # Playwright 配置
├── report/                          # 测试报告（自动生成）
└── screenshots/                     # 失败截图（自动生成）
```

### 测试最佳实践

1. **每个测试独立** — 不依赖其他测试的状态
2. **使用描述性名称** — `test.describe('用户操作流 3: 用户使用聊天面板')`
3. **等待元素稳定** — 使用 `waitForSelector`、`waitForTimeout` 等待渲染完成
4. **错误处理** — 捕获并记录控制台错误
5. **数据清理** — 测试创建的会话/数据应在测试中清理
6. **关键路径测试** — 将关键业务路径标记为 `critical: true`

### 示例

```typescript
import { test, expect } from '@playwright/test';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:3000';

test.describe('新功能测试', () => {
  test('功能应正常工作', async ({ page }) => {
    await page.goto(FRONTEND_URL, { waitUntil: 'networkidle' });
    await expect(page.locator('#my-element')).toBeVisible();
    await page.locator('#my-button').click();
    await expect(page.locator('.result')).toContainText('成功');
  });
});
```

---

## 故障排除

### 服务启动失败

```bash
# 清理端口占用
npx kill-port 8080 3000

# 单独启动后端验证
npm run studio:server

# 单独启动前端验证
npm run studio:dev
```

### 测试超时

- 默认超时 60 秒，SSE 测试可增至 120 秒
- CLI 工作流测试有 420 秒超时（AI 响应较慢）
- 检查后端是否正常响应：`curl http://127.0.0.1:8080/health`

### Chrome 找不到

配置 `PLAYWRIGHT_CHROME_PATH` 环境变量指向 Chrome 可执行文件：

```bash
# Windows
set PLAYWRIGHT_CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe

# Linux
export PLAYWRIGHT_CHROME_PATH=/usr/bin/google-chrome
```

### 端口冲突

```bash
# 使用不同端口
PORT=8081 VITE_PORT=3001 npx tsx scripts/run-e2e-tests.ts
```

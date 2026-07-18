# 模块名称：Studio 前端模块（AstroM v3.0）

> 路径: `packages/studio/ui/` | 框架: React 19 + Three.js (R3F) | 构建: Vite 5 | 版本: v3.2
>
> 🟢 **v3.0 重构完成 (2026-07-14)** — 42 文件 → 21 文件，删掉 50% 冗余。三合一 Zustand store。BrainScene 零 GC 帧循环。爆炸视图红色光弦。全链路数据对接。
>
> 🎨 **配色**: `#000000`(纯黑) / `#FFFFFF`(纯白) / `#FF3333`(赛博红) — 零绿色。
>
> 📐 **布局**: CSS Grid — `24vw 52vw 24vw`(列) / `32px 1fr 200px`(行)。

---

## 1. 模块职责 (Responsibility)

### 本模块负责

| 职责 | 说明 |
|------|------|
| **3D 大脑可视化** | R3F 渲染 5 分区大脑模型，空闲自转 0.05 rad/s，左键拖拽惯性阻尼，双击爆炸视图 + 红色光弦 |
| **Grid Matrix 单页布局** | 5 区常驻面板（ZoneA/B/C/D/E），无路由切换 |
| **对话交互** | ZoneB 输入框 → POST /api/chat/message → 聊天记录 `[USR]`/`[SYS]` 内联展示 |
| **SSE 事件消费** | 连接 `/api/stream/global`，实时更新 DAG/FSM/执行状态/记忆统计 |
| **REST API 调用** | 封装 9 个端点（api.ts），初始化时拉取 domains / artifacts / memoryStats |
| **全局状态管理** | 单文件 Zustand store（stores.ts），含 7 个 slice：System / DAG / Domains / Artifacts / Telemetry / Memory / Neural |
| **DAG 任务卡片** | ZoneD 显示，弹簧刀式折叠/展开，4 态边框（PENDING/RUNNING/FAILED/SUCCESS） |
| **DAG 拓扑条** | ZoneC 大脑下方，实时显示 DAG 节点链路 |
| **质询仲裁覆盖层** | 全屏红黑格点对质矩阵，F1 批准 / F2 驳回 / ESC 挂起 |

### 本模块【绝不】负责

| 不负责 | 正确归属 |
|--------|----------|
| ❌ 后端业务逻辑 / 引擎执行 | `packages/core/` — MorPexCore 引擎 |
| ❌ LLM 模型调用 | `@earendil-works/pi-ai` + `@earendil-works/pi-agent-core` |
| ❌ HTTP API 实现 | `packages/studio/server/` — StudioServer |
| ❌ 数据持久化 | `packages/core/mirror/storage/` + zvec |
| ❌ 身份认证 / 权限 | 未实现 |

---

## 2. 文件结构树 (File Structure)

```text
packages/studio/ui/
├── index.html                     # HTML 入口（AstroM 标题 + loading screen）
├── style.css                      # 全局样式 + Grid Matrix + 动画 keyframes
├── package.json                   # 前端依赖
├── vite.config.ts                 # Vite 配置（代理 /api → :8080，端口 3000）
├── tsconfig.json                  # TypeScript 配置
│
├── public/                        # 静态资源
│   ├── brain.glb                  #   基础大脑模型
│   ├── brain_5part.glb            #   ★ 5 分区大脑模型（当前使用）
│   └── brain_full.glb             #   完整大脑模型
│
├── ts/                            # TypeScript 源码（21 个文件）
│   ├── main.tsx                   #   入口：挂载 React + 隐藏 loading screen
│   ├── App.tsx                    #   ★ 根组件：SSE 全局接线 + 初始化数据拉取 + 覆盖层渲染
│   ├── MatrixGrid.tsx             #   CSS Grid 5 区容器（纯布局，零业务逻辑）
│   ├── stores.ts                  #   ★ Zustand 单文件（7 slice）
│   ├── types.ts                   #   纯类型定义（零逻辑）
│   ├── api.ts                     #   REST 9 函数 + SSE connectSSE
│   │
│   ├── ZoneA_TopBar.tsx           #   [A] 顶部遥测栏：ASTROM // KERNEL 呼吸红光 + EXEC 闪烁 + MEM/VEC
│   ├── ZoneB_LeftPane.tsx         #   [B] 左面板：Omni-Command 输入 + 聊天记录 [USR]/[SYS] + 领域列表
│   ├── ZoneC_CenterPane.tsx       #   [C] 中央视口：R3F 大脑 + DAG 拓扑条
│   ├── ZoneD_RightPane.tsx        #   [D] 右面板：FSM 10 状态点阵 + DAG 卡片 + 背压 VU 表
│   ├── ZoneE_BottomPane.tsx       #   [E] 底栏：MemoryBus 三池 + 产物树 [CODE]/[DOC]/[LOG]
│   │
│   ├── brain/                     #   3D 大脑子系统
│   │   ├── BrainScene.tsx         #     ★ R3F 场景：零 GC 帧循环 + 自转 + 爆炸 + DAG 告警联动 + 红色光弦
│   │   └── brainConfig.ts         #     5 分区配置（额叶/顶叶/颞叶/枕叶/小脑）
│   │
│   ├── overlays/                  #   全屏覆盖层
│   │   ├── OmniTerminal.tsx       #     Xterm.js Canvas 终端（Ctrl+` 切换）
│   │   ├── InterrogationMatrix.tsx#     质询仲裁全屏矩阵（F1/F2/ESC）
│   │   ├── SlideoverDrawer.tsx    #     只读代码审计器（右滑 50vw）
│   │   ├── ClarifySlots.tsx       #     澄清卡槽（YES_BUF/NO_BUF）
│   │   └── KeyboardShortcuts.tsx  #     全局键盘绑定
│   │
│   └── shared/                    #   共享工具
│       ├── ErrorBoundary.tsx      #     错误边界
│       └── TruncatedText.tsx      #     文本截断
│
├── e2e/                           # Playwright E2E 测试
│
└── dist/                          # 构建产物（gitignored）
```

### 旧文件对照（全部已删除）

| 旧位置 | 文件数 | 替代 |
|--------|--------|------|
| `ts/neuro/` | 20 个 | 分散到 `ts/` 根目录 + `brain/` + `overlays/` + `shared/` |
| `ts/components/` | 7 个 | `shared/ErrorBoundary.tsx` + `shared/TruncatedText.tsx` 保留，其余废弃 |
| `ts/views/` | 10 个 | 无路由，全废弃 |
| `ts/state.ts` | 1 个 | `stores.ts` |
| `ts/dag-store.ts` | 1 个 | `stores.ts` |
| `ts/chat.ts` | 1 个 | 内联到 `ZoneB_LeftPane.tsx` 聊天记录区 |
| `ts/config.ts` | 1 个 | 常量内联 |
| `ts/global-shim.ts` | 1 个 | 废弃 |

---

## 3. 架构与数据流程

### 3.1 三层性能架构

```
┌─────────────────────────────────────────────────────────────────┐
│  React 静态骨架层 (低频配置, ~0 re-renders)                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────┐ │
│  │ ZoneA    │ │ ZoneB    │ │ ZoneC    │ │ ZoneD    │ │ ZoneE │ │
│  │ TopBar   │ │ LeftPane │ │ Center   │ │ Right    │ │Bottom │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └───────┘ │
├─────────────────────────────────────────────────────────────────┤
│  高频数据通道 (绕过 React, 零组件刷新)                           │
│  ┌──────────────────────┐ ┌──────────────────────────────┐     │
│  │ Xterm.js Canvas      │ │ Zustand .subscribe()         │     │
│  │ SSE 日志流直写       │ │ → ref.innerText DOM 直接更新  │     │
│  │ (VS Code 同款引擎)   │ │ (EXEC/MEM/VEC/背压/VU表)      │     │
│  └──────────────────────┘ └──────────────────────────────┘     │
├─────────────────────────────────────────────────────────────────┤
│  3D 渲染层 (按需休眠)                                           │
│  ┌──────────────────────┐                                      │
│  │ R3F Canvas            │                                      │
│  │ useFrame 零 GC       │ ← 复用单例 Vector3，扁平数组 O(1)    │
│  │ OrbitControls 阻尼   │ ← 松手后 2s 恢复自转                 │
│  └──────────────────────┘                                      │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Grid Matrix 布局

```
grid-template-columns: 24vw   52vw   24vw
grid-template-rows:    32px   1fr    200px

┌──────────────────────────────────────────────────────────────┐
│  [A] TOP BAR — 32px: ASTROM // KERNEL | EXEC:N | MEM | VEC  │
├─────────────────┬──────────────────────┬────────────────────┤
│  [B] LEFT PANE  │  [C] CENTER VIEWPORT │  [D] RIGHT PANE    │
│  O_CMD> 输入框  │  3D 大脑 (R3F)       │  FSM 点阵          │
│  [USR] 对话记录 │  双击 → 爆炸 + 光弦  │  DAG 卡片          │
│  [SYS] AI 回复  │  ─────────────────   │  背压 VU 表        │
│  DOMAIN CLUSTERS│  DAG 拓扑节点条       │                    │
├─────────────────┴──────────────────────┴────────────────────┤
│  [E] BOTTOM PANE — 200px                                     │
│  MemoryBus: MAIN / ARCHIVE / TEMP  |  ArtifactRegistry 产物树│
└──────────────────────────────────────────────────────────────┘
```

### 3.3 组件树

```
App (SSE 接线 + 初始化数据拉取)
│
├── MatrixGrid (CSS Grid 容器)
│   ├── ZoneA_TopBar           ← ASTROM // KERNEL 呼吸 + EXEC + MEM/VEC
│   ├── ZoneB_LeftPane         ← 输入框 + 聊天记录 + 领域列表
│   ├── ZoneC_CenterPane       ← R3F Canvas + DAG 拓扑条
│   │   └── BrainScene         ←   3D 大脑 5 分区 + 爆炸光弦
│   ├── ZoneD_RightPane        ← FSM 点阵 + DAG 卡片 + VU 表
│   └── ZoneE_BottomPane       ← MemoryBus 三池 + 产物树
│
├── OmniTerminal               ← Xterm.js (Ctrl+` 切换)
├── InterrogationMatrix        ← 全屏质询 (F1/F2/ESC)
├── SlideoverDrawer            ← 代码审计器 (右滑)
├── ClarifySlots               ← 澄清卡槽
└── KeyboardShortcuts          ← 全局按键
```

### 3.4 状态管理（stores.ts 7 合 1）

```
useAstroStore (Zustand 单文件)
  ├── Slice 1: System          — phase, uptime, execCount, sseConnected
  ├── Slice 2: DAG             — flows[], addFlow/updateTaskStatus (幂等)
  ├── Slice 3: Domains         — domains[], setDomains/updateDomainStatus
  ├── Slice 4: Artifacts       — artifacts[], addArtifact
  ├── Slice 5: Telemetry       — backpressure, fsmPhase, runningTasks
  ├── Slice 6: Memory          — memMainPool, memArchivePool, memTempPool, memVecCount
  └── Slice 7: Neural          — brainAlert, alertRegion, exploded, autoRotate
```

### 3.5 数据加载策略

| 数据 | 初始加载 | 实时更新 |
|------|---------|---------|
| 系统状态 (phase/uptime) | `api.status()` | SSE `runtime.fsm.transition` |
| 领域列表 | `api.domains()` | SSE `domain.waking/active/sleeping` |
| 产物列表 | `api.artifacts()` | SSE `artifact.created` |
| 记忆统计 | `api.memoryStats()` | SSE `memory.recall` |
| DAG 流 | ZoneB 提交后 HTTP 响应立即写入 | SSE `dag.created` / `runtime.task.*` |
| 对话记录 | ZoneB 提交后 HTTP 响应提取 text | SSE `message_update` → OmniTerminal |
| 背压 | — | SSE `scheduler.backpressure` |

### 3.6 BrainScene 性能设计（零 GC 帧循环）

```
useFrame 关键优化：
  1. 单例 Vector3 (tempDir) — 复用，永不 new
  2. 扁平数组 (explodeParts[] / alertMap) — O(1) 遍历，永不 traverse
  3. 状态锁 (wasExplodedRef) — 常态零坐标写入，边缘触发复位
  4. alertMap 按分区名索引 — 告警只脉冲目标分区材质，不全脑遍历

爆炸视图光弦：
  5 条 THREE.Line 预分配（每条 3 顶点：中心→弧中点→分区）
  useFrame 直接写 Float32Array + needsUpdate=true，零 GC
  透明度脉冲：opacity = 0.25 + sin(t*3)*0.15
```

---

## 4. 接口与契约 (API & Contracts)

### 4.1 API 封装 (api.ts — 9 个函数)

```typescript
import { api } from './api';

// 初始化拉取
const status = await api.status();           // GET /api/status
const domains = await api.domains();         // GET /api/domains
const artifacts = await api.artifacts();     // GET /api/artifacts
const memStats = await api.memoryStats();    // GET /api/memory/stats

// 聊天
const result = await api.chat('你好');       // POST /api/chat/message

// 紧急操作
await api.abort();                           // POST /api/ai/abort
```

### 4.2 SSE 连接

```typescript
import { connectSSE } from './api';

const disconnect = connectSSE({
  'runtime.execution.started': () => { ... },
  'runtime.execution.completed': () => { ... },
  'runtime.fsm.transition': (data) => { ... },
  'runtime.task.started': (data) => { ... },
  'runtime.task.completed': (data) => { ... },
  'dag.created': (data) => { ... },
  'cross_domain.dag_created': (data) => { ... },
  'artifact.created': (data) => { ... },
  'scheduler.backpressure': (data) => { ... },
  'message_update': (data) => { ... },
  'memory.recall': (data) => { ... },
  'dag.node.failed': (data) => { ... },
  'domain.waking': (data) => { ... },
  'domain.active': (data) => { ... },
  'domain.sleeping': (data) => { ... },
  'cross-domain.interrogation': (data) => { ... },
  'cross-domain.arbitration': () => { ... },
});
// 指数退避重连: 1s → 2s → 4s → … → 30s max
```

### 4.4 新增 API 函数

```typescript
// 会话历史持久化
await api.saveChatMessage(sessionId, { role: 'user', content: '你好' });
const history = await api.getChatHistory(sessionId);

// 节点执行消息持久化
await api.saveTaskMessage(execId, taskId, { role: 'assistant', content: '输出' });

// 向 agent 回复（pi 核 steering）
await api.steerHarness(harnessId, '回复内容');

// Agent 建议列表（@ 提及面板）
const suggestions = await api.agentSuggestions();
```

### 4.5 SSE 新事件处理

```typescript
'runtime.task.awaiting_input': (data) => {
  // data: { taskId, harnessId, question, options[], executionId }
  s.updateTaskStatus(taskId, { status: 'awaiting_input', harnessId, question, options });
  s.pushTaskMessage(taskId, { role: 'system', content: `❓ ${question}` });
},
```

### 4.6 Store 扩展（新增 slice）

```typescript
// DagTask 扩展字段
interface DagTask {
  harnessId?: string;  // pi 核 harness ID（steer 注入用）
  question?: string;   // ask_user 的问题
  options?: string[];  // 可选选项列表
}

// 新增 action
upsertFlow: (flow: DagFlow) => void;  // 替换或添加 flow（刷新恢复用）
restoreLiveStream: (items: LiveStreamItem[]) => void;  // 从持久化恢复历史
clearLiveStream: () => void;
```

---

## 7. 新增组件 🆕

### 7.1 @ 提及 Agent 面板（MentionSuggest.tsx）

输入 `@` 触发建议列表（类似 Slack / Notion 的 mention）：
- 数据源：`agents.ts`（AGENT_LIST 配置）+ `api.agentSuggestions()`
- 交互：`↑↓` 导航 + `Enter`/`Tab` 选中 + `Escape` 关闭
- 选中后标题栏显示 `附灵:鲁班`，后续消息自动路由到对应 handler
- 输入 `@ `（@+空格）取消附灵，恢复默认聊天模式
- 模糊搜索：`@工` 可匹配 `@鲁班`（通过 keywords 字段）

### 7.2 DAG 卡片（DagCard.tsx）🔄 v3.2 重构

内联任务列表 + 子 shell 展开，显示在聊天流中：
- 头部：`▶ 任务名 [Agent]` → `5个节点 跨域 2/5完成 任务1:❓ task需输入`
- 节点列表：`#索引 ● 状态 [领域] 目标`，点击行内展开子 shell
- 状态：`等待`(灰) / `执行中`(蓝) / `已完成`(绿) / `异常`(红) / `需输入`(金) / `中断`(橙)
- 实时状态驱动：SSE `runtime.task.*` 事件
- 刷新恢复：从 localStorage 缓存 + JSONL 重建，running→interrupted
- **子 shell**：内联展开，过滤系统状态消息，只显示对话；流式输出自动合并
- **$ prompt**：中断/失败/需输入时显示 CLI 风格输入行

### 7.3 节点对话框（NodeDialog.tsx）⚠️ 已废弃

v3.2 改为内联子 shell（DagCard 内 TaskShell），不再弹窗。NodeDialog.tsx 保留但不再引用。

### 7.4 会话持久化

| 数据 | 存储路径 | 恢复时机 |
|------|---------|---------|
| Chat history | `data/sessions/chat-history/{id}.jsonl` | 刷新时读取 localStorage 的 sessionId |
| Task messages | `data/sessions/task-history/{execId}/{taskId}.jsonl` | TaskShell 挂起时按需加载 |
| DAG 数据 | 嵌入 chat-history 消息的 `dag` 字段 | 刷新时重建 DagCard + flow |
| Flow 状态缓存 | `localStorage('morpex_flows_cache')` | SSE 更新时自动写入，刷新时恢复 |
| sessionId | `localStorage.getItem('morpex_session_id')` | 页面加载时恢复 |

### 7.5 交付物列表（左侧栏）

左侧 `ZoneB_LeftPane.tsx` 底部显示：
- 实时：SSE `artifact.created` 事件 → 直接添加
- 刷新：`GET /api/artifacts` → 读取磁盘文件列表
- 文件类型图标：`code→{}`、`document→¶`、`config→⚙`、`schema→◈`、`report→◉`
- 文件名保留中文，扩展名正确

| 属性 | 值 |
|------|-----|
| 底色 | `#000000` 纯黑 |
| 文字 | `#FFFFFF` 冷白 |
| 警示 | `#FF3333` 赛博红 |
| 字体 | `JetBrains Mono`, monospace |
| 数字 | `font-variant-numeric: tabular-nums` |
| 网格 | `grid-template: 24vw 52vw 24vw / 32px 1fr 200px` |
| 滚动条 | 2px `rgba(255,51,51,0.3)` |
| 终端 | Xterm.js Canvas |
| 3D | R3F `useFrame` 零 GC + OrbitControls `enableDamping` |

---

## 6. 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| **Ctrl+`** | 唤醒/隐藏 OmniTerminal |
| **Ctrl+K** | 清空 Temp Pool（红光一闪） |
| **Shift+Space** | 全局紧急中止 → `POST /api/ai/abort` |
| **F1 / F2** | 质询仲裁：批准 / 驳回 |
| **ESC** | 关闭所有覆盖层 |
| **Enter** | 提交 ZoneB 输入框命令 |

---

## 7. 已知限制

### 产物输出

当前 Agent 执行通过 DomainCluster → AgentHarness → LLM 直接对话。产物（如代码文件）需要 Agent 主动调用 `save-artifact` 技能才会写入 ArtifactRegistry。简单的对话请求（如 "say hello"）不会产生文件型产物。

### Embedding Server

向量搜索需要 Python Embedding Server（`tools-python/embedding-server.py --port 3100`）。未启动时，MemoryBus 降级运行（JSONL 索引可用，向量搜索不可用）。

### 模型名修复

领域 manifest 文件（`data/domains/*.json`）中 `master_agent_config.model` 必须使用有效的模型名。当前可用：`deepseek-v4-flash`、`deepseek-v4-pro`。

---

> **铁律**: 修改前端源码前，必须阅读本文档。新增组件必须在 §2 文件结构中注册。修改状态管理必须在 §3.4 中更新 slice 定义。修改 API 调用方式必须在 §4 中更新契约。

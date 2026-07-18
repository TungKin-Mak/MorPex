# 03 — 页面功能清单（Page Requirements）

> **用途**: 按角色列出功能点清单，不做设计图，只列功能点
> **版本**: 3.1.0 | **最后更新**: 2026-07-12
> **布局**: Grid Matrix 单页布局 — 5 区常驻面板，无路由切换
> **配色**: `#000000`（纯黑）、`#FFFFFF`（纯白）、`#FF3333`（赛博红）— 零绿色

---

## 目录

- [一、布局总览](#一布局总览)
- [二、Zone A — TopBar（顶部遥测栏）](#二zone-a--topbar顶部遥测栏)
- [三、Zone B — LeftPane（左面板）](#三zone-b--leftpane左面板)
- [四、Zone C — CenterPane（中央视口）](#四zone-c--centerpane中央视口)
- [五、Zone D — RightPane（右面板）](#五zone-d--rightpane右面板)
- [六、Zone E — BottomPane（底栏）](#六zone-e--bottompane底栏)
- [七、覆盖层组件（Overlays）](#七覆盖层组件overlays)
- [八、键盘快捷键](#八键盘快捷键)
- [九、按角色的功能矩阵](#九按角色的功能矩阵)

---

## 一、布局总览

```
┌──────────────────────────────────────────────────────────────┐
│  [A] TOP BAR — 32px, col 1-3                                │
├─────────────────┬──────────────────────┬────────────────────┤
│  [B] LEFT PANE  │  [C] CENTER VIEWPORT │  [D] RIGHT PANE    │
│  24vw           │  52vw                │  24vw              │
│  Y-scroll       │  3D Brain / Overlays │  Y-scroll          │
├─────────────────┴──────────────────────┴────────────────────┤
│  [E] BOTTOM PANE — 200px, col 1-3, 50/50 split             │
└──────────────────────────────────────────────────────────────┘
```

> 所有面板常驻，无路由切换。点击即下钻，不跳转新页面。

---

## 二、Zone A — TopBar（顶部遥测栏）

**位置**: 顶部 32px，横跨整个屏幕  
**默认展示**: 系统状态摘要条

### 功能点清单

| # | 功能 | 数据源 | 默认展示 |
|---|------|--------|----------|
| 1 | **PHASE 指示器** | `GET /api/status → phase` | 显示当前内核阶段: `starting` / `running` / `stopping` |
| 2 | **MEM 记忆统计** | `GET /api/memory/stats → provenance.totalIndexed` | 已索引记忆数，如 `MEM 500` |
| 3 | **VEC 向量计数** | `GET /api/memory/stats` | 向量库条目数 |
| 4 | **GATEWAY 状态** | `GET /api/status → gateway` | 网关状态指示灯（绿/红） |
| 5 | **AI 引擎状态** | `GET /api/ai/status → engine_info` | 模型名称 + 运行状态 |
| 6 | **活跃执行数** | SSE `runtime.execution.started/completed` | 实时计数，如 `▶ 2` |
| 7 | **OmniTerminal 开关** | `#tb-chat-btn` | 点击打开/关闭终端 |

### 色标规则

| 项目 | 正常 | 警告 | 错误 |
|------|------|------|------|
| PHASE | 白色 `running` | — | 红色 `stopping` |
| AI 引擎 | 白色 | — | 红色 |
| 执行计数 | 白色 | — | — |

---

## 三、Zone B — LeftPane（左面板）

**位置**: 左侧 24vw，可垂直滚动  
**默认展示**: OmniTerminal + 领域集群列表

### 功能点清单

#### 3.1 Omni-Command 终端（Xterm.js）

| # | 功能 | 说明 |
|---|------|------|
| 1 | **输入框** | 用户输入命令/消息的主入口 |
| 2 | **流式输出** | SSE `runtime.agent.message_update` 实时写入 Canvas |
| 3 | **工具调用可视化** | SSE `tool_execution_start/end` → 工具状态卡片 |
| 4 | **回合标记** | SSE `turn_start/end` → `[USR]` / `[SYS]` 标记 |
| 5 | **Ctrl+` 唤醒** | 全局快捷键聚焦 |
| 6 | **历史回滚** | 支持滚动查看历史输出 |

#### 3.2 领域集群列表

| # | 功能 | 数据源 | 说明 |
|---|------|--------|------|
| 1 | **领域列表** | `GET /api/domains` | 显示所有已注册领域 |
| 2 | **状态指示灯** | `domain.status` | `active`=白色 / `sleeping`=灰色 |
| 3 | **领域名称** | `domain.domain_name` | 中文名称 |
| 4 | **技能标签** | `domain.skills` | 逗号分隔的技能列表 |

#### 3.3 Agent 列表（可选）

| # | 功能 | 数据源 | 说明 |
|---|------|--------|------|
| 1 | **Agent 列表** | `GET /api/orchestrator/agents` | 显示全部 Agent |
| 2 | **状态指示** | `agent.status` | `idle`=灰色 / `running`=白色脉冲 |
| 3 | **角色标签** | `agent.role` | CEO-AI / PM-AI / Worker |

---

## 四、Zone C — CenterPane（中央视口）

**位置**: 中央 52vw  
**默认展示**: 3D 大脑模型（R3F）

### 功能点清单

#### 4.1 3D 大脑可视化

| # | 功能 | 说明 |
|---|------|------|
| 1 | **5 分区大脑模型** | R3F 渲染，5 个功能分区 |
| 2 | **左键拖拽旋转** | 自由视角操作 |
| 3 | **左键点击爆炸展开** | 点击分区展开详情 |
| 4 | **脉冲边框** | SSE 事件驱动，不同事件类型不同颜色脉冲 |
| 5 | **帧率按需渲染** | `frameloop="demand"`，空闲 0 FPS |
| 6 | **颜色规则** | 正常=白色 / 执行中=红色脉冲 / 空闲=灰色 |

#### 4.2 CrossDomain 路由覆盖层

| # | 功能 | 触发条件 | 说明 |
|---|------|----------|------|
| 1 | **DAG 拓扑可视化** | SSE `cross_domain.dag_created` | 覆盖在大脑上方的 DAG 节点图 |
| 2 | **节点状态指示** | SSE `domain.task_completed` | 完成节点标记 ✅ |
| 3 | **连线展示依赖** | DAG 的 deps 关系 | 箭头连线表示依赖 |

#### 4.3 质询仲裁覆盖层

| # | 功能 | 触发条件 | 说明 |
|---|------|----------|------|
| 1 | **全屏红黑格点矩阵** | SSE `negotiation.ticket_created` | 覆盖整个视口 |
| 2 | **打字机动画** | 质询内容逐字显示 | 增强紧迫感 |
| 3 | **F1/F2 快捷键** | 用户操作 | 批准 / 驳回 |
| 4 | **3D 大脑变红** | 仲裁期间 | 红色脉冲表示冲突 |

---

## 五、Zone D — RightPane（右面板）

**位置**: 右侧 24vw，可垂直滚动  
**默认展示**: FSM 状态点阵 + DAG 卡片

### 功能点清单

#### 5.1 FSM 状态点阵

| # | 功能 | 数据源 | 说明 |
|---|------|--------|------|
| 1 | **10 状态点阵** | SSE `runtime.fsm.transition` | 每个状态一个圆点 |
| 2 | **当前状态高亮** | `fsm.transition → payload.to` | 当前状态白色脉冲 |
| 3 | **已完成状态标记** | 历史状态灰色 | 路径标记 |
| 4 | **状态中文名** | 配置映射 | 鼠标悬停显示 |

**状态点阵布局**:
```
IDLE ──► PLANNING ──► RUNNING ──► VERIFYING ──► COMPLETED
                         │  ▲                        │
                         ▼  │                        ▼
                    WAITING_TOOL                 FAILED
                         │
                         ▼
                    WAITING_USER
                         │
                         ▼
                    SUSPENDED ──► CANCELLED
```

#### 5.2 DAG 任务卡片

| # | 功能 | 说明 |
|---|------|------|
| 1 | **弹簧刀式折叠/展开** | 点击卡片展开详情 |
| 2 | **4 态边框颜色** | PENDING=灰色 / RUNNING=白色脉冲 / FAILED=红色 / SUCCESS=白色 |
| 3 | **任务 ID** | 卡片标题 |
| 4 | **任务目标** | 卡片副标题 |
| 5 | **所属领域** | 领域标签 |
| 6 | **依赖箭头** | 卡片间连线表示依赖关系 |

**卡片状态规则**:

| 状态 | 边框 | 可操作 |
|------|------|--------|
| `pending` | 灰色虚线 | — |
| `running` | 白色脉冲 | 点击取消 |
| `success` | 白色实线 | 点击查看结果 |
| `failed` | 红色实线 | 点击**重试** |
| `rerouting` | 黄色闪烁 | — |
| `skipped` | 灰色删除线 | — |

#### 5.3 背压 VU 表

| # | 功能 | 数据源 | 说明 |
|---|------|--------|------|
| 1 | **调度背压指示** | SSE `scheduler.backpressure` | 0-100% 柱状图 |
| 2 | **阈值标记** | 80% 警戒线 | 超过变红 |
| 3 | **Zero React** | Zustand subscribe → DOM 直接更新 | 高频不触发 React 重渲染 |

---

## 六、Zone E — BottomPane（底栏）

**位置**: 底部 200px，横跨整个屏幕，50/50 左右分割  
**默认展示**: 左侧 MemoryBus 三池 + 右侧 ArtifactRegistry 文件树

### 功能点清单

#### 6.1 MemoryBus v2 三池插槽（左侧 50%）

| # | 功能 | 数据源 | 说明 |
|---|------|--------|------|
| 1 | **Main Pool 竞争池** | `GET /api/memory/stats → mainPoolCount` | 最新/高频记忆条数 |
| 2 | **Archive 归档池** | `archiveCount` | 沉淀后的稳定记忆条数 |
| 3 | **Temp Pool 临时池** | `tempPoolSize` | 会话级临时上下文条数 |
| 4 | **写闸门拒绝率** | `gate.rejectRate` | 被过滤的低质量记忆百分比 |
| 5 | **Ctrl+K 清空临时池** | 快捷键 | 清空 Temp Pool |

**默认展示统计卡片**:
```
┌─────────────┬─────────────┬─────────────┐
│  Main       │  Archive    │  Temp       │
│  300 条     │  150 条     │  40 条      │
│  最近记忆    │  归档沉淀    │  临时会话   │
└─────────────┴─────────────┴─────────────┘
└─ Gate: 12.0% 被拒绝 ─┘
```

#### 6.2 ArtifactRegistry 产物文件树（右侧 50%）

| # | 功能 | 数据源 | 说明 |
|---|------|--------|------|
| 1 | **文件树** | `GET /api/artifacts` | 按 `projects/{execId}/` 组织 |
| 2 | **文件图标** | `artifact.type` | code=📄 / document=📝 / report=📊 |
| 3 | **点击预览** | 点击文件 | 在 SlideoverDrawer 中预览内容 |
| 4 | **SSE 增量更新** | SSE `artifact.created` | 新产物实时加入（不用刷新） |
| 5 | **版本号标签** | `artifact.version` | 显示 `v1` `v2` |

---

## 七、覆盖层组件（Overlays）

> 以下组件不占用固定面板，以覆盖层形式弹出

### 7.1 OmniTerminal

| # | 功能 | 说明 |
|---|------|------|
| 1 | **Xterm.js Canvas** | VS Code 同款引擎，零 React 重渲染 |
| 2 | **Ctrl+` 切换** | 全局快捷键唤醒/隐藏 |
| 3 | **SSE 日志流直写** | 所有 SSE 事件写入终端 |
| 4 | **命令输入** | 直接在终端输入命令 |

### 7.2 SlideoverDrawer（代码审计器）

| # | 功能 | 触发条件 |
|---|------|----------|
| 1 | **0.1s 右滑 50vw 进入** | 点击产物文件 |
| 2 | **只读代码查看** | 查看文件内容 |
| 3 | **ESC 关闭** | 关闭抽屉 |

### 7.3 ClarifySlots（澄清卡槽）

| # | 功能 | 触发条件 |
|---|------|----------|
| 1 | **YES_BUF / NO_BUF 按钮** | 后端返回 `clarification` 类型 |
| 2 | **选择题/开放式答案** | 根据 `question.type` 渲染不同表单 |
| 3 | **确认后再次请求** | 按确认 → 自动 POST `/api/chat/send` |

### 7.4 DialogueLedger（对话审计账本）

| # | 功能 | 说明 |
|---|------|------|
| 1 | `[USR]` / `[SYS]` 流水 | 用户/系统对话流水账 |
| 2 | **时间戳标记** | 每条消息带时间 |

### 7.5 InterrogationMatrix（质询矩阵）

| # | 功能 | 说明 |
|---|------|------|
| 1 | 全屏覆盖 | 黑色背景 + 红色格点 |
| 2 | 打字机动画 | 质询内容逐字显示 |
| 3 | F1/F2 快捷键 | 批准/驳回 |
| 4 | ESC 暂缓 | 挂起质询 |
| 5 | 3D 大脑同步变红 | 视觉反馈 |

---

## 八、键盘快捷键

| 快捷键 | 功能 | 适用场景 |
|--------|------|----------|
| **Ctrl+`** | 唤醒/聚焦 OmniTerminal | 全局 |
| **Ctrl+1~4** | 调整面板视口高度分布 | 全局 |
| **Ctrl+K** | 清除临时池 (Temp Pool) | 底部面板 |
| **Shift+Space** | 全局紧急中止 → `POST /api/ai/abort` | 全局 |
| **F1** | 质询仲裁：批准 | InterrogationMatrix |
| **F2** | 质询仲裁：驳回 | InterrogationMatrix |
| **ESC** | 关闭所有覆盖层/展开面板/质询 | 全局 |

---

## 九、按角色的功能矩阵

### 普通用户（查看）

| 功能区域 | 可操作项 | 只读项 |
|----------|----------|--------|
| TopBar | 点击 OmniTerminal 开关 | 系统状态、执行计数 |
| LeftPane | 在终端输入消息 | 领域列表、Agent 列表 |
| CenterPane | 拖拽旋转 3D 大脑 | 大脑可视化、DAG 拓扑 |
| RightPane | 展开/折叠 DAG 卡片 | FSM 状态、背压 VU 表 |
| BottomPane | 预览产物文件 | MemoryBus 统计 |

### 操作者（审批/裁决）

| 操作 | 触发条件 | 当前角色 |
|------|----------|----------|
| 澄清问答 | SSE `clarification` | 普通用户 |
| F1 批准质询 | InterrogationMatrix 弹出 | 管理员 |
| F2 驳回质询 | InterrogationMatrix 弹出 | 管理员 |
| 挂起/恢复任务 | FSM SUSPENDED | 管理员 |
| 重试失败任务 | 点击 FAILED 卡片"重试"按钮 | 操作者 |
| 紧急中止 | Shift+Space 或 POST abort | 管理员 |

### 按钮显示条件

| 按钮 | 显示条件 | 位置 |
|------|----------|------|
| **重试** | 仅 `task.status === 'failed'` | DAG 卡片底部 |
| **恢复** | 仅 `fsm.state === 'SUSPENDED'` | FSM 点阵旁 |
| **取消** | 仅 `fsm.state === 'RUNNING'` 或 `'PLANNING'` | FSM 点阵旁 |
| **F1 批准** | 仅 InterrogationMatrix 激活时 | 覆盖层 |
| **F2 驳回** | 仅 InterrogationMatrix 激活时 | 覆盖层 |
| **查看代码** | 仅 `artifact.type === 'code'` | 文件树节点 |
| **查看文档** | 仅 `artifact.type === 'document'` | 文件树节点 |
| **清除临时池** | 仅 `tempPoolSize > 0` | 底部面板（Ctrl+K）|

---

## 附录：数据加载策略

| 页面区域 | 加载时机 | 频率 |
|----------|----------|------|
| TopBar 状态 | 页面加载 + SSE 更新 | 事件驱动 |
| 领域列表 | 页面加载 | 一次性 |
| Agent 列表 | 页面加载 | 一次性 |
| 3D 大脑 | 页面加载 | 按需渲染 |
| FSM 状态 | SSE `runtime.fsm.transition` | 事件驱动 |
| DAG 卡片 | SSE `cross_domain.dag_created` | 事件驱动 |
| 记忆统计 | 页面加载 | 一次性 |
| 产物文件树 | 页面加载 + SSE `artifact.*` | 事件驱动 |
| 背压 VU 表 | SSE `scheduler.backpressure` | 事件驱动 |

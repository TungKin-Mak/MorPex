# 快速开始

> 面向新开发者的 MorPex 环境搭建和使用指南

---

## 1. 环境要求

- **Node.js** ≥ 20.0.0
- **npm** ≥ 9
- **(可选) DeepSeek API Key** — LLM 调用
- **(可选) OpenAI API Key** — 降级方案

## 2. 安装

```bash
# 克隆项目
git clone <repo-url> morpex
cd morpex

# 安装依赖
npm install
```

## 3. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`:

```env
# LLM API (至少配置一个)
DEEPSEEK_API_KEY=sk-your-deepseek-key
# OPENAI_API_KEY=sk-your-openai-key

# Studio 服务
PORT=8080
MIRROR_PATH=./data/mirror
```

## 4. 启动

### 开发模式 (推荐)

```bash
# 一键启动后端 + 前端 + Embedding（PM2 进程管理）
npm start

# 跳过 Embedding Server
npm run start:no-embed
```

打开浏览器访问 `http://localhost:3000`（Vite 热更新，API 自动代理到 :8080）

### 生产模式

```bash
npm run start:prod
# → http://localhost:8080 (自 serve 前端)
```

### PM2 管理命令

```bash
npm stop                # 停止所有
npm run restart         # 重启所有
npm run logs            # 实时日志
npm run start:status    # 查看进程状态
```

## 5. 验证

### 5.1 检查 API 健康状态

```bash
curl http://localhost:8080/api/health
```

预期响应:
```json
{
  "ok": true,
  "uptime": 1234,
  "kernel": { "phase": "running", "pluginCount": 0, "activeExecutions": 0 },
  "plugins": 0
}
```

### 5.2 检查引擎

```bash
curl http://localhost:8080/api/engine/check
```

### 5.3 发送一条消息

```bash
curl -X POST http://localhost:8080/api/prompt \
  -H "Content-Type: application/json" \
  -d '{"message": "你好，请用一句话介绍 MorPex"}'
```

## 6. 首次使用 UI

1. 打开 `http://localhost:3000` (开发) 或 `http://localhost:8080` (生产)
2. 你会看到 **3D 大脑主页** — 核心界面
3. 点击右下角 **聊天按钮** (👑图标) 打开聊天面板
4. 输入消息与 AI 对话
5. 点击底部栏的 **视图版图** 按钮切换不同视图

## 7. 可用视图

| 视图 | 如何打开 | 作用 |
|------|----------|------|
| 🧠 大脑主页 | 首页默认 | 3D 交互式大脑 |
| 📊 指挥中心 | 视图版图 → 指挥中心 | 系统 KPI 总览 |
| 💾 记忆系统 | 底部栏 → 全局记忆 | 记忆检索 |
| 🧠 知识图谱 | 底部栏 → 知识库 | 知识可视化 |
| 🤖 Agent 协作 | 视图版图 → Agent 协作 | 任务流水线 |
| 📡 系统健康 | 底部栏 → 系统健康 | 可观测性 |

## 8. 常用命令

```bash
npm start               # 启动全栈（PM2：Embedding + 后端 + 前端）
npm run start:no-embed  # 跳过 Embedding
npm run start:prod      # 生产模式
npm stop                # 停止所有
npm run restart         # 重启所有
npm run logs            # 实时日志
npm run start:status    # 查看 PM2 状态
npm run dev             # 备用：tsx 直接启动
npm run studio:server   # 单独启动后端
npm run studio:dev      # 单独启动前端 Vite
npm run studio:build    # 构建前端
npm run core:test       # 引擎端到端测试
```

## 9. 遇到问题？

| 问题 | 检查 |
|------|------|
| SSE 连接失败 | 后端是否运行在 :8080？ |
| LLM 返回空 | `DEEPSEEK_API_KEY` 或 `OPENAI_API_KEY` 是否设置？ |
| Vite 无法启动 | `cd packages/studio/ui && npm install` |
| 前端白屏 | 浏览器控制台是否有报错？ |

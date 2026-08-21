# MorPex Studio Web — 渲染层

MorPex 前端渲染层（`packages/studio/web`）：Vanilla TypeScript + Vite，无框架依赖。
**当前形态：浏览器模式 + 桌面壳（Tauri，`packages/studio/desktop`）共用这一套 UI**——本目录保持无框架依赖（不引入框架 / tauri 依赖），以兼容两种消费形态。

## 快速上手（浏览器模式）

1. 先启动后端（监听 `http://localhost:5473`）：

   ```bash
   npx tsx packages/studio/server/index.ts
   ```

2. 安装依赖并启动前端开发服务器：

   ```bash
   cd packages/studio/web
   npm install
   npm run dev
   ```

3. 打开 Vite 输出的本地地址（默认 `http://localhost:5173`）。

> 开发模式无需额外配置：Vite 已把 `/api` 代理到 `http://localhost:5473`（见 `vite.config.ts`）。

## ⚠️ 端口冲突（重要）

StudioServer 默认监听 `5473`（本仓库已统一默认端口，见 `packages/studio/server/index.ts`）。
若本机 5473 被其它服务占用，可改用别的端口并同步前端地址：

```bash
# 1. 用别的端口起后端
PORT=8081 npx tsx packages/studio/server/index.ts

# 2. 告诉前端真实后端地址（两种任选其一）
#    方式 A：写 .env.local（推荐）
#    方式 B：启动时注入
VITE_API_BASE=http://localhost:8081 npm run dev
```

> 方式 B 在 dev 下会绕过 Vite 代理直连后端（后端 CORS 全放开，无需代理）。生产构建同理，务必把 `VITE_API_BASE` 指向真实后端地址。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VITE_API_BASE` | `http://localhost:5473` | 后端地址（唯一后端入口，由 `src/env.ts` 读取） |

生产构建后是纯静态产物，可托管到任意静态服务器 / CDN；请通过 `VITE_API_BASE` 指向真实后端地址。

## 目录

```
src/
├── main.ts            # 入口：装配 ApiClient + hash 路由 + 顶部 tab + 4 视图
├── env.ts             # 读取 VITE_API_BASE（唯一后端地址来源）
├── api/               # 唯一触碰后端的层（HTTP 客户端 + SSE + 类型）
│   ├── client.ts      # 26 个 REST 端点 → 类型化函数（唯一拼 '/api/...' 的地方）
│   ├── http.ts        # fetch 封装：JSON、错误归一化
│   ├── sse.ts         # EventSource 封装：自动重连
│   └── types.ts       # 手写响应类型（镜像 packages/studio/server/__tests__/api-contract.test.ts）
├── ui/                # DOM 工具 / hash 路由 / 基础组件（无框架）
└── views/             # 4 个视图：会话(console，默认首页) / dashboard / events / artifacts
```

## 命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动 Vite 开发服务器（:5173，代理 /api → 5473） |
| `npm run typecheck` | TypeScript 严格类型检查（0 错误） |
| `npm run build` | 类型检查 + 产出纯静态 `dist/` |
| `npm run preview` | 本地预览构建产物 |

# MorPex Studio Desktop — 桌面壳（Tauri 2）

MorPex 桌面应用壳（`packages/studio/desktop`）：Tauri 2 原生窗口，**只负责开窗加载渲染层** `packages/studio/web`（Vite 构建产物），零后端代码、零 IPC command、零 `@morpex/*` 依赖。

架构：`desktop 壳 → (加载) → web 渲染层 → (HTTP/SSE) → StudioServer(5473)`，三段完全解耦，后端仍是独立 HTTP 服务。

## 📦 安装包（Phase 1+2 已支持：可安装 + 完全独立）

`npm run bundle` + `npm run build:installer` 产出 `MorPex Studio_0.1.0_x64-setup.exe`（~47MB），**安装后完全独立**：

- **后端打进安装包**：内置 `node.exe`（92MB）+ `repo.zip`（162MB，剥离 .d.ts/.map 的源码+依赖），首次运行由壳解压到 `%LOCALAPPDATA%/MorPex/runtime`（按版本号自动重新解压），用户**无需本机 Node / 无需仓库**。
- **用户 API Key**：首次运行自动生成 `%APPDATA%/MorPex/config.env` 模板（AGNES_API_KEY / SILICONFLOW_API_KEY / MINICPM_API_KEY），用户填 key 重启生效；壳把 key 注入后端环境变量（morpex.yaml 的 `${VAR}` 引用）。
- **NSIS 安装**：简体中文向导、当前用户安装（免管理员）、开始菜单快捷方式、卸载程序。
- **数据位置**：`%LOCALAPPDATA%/MorPex/runtime/data/`（数据库/产物）；卸载重装会清空（v1 限制）。

## 🚀 双击即用（v1 已支持）

**`MorPex-Studio.exe`**（`packages/studio/desktop/` 下，由 `npm run build:exe` 复制）双击即可打开应用（**不会弹出多余的 CLI 黑窗口**）——壳会自动完成：

1. **探测** `localhost:5473`：后端未运行 → 自动拉起 `node <仓库>/node_modules/tsx/dist/cli.mjs <仓库>/packages/studio/server/index.ts`（后端默认端口 5473，日志写 `logs/desktop-backend.log`）
2. 开窗加载渲染层；后端启动约 **40s**（真实 cognee 冷启动可能更久），期间界面显示「后端未就绪，自动重试中…」，就绪后自动连接
3. **关闭窗口 → 自动停止由壳拉起的后端**（若后端本就是手动运行的则不杀）

**仓库定位**：`MORPEX_REPO` 环境变量优先；否则从 exe 位置向上找（标记=`packages/studio/server/index.ts`），故 exe 需放在仓库内（`packages/studio/desktop/MorPex-Studio.exe` 即为标准位置）。

> 依赖：本机需有 Node（`node` 在 PATH）+ 仓库 node_modules 完整。把 exe 拷到别处会因找不到仓库而无法自动启动后端（界面会提示手动启动）。

## 前置条件

- **Rust 工具链**（本机已装：cargo/rustc）
- **Windows WebView2 运行时**（Win10/11 预装）
- Node.js ≥ 20（在 PATH）

## 快速上手

### 方式 A：双击 exe（推荐，无需终端）

```bash
# 一次性构建并复制 exe 到 packages/studio/desktop/MorPex-Studio.exe
cd packages/studio/desktop && npm install && npm run build:exe
# 之后直接双击 MorPex-Studio.exe 即可（后端自动拉起/自动停止）
```

### 方式 B：开发模式（热加载，改完即测）

**两个终端**：

```bash
# 终端 1：后端（tsx watch 自动重启，改后端保存后 ~40s 自动就绪）
npm run dev:backend          # 仓库根目录执行

# 终端 2：前端 HMR + 桌面窗口
cd packages/studio/desktop && npm run dev:all
```

- **前端改动**（web/src）：Vite HMR **即时生效**（保存即刷，无需重启）
- **后端改动**（core/studio server）：`tsx watch` **自动重启**，无需手动操作
- 壳 Rust 改动：重启 `dev:all`

> 终端 2 的 `tauri dev` 会探测 5473：后端已在终端 1 运行时它不会重复拉起。若只跑 `dev:all` 没跑终端 1，壳会自动从仓库拉起一个后端（无 watch）。

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev:all` | 一键：vite dev + tauri dev |
| `npm run dev` | 仅 tauri dev（需 vite 已在 5173 运行） |
| `npm run bundle` | `node scripts/bundle-backend.mjs`：打包可移植后端（portable/node.exe + repo.zip） |
| `npm run build:installer` | `tauri build`：编译 + NSIS 安装包（**含内置后端运行时**） |
| `npm run build:exe` | `tauri build --no-bundle` + 复制独立 exe 到 `MorPex-Studio.exe`（依赖仓库） |
| `npm run build` | `tauri build --no-bundle`（仅编译验证） |
| `npm run check` | `cargo check`（快速编译检查） |

## 构建说明

- **安装包**：`npm run bundle` 先打包可移植后端，再 `npm run build:installer` 产出 setup.exe（NSIS 已配简体中文 + currentUser + 镜像见下）。
- 图标：当前为脚本生成的占位图标（`src-tauri/icons/`），后续可替换为正式 Logo 后 `npx tauri icon <1024px PNG>` 重新生成。
- `tauri.conf.json` 的 `bundle.active=true`（NSIS）；`bundle.resources` 只打 node.exe + repo.zip 两个单文件（规避 node_modules 深路径超 Windows 260 字符导致 NSIS 失败）。
- 代码保护（防修改）为后续迭代：当前包内是明文源码（Phase C 决策：先独立安装包、暂不加密），后续可用 Bytenode 编 V8 字节码 + 前端混淆提升逆向难度。

## 常见问题

- **crates.io 拉取失败/超时**：配置国内镜像，在 `src-tauri/` 下建 `.cargo/config.toml`：

  ```toml
  [source.crates-io]
  replace-with = "rsproxy-sparse"
  [source.rsproxy-sparse]
  registry = "sparse+https://rsproxy.cn/index/"
  [net]
  git-fetch-with-cli = true
  ```

- **后端连不上**：确认后端已启动且端口匹配（渲染层默认 `http://localhost:5473`，可用 `VITE_API_BASE` 覆盖）。

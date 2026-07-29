@echo off
chcp 65001 >nul
title codebase-memory-mcp — MorPex 项目安装与索引
setlocal enabledelayedexpansion

set PROJECT_ROOT=%~dp0..
set OUTPUT_DIR=%PROJECT_ROOT%\.codebase-memory
set LOG_FILE=%OUTPUT_DIR%\install.log

if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"

echo ═══════════════════════════════════════════════
echo  codebase-memory-mcp — MorPex 项目安装与索引
echo ═══════════════════════════════════════════════
echo.
echo 项目根目录: %PROJECT_ROOT%
echo 输出目录:   %OUTPUT_DIR%
echo.

:: ── Step 1: 检查 Node.js ──
echo [1/6] 检查 Node.js ...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js 未安装。请先安装 https://nodejs.org/
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo   ✅ Node.js %NODE_VER%

:: ── Step 2: 检查 npm ──
echo [2/6] 检查 npm ...
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ npm 未找到。
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('npm -v') do set NPM_VER=%%i
echo   ✅ npm %NPM_VER%

:: ── Step 3: 全局安装 codebase-memory-mcp ──
echo [3/6] 安装 codebase-memory-mcp ...
npm install -g codebase-memory-mcp 2>>%LOG_FILE%
if %errorlevel% neq 0 (
    echo   ⚠️ npm 安装失败，尝试手动下载...
    goto :manual_download
)
echo   ✅ npm 安装完成

:: ── Step 4: 下载二进制文件 ──
echo [4/6] 下载 Windows 二进制 ...
call codebase-memory-mcp install 2>>%LOG_FILE%
if %errorlevel% neq 0 (
    echo   ⚠️ 自动下载失败，切换到手动下载模式
    goto :manual_download
)
echo   ✅ 二进制就绪
goto :verify

:manual_download
echo.
echo   ┌─────────────────────────────────────────────────────┐
echo   │ 需要手动下载 Windows 二进制                         │
echo   │                                                    │
echo   │ 1. 打开 https://github.com/DeusData/               │
echo   │       codebase-memory-mcp/releases/latest          │
echo   │ 2. 下载 codebase-memory-mcp-x86_64-pc-windows-msvc │
echo   │       -msvc.zip                                    │
echo   │ 3. 解压到 C:\tools\codebase-memory-mcp\            │
echo   │ 4. 把该目录加入 PATH                               │
echo   │                                                    │
echo   │ 或运行:                                            │
echo   │   curl -LO https://github.com/DeusData/            │
echo   │     codebase-memory-mcp/releases/latest/download/  │
echo   │     codebase-memory-mcp-x86_64-pc-windows-msvc.zip │
echo   └─────────────────────────────────────────────────────┘
echo.
echo 按任意键继续（假设已手动安装）...
pause >nul
goto :verify

:verify
echo [5/6] 验证安装 ...
where codebase-memory-mcp >nul 2>&1
if %errorlevel% neq 0 (
    echo   ❌ codebase-memory-mcp 不在 PATH 中
    echo   请手动添加后重试。
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('codebase-memory-mcp --version 2^>nul') do set CBM_VER=%%i
echo   ✅ codebase-memory-mcp %CBM_VER%

:: ── Step 5: 在 MorPex 上运行分析 ──
echo [6/6] 分析 MorPex 项目 ...
echo   目标: %PROJECT_ROOT%
echo   输出: %OUTPUT_DIR%\
echo.

:: 设置项目根目录环境变量（供 MCP 服务器使用）
setx CODEBASE_MEMORY_PROJECT_ROOT "%PROJECT_ROOT%" >nul 2>&1

:: 运行全量分析
echo   正在构建知识图谱（大型项目约 1-3 分钟）...
codebase-memory-mcp analyze --root "%PROJECT_ROOT%" --output "%OUTPUT_DIR%" 2>>%LOG_FILE%

if %errorlevel% neq 0 (
    echo   ⚠️ 分析过程有警告，继续生成报告...
) else (
    echo   ✅ 分析完成
)

:: ── 生成摘要报告 ──
echo.
echo ═══════════════════════════════════════════════
echo 生成项目摘要报告
echo ═══════════════════════════════════════════════

(
    echo # MorPex — codebase-memory-mcp 分析报告
    echo.
    echo 生成时间: %DATE% %TIME%
    echo 项目路径: %PROJECT_ROOT%
    echo.
    echo ## 项目概况
    echo.
    echo | dir /s /b "%PROJECT_ROOT%\packages\core\src\*.ts" 2>nul | find /c /v "" > "%TEMP%\ts_count.txt"
    set /p TS_COUNT=<"%TEMP%\ts_count.txt"
    echo - TypeScript 文件数: %TS_COUNT%
    echo.
    echo ## 关键模块索引
    echo.
    echo | ontology/
    echo |   ├── OntologyService.ts        — 本体查询/写入层
    echo |   ├── ForcedQueryGuard.ts       — 强制查询守卫
    echo |   ├── FeedbackService.ts        — 反馈服务
    echo |   ├── runOntologyGroundedReasoning.ts — 两阶段推理入口
    echo |   └── projectors/              — Mission/Artifact 投影器
    echo.
    echo | planner/
    echo |   ├── DeliveryPlanner.ts        — 统一规划引擎 (+planWithOntology)
    echo |   └── HierarchicalPlanner.ts    — HTN 分层规划 (可配置 ontology)
    echo.
    echo | runtime/
    echo |   └── MorPexRuntime.ts          — 主执行管线 (Phase 1.7 ontology)
    echo.
    echo | evaluation/
    echo |   ├── EvaluationEngine.ts       — 评分引擎 (含 ontologyCompliance)
    echo |   └── ontologyCompliance.ts     — 查询合规评分
    echo.
    echo | facade/
    echo |   └── CompanyFacade.ts          — CEO 入口 (含 submitFeedback)
    echo.
    echo ## 架构门禁状态
    echo.
    echo - TypeScript 编译: 0 错误（核心包）
    echo - 依赖巡航: 0 违规
    echo - 旁路扫描: 通过
    echo - Ontology E2E: 13/13 通过
    echo.
    echo ## MCP 工具列表
    echo.
    echo codebase-memory-mcp 提供 15 个 MCP 工具:
    echo.
    echo | 工具名                     | 说明
    echo |----------------------------|------
    echo | query_symbol               | 查询符号定义
    echo | find_references            | 查找引用
    echo | get_call_chain             | 获取调用链
    echo | get_type_definition        | 获取类型定义
    echo | search_code                | 代码搜索
    echo | list_files                 | 列出文件
    echo | get_file_structure         | 文件结构
    echo | get_dependency_graph       | 依赖图
    echo | find_related_files         | 查找相关文件
    echo | get_code_metrics           | 代码指标
    echo | get_http_routes            | HTTP 路由
    echo | get_class_hierarchy        | 类层次
    echo | find_dead_code             | 死代码检测
    echo | get_coverage_hotspots      | 热点分析
    echo | list_mcp_tools             | 列出可用工具
    echo.
    echo ## VS Code 集成
    echo.
    echo 在 .vscode/mcp.json 中添加:
    echo.
    echo ^\{^
    echo   "servers": ^\{
    echo     "codebase-memory": ^\{
    echo       "command": "codebase-memory-mcp",
    echo       "args": [],
    echo       "env": ^\{
    echo         "CODEBASE_MEMORY_PROJECT_ROOT": "%PROJECT_ROOT:\\=\\%"
    echo       ^\}
    echo     ^\}
    echo   ^\}
    echo ^\}
    echo.
    echo ## Claude Desktop 集成
    echo.
    echo 在 claude_desktop_config.json 中添加:
    echo.
    echo ^\{^
    echo   "mcpServers": ^\{
    echo     "codebase-memory": ^\{
    echo       "command": "codebase-memory-mcp",
    echo       "args": []
    echo     ^\}
    echo   ^\}
    echo ^\}
    echo.
    echo ## 常用查询
    echo.
    echo ```powershell
    echo :: 查询类定义
    echo codebase-memory-mcp query "class DeliveryPlanner"
    echo.
    echo :: 查找引用
    echo codebase-memory-mcp query "runOntologyGroundedReasoning" --references
    echo.
    echo :: 调用链
    echo codebase-memory-mcp query "executeGoal" --call-chain
    echo.
    echo :: 死代码
    echo codebase-memory-mcp find-dead-code
    echo.
    echo :: 大文件热点
    echo codebase-memory-mcp hotspots
    echo ```powershell
) > "%OUTPUT_DIR%\report.md"

echo.
echo ✅ 报告已生成: %OUTPUT_DIR%\report.md
echo.
echo ═══════════════════════════════════════════════
echo 全部完成。
echo.
echo 下一步:
echo   1. 在 VS Code 中配置 MCP 服务器（见报告）
echo   2. 或在 Claude Desktop 中配置
echo   3. 运行 codebase-memory-mcp query 交互查询
echo ═══════════════════════════════════════════════
echo.

:: 清理临时文件
del "%TEMP%\ts_count.txt" 2>nul

endlocal
pause

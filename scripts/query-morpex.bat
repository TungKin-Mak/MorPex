@echo off
chcp 65001 >nul
title codebase-memory-mcp — MorPex 查询助手
setlocal enabledelayedexpansion

:: 确保 codebase-memory-mcp 可用
where codebase-memory-mcp >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ codebase-memory-mcp 未安装。先运行 setup-codebase-memory.bat
    pause
    exit /b 1
)

:: 设置项目根
set PROJECT_ROOT=%~dp0..
set CODEBASE_MEMORY_PROJECT_ROOT=%PROJECT_ROOT%

:MENU
cls
echo ═══════════════════════════════════════════════
echo  MorPex — codebase-memory-mcp 查询菜单
echo ═══════════════════════════════════════════════
echo.
echo  1. ontology 模块全景
echo  2. executeGoal 调用链
echo  3. 大文件热点（TOP 5）
echo  4. 死代码检测
echo  5. 查询类/接口定义
echo  6. 查找引用
echo  7. HTTP 路由
echo  8. 依赖图
echo  9. 自定义查询
echo  0. 退出
echo.
set /p CHOICE="请选择 (0-9): "

if "%CHOICE%"=="1" goto :ontology_panorama
if "%CHOICE%"=="2" goto :execute_chain
if "%CHOICE%"=="3" goto :hotspots
if "%CHOICE%"=="4" goto :dead_code
if "%CHOICE%"=="5" goto :query_symbol
if "%CHOICE%"=="6" goto :find_refs
if "%CHOICE%"=="7" goto :http_routes
if "%CHOICE%"=="8" goto :dep_graph
if "%CHOICE%"=="9" goto :custom
if "%CHOICE%"=="0" exit /b

echo 无效选择
timeout /t 2 >nul
goto :MENU

:ontology_panorama
echo.
echo 🔍 ontology 模块全景
echo.
codebase-memory-mcp query "class OntologyService" --call-chain
echo.
echo ---
codebase-memory-mcp query "class ForcedQueryGuard" --call-chain
echo.
echo ---
codebase-memory-mcp query "runOntologyGroundedReasoning" --references
echo.
pause
goto :MENU

:execute_chain
echo.
echo 🔍 executeGoal 调用链
echo.
codebase-memory-mcp query "executeGoal" --call-chain
echo.
pause
goto :MENU

:hotspots
echo.
echo 🔍 大文件热点
echo.
codebase-memory-mcp hotspots --top 5
echo.
pause
goto :MENU

:dead_code
echo.
echo 🔍 死代码检测
echo.
codebase-memory-mcp find-dead-code
echo.
pause
goto :MENU

:query_symbol
set /p SYMBOL="输入要查询的符号名: "
echo.
codebase-memory-mcp query "%SYMBOL%"
echo.
pause
goto :MENU

:find_refs
set /p SYMBOL="输入要查找引用的符号名: "
echo.
codebase-memory-mcp query "%SYMBOL%" --references
echo.
pause
goto :MENU

:http_routes
echo.
echo 🔍 HTTP 路由
echo.
codebase-memory-mcp http-routes
echo.
pause
goto :MENU

:dep_graph
echo.
echo 🔍 依赖图（限于 3 层）
echo.
codebase-memory-mcp dependency-graph --depth 3
echo.
pause
goto :MENU

:custom
set /p CMD="输入完整命令: "
echo.
call codebase-memory-mcp %CMD%
echo.
pause
goto :MENU

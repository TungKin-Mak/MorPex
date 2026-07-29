@echo off
SETLOCAL ENABLEDELAYEDEXPANSION

ECHO ============================================
ECHO  codebase-memory-mcp - MorPex Project Setup
ECHO ============================================
ECHO.
ECHO Project root: %~dp0..\
ECHO.

:: Check if binary exists locally
SET BIN_PATH=%~dp0..\.codebase-memory\bin\codebase-memory-mcp.exe
IF EXIST "%BIN_PATH%" (
    ECHO [OK] Local binary found: %BIN_PATH%
    GOTO :run_analysis
)

:: Check PATH
WHERE codebase-memory-mcp >nul 2>&1
IF %ERRORLEVEL% EQU 0 (
    ECHO [OK] codebase-memory-mcp found in PATH
    SET BIN_PATH=codebase-memory-mcp
    GOTO :run_analysis
)

ECHO [INFO] codebase-memory-mcp not found.
ECHO.
ECHO Please download manually:
ECHO   1. Open https://github.com/DeusData/codebase-memory-mcp/releases/latest
ECHO   2. Download codebase-memory-mcp-x86_64-pc-windows-msvc.zip
ECHO   3. Extract the EXE to: %~dp0..\.codebase-memory\bin\
ECHO.
ECHO After placing the binary, run this script again.
ECHO.
PAUSE
EXIT /b 1

:run_analysis
SET OUTPUT_DIR=%~dp0..\.codebase-memory
IF NOT EXIST "%OUTPUT_DIR%" MKDIR "%OUTPUT_DIR%"

ECHO [1/2] Running codebase analysis...
"%BIN_PATH%" analyze --root "%~dp0.." --output "%OUTPUT_DIR%"
ECHO.

ECHO [2/2] Generating summary...
(
    ECHO # MorPex - Codebase Memory Report
    ECHO.
    ECHO Generated: %DATE% %TIME%
    ECHO.
    ECHO ## Key Commands
    ECHO.
    ECHO ### Query a symbol
    ECHO   "%BIN_PATH%" query "class DeliveryPlanner"
    ECHO.
    ECHO ### Find references
    ECHO   "%BIN_PATH%" query "runOntologyGroundedReasoning" --references
    ECHO.
    ECHO ### Call chain
    ECHO   "%BIN_PATH%" query "executeGoal" --call-chain
    ECHO.
    ECHO ### Dead code
    ECHO   "%BIN_PATH%" find-dead-code
    ECHO.
    ECHO ### Hotspots (large files)
    ECHO   "%BIN_PATH%" hotspots --top 5
    ECHO.
    ECHO ## VS Code Config (.vscode/mcp.json)
    ECHO.
    ECHO {^
    ECHO   "servers": {^
    ECHO     "codebase-memory": {^
    ECHO       "command": "%BIN_PATH:\=\\%",^
    ECHO       "args": [],^
    ECHO       "env": {^
    ECHO         "CODEBASE_MEMORY_PROJECT_ROOT": "%~dp0..\\"^
    ECHO       }^
    ECHO     }^
    ECHO   }^
    ECHO }
) > "%OUTPUT_DIR%\report.md"

ECHO [OK] Done! Report: %OUTPUT_DIR%\report.md
ECHO.
PAUSE

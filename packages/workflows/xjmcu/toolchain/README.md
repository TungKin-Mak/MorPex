# XJ MCU 全闭环自动开发系统

> **目标**: 从单个 `.c` 源文件出发，全自动完成 **编译 → 烧录 → 硬件仿真验证**，输出结构化结果供 AI 智能体消费。

---

## 目录

- [系统架构](#系统架构)
- [快速开始](#快速开始)
- [三层调用方式](#三层调用方式)
- [数据流详解](#数据流详解)
- [配置字 (Option Words)](#配置字-option-words)
- [buildcli 编译工具链](#buildcli-编译工具链)
- [astrocli 硬件仿真器](#astrocli-硬件仿真器)
- [项目结构](#项目结构)
- [支持芯片](#支持芯片)
- [退出码](#退出码)
- [依赖](#依赖)
- [Git 提交历史](#git-提交历史)

---

## 系统架构

```
                     ┌─────────────────────────────┐
                     │       agent.py (统一入口)      │
                     │  Agent.closed_loop()          │
                     │  Agent.build() / .verify()    │
                     └──────────┬──────────────────┘
                                │
            ┌───────────────────┼───────────────────┐
            ▼                   ▼                   ▼
   ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
   │   buildcli/    │  │   astrocli/    │  │   硬件仿真器    │
   │ 编译工具链      │  │ 烧录+仿真工具   │  │ XJ-IDE V2.0    │
   │                │  │                │  │ VID=0x8235     │
   │ slcc (SDCC)    │  │ WinUSB直连      │  │ PID=0x584B     │
   │ slasm          │  │ 8阶段固件下载    │  │                │
   │ sllink (gplink)│  │ 调试/运行/读RAM  │  │ XC8P9530 MCU   │
   │ slvo           │  │                │  │                │
   └────────────────┘  └────────────────┘  └────────────────┘
```

### 核心模块

| 模块 | 行数 | 职责 |
|------|------|------|
| `agent.py` | 280 | 统一 AI 接口: `Agent.build()` / `.verify()` / `.closed_loop()` |
| `buildcli/pipeline.py` | 335 | 9 阶段编译流水线 |
| `buildcli/compiler.py` | 141 | slcc / slasm / sllink / slvo 子进程封装 |
| `buildcli/project.py` | 360 | .mpj / .xj 生成+解析, 配置字提取, 路径修复 |
| `buildcli/chipdb.py` | 70 | 从 IDE XML 解析 32 款芯片参数 |
| `buildcli/hexbin.py` | 35 | Intel HEX → .xbin (16-bit LE word padded) |
| `buildcli/patches/core.py` | 174 | 汇编补丁: Pwm2Patch, Counter2Patch |
| `astrocli/agent.py` | 270 | 仿真执行: `exec_firmware()` |
| `astrocli/commands.py` | 384 | 8 阶段下载 + 调试命令 |
| `astrocli/transport.py` | 366 | WinUSB 传输层 (libusbK) |
| `astrocli/protocol.py` | 100 | CRC-16/XMODEM + 命令包构建 |

---

## 快速开始

### 环境要求

- Windows 10/11
- Python 3.10+
- XJ-IDE 工具链: `F:\DevTools\XJ_C_IDE_V1.9.2.251202` (或设置 `XJIDE_HOME` 环境变量)
- XJ-IDE V2.0 仿真器 (USB 连接, 驱动已安装)

### 安装

```bash
cd E:\cli
pip install libusbK   # astrocli 依赖
```

### 最简示例

**1. 写一个程序:**

```c
// main.c
// @config 0x1FFF, 0x3F77, 0x1FE5, 0x3BFF, 0x3FFF, 0x3FFF
#include "XC8P9530.h"

unsigned char x, y;

void main()
{
    x = 0;
    y = 200;
    while (1)
    {
        if (x < 200) x++;
        if (y > 0) y--;
        __asm__(" nop ");
    }
}
```

**2. 一键编译+烧录+验证:**

```bash
python -c "
from agent import Agent
r = Agent().closed_loop(sources=['main.c'], chip='XC8P9530', expect={0x10:200, 0x11:0})
print(r.summary())
"
# 输出: [PASS] build OK → verify OK (5ms)
```

---

## 三层调用方式

### Layer 1: CLI 命令行

```bash
# ── buildcli ──

# 从单个 .c 编译
python -m buildcli build --chip XC8P9530 --src main.c

# 从 IDE 工程编译
python -m buildcli build --mpj project.mpj

# 指定配置字
python -m buildcli build --chip XC8P9530 --src main.c --config 1FFF,3F77,1FE5,3BFF,3FFF,3FFF

# AI Agent JSON 模式
python -m buildcli agent --chip XC8P9530 --src main.c

# 创建新项目 (1:1 复刻 IDE 结构)
python -m buildcli init --chip XC8P9530 --name MyProject -o ./my_project

# 工具链查询
python -m buildcli discover              # IDE 路径
python -m buildcli chips                 # 32 款芯片列表
python -m buildcli chip-info XC8P9530    # 芯片参数
python -m buildcli mpj-info project.mpj  # 项目信息
python -m buildcli hex2xbin firmware.hex 1024  # HEX 转换

# ── astrocli ──

# 烧录 + 运行 + 验证
python -m astrocli exec firmware.xbin --run 0.5 --expect "0x10=200,0x11=0"

# 仅烧录
python -m astrocli flash firmware.xbin

# 交互式调试 Shell
python -m astrocli shell firmware.xbin

# 单步执行
python -m astrocli step firmware.xbin -n 10

# 连接测试
python -m astrocli connect
```

### Layer 2: Python API (分步控制)

```python
from agent import Agent

agent = Agent()

# Step 1: 编译
build = agent.build(sources=["main.c"], chip="XC8P9530")

print(build.ok)            # True
print(build.xbin)          # "build/firmware.xbin"
print(build.summary())     # "[PASS] XC8P9530 ROM=1024W"

if not build.ok:
    print(f"编译失败: {build.error}")
    print(f"失败阶段: {build.phases}")

# Step 2: 烧录验证
verify = agent.verify(
    xbin=build.xbin,
    expect={0x10: 200, 0x11: 0},
    run_duration=0.5,
)

print(verify.ok)           # True
print(verify.memory)       # {"0x10": 200, "0x11": 0}
print(verify.registers)    # {"PCL": 12, "ACC": 0, ...}
print(verify.mismatches)   # []
print(verify.run_ms)       # 5
```

### Layer 3: 一站式闭环 (AI 智能体推荐)

```python
from agent import Agent

agent = Agent()

# 一个调用完成全部流程
result = agent.closed_loop(
    sources=["main.c"],
    chip="XC8P9530",
    expect={0x10: 200, 0x11: 0},
    read_addrs=[0x10, 0x11],
    run_duration=0.5,
    output_dir="my_build",
)

print(result.ok)           # True
print(result.summary())    # "[PASS] build OK → verify OK (5ms)"

# 错误处理
if not result.ok:
    if result.build and not result.build.ok:
        print(f"编译失败: {result.build.error}")
    elif result.verify and not result.verify.ok:
        for m in result.verify.mismatches:
            print(f"  地址 {m['address']}: 期望={m['expected']} 实际={m['actual']}")

# JSON 序列化 (供 AI 智能体传输)
import json
print(json.dumps(agent.to_dict(result), indent=2, ensure_ascii=False))

# 模块级便捷函数
from agent import closed_loop, build, verify
result = closed_loop(sources=["main.c"], chip="XC8P9530", expect={0x10: 200})
```

---

## 数据流详解

### 编译流水线 (buildcli, 9 阶段)

```
main.c
  │  // @config 0x1FFF, 0x3F77, ...
  │  #include "XC8P9530.h"
  │  unsigned char x, y;
  │  void main() { ... }
  │
  ▼
┌─────────────────────────────────────────────────────────┐
│ Phase 1  discover_ide    找到 IDE 安装路径               │
│          F:\DevTools\XJ_C_IDE_V1.9.2.251202             │
│                                                         │
│ Phase 2  resolve_chip    解析 XC8P9530.XML               │
│          ROM=1024W  RAM=80B  OptionSize=6               │
│                                                         │
│ Phase 3  compile         slcc -S -pXC8P9530             │
│          --use-non-free -o main.asm main.c              │
│          C → 汇编 (SDCC xj port)                        │
│                                                         │
│ Phase 4  patch           汇编补丁注入 (可选)              │
│          注入 max(Pwm,Pwm1) / max(Counter,Counter1)     │
│          智能跳过 C 已定义的全局变量                      │
│                                                         │
│ Phase 5  assemble        slasm -c -pXC8P9530             │
│          -o main.o main.asm                             │
│          汇编 → 目标文件                                 │
│                                                         │
│ Phase 6  link            sllink -c -m -sXC8P9530.lkr    │
│          -ofirmware main.o xc8p9530.lib                 │
│          链接 → .hex .cof .map .lst .cod                │
│                                                         │
│ Phase 7  hex2xbin        Intel HEX → .xbin              │
│          1024 words × 2 bytes = 2048 bytes              │
│          未使用区域填充 0x3FFF                           │
│                                                         │
│ Phase 8  gen_xj          生成 .xj (IDE 项目文件)         │
│          54 字节头 + 2048 字节 ROM 数据                  │
│                                                         │
│ Phase 9  gen_mpj         自动生成 .mpj (含配置字)        │
│          供 astrocli 自动发现配置字                      │
└─────────────────────────────────────────────────────────┘
  │
  ▼
产物: firmware.hex, firmware.xbin, firmware.mpj, firmware.xj, ...
```

### 仿真验证流程 (astrocli, 8 阶段)

```
firmware.xbin + firmware.mpj
  │
  ▼
┌─────────────────────────────────────────────────────────┐
│ 1. discover       USB 发现设备                           │
│     VID=0x8235 PID=0x584B → WinUSB 直连                 │
│     EP2 OUT (0x02) / EP6 IN (0x86)                      │
│                                                         │
│ 2. download       8 阶段固件下载                         │
│     Phase 1: 握手初始化 (CMD_INIT)                       │
│     Phase 2: Pass1 固件下载 (33B 分块)                   │
│     Phase 3: 写配置字 (CMD_WRITE_CFG)                    │
│     Phase 4: Flash 校验读取                              │
│     Phase 5: 状态转换 (CMD_TRANSITION)                   │
│     Phase 6: Pass2 编程 (word 交织)                      │
│     Phase 7: Pass2 回读校验                              │
│                                                         │
│ 3. debug_entry    进入调试模式                           │
│     HALT × 2 时序 → PCL=0x01                            │
│                                                         │
│ 4. freerun        CPU 自由运行 N 秒                      │
│     8MHz/4T = 2MIPS, 约 20 万次循环/秒                  │
│                                                         │
│ 5. stop           停止 CPU (CMD_HALT_STEP)               │
│     注意: 可能停在指令间隙                              │
│                                                         │
│ 6. read_ram       读取指定 RAM 地址                      │
│     逐个地址读取，返回 {addr: value}                     │
│                                                         │
│ 7. verify         与期望值比对                           │
│     全部匹配 → pass, 否则列出 mismatches                 │
│                                                         │
│ 8. disconnect     断开 USB 连接                         │
└─────────────────────────────────────────────────────────┘
  │
  ▼
结果: {memory: {0x10: 200, 0x11: 0}, mismatches: [], status: "pass"}
```

### 硬件执行速度参考

| 参数 | 值 |
|------|-----|
| 主频 | 8MHz IRC |
| 分频 | 4T (默认) |
| 有效速度 | 2 MIPS |
| 每循环指令 | ~10-12 |
| 循环速率 | ~170k-200k 次/秒 |
| 255 步递减 | ~1.3ms |
| 255→0→255 三角波 | ~2.6ms |

---

## 配置字 (Option Words)

配置字控制 MCU 硬件行为，**不在 HEX 文件中**，通过 `.mpj` 独立传输给 astrocli。

### 三种指定方式

| 优先级 | 方式 | 示例 |
|--------|------|------|
| 1 (最高) | `--config` CLI 参数 | `--config 1FFF,3F77,1FE5,3BFF,3FFF,3FFF` |
| 2 | `// @config` 源码注释 | `// @config 0x1FFF, 0x3F77, 0x1FE5, 0x3BFF, 0x3FFF, 0x3FFF` |
| 3 | `#define` 宏 | `#define BUILDCLI_CONFIG_WORD0 0x1FFF` |
| 4 (默认) | 内置默认值 | `[0x1FFF, 0x3F77, 0x1FE5, 0x3BFF, 0x3FFF, 0x3FFF]` |

### XC8P9530 配置字含义 (默认值)

| Word | 默认值 | 含义 |
|------|--------|------|
| 0 | `0x1FFF` | IRC=8MHz, OTP=1K, 无加密, HIGH 功率 |
| 1 | `0x3F77` | **WDT 禁止**, **4 Clocks 分频**, P63=GPIO, 复位=18ms |
| 2 | `0x1FE5` | 倍频禁止, LVR=1.8V always, IRC 源=VDD |
| 3 | `0x3BFF` | 复位上拉禁止, 查表范围=1K |
| 4 | `0x3FFF` | 保留 |
| 5 | `0x3FFF` | 保留 |
| 6 | `0x3FFC` | VDD=内部 5V |
| 7 | `0xFFFF` | 保留 |

---

## buildcli 编译工具链

### 支持的输入格式

| 输入 | 说明 |
|------|------|
| `--src main.c` | 单个 C 源文件 |
| `--src main.c utils.asm` | C + 汇编混合 |
| `--src ./src_dir/` | 目录 (自动扫描 .c/.asm) |
| `--mpj project.mpj` | IDE 工程文件 |
| `.mpj` 损坏路径 | 3 策略自动修复 |

### 编译器调用

```bash
# C → 汇编
slcc -S -Iheader -Iinclude -pXC8P9530 --use-non-free -o out.asm src.c

# 汇编 → 目标文件
slasm -c -pXC8P9530 -Iinclude -o out.o src.asm

# 链接
sllink -c -m -sXC8P9530.lkr -ooutput obj1.o obj2.o xc8p9530.lib

# COFF → 文本
slvo -s -t output.cof
```

### 汇编补丁系统

```python
# 补丁协议
class PatchPlugin:
    name: str                    # 补丁名称
    chip_filter: list[str] | None  # 芯片过滤 (None=全部)

    def can_apply(asm_path, chip) -> bool  # 检查是否适用
    def apply(asm_path, chip) -> dict      # 执行注入
```

内置补丁:
- **Pwm2Patch**: 注入 `Pwm2 = max(Pwm, Pwm1)` 逻辑
- **Counter2Patch**: 注入 `Counter2 = max(Counter, Counter1)` 逻辑
- 自动检测 `global _VarName` 跳过 C 已定义变量

外部补丁目录: 设置 `BUILDCLI_PATCH_DIR` 环境变量

---

## astrocli 硬件仿真器

### USB 协议

| 参数 | 值 |
|------|-----|
| VID/PID | 0x8235 / 0x584B |
| 传输方式 | WinUSB (libusbK) |
| OUT 端点 | EP2 (0x02) |
| IN 端点 | EP6 (0x86) |
| 同步字节 | 0x41 |
| 数据包 | 10B 短包 / 42B 长包 / 19B 配置包 |
| 校验 | CRC-16/XMODEM |

### 命令速查

| 命令 | wValue | 功能 |
|------|--------|------|
| `CMD_INIT` | 0x0005 | 初始化握手 |
| `CMD_PASS1_DOWNLOAD` | 0x0001 | Pass1 固件下载 |
| `CMD_WRITE_CFG` | 0x0006 | 写配置字 |
| `CMD_FLASH_VERIFY` | 0x0002 | Flash 校验 |
| `CMD_TRANSITION` | 0x0008 | 状态转换 |
| `CMD_PASS2_PROGRAM` | 0x0003 | Pass2 编程 |
| `CMD_PASS2_DUMP` | 0x0004 | Pass2 回读 |
| `CMD_ENTER_DEBUG` | 0x0015 | 进入调试 |
| `CMD_FREE_RUN` | 0x0013 | 自由运行 |
| `CMD_HALT_STEP` | 0x0026 | 停止/单步 |
| `CMD_READ_CPU_STATE` | 0x0011 | 读寄存器 |
| `CMD_DISCONNECT` | 0x0022 | 断开连接 |

---

## 项目结构

```
E:\cli\
├── agent.py                # 统一 AI 智能体接口 (280行)
│
├── buildcli/               # 编译工具链 v2.0.0 (2080行)
│   ├── __init__.py          # 包入口
│   ├── __main__.py          # python -m 入口
│   ├── cli.py               # 9个子命令
│   ├── agent.py             # AI Agent JSON API
│   ├── pipeline.py          # 9阶段编译流水线
│   ├── compiler.py          # slcc/slasm/sllink/slvo 封装
│   ├── project.py           # .mpj/.xj 生成+解析+配置字提取
│   ├── chipdb.py            # IDE XML 芯片参数解析
│   ├── ide.py               # IDE 路径发现
│   ├── hexbin.py            # HEX → XBIN 转换
│   ├── types.py             # 数据类型+默认配置字
│   ├── errors.py            # 错误类型+退出码
│   └── patches/
│       ├── __init__.py      # 补丁插件框架
│       └── core.py          # Pwm2Patch, Counter2Patch
│
├── astrocli/               # 硬件仿真器 CLI (2011行)
│   ├── __init__.py
│   ├── __main__.py
│   ├── astrocli.py          # 13个子命令+交互Shell
│   ├── agent.py             # AI Agent JSON API: exec_firmware()
│   ├── commands.py          # 固件下载/MCU控制/寄存器读写
│   ├── protocol.py          # CRC/数据包构建
│   ├── transport.py         # WinUSB 传输层
│   ├── config.py            # .mpj 解析 + 配置字自动发现
│   └── constants.py         # USB 常量 + 芯片数据库
│
├── 2_XC8P9530_TEST/        # 官方 IDE 参考工程 (仅源文件)
│   ├── XC8P9530_INT.c
│   ├── XC8P9530_INT.mpj
│   ├── XC8P9530_INT.xj
│   └── XJ_Define.h
│
├── 3_FRESH_TEST/            # 多文件混合编译参考
│   ├── main.c
│   ├── fresh.h
│   ├── counter2_def.asm     # 汇编补丁用例
│   ├── FRESH.mpj
│   └── test_closed_loop.py  # 闭环测试脚本
│
├── XJIDE驱动/               # USB 驱动 (不入 git)
└── .gitignore
```

### 产物说明

| 扩展名 | 说明 | 大小 (XC8P9530) |
|--------|------|-----------------|
| `.hex` | Intel HEX 格式 | ~186 bytes |
| `.xbin` | 原始 ROM 二进制 (16-bit LE) | 2048 bytes |
| `.mpj` | XML 项目文件 (含配置字) | ~700 bytes |
| `.xj` | IDE 二进制项目文件 | 2102 bytes |
| `.cof` | COFF 调试信息 | ~2KB |
| `.cofv` | COFF 文本转储 | ~7KB |
| `.map` | 内存映射 | ~3KB |
| `.lst` | 汇编列表 | ~16KB |
| `.cod` | 代码段信息 | ~4KB |

---

## 支持芯片

通过 IDE 的 `config/*.XML` 自动发现，目前支持 32 款:

```
XC8E855E   XC8E955E   XC8FT6801
XC8M4096   XC8M4097   XC8M4098
XC8M6600   XC8M6601   XC8M8605
XC8M8632   XC8M9003   XC8M9602
XC8P8508   XC8P8521   XC8P8600
XC8P8610   XC8P8612   XC8P8613
XC8P8615   XC8P8616   XC8P9500
XC8P9510   XC8P9520   XC8P9521
XC8P9525   XC8P9527   XC8P9530
XC8P955    XC8P9611
XC8PT4501  XC8PT8500  XC8PT8503
```

查询命令: `python -m buildcli chips`

---

## 退出码

### 统一退出码 (agent.ExitCode)

| 码 | 常量 | 含义 |
|----|------|------|
| 0 | `OK` | 成功 |
| 1 | `BUILD_FAILED` | 编译失败 |
| 2 | `DEVICE_NOT_FOUND` | 设备未找到 |
| 3 | `COMM_ERROR` | USB 通信错误 |
| 4 | `VERIFY_FAILED` | 验证失败 (期望值不匹配) |
| 5 | `INPUT_ERROR` | 输入参数错误 |
| 6 | `TIMEOUT` | 操作超时 |

### buildcli 退出码

| 码 | 含义 |
|----|------|
| 0 | 编译成功 |
| 1 | IDE 未找到 |
| 2 | 编译/汇编/链接错误 |
| 3 | 输入参数错误 |
| 4 | 补丁执行失败 |
| 5 | 后处理失败 (hex2xbin/cofv) |

### astrocli 退出码

| 码 | 含义 |
|----|------|
| 0 | 仿真成功 |
| 1 | 设备未找到/无法打开 |
| 2 | USB 通信错误 |
| 3 | 验证失败 (期望值不匹配) |
| 4 | 操作超时 |

---

## 依赖

| 组件 | 依赖 |
|------|------|
| buildcli | Python 标准库 (无第三方依赖) |
| astrocli | Python 标准库 + libusbK (USB 驱动) |
| 外部工具 | IDE 工具链: slcc.exe, slasm.exe, sllink.exe, slvo.exe |
| 硬件 | XJ-IDE V2.0 仿真器 (VID=0x8235, PID=0x584B) |

---

## 新增: 知识感知代码生成 (knowledge_code_gen.py)

将 AstroBrain 知识库与 MCU 代码生成闭环集成。

### 架构

```
知识库 (~/.owb/)  ──→  knowledge_code_gen.py  ──→  agent.py (编译+验证)
     │                                                    │
     ├─ 芯片事实 (chips/XC8P9530.json)                     │
     ├─ 反模式 (Anti_Patterns/*.jsonl)                     │
     └─ 代码模板 (Recipes/*.c)                             │
                                                          ▼
                                                   tmp/ (测试报告)
```

### 用法

```python
from knowledge_code_gen import KnowledgeCodeGen

gen = KnowledgeCodeGen()

# 查询知识库
report = gen.query_knowledge("XC8P9530")
print(report.summary())

# 全链路: 知识库 → 代码生成 → 编译 → 验证
result = gen.generate_and_verify(
    chip="XC8P9530",
    requirement="Timer0 LED blink 500ms",
    output_dir="../../tmp",
)
print(result.summary())
```

### CLI

```bash
python knowledge_code_gen.py --chip XC8P9530
python knowledge_code_gen.py --chip XC8P9530 --no-build  # 仅查询知识库
```

### 测试

```bash
python ../../tmp/test_knowledge_chain.py
```

测试产物自动输出到 `tmp/` 目录:
- `knowledge_report_*.json` — 知识库检索报告
- `generated_*.c` — 知识感知生成的代码
- `chain_summary_*.md` — 链路测试总结

---

## Git 提交历史

```
[当前] 新增: knowledge_code_gen.py 知识感知代码生成
[当前] 新增: AstroBrain 桥接插件 (5个知识库工具)
[当前] 新增: MCU 知识优先系统提示注入器
[当前] 新增: tmp/ 测试输出目录
[当前] 新增: tmp/test_knowledge_chain.py 链路验证测试
aeec1a7 新增: 统一 AI Agent 接口 agent.py
1c313f8 优化: 移除 hexbin.py 未使用的 raw_to_hex 函数
8ff9f73 v2.0.0: buildcli 完全重构 + astrocli 优化
```

---

## 典型工作流示例

### 示例 1: 从零开始创建并验证新程序

```bash
# 1. 创建项目
python -m buildcli init --chip XC8P9530 --name Blink -o ./blink

# 2. 编辑源码
echo '...' > blink/Blink.c

# 3. 编译 + 验证
python -c "
from agent import Agent
r = Agent().closed_loop(
    sources=['blink/Blink.c'], chip='XC8P9530',
    expect={0x10: 200}, run_duration=0.5,
    output_dir='blink/build'
)
print(r.summary())
"
```

### 示例 2: AI 智能体自动修复代码

```python
from agent import Agent

agent = Agent()
max_attempts = 3

for attempt in range(max_attempts):
    # AI 生成/修改源码...
    write_source("main.c", generated_code)
    
    # 编译
    build = agent.build(sources=["main.c"], chip="XC8P9530")
    if not build.ok:
        print(f"编译失败 (attempt {attempt+1}): {build.error}")
        # AI 根据 build.error 修复代码...
        continue
    
    # 验证
    verify = agent.verify(
        xbin=build.xbin,
        expect=expected_values,
        run_duration=0.5,
    )
    
    if verify.ok:
        print(f"PASS (attempt {attempt+1})")
        break
    else:
        print(f"验证失败: {verify.mismatches}")
        # AI 根据 mismatches 调整逻辑...
```

### 示例 3: 批量测试多个配置字

```python
from agent import Agent

agent = Agent()
configs = [
    [0x1FFF, 0x3F77, 0x1FE5, 0x3BFF, 0x3FFF, 0x3FFF],  # 默认
    [0x1FFF, 0x3F77, 0x1FE5, 0x39FF, 0x3FFF, 0x3FFF],  # LVR=2.6V
]

for config in configs:
    result = agent.closed_loop(
        sources=["main.c"], chip="XC8P9530",
        config_words=config,
        expect={0x10: 200},
    )
    print(f"config={config[0]:04X}: {result.summary()}")
```

---

## 全链路验证结果 (2026-06-19)

| 验证项 | 结果 |
|--------|------|
| AstroBrain 知识库查询 | ✅ 24个寄存器, 13个模板, 9条规则 |
| dual_counter.c 编译 | ✅ 0错误, 1024 words |
| XJ-IDE 仿真器连接 | ✅ VID=0x8235, PID=0x584B |
| 变量读取 (counter_slow @0x12) | ✅ 1s=1, 2s=2, 3s=3 (983ms/cycle) |
| 变量读取 (counter_fast @0x13) | ✅ 1s=3, 2s=6, 3s=9 (328ms/cycle) |
| 寄存器读取 (ACC/STATUS/PORT6) | ✅ 正常运行中 |
| 时序精度 (0.5s/1s/2s/3s) | ✅ 全部精确匹配 |
| 配置字验证 | ✅ 0x1FFF, 0x3F77, 0x1FE5, 0x3BFF, 0x3FFF, 0x3FFF |

---

## Git 提交历史

```
[当前] 全链路验证通过: AI引擎->知识库->编译->仿真->变量读取
[当前] 新增: knowledge_code_gen.py 知识感知代码生成
[当前] 新增: AstroBrain 桥接插件 (5个知识库工具)
[当前] 新增: knowledge_injector.js (零硬编码)
[当前] 新增: tmp/ 测试目录 + test_knowledge_chain.py
```

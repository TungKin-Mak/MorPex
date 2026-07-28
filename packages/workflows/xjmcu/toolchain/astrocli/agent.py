"""
astrocli — AI Agent 接口模块
============================
提供结构化 JSON 输出和一站式仿真执行，供 AI 智能体调用。

设计目标:
  1. 全自动闭环: 编译 → astrocli exec → 获取结果 → 判断通过/失败
  2. 结构化输出: 所有输出为 JSON，易于解析
  3. 标准退出码: 0=成功, 1=设备错误, 2=通信错误, 3=验证失败, 4=超时
  4. 持久连接: exec 内部自动管理设备生命周期
  5. 异常安全: 任何失败路径都确保断开仿真器 (LED 熄灭)

用法示例:
  python -m astrocli exec test.xbin --run 2.0 --expect "0x12=200,0x13=0"
"""
from __future__ import annotations

import json
import time

from .transport import XJDevice, discover
from .commands import (
    flash_and_debug, read_regs, read_ram,
    freerun_mcu, stop_mcu, disconnect,
)
from .config import get_config


# ============================================================
# 退出码
# ============================================================
EXIT_OK           = 0   # 成功
EXIT_DEVICE_ERROR = 1   # 设备未找到 / 无法打开
EXIT_COMM_ERROR   = 2   # USB 通信错误
EXIT_VERIFY_FAIL  = 3   # 仿真结果与预期不符
EXIT_TIMEOUT      = 4   # 操作超时


# ============================================================
# JSON 输出辅助
# ============================================================
def _print_json(obj: dict) -> None:
    """打印 JSON 到 stdout"""
    print(json.dumps(obj, ensure_ascii=False, default=str))


# ============================================================
# 核心: 一站式仿真执行
# ============================================================
def exec_firmware(
    xbin_path: str,
    mpj_path: str = None,
    run_duration: float = 2.0,
    expect: dict[int, int] | None = None,
    read_addrs: list[int] | None = None,
    json_output: bool = True,
) -> tuple[int, dict]:
    """
    一站式固件仿真执行。

    流程:
      1. 发现并打开设备
      2. 下载固件 (Phase 1-7)
      3. 进入调试模式 (PCL=0x01)
      4. 自由运行指定时长
      5. 停止 CPU
      6. 读取寄存器 + 指定 RAM 地址
      7. 与预期值比对 (如果提供 expect)
      8. 断开连接 (★ finally 确保任何失败路径都执行)
      9. 返回 (exit_code, result_dict)

    参数:
      xbin_path    — .xbin 固件路径
      mpj_path     — .mpj 配置文件路径 (可选)
      run_duration — 自由运行时长 (秒)
      expect       — {addr: expected_value, ...} 期望的 RAM 值
      read_addrs   — [addr, ...] 额外读取的 RAM 地址列表
      json_output  — 是否打印 JSON 到 stdout

    返回:
      (exit_code, result_dict)
    """
    result = {
        "xbin": xbin_path,
        "run_duration_s": run_duration,
        "phases": {},
    }

    # ── 1. 发现设备 ──
    dev_path = discover()
    if not dev_path:
        result["error"] = "device not found"
        result["phases"]["discover"] = "fail"
        if json_output:
            _print_json(result)
        return EXIT_DEVICE_ERROR, result
    result["device"] = dev_path
    result["phases"]["discover"] = "ok"

    # ── 2. 打开设备并执行 ──
    try:
        with XJDevice() as dev:
            # ★ try/finally: 无论成功或失败，finally 确保断开仿真器
            try:
                # 读取固件
                with open(xbin_path, "rb") as f:
                    xbin = f.read()
                config = get_config(xbin_path, mpj_path)
                result["mcu"] = config["name"]
                result["config_words"] = [f"0x{w:04X}" for w in config.get("config_words", [])]

                # 下载 + 直接进入调试-暂停态 (原子操作)
                family = config.get("family")
                sfr = flash_and_debug(dev, xbin, config, verbose=False, family=family)
                result["phases"]["download"] = "ok"
                result["phases"]["debug_entry"] = "ok"
                result["entry"] = {
                    "PCL": sfr.get("PCL", 0),
                    "ACC": sfr.get("ACC", 0),
                    "STATUS": sfr.get("STATUS", 0),
                }

                # 自由运行
                t0 = time.perf_counter()
                freerun_mcu(dev, verbose=False)
                time.sleep(run_duration)
                stop_mcu(dev, verbose=False)
                elapsed = time.perf_counter() - t0
                result["actual_run_ms"] = round(elapsed * 1000)
                result["phases"]["run"] = "ok"

                # 读取寄存器
                family = config.get("family")
                sfr = read_regs(dev, family=family)
                result["registers"] = {
                    "PCL": sfr.get("PCL", 0),
                    "ACC": sfr.get("ACC", 0),
                    "STATUS": sfr.get("STATUS", 0),
                    "PORT6": sfr.get("PORT6", sfr.get("PORT6", 0)),
                    "PORT7": sfr.get("PORT7", sfr.get("PORT7", "/")),
                }
                result["phases"]["read_regs"] = "ok"

                # 读取 RAM
                memory = {}
                all_addrs = set()
                if read_addrs:
                    all_addrs.update(read_addrs)
                if expect:
                    all_addrs.update(expect.keys())
                for addr in sorted(all_addrs):
                    try:
                        memory[f"0x{addr:02X}"] = read_ram(dev, addr)
                    except Exception:
                        memory[f"0x{addr:02X}"] = None
                result["memory"] = memory

            except Exception as e:
                result["error"] = str(e)
                if json_output:
                    _print_json(result)
                # 不在这里 return，让 finally 先执行 disconnect
            finally:
                # ★ 关键: 无论成功/失败都断开，确保仿真器退出下载模式 (LED 灭)
                try:
                    disconnect(dev, verbose=False)
                    result["phases"]["disconnect"] = "ok"
                except Exception:
                    result["phases"]["disconnect"] = "fail"

            # 如果上面有错误，返回错误码
            if result.get("error"):
                return EXIT_COMM_ERROR, result

    except RuntimeError as e:
        result["error"] = str(e)
        if json_output:
            _print_json(result)
        return EXIT_DEVICE_ERROR, result
    except Exception as e:
        result["error"] = str(e)
        if json_output:
            _print_json(result)
        return EXIT_COMM_ERROR, result

    # ── 3. 比对期望值 ──
    if expect:
        result["expected"] = {f"0x{a:02X}": v for a, v in expect.items()}
        mismatches = []
        for addr, expected_val in expect.items():
            actual_val = memory.get(f"0x{addr:02X}")
            if actual_val != expected_val:
                mismatches.append({
                    "address": f"0x{addr:02X}",
                    "expected": expected_val,
                    "actual": actual_val,
                })
        result["mismatches"] = mismatches
        if mismatches:
            result["status"] = "fail"
            result["error"] = f"{len(mismatches)} mismatch(es)"
            if json_output:
                _print_json(result)
            return EXIT_VERIFY_FAIL, result

    result["status"] = "ok"
    if json_output:
        _print_json(result)
    return EXIT_OK, result


# ============================================================
# 辅助: 只读寄存器 (JSON 输出) — 供 astrocli regs 命令使用
# ============================================================
def read_registers_json() -> tuple[int, dict]:
    """连接设备并读取寄存器，输出 JSON。设备需已进入调试模式。"""
    result = {}
    try:
        with XJDevice() as dev:
            sfr = read_regs(dev)
            result["registers"] = {
                "PCL": sfr.get("PCL", 0),
                "ACC": sfr.get("ACC", 0),
                "STATUS": sfr.get("STATUS", 0),
                "PORT6": sfr.get("PORT6", 0),
                "PORT7": sfr.get("PORT7", 0),
            }
            result["status"] = "ok"
            disconnect(dev, verbose=False)
        _print_json(result)
        return EXIT_OK, result
    except Exception as e:
        result["status"] = "error"
        result["error"] = str(e)
        _print_json(result)
        return EXIT_COMM_ERROR, result


# ============================================================
# 辅助: 只读 RAM (JSON 输出) — 供 astrocli ram 命令使用
# ============================================================
def read_memory_json(addrs: list[int]) -> tuple[int, dict]:
    """连接设备并读取指定 RAM 地址，输出 JSON。设备需已进入调试模式。"""
    result = {"memory": {}, "status": "ok"}
    try:
        with XJDevice() as dev:
            for addr in addrs:
                result["memory"][f"0x{addr:02X}"] = read_ram(dev, addr)
            disconnect(dev, verbose=False)
        _print_json(result)
        return EXIT_OK, result
    except Exception as e:
        result["status"] = "error"
        result["error"] = str(e)
        _print_json(result)
        return EXIT_COMM_ERROR, result

"""
agent — 统一 AI 智能体接口
==========================
提供编译→烧录→验证的完整闭环，供 AI 编程智能体调用。

用法::

    from agent import Agent

    agent = Agent()

    # 方式1: 一站式闭环 (编译 + 烧录 + 验证)
    result = agent.closed_loop(
        sources=["main.c"],
        chip="XC8P9530",
        expect={0x10: 200, 0x11: 0},
        run_duration=0.5,
    )
    print(result.ok, result.summary())

    # 方式2: 分步控制
    build = agent.build(sources=["main.c"], chip="XC8P9530")
    if build.ok:
        verify = agent.verify(
            xbin=build.artifacts["xbin"],
            expect={0x10: 200, 0x11: 0},
        )
        print(verify.ok, verify.memory)

返回类型:
    - BuildResult  — 编译结果 (.ok, .artifacts, .error, .phases)
    - VerifyResult — 验证结果 (.ok, .memory, .mismatches, .registers)
    - LoopResult   — 闭环结果 (.ok, .build, .verify)
"""

from __future__ import annotations
import os
import sys
import time
import json
from dataclasses import dataclass, field
from typing import Any


# ═══════════════════════════════════════════════════════════
# 统一退出码
# ═══════════════════════════════════════════════════════════
class ExitCode:
    OK               = 0
    BUILD_FAILED     = 1
    DEVICE_NOT_FOUND = 2
    COMM_ERROR       = 3
    VERIFY_FAILED    = 4
    INPUT_ERROR      = 5
    TIMEOUT          = 6


# ═══════════════════════════════════════════════════════════
# 结果类型
# ═══════════════════════════════════════════════════════════

@dataclass
class BuildResult:
    """编译结果"""
    ok:           bool           = False
    exit_code:    int            = -1
    error:        str | None     = None
    error_detail: str | None     = None   # 编译工具完整 stderr 输出
    artifacts:    dict[str, str] = field(default_factory=dict)
    phases:       dict           = field(default_factory=dict)
    chip:         str            = ""
    rom_words:    int            = 0
    raw:          dict           = field(default_factory=dict)

    @property
    def xbin(self) -> str | None:
        return self.artifacts.get("xbin")

    @property
    def mpj(self) -> str | None:
        return self.artifacts.get("mpj")

    def summary(self) -> str:
        if self.ok:
            return f"[PASS] {self.chip} ROM={self.rom_words}W"
        if self.error_detail:
            return f"[FAIL] {self.error}\n{self.error_detail}"
        return f"[FAIL] {self.error}"


@dataclass
class VerifyResult:
    """仿真验证结果"""
    ok:           bool           = False
    exit_code:    int            = -1
    error:        str | None     = None
    memory:       dict[str, int] = field(default_factory=dict)
    registers:    dict           = field(default_factory=dict)
    mismatches:   list[dict]     = field(default_factory=list)
    run_ms:       int            = 0
    mcu:          str            = ""
    config_words: list[str]      = field(default_factory=list)
    raw:          dict           = field(default_factory=dict)

    def summary(self) -> str:
        if self.ok:
            return f"[PASS] {self.run_ms}ms, {len(self.memory)} vars OK"
        if self.mismatches:
            ms = self.mismatches
            return f"[FAIL] {len(ms)} mismatch(es): " + \
                ", ".join(f"{m['address']}: exp={m['expected']} act={m['actual']}" for m in ms[:3])
        return f"[FAIL] {self.error}"


@dataclass
class LoopResult:
    """闭环结果"""
    ok:      bool = False
    build:   BuildResult | None = None
    verify:  VerifyResult | None = None
    error:   str | None = None

    def summary(self) -> str:
        if self.ok:
            return f"[PASS] build OK → verify OK ({self.verify.run_ms}ms)"
        if self.build and not self.build.ok:
            detail = self.build.error_detail or ""
            return f"[FAIL] build: {self.build.error}" + (f"\n{detail}" if detail else "")
        if self.verify and not self.verify.ok:
            return f"[FAIL] verify: {self.verify.summary()}"
        return f"[FAIL] {self.error}"


# ═══════════════════════════════════════════════════════════
# 内部辅助
# ═══════════════════════════════════════════════════════════

def _find_ide_path() -> str:
    """自动发现 IDE 路径"""
    for env in ("XJIDE_HOME", "BUILDCLI_IDE_PATH"):
        val = os.environ.get(env)
        if val:
            return val
    # 已知路径
    candidates = [
        r"F:\DevTools\XJ_C_IDE_V1.9.2.251202",
    ]
    import glob
    for pattern in [r"F:\DevTools\XJ_C_IDE_V*", r"C:\XJ_C_IDE*"]:
        matches = sorted(glob.glob(pattern), reverse=True)
        if matches:
            candidates.append(matches[0])
    for path in candidates:
        if os.path.isfile(os.path.join(path, "bin", "slcc.exe")):
            return path
    return candidates[0]  # 返回最可能的路径


def _parse_hex_addr(s: str) -> int:
    """'0x10' → 16"""
    return int(s, 16)


# ═══════════════════════════════════════════════════════════
# 统一 Agent
# ═══════════════════════════════════════════════════════════

class Agent:
    """XJ MCU 全闭环 AI 智能体接口。

    使用示例::

        agent = Agent()
        result = agent.closed_loop(
            sources=["main.c"], chip="XC8P9530",
            expect={0x10: 200, 0x11: 0},
        )
        assert result.ok
    """

    def __init__(self, ide_path: str | None = None):
        self.ide_path = ide_path or _find_ide_path()
        self._last_build: BuildResult | None = None
        self._last_verify: VerifyResult | None = None

    # ── build ──────────────────────────────────────────

    def build(
        self,
        sources: list[str] | None = None,
        mpj: str | None = None,
        chip: str | None = None,
        output_dir: str | None = None,
        project_name: str | None = None,
        include_dirs: list[str] | None = None,
        config_words: list[int] | None = None,
    ) -> BuildResult:
        """编译 C/ASM 源码。

        Args:
            sources: .c / .asm 源文件列表
            mpj: .mpj 项目文件路径
            chip: MCU 型号 (e.g. XC8P9530)
            output_dir: 输出目录 (默认 build/)
            config_words: 配置字列表 (e.g. [0x1FFF, 0x3F77, ...])

        Returns:
            BuildResult: .ok, .artifacts, .error, .phases
        """
        from buildcli.agent import exec_build

        code, raw = exec_build(
            sources=sources, mpj=mpj, chip=chip,
            output_dir=output_dir, project_name=project_name,
            ide_path=self.ide_path,
            include_dirs=include_dirs,
            config_words=config_words,
            json_output=False,
        )

        result = BuildResult(
            ok=(code == 0),
            exit_code=code,
            error=raw.get("error"),
            error_detail=raw.get("error_detail"),
            artifacts=raw.get("artifacts", {}),
            phases=raw.get("phases", {}),
            chip=raw.get("chip", ""),
            rom_words=raw.get("rom_words", 0),
            raw=raw,
        )
        self._last_build = result
        return result

    # ── verify ─────────────────────────────────────────

    def verify(
        self,
        xbin: str,
        mpj: str | None = None,
        run_duration: float = 0.5,
        expect: dict[int, int] | None = None,
        read_addrs: list[int] | None = None,
    ) -> VerifyResult:
        """烧录并运行固件，读取 RAM 验证。

        Args:
            xbin: .xbin 固件路径
            mpj: .mpj 配置路径 (可选，默认同目录自动发现)
            run_duration: 自由运行时长 (秒)
            expect: {地址: 期望值, ...}  例如 {0x10: 200, 0x11: 0}
            read_addrs: 额外读取的地址列表 [0x10, 0x11, ...]

        Returns:
            VerifyResult: .ok, .memory, .mismatches, .registers
        """
        from astrocli.agent import exec_firmware

        code, raw = exec_firmware(
            xbin_path=xbin, mpj_path=mpj,
            run_duration=run_duration,
            expect=expect,
            read_addrs=read_addrs,
            json_output=False,
        )

        # 转换 memory key 从 "0x10" 到 int 10
        memory: dict[str, int] = {}
        for k, v in raw.get("memory", {}).items():
            try:
                addr = int(k, 16)
                memory[f"0x{addr:02X}"] = v
            except (ValueError, TypeError):
                memory[k] = v

        result = VerifyResult(
            ok=(code == 0),
            exit_code=code,
            error=raw.get("error"),
            memory=memory,
            registers=raw.get("registers", {}),
            mismatches=raw.get("mismatches", []),
            run_ms=raw.get("actual_run_ms", 0),
            mcu=raw.get("mcu", ""),
            config_words=raw.get("config_words", []),
            raw=raw,
        )
        self._last_verify = result
        return result

    # ── closed_loop ────────────────────────────────────

    def closed_loop(
        self,
        sources: list[str] | None = None,
        mpj: str | None = None,
        chip: str | None = None,
        expect: dict[int, int] | None = None,
        read_addrs: list[int] | None = None,
        run_duration: float = 0.5,
        output_dir: str | None = None,
        config_words: list[int] | None = None,
    ) -> LoopResult:
        """一站式闭环：编译 → 烧录 → 运行 → 验证。

        Args:
            sources: 源文件列表
            mpj: .mpj 项目文件
            chip: MCU 型号
            expect: {地址: 期望值}  例如 {0x10: 200}
            read_addrs: 额外读取地址
            run_duration: 运行时长 (秒)
            output_dir: 编译输出目录

        Returns:
            LoopResult: .ok, .build, .verify
        """
        # Step 1: 编译
        build = self.build(
            sources=sources, mpj=mpj, chip=chip,
            output_dir=output_dir,
            config_words=config_words,
        )
        if not build.ok:
            return LoopResult(ok=False, build=build, error=f"build: {build.error}")

        # Step 2: 验证
        verify = self.verify(
            xbin=build.xbin,
            mpj=build.mpj,
            run_duration=run_duration,
            expect=expect,
            read_addrs=read_addrs,
        )
        if not verify.ok:
            return LoopResult(ok=False, build=build, verify=verify,
                            error=f"verify: {verify.summary()}")

        return LoopResult(ok=True, build=build, verify=verify)

    # ── convenience ────────────────────────────────────

    @property
    def last_build(self) -> BuildResult | None:
        return self._last_build

    @property
    def last_verify(self) -> VerifyResult | None:
        return self._last_verify

    def to_dict(self, result: BuildResult | VerifyResult | LoopResult) -> dict:
        """将结果转为可序列化 dict (供 AI 智能体 JSON 输出)"""
        if isinstance(result, LoopResult):
            return {
                "ok": result.ok,
                "error": result.error,
                "build": self.to_dict(result.build) if result.build else None,
                "verify": self.to_dict(result.verify) if result.verify else None,
            }
        if isinstance(result, BuildResult):
            return {
                "ok": result.ok,
                "error": result.error,
                "error_detail": result.error_detail,
                "chip": result.chip,
                "rom_words": result.rom_words,
                "artifacts": result.artifacts,
                "phases": {k: (v if isinstance(v, dict) else {"status": getattr(v, 'status', '?')})
                          for k, v in result.phases.items()},
            }
        if isinstance(result, VerifyResult):
            return {
                "ok": result.ok,
                "error": result.error,
                "memory": result.memory,
                "registers": result.registers,
                "mismatches": result.mismatches,
                "run_ms": result.run_ms,
                "mcu": result.mcu,
            }
        return {"error": "unknown result type"}


# ═══════════════════════════════════════════════════════════
# 模块级便捷函数 (无状态，每次创建新 Agent)
# ═══════════════════════════════════════════════════════════

_default_agent: Agent | None = None


def _get_agent() -> Agent:
    global _default_agent
    if _default_agent is None:
        _default_agent = Agent()
    return _default_agent


def build(**kwargs) -> BuildResult:
    return _get_agent().build(**kwargs)


def verify(**kwargs) -> VerifyResult:
    return _get_agent().verify(**kwargs)


def closed_loop(**kwargs) -> LoopResult:
    return _get_agent().closed_loop(**kwargs)

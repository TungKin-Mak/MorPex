#!/usr/bin/env python3
"""
astrocli — XJ-IDE 硬件仿真器命令行调试工具
==========================================
用法:
  # 单次命令模式
  astrocli flash  test.xbin
  astrocli debug  test.xbin
  astrocli step   test.xbin -n 10

  # AI Agent 一站式仿真 (推荐)
  astrocli exec   test.xbin --run 2.0 --expect "0x12=200,0x13=0"

  # JSON 输出模式 (AI Agent 解析)
  astrocli regs   --json
  astrocli ram    0x12 0x13 --json

  # 交互 Shell
  astrocli shell  test.xbin

  # 连接测试
  astrocli connect
"""
import argparse
import cmd
import os
import sys
import time

from .transport import XJDevice, discover
from .commands import (
    boot_download, flash_and_debug, read_regs, read_regs_full, read_ram,
    run_mcu, stop_mcu, step_one, step_multi,
    freerun_mcu, reset_mcu, query_status,
    disconnect, keepalive_loop, session_flash_debug,
)
from .config import get_config
from .constants import SFR_NAMES, FAMILY_SFR_MAP
from .agent import exec_firmware, read_registers_json, read_memory_json
from .agent import EXIT_OK, EXIT_DEVICE_ERROR, EXIT_COMM_ERROR, EXIT_VERIFY_FAIL, EXIT_TIMEOUT


# ============================================================
# 单次命令处理器
# ============================================================

def cmd_connect(args):
    """连接测试：发现设备 + 版本查询"""
    dev_path = discover()
    if not dev_path:
        print("[ERROR] 未找到设备。请确认仿真器已连接且驱动已安装。")
        return 1
    print(f"[device] {dev_path}")

    with XJDevice() as dev:
        # 仅验证设备可访问（不发送任何命令，避免改变设备状态）
        print("[OK] 设备已连接 (OUT=0x%02X IN=0x%02X)" % (dev._ep_out, dev._ep_in))
    return 0


def cmd_flash(args):
    """下载固件"""
    xbin_path = args.file
    if not os.path.isfile(xbin_path):
        print(f"[ERROR] 文件不存在: {xbin_path}")
        return 1

    mpj_path = getattr(args, 'mpj', None)
    with XJDevice() as dev:
        with open(xbin_path, 'rb') as f:
            xbin = f.read()
        config = get_config(xbin_path, mpj_path)
        boot_download(dev, xbin, config, verbose=True)
        disconnect(dev, verbose=True)
        print("[OK] 固件已下载")
    return 0


def cmd_debug(args):
    """进入调试模式"""
    xbin_path = args.file
    if not os.path.isfile(xbin_path):
        print(f"[ERROR] 文件不存在: {xbin_path}")
        return 1

    mpj_path = getattr(args, 'mpj', None)
    with XJDevice() as dev:
        with open(xbin_path, 'rb') as f:
            xbin = f.read()
        config = get_config(xbin_path, mpj_path)
        sfr = flash_and_debug(dev, xbin, config, verbose=True)

        pcl = sfr.get("PCL", 0)
        if pcl == 0x01:
            print("\n[OK] MCU 停在 main() 入口 (PCL=0x01)")
        else:
            print(f"\n[WARN] PCL=0x{pcl:02X}，可能未在 main() 入口")
        disconnect(dev, verbose=True)

    return 0


def cmd_run(args):
    """下载 + 运行 + keepalive 监控"""
    xbin_path = args.file
    if not os.path.isfile(xbin_path):
        print(f"[ERROR] 文件不存在: {xbin_path}")
        return 1

    mpj_path = getattr(args, 'mpj', None)
    with XJDevice() as dev:
        sfr = session_flash_debug(dev, xbin_path, mpj_path, verbose=True)
        run_mcu(dev, verbose=True)
        interval = getattr(args, 'interval', 0.5)
        keepalive_loop(dev, verbose=True, interval=interval)
        disconnect(dev, verbose=True)

    return 0


def cmd_step(args):
    """下载 + 进入调试 + 单步 N 次"""
    xbin_path = args.file
    if not os.path.isfile(xbin_path):
        print(f"[ERROR] 文件不存在: {xbin_path}")
        return 1

    mpj_path = getattr(args, 'mpj', None)
    n = getattr(args, 'n', 1) or 1

    with XJDevice() as dev:
        sfr = session_flash_debug(dev, xbin_path, mpj_path, verbose=True)

        pcl = sfr.get("PCL", 0)
        if pcl != 0x01:
            print(f"[WARN] PCL=0x{pcl:02X}，继续单步...")

        step_multi(dev, n, verbose=True)
        disconnect(dev, verbose=True)

    return 0


def cmd_regs(args):
    """读取寄存器（需设备已处于调试模式）"""
    json_mode = getattr(args, 'json', False)
    family = getattr(args, 'family', None)

    if json_mode:
        return read_registers_json()[0]

    sfr_map = FAMILY_SFR_MAP.get(family, SFR_NAMES) if family else SFR_NAMES

    with XJDevice() as dev:
        sfr = read_regs(dev, family=family)
        if not sfr:
            print("[ERROR] 无法读取寄存器。设备是否已进入调试模式？")
            return 1

        print(f"{'寄存器':>8s}  {'值':>6s}  {'说明'}")
        print("-" * 35)
        for offset, name in sfr_map.items():
            if name == "reserved":
                continue
            val = sfr.get(name, 0)
            print(f"  [{name:6s}]  0x{val:02X}    ({val:3d})")

        # 也显示全三组
        full = read_regs_full(dev)
        for offset in [0x20, 0x40]:
            if offset in full and full[offset]:
                print(f"\n--- 偏移 0x{offset:02X} ---")
                data = full[offset]
                for i in range(0, min(16, len(data)), 8):
                    hex_str = " ".join(f"{b:02X}" for b in data[i:i+8])
                    print(f"  {i:02X}: {hex_str}")

    return 0


def cmd_ram(args):
    """读取 RAM 地址的值"""
    json_mode = getattr(args, 'json', False)
    addrs = [int(a, 16) if a.startswith('0x') else int(a) for a in args.addrs]

    if json_mode:
        return read_memory_json(addrs)[0]

    with XJDevice() as dev:
        for addr in addrs:
            val = read_ram(dev, addr)
            print(f"RAM[0x{addr:02X}] = {val} (0x{val:02X})")
        disconnect(dev, verbose=False)
    return 0


def cmd_exec(args):
    """一站式仿真执行（AI Agent 接口）"""
    xbin_path = args.file
    if not os.path.isfile(xbin_path):
        print(f'{{"status":"error","error":"file not found: {xbin_path}"}}')
        return EXIT_DEVICE_ERROR

    expect = None
    if args.expect:
        expect = {}
        for pair in args.expect.split(","):
            pair = pair.strip()
            if "=" in pair:
                addr_str, val_str = pair.split("=", 1)
                addr = int(addr_str.strip(), 16) if addr_str.strip().startswith("0x") else int(addr_str.strip())
                expect[addr] = int(val_str.strip())

    read_addrs = None
    if args.read:
        read_addrs = [int(a.strip(), 16) if a.strip().startswith("0x") else int(a.strip()) for a in args.read.split(",")]

    mpj_path = getattr(args, 'mpj', None)
    exit_code, _ = exec_firmware(
        xbin_path=xbin_path,
        mpj_path=mpj_path,
        run_duration=args.run,
        expect=expect,
        read_addrs=read_addrs,
        json_output=True,
    )
    return exit_code


def cmd_stop(args):
    """停止运行中的 MCU"""
    with XJDevice() as dev:
        stop_mcu(dev, verbose=True)
        sfr = read_regs(dev)
        if sfr:
            print(f"  PCL=0x{sfr.get('PCL',0):02X}  ACC=0x{sfr.get('ACC',0):02X}")
    return 0


def cmd_reset(args):
    """复位 MCU"""
    with XJDevice() as dev:
        sfr = reset_mcu(dev, verbose=True)
        if sfr:
            print(f"  PCL=0x{sfr.get('PCL',0):02X}  ACC=0x{sfr.get('ACC',0):02X}")
    return 0


def cmd_freerun(args):
    """自由运行"""
    xbin_path = args.file
    if not os.path.isfile(xbin_path):
        print(f"[ERROR] 文件不存在: {xbin_path}")
        return 1

    duration = getattr(args, 'duration', 3.0)
    mpj_path = getattr(args, 'mpj', None)

    with XJDevice() as dev:
        session_flash_debug(dev, xbin_path, mpj_path, verbose=True)
        freerun_mcu(dev, verbose=True)
        print(f"[freerun] 运行 {duration}s...")
        time.sleep(duration)
        stop_mcu(dev, verbose=True)
        sfr = read_regs(dev)
        if sfr:
            print(f"  PCL=0x{sfr.get('PCL',0):02X}  ACC=0x{sfr.get('ACC',0):02X}")
        disconnect(dev, verbose=True)

    return 0


def cmd_disconnect(args):
    """断开连接"""
    with XJDevice() as dev:
        disconnect(dev, verbose=True)
    return 0


# ============================================================
# 交互式 Shell
# ============================================================

class AstroCliShell(cmd.Cmd):
    """
    交互式调试 Shell。
    在 flash + debug 后进入，保持持久连接。

    命令:
      run           全速运行 + keepalive 监控 (Ctrl+C 停止)
      freerun       自由运行 (无断点)
      stop          停止 CPU
      step [N]      单步 N 条指令 (默认 1)
      regs          读取寄存器
      reset         复位 MCU
      status        查询设备状态
      quit / exit   断开并退出
      help          显示帮助
    """

    prompt = "astro> "
    intro = """
╔══════════════════════════════════════════╗
║       astrocli — XJ-IDE 调试 Shell       ║
║  输入 help 查看命令  |  quit 退出         ║
╚══════════════════════════════════════════╝
"""

    def __init__(self, dev: XJDevice, xbin_path: str = None, mpj_path: str = None):
        super().__init__()
        self.dev = dev
        self.xbin_path = xbin_path
        self.mpj_path = mpj_path
        self._flashed = False
        self._debug_ready = False
        self._family = None  # 芯片家族，flash 后设置

    def _ensure_ready(self) -> bool:
        """确保设备已下载固件并进入调试模式"""
        if self._debug_ready:
            return True

        if not self.xbin_path:
            print("[ERROR] 未指定固件文件，无法进入调试模式")
            return False

        if not self._flashed:
            print("[info] 下载固件...")
            with open(self.xbin_path, 'rb') as f:
                xbin = f.read()
            config = get_config(self.xbin_path, self.mpj_path)
            self._family = config.get("family")
            boot_download(self.dev, xbin, config, verbose=True)
            self._flashed = True

        print("[info] 进入调试模式...")
        sfr = start_mcu(self.dev, verbose=True)
        self._debug_ready = True

        pcl = sfr.get("PCL", 0)
        if pcl == 0x01:
            print("[OK] MCU 停在 main() 入口\n")
        else:
            print(f"[WARN] PCL=0x{pcl:02X}\n")
        return True

    # ── 运行控制 ──
    def do_run(self, arg):
        """run — 全速运行 + keepalive 监控 (Ctrl+C 停止)"""
        if not self._ensure_ready():
            return
        run_mcu(self.dev, verbose=True)
        keepalive_loop(self.dev, verbose=True)
        self._debug_ready = False  # 运行后状态改变

    def do_freerun(self, arg):
        """freerun [秒数] — 自由运行 (无断点)，默认 3 秒"""
        if not self._ensure_ready():
            return
        try:
            duration = float(arg.split()[0]) if arg.strip() else 3.0
        except ValueError:
            duration = 3.0

        freerun_mcu(self.dev, verbose=True)
        print(f"[freerun] 运行 {duration}s...")
        time.sleep(duration)
        stop_mcu(self.dev, verbose=True)
        sfr = read_regs(self.dev)
        if sfr:
            print(f"  PCL=0x{sfr.get('PCL',0):02X}  ACC=0x{sfr.get('ACC',0):02X}")
        self._debug_ready = False

    def do_stop(self, arg):
        """stop — 停止 CPU"""
        stop_mcu(self.dev, verbose=True)
        sfr = read_regs(self.dev)
        if sfr:
            print(f"  PCL=0x{sfr.get('PCL',0):02X}  ACC=0x{sfr.get('ACC',0):02X}")
        self._debug_ready = True

    # ── 单步 ──
    def do_step(self, arg):
        """step [N] — 单步 N 条指令 (默认 1)"""
        if not self._ensure_ready():
            return
        try:
            n = int(arg.split()[0]) if arg.strip() else 1
        except (ValueError, IndexError):
            n = 1

        if n == 1:
            sfr = step_one(self.dev)
            print(f"  PCL=0x{sfr.get('PCL',0):02X}  "
                  f"ACC=0x{sfr.get('ACC',0):02X}  "
                  f"STATUS=0x{sfr.get('STATUS',0):02X}")
        else:
            step_multi(self.dev, n, verbose=True)

    # ── 寄存器 ──
    def do_regs(self, arg):
        """regs — 读取 CPU 寄存器"""
        sfr_map = FAMILY_SFR_MAP.get(self._family, SFR_NAMES) if self._family else SFR_NAMES
        sfr = read_regs(self.dev, family=self._family)
        if not sfr:
            print("[WARN] 无法读取寄存器")
            return
        print(f"{'寄存器':>8s}  {'值':>6s}  {'说明'}")
        print("-" * 35)
        for offset, name in sfr_map.items():
            if name == "reserved":
                continue
            val = sfr.get(name, 0)
            print(f"  [{name:6s}]  0x{val:02X}    ({val:3d})")

    def do_regs_all(self, arg):
        """regs_all — 读取全部三组寄存器"""
        full = read_regs_full(self.dev)
        for offset, name in [(0x00, "基本寄存器"), (0x20, "扩展寄存器"), (0x40, "SFR")]:
            if offset in full and full[offset]:
                print(f"\n--- {name} (0x{offset:02X}) ---")
                data = full[offset]
                for i in range(0, len(data), 16):
                    hex_str = " ".join(f"{b:02X}" for b in data[i:i+16])
                    print(f"  {offset+i:04X}: {hex_str}")

    # ── 复位 ──
    def do_reset(self, arg):
        """reset — 复位 MCU"""
        sfr = reset_mcu(self.dev, verbose=True)
        if sfr:
            print(f"  PCL=0x{sfr.get('PCL',0):02X}  ACC=0x{sfr.get('ACC',0):02X}")
        self._debug_ready = True

    # ── 固件重烧 ──
    def do_flash(self, arg):
        """flash [xbin] — 重新下载固件"""
        xbin_path = arg.strip() if arg.strip() else self.xbin_path
        if not xbin_path:
            print("[ERROR] 未指定 .xbin 文件")
            return
        if not os.path.isfile(xbin_path):
            print(f"[ERROR] 文件不存在: {xbin_path}")
            return
        with open(xbin_path, 'rb') as f:
            xbin = f.read()
        config = get_config(xbin_path, self.mpj_path)
        self._family = config.get("family")
        boot_download(self.dev, xbin, config, verbose=True)
        self._flashed = True
        self._debug_ready = False
        print("[OK] 固件已下载，输入 debug 进入调试模式")

    def do_debug(self, arg):
        """debug — (重新)进入调试模式"""
        if not self._flashed:
            print("[WARN] 请先 flash 下载固件")
            return
        print("[info] 进入调试模式...")
        sfr = start_mcu(self.dev, verbose=True)
        self._debug_ready = True
        pcl = sfr.get("PCL", 0)
        if pcl == 0x01:
            print("[OK] MCU 停在 main() 入口")
        else:
            print(f"[OK] PCL=0x{pcl:02X}")

    # ── 状态 ──
    def do_status(self, arg):
        """status — 查询设备状态"""
        resp = query_status(self.dev)
        if resp:
            print(f"  raw: {resp.hex(' ')}")
        else:
            print("[WARN] 无响应")

    # ── 退出 ──
    def do_quit(self, arg):
        """quit — 断开连接并退出"""
        disconnect(self.dev, verbose=True)
        return True

    def do_exit(self, arg):
        """exit — 同 quit"""
        return self.do_quit(arg)

    def do_EOF(self, arg):
        """Ctrl+D 退出"""
        print()
        return self.do_quit(arg)

    # ── 帮助 ──
    def do_help(self, arg):
        """显示帮助"""
        if arg:
            super().do_help(arg)
        else:
            print("""
可用命令:
  flash [xbin]   重新下载固件
  debug          进入调试模式
  run            全速运行 + keepalive 监控 (Ctrl+C 停止)
  freerun [秒]   自由运行 (无断点), 默认 3 秒
  stop           停止 CPU
  step [N]       单步 N 条指令 (默认 1)
  regs           读取 CPU 寄存器
  regs_all       读取全部三组寄存器
  reset          复位 MCU
  status         查询设备状态
  version        查询仿真器版本
  quit / exit    断开并退出
  help [cmd]     显示帮助

AI Agent 模式: 使用单次命令代替交互 Shell
  astrocli flash  <xbin>
  astrocli debug  <xbin>
  astrocli step   <xbin> -n 10
  astrocli run    <xbin>
""")

    def emptyline(self):
        """空行不重复上一条命令"""
        pass


def cmd_shell(args):
    """启动交互式 Shell"""
    xbin_path = args.file
    mpj_path = getattr(args, 'mpj', None)

    if xbin_path and not os.path.isfile(xbin_path):
        print(f"[ERROR] 文件不存在: {xbin_path}")
        return 1

    with XJDevice() as dev:
        shell = AstroCliShell(dev, xbin_path, mpj_path)

        if xbin_path:
            # 自动 flash + debug
            if not shell._ensure_ready():
                return 1

        shell.cmdloop()

    return 0


# ============================================================
# CLI 入口
# ============================================================
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="astrocli — XJ-IDE 硬件仿真器命令行调试工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  astrocli connect                           # 连接测试
  astrocli flash  test.xbin                  # 下载固件
  astrocli debug  test.xbin                  # 下载并进入调试
  astrocli run    test.xbin                  # 下载+运行+监控
  astrocli step   test.xbin -n 10            # 下载+单步10次
  astrocli step   test.xbin --mpj test.mpj   # 指定 .mpj
  astrocli regs                              # 读寄存器(需已调试)
  astrocli shell  test.xbin                  # 交互 Shell
""",
    )

    sub = parser.add_subparsers(dest="command", help="操作命令")

    # connect
    sub.add_parser("connect", help="连接测试 + 版本查询")

    # flash
    fp = sub.add_parser("flash", help="下载固件到仿真器")
    fp.add_argument("file", help=".xbin 固件文件路径")
    fp.add_argument("--mpj", metavar="MPJ", help=".mpj 配置文件路径（可选，自动查找）")

    # debug
    dp = sub.add_parser("debug", help="下载固件并进入调试模式")
    dp.add_argument("file", help=".xbin 固件文件路径")
    dp.add_argument("--mpj", metavar="MPJ", help=".mpj 配置文件路径（可选）")

    # run
    rp = sub.add_parser("run", help="下载 + 运行 + keepalive 监控")
    rp.add_argument("file", help=".xbin 固件文件路径")
    rp.add_argument("--mpj", metavar="MPJ", help=".mpj 配置文件路径（可选）")
    rp.add_argument("--interval", type=float, default=0.5, help="keepalive 间隔 (秒)")

    # step
    sp = sub.add_parser("step", help="下载 + 单步执行 N 条指令")
    sp.add_argument("file", help=".xbin 固件文件路径")
    sp.add_argument("-n", type=int, default=1, help="单步次数 (默认 1)")
    sp.add_argument("--mpj", metavar="MPJ", help=".mpj 配置文件路径（可选）")

    # regs
    rp = sub.add_parser("regs", help="读取 CPU 寄存器（需已进入调试模式）")
    rp.add_argument("--json", action="store_true", help="JSON 格式输出")

    # ram — 读取 RAM
    ramp = sub.add_parser("ram", help="读取 RAM 地址的值")
    ramp.add_argument("addrs", nargs="+", help="RAM 地址列表 (如: 0x12 0x13 或 18 19)")
    ramp.add_argument("--json", action="store_true", help="JSON 格式输出")

    # exec — AI Agent 一站式仿真
    exp = sub.add_parser("exec", help="一站式仿真执行 (AI Agent 接口)")
    exp.add_argument("file", help=".xbin 固件文件路径")
    exp.add_argument("--run", type=float, default=2.0, help="自由运行时长/秒 (默认 2.0)")
    exp.add_argument("--expect", metavar="ADDR=VAL,...", help="期望的 RAM 值 (如: 0x12=200,0x13=0)")
    exp.add_argument("--read", metavar="ADDR,...", help="额外读取的 RAM 地址 (如: 0x12,0x13)")
    exp.add_argument("--mpj", metavar="MPJ", help=".mpj 配置文件路径（可选）")

    # stop
    sub.add_parser("stop", help="停止 CPU")

    # reset
    sub.add_parser("reset", help="复位 MCU")

    # freerun
    frp = sub.add_parser("freerun", help="自由运行（下载 + 运行 N 秒 + 停止）")
    frp.add_argument("file", help=".xbin 固件文件路径")
    frp.add_argument("--mpj", metavar="MPJ", help=".mpj 配置文件路径（可选）")
    frp.add_argument("--duration", type=float, default=3.0, help="运行时长 (秒)")

    # disconnect
    sub.add_parser("disconnect", help="断开连接")

    # shell
    shp = sub.add_parser("shell", help="启动交互式调试 Shell")
    shp.add_argument("file", nargs="?", help=".xbin 固件文件路径（可选）")
    shp.add_argument("--mpj", metavar="MPJ", help=".mpj 配置文件路径（可选）")

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    handlers = {
        "connect":    cmd_connect,
        "flash":      cmd_flash,
        "debug":      cmd_debug,
        "run":        cmd_run,
        "step":       cmd_step,
        "regs":       cmd_regs,
        "ram":        cmd_ram,
        "exec":       cmd_exec,
        "stop":       cmd_stop,
        "reset":      cmd_reset,
        "freerun":    cmd_freerun,
        "disconnect": cmd_disconnect,
        "shell":      cmd_shell,
    }

    handler = handlers.get(args.command)
    if handler:
        sys.exit(handler(args) or 0)
    else:
        parser.print_help()
        sys.exit(0)


if __name__ == "__main__":
    main()

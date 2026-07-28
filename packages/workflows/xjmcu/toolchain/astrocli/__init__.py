"""
astrocli — XJ-IDE 硬件仿真器命令行调试工具
==========================================
Windows CLI 工具，通过 WinUSB 直连 XJ-IDE V2.0 仿真器 (VID=0x8235, PID=0x584B)。

用法:
  python -m astrocli connect
  python -m astrocli flash  test.xbin
  python -m astrocli shell test.xbin
"""

__version__ = "0.1.0"
__all__ = ["transport", "protocol", "commands", "config", "constants"]

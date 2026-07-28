"""
astrocli — WinUSB 传输层
Windows-only: 通过 SetupDi + WinUSB 直连 XJ-IDE 仿真器
"""
from __future__ import annotations

import ctypes
import time
from ctypes import wintypes, byref, sizeof, POINTER

from .constants import (
    VID, PID, PIPE_TIMEOUT, TIMEOUT_STD,
    GUID_WINUSB, GUID_USB, GUID_XJIDE,
)


# ============================================================
# Win32 结构体定义
# ============================================================
class GUID(ctypes.Structure):
    _fields_ = [
        ("Data1", wintypes.DWORD),
        ("Data2", wintypes.WORD),
        ("Data3", wintypes.WORD),
        ("Data4", wintypes.BYTE * 8),
    ]


class SP_DEVICE_INTERFACE_DATA(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("InterfaceClassGuid", GUID),
        ("Flags", wintypes.DWORD),
        ("Reserved", ctypes.c_void_p),
    ]


class SP_DEVICE_INTERFACE_DETAIL_DATA(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("DevicePath", wintypes.WCHAR * 1),
    ]


# ============================================================
# GUID 解析
# ============================================================
def _parse_guid(s: str) -> GUID:
    s = s.strip("{}")
    parts = s.split("-")
    g = GUID()
    g.Data1 = int(parts[0], 16)
    g.Data2 = int(parts[1], 16)
    g.Data3 = int(parts[2], 16)
    bs = parts[3] + parts[4]
    for i in range(8):
        g.Data4[i] = int(bs[i * 2 : i * 2 + 2], 16)
    return g


# ============================================================
# 设备发现 (SetupDi API)
# ============================================================
def discover():
    """
    通过 SetupDi API 枚举 USB 设备，查找 VID/PID 匹配的设备路径。
    返回设备路径字符串，找不到则返回 None。
    """
    setupapi = ctypes.windll.setupapi
    setupapi.SetupDiGetClassDevsW.argtypes = [
        POINTER(GUID), wintypes.LPCWSTR, wintypes.HWND, wintypes.DWORD,
    ]
    setupapi.SetupDiGetClassDevsW.restype = ctypes.c_void_p
    setupapi.SetupDiEnumDeviceInterfaces.argtypes = [
        ctypes.c_void_p, ctypes.c_void_p, POINTER(GUID),
        wintypes.DWORD, POINTER(SP_DEVICE_INTERFACE_DATA),
    ]
    setupapi.SetupDiEnumDeviceInterfaces.restype = wintypes.BOOL
    setupapi.SetupDiGetDeviceInterfaceDetailW.argtypes = [
        ctypes.c_void_p, POINTER(SP_DEVICE_INTERFACE_DATA),
        ctypes.c_void_p, wintypes.DWORD, POINTER(wintypes.DWORD),
        ctypes.c_void_p,
    ]
    setupapi.SetupDiGetDeviceInterfaceDetailW.restype = wintypes.BOOL
    setupapi.SetupDiDestroyDeviceInfoList.argtypes = [ctypes.c_void_p]

    for guid_str in [GUID_XJIDE, GUID_WINUSB, GUID_USB]:
        guid = _parse_guid(guid_str)
        h = setupapi.SetupDiGetClassDevsW(byref(guid), None, None, 0x12)
        if h == -1 or h == ctypes.c_void_p(-1).value:
            continue

        try:
            idx = 0
            while True:
                iface = SP_DEVICE_INTERFACE_DATA()
                iface.cbSize = sizeof(SP_DEVICE_INTERFACE_DATA)
                ok = setupapi.SetupDiEnumDeviceInterfaces(
                    h, None, byref(guid), idx, byref(iface)
                )
                if not ok:
                    break

                req = wintypes.DWORD()
                setupapi.SetupDiGetDeviceInterfaceDetailW(
                    h, byref(iface), None, 0, byref(req), None
                )
                if req.value == 0 or req.value > 4096:
                    idx += 1
                    continue

                buf = (wintypes.BYTE * req.value)()
                detail = ctypes.cast(buf, POINTER(SP_DEVICE_INTERFACE_DETAIL_DATA))
                detail.contents.cbSize = sizeof(SP_DEVICE_INTERFACE_DETAIL_DATA)
                if setupapi.SetupDiGetDeviceInterfaceDetailW(
                    h, byref(iface), detail, req.value, byref(req), None
                ):
                    ptr = ctypes.cast(
                        ctypes.byref(detail.contents, sizeof(wintypes.DWORD)),
                        ctypes.POINTER(wintypes.WCHAR),
                    )
                    path = ctypes.wstring_at(ptr)
                    vid_str = f"vid_{VID:04x}"
                    pid_str = f"pid_{PID:04x}"
                    if vid_str in path.lower() and pid_str in path.lower():
                        return path
                idx += 1
        finally:
            setupapi.SetupDiDestroyDeviceInfoList(h)

    return None


# ============================================================
# WinUSB 设备操作
# ============================================================
class XJDevice:
    """
    WinUSB 直连 XJ-IDE 仿真器 (VID=0x8235, PID=0x584B)。

    用法:
        with XJDevice() as dev:
            dev.send_cmd(...)
    """

    def __init__(self):
        w = ctypes.WinDLL("winusb.dll")
        k = ctypes.windll.kernel32
        self._w = w
        self._k = k
        self._h = None      # 文件句柄
        self._wu = None     # WinUSB 接口句柄
        self._path = None
        self._disconnected = False  # 是否已发送断开命令

        # WinUsb_Initialize
        w.WinUsb_Initialize.restype = wintypes.BOOL
        w.WinUsb_Initialize.argtypes = [
            wintypes.HANDLE, POINTER(wintypes.HANDLE),
        ]

        # WinUsb_Free
        w.WinUsb_Free.restype = wintypes.BOOL
        w.WinUsb_Free.argtypes = [wintypes.HANDLE]

        # WinUsb_WritePipe / ReadPipe
        for fn in ["WritePipe", "ReadPipe"]:
            f = getattr(w, f"WinUsb_{fn}")
            f.restype = wintypes.BOOL
            f.argtypes = [
                wintypes.HANDLE, ctypes.c_ubyte, ctypes.c_void_p,
                wintypes.ULONG, POINTER(wintypes.ULONG), ctypes.c_void_p,
            ]

        # WinUsb_SetPipePolicy
        w.WinUsb_SetPipePolicy.restype = wintypes.BOOL
        w.WinUsb_SetPipePolicy.argtypes = [
            wintypes.HANDLE, ctypes.c_ubyte, wintypes.ULONG,
            wintypes.ULONG, ctypes.c_void_p,
        ]


    # ── 上下文管理器 ──────────────────────────────────
    def open(self):
        """发现并打开设备"""
        dev_path = discover()
        if not dev_path:
            raise RuntimeError(
                f"未找到设备 (VID={VID:04X}, PID={PID:04X})。\n"
                f"请确认仿真器已连接且驱动已安装。"
            )
        self._path = dev_path
        print(f"[device] {dev_path}")

        # CreateFile
        h = self._k.CreateFileW(
            dev_path, 0xC0000000, 3, None, 3, 0x40000000, None
        )
        if h == -1 or h == ctypes.c_void_p(-1).value:
            raise RuntimeError(f"CreateFileW 失败: err={self._k.GetLastError()}")
        self._h = h

        # WinUsb_Initialize
        wu = wintypes.HANDLE()
        if not self._w.WinUsb_Initialize(h, byref(wu)):
            raise RuntimeError(f"WinUsb_Initialize 失败: err={self._k.GetLastError()}")
        self._wu = wu

        # 枚举管道，验证 pipe ID 正确
        self._ep_out = None
        self._ep_in = None
        WinUsb_QueryPipe = self._w.WinUsb_QueryPipe
        WinUsb_QueryPipe.restype = wintypes.BOOL
        WinUsb_QueryPipe.argtypes = [
            wintypes.HANDLE, ctypes.c_ubyte, ctypes.c_ubyte,
            ctypes.c_void_p,
        ]

        class PIPE_INFO(ctypes.Structure):
            _fields_ = [
                ("PipeType", wintypes.ULONG),
                ("PipeId", ctypes.c_ubyte),
                ("MaximumPacketSize", wintypes.USHORT),
                ("Interval", ctypes.c_ubyte),
            ]

        print("[pipes]", end="")
        for alt in range(4):  # 扫描 alternate settings
            for pipe_idx in range(8):  # 最多 8 个 pipe
                info = PIPE_INFO()
                try:
                    if WinUsb_QueryPipe(wu, alt, pipe_idx, byref(info)):
                        direction = "OUT" if info.PipeId & 0x80 == 0 else "IN"
                        print(f" {direction}=0x{info.PipeId:02X}", end="")
                        if direction == "OUT" and self._ep_out is None:
                            self._ep_out = info.PipeId
                        elif direction == "IN" and self._ep_in is None:
                            self._ep_in = info.PipeId
                except Exception:
                    break
        print()

        if self._ep_out is None or self._ep_in is None:
            raise RuntimeError(
                f"无法找到全部端点 (OUT={self._ep_out}, IN={self._ep_in})。"
                f"请检查驱动是否正确安装。"
            )

        # 设置 Pipe 策略超时
        tv = wintypes.ULONG(PIPE_TIMEOUT)
        self._w.WinUsb_SetPipePolicy(wu, self._ep_out, 3, 4, byref(tv))
        self._w.WinUsb_SetPipePolicy(wu, self._ep_in, 3, 4, byref(tv))

    def close(self):
        """关闭设备，释放 WinUSB 句柄。
        注意: 不发送断开命令。调用方应在 close() 前显式调用 disconnect() 以确保硬件退出下载模式。
        """
        if self._wu:
            try:
                self._w.WinUsb_Free(self._wu)
            except Exception:
                pass
            self._wu = None
        if self._h:
            try:
                self._k.CloseHandle(self._h)
            except Exception:
                pass
            self._h = None

    def __enter__(self):
        self.open()
        return self

    def __exit__(self, *args):
        # 统一断开序列：ENTER_DEBUG→DEBUG_INIT→QUERY_STATUS→HALT×2→FINAL
        # 不委托 disconnect()，避免循环导入拿到旧版本
        if not self._disconnected and self._wu:
            try:
                import time
                self.send_precomputed("ENTER_DEBUG", 256, 500)
                time.sleep(0.013)
                self.send_precomputed("DEBUG_INIT", 256, 500)
                time.sleep(0.25)
                self.send_precomputed("QUERY_STATUS", 256, 500)
                time.sleep(0.15)
                self.send_precomputed("HALT_STEP", 256, 500)
                time.sleep(0.002)
                self.send_precomputed("HALT_STEP", 256, 500)
                self.send_precomputed("DISCONNECT_FINAL", 256, 500)
                self._disconnected = True
            except Exception:
                pass
        self.close()

    @property
    def is_open(self) -> bool:
        return self._wu is not None

    # ── 底层读写 ──────────────────────────────────────
    def write(self, data: bytes):
        """向设备写入数据，最多重试 6 次（不 Abort/Reset，避免持久 stall）"""
        buf = (wintypes.BYTE * len(data))(*data)
        n = wintypes.ULONG()
        RETRYABLE = (22, 31, 121, 433, 995, 1167)
        for attempt in range(6):  # 1 次初始 + 5 次重试
            if self._w.WinUsb_WritePipe(
                self._wu, self._ep_out, buf, len(data), byref(n), None
            ):
                return
            err = self._k.GetLastError()
            if err not in RETRYABLE or attempt >= 5:
                raise RuntimeError(f"WritePipe 失败: err={err} (attempt {attempt+1}/6)")
            # 递增延迟: 25ms, 100ms, 225ms, 400ms, 625ms
            time.sleep(0.025 * (attempt + 1) * (attempt + 1))

    def read(self, size: int = 256, timeout: int = None) -> bytes:
        """
        从设备读取数据。
        超时由 open() 中设置的 PIPE_TRANSFER_TIMEOUT (3000ms) 控制。
        timeout 参数保留用于 API 兼容，实际超时请用 set_timeout() 调整。
        """
        buf = (wintypes.BYTE * size)()
        n = wintypes.ULONG()
        if self._w.WinUsb_ReadPipe(
            self._wu, self._ep_in, buf, size, byref(n), None
        ):
            return bytes(buf[: n.value])
        return b""

    def set_timeout(self, timeout_ms: int):
        """修改 IN pipe 读取超时（毫秒），影响后续所有 read() 调用。"""
        tv = wintypes.ULONG(timeout_ms)
        self._w.WinUsb_SetPipePolicy(self._wu, self._ep_in, 3, 4, byref(tv))

    def drain(self, timeout_ms: int = 50) -> int:
        """
        排空 IN pipe 中残留的数据。
        关键：0x0011 SFR_READ 可能返回 3 个包，不排空会累积导致 USB stall。
        临时切换到短超时（默认 50ms），排空后恢复。
        """
        count = 0
        buf = (wintypes.BYTE * 256)()
        n = wintypes.ULONG()
        self.set_timeout(timeout_ms)
        try:
            for _ in range(10):
                if self._w.WinUsb_ReadPipe(self._wu, self._ep_in, buf, 256, byref(n), None):
                    count += 1
                else:
                    break
        finally:
            self.set_timeout(PIPE_TIMEOUT)
        return count

    # ── 协议级收发 ────────────────────────────────────
    def send_raw(self, data: bytes, rsize: int = 256, timeout: int = TIMEOUT_STD) -> bytes:
        """发送原始数据并读取响应"""
        self.write(data)
        # no sleep - WinUsb_ReadPipe blocks until response
        return self.read(rsize, timeout)

    def send_cmd(self, data: bytes, rsize: int = 256, timeout: int = TIMEOUT_STD) -> bytes:
        """
        发送命令包并读取响应。
        自动处理 0x0011 的多包排空。
        """
        resp = self.send_raw(data, rsize, timeout)
        # 检查是否需要排空（0x0011 READ_CPU_STATE, 包括 0x0011/0x2011/0x4011）
        if len(data) >= 4:
            cmd_lo = data[2]  # wValue 低字节
            if cmd_lo == 0x11:
                self.drain()
        return resp

    # ── 便捷方法 ──────────────────────────────────────
    def send_precomputed(self, name: str, rsize: int = 256, timeout: int = TIMEOUT_STD) -> bytes:
        """发送预构建命令（从 protocol.PRECOMPUTED）"""
        from .protocol import PRECOMPUTED
        pkt = PRECOMPUTED[name]
        return self.send_cmd(pkt, rsize, timeout)

    def get_version(self) -> "str | None":
        """查询仿真器固件版本。返回版本字符串或 None。"""
        from .protocol import PRECOMPUTED
        resp = self.send_cmd(PRECOMPUTED["VERSION"], 256, 3000)
        if not resp or len(resp) < 5:
            return None
        if resp[2] == 0xFE:
            plen = resp[3]
            if plen > 0 and len(resp) >= 4 + plen:
                return resp[4:4 + plen].decode("ascii", errors="replace")
        return None

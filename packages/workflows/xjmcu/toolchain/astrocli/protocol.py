"""
astrocli — 协议层: CRC-16/XMODEM + 数据包构建/解析
"""

import struct
import binascii

from .constants import SYNC_BYTE, BYTE7_CMD, CMD_WRITE_CFG


# ============================================================
# CRC-16/XMODEM (字节交换输出，小端序)
# ============================================================
def calc_crc(data: bytes) -> int:
    """
    计算 CRC-16/XMODEM（多项式 0x1021，初始值 0x0000）。
    输出不进行字节交换；由调用方使用 struct.pack('<H', crc) 以小端序存储。

    已验证与 xjide_v3.py 工作脚本和 12 个抓包完全匹配。
    """
    return binascii.crc_hqx(data, 0)



# ============================================================
# 数据包构建
# ============================================================

def build_cmd(cmd_id: int, wIndex: int = 0, byte7: int = BYTE7_CMD) -> bytes:
    """
    构建 10 字节短命令包：
    [SYNC:1] [Flags:1] [wValue LE:2] [wIndex LE:2] [pad:1] [byte7:1] [CRC LE:2]

    参数:
      cmd_id  — 命令 ID (wValue 低字节)
      wIndex  — wIndex 值
      byte7   — 第 7 字节标记
    """
    wValue = cmd_id & 0xFFFF
    hdr = struct.pack("<BBHHBB", SYNC_BYTE, 0x00, wValue, wIndex, 0x00, byte7)
    crc = calc_crc(hdr)
    return hdr + struct.pack("<H", crc)


def build_cmd_with_wvalue(wValue: int, wIndex: int = 0, byte7: int = BYTE7_CMD) -> bytes:
    """
    构建使用完整 wValue 的命令包（如 INIT：wValue=0x2005）。
    """
    hdr = struct.pack("<BBHHBB", SYNC_BYTE, 0x00, wValue, wIndex, 0x00, byte7)
    crc = calc_crc(hdr)
    return hdr + struct.pack("<H", crc)


def build_cmd_data(wValue: int, wIndex: int, byte7: int, data: bytes) -> bytes:
    """
    构建带数据载荷的长包（42/19 字节）：
    [SYNC:1] [Flags:1] [wValue LE:2] [wIndex LE:2] [pad:1] [byte7:1] [data: N] [CRC LE:2]
    """
    payload = struct.pack("<BBHHBB", SYNC_BYTE, 0x00, wValue, wIndex, 0x00, byte7) + data
    crc = calc_crc(payload)
    return payload + struct.pack("<H", crc)


def build_config_cmd(words: list) -> bytes:
    """
    构建 0x0006 配置命令包（19 字节）：
    [SYNC] [00] [06 00] [0C] [words LE16...] [E0] [CRC LE]
    """
    payload = bytes([0x0C])
    for w in words:
        payload += struct.pack("<H", w)
    payload += bytes([0xE0])
    pkt = struct.pack("<BBB", SYNC_BYTE, 0x00, CMD_WRITE_CFG & 0xFF) + payload
    crc = calc_crc(pkt)
    return pkt + struct.pack("<H", crc)


# ============================================================
# 已知命令的预构建包（带正确 CRC，可直接发送）
# ============================================================
PRECOMPUTED = {
    "ENTER_DEBUG":   build_cmd(0x0015),
    "DEBUG_INIT":    build_cmd(0x0024),
    "QUERY_STATUS":  build_cmd(0x0023),
    "HALT_STEP":     build_cmd(0x0026),
    "RUN":           build_cmd(0x0016),
    "RUN_POLL":      build_cmd(0x0017),
    "STOP":          build_cmd(0x0014),
    "FREE_RUN":      build_cmd(0x0013),
    "SYNC_WAIT":     build_cmd(0x0012),
    "QUERY_INFO":    build_cmd(0x00FC),
    "TRANSITION":    build_cmd(0x0008),
}

# DISCONNECT 两个变体（wValue/wIndex 编码来自抓包字节级验证）
PRECOMPUTED["DISCONNECT_TRANSITION"] = build_cmd_with_wvalue(0x0022, 0x00FC, BYTE7_CMD)
PRECOMPUTED["DISCONNECT_FINAL"]      = build_cmd_with_wvalue(0x3F22, 0x00FF, BYTE7_CMD)

# INIT (wValue=0x2005)
PRECOMPUTED["INIT"] = build_cmd_with_wvalue(0x2005, 0x0015, BYTE7_CMD)

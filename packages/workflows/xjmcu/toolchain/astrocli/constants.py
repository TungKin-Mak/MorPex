"""
astrocli — 硬件仿真器 CLI 常量定义
XJ-IDE V2.0 协议常量 (VID=0x8235, PID=0x584B)
"""

# ============================================================
# USB 设备标识
# ============================================================
VID = 0x8235
PID = 0x584B

# ============================================================
# USB 端点地址 — 自动发现，此处仅作文档参考
# ============================================================

# ============================================================
# 同步字节
# ============================================================
SYNC_BYTE = 0x41

# ============================================================
# 命令 ID (wValue 低字节)
# ============================================================
CMD_PASS1_DOWNLOAD  = 0x0001   # Pass1 固件下载 (33B 分块)
CMD_FLASH_VERIFY    = 0x0002   # Flash 校验读取
CMD_PASS2_PROGRAM   = 0x0003   # Pass2 编程 (word 交织)
CMD_PASS2_DUMP      = 0x0004   # Pass2 回读校验
CMD_INIT            = 0x0005   # 初始化握手
CMD_WRITE_CFG       = 0x0006   # 写配置字
CMD_TRANSITION      = 0x0008   # 状态转换
CMD_READ_CPU_STATE  = 0x0011   # 读 CPU 寄存器
CMD_SYNC_WAIT       = 0x0012   # 同步等待
CMD_FREE_RUN        = 0x0013   # 自由运行 (全速，无断点)
CMD_STOP            = 0x0014   # 停止 CPU
CMD_ENTER_DEBUG     = 0x0015   # 进入调试模式
CMD_RUN             = 0x0016   # 启动运行
CMD_RUN_POLL        = 0x0017   # 运行轮询
CMD_DISCONNECT      = 0x0022   # 断开连接
CMD_QUERY_STATUS    = 0x0023   # 查询状态
CMD_DEBUG_INIT      = 0x0024   # 调试初始化
CMD_HALT_STEP       = 0x0026   # 停止/单步 (多功能)
CMD_QUERY_INFO      = 0x00FC   # 查询设备信息
CMD_VERSION         = 0x00FE   # 版本查询 (脚本独有)

# ============================================================
# Byte7 标记值
# ============================================================
BYTE7_CMD   = 0xE0   # 主机命令标记
# BYTE7_RESP = 0xE1   # 设备响应标记 (informational)

# ============================================================
# 超时 (ms)
# ============================================================
TIMEOUT_STD   = 3000

# ============================================================
# Pipe 策略超时
# ============================================================
PIPE_TIMEOUT = 3000

# ============================================================
# USB 设备发现 GUID (保留用于参考，libusbK 通过 VID/PID 发现)
# ============================================================
GUID_WINUSB = "{BF60B811-930D-E69C-4A05-1551C7987908}"
GUID_USB    = "{A5DCBF10-6530-11D2-901F-00C04FB951ED}"
GUID_XJIDE  = "{88bae032-5a81-49f0-bc3d-a4ff138216d6}"  # XJ-IDE V2.0 custom class

# ============================================================
# MCU 芯片数据库
# 数据来源: IDE config/*.XML (F:/DevTools/XJ_C_IDE_V1.9.2.251202/config/)
# ============================================================
CHIP_DATABASE = {
    # ── XC8E 系列 (OTP + EEPROM) ──
    "XC8E855E": {
        "rom_size": 2048, "ram_size": 256, "ram_base": 80,
        "opt_size": 6, "rom_base": 0, "instr_width": 14,
        "family": "rpage_port6",
    },
    "XC8E955E": {
        "rom_size": 1024, "ram_size": 256, "ram_base": 48,
        "opt_size": 4, "rom_base": 0, "instr_width": 14,
        "family": "rpage_port56",
    },
    # ── XC8P8500 系列 (2KW 大容量) ──
    "XC8P8508": {
        "rom_size": 2048, "ram_size": 160, "ram_base": 96,
        "opt_size": 6, "rom_base": 0, "instr_width": 14,
        "family": "rpage_port567",
    },
    "XC8P8521": {
        "rom_size": 2048, "ram_size": 144, "ram_base": 96,
        "opt_size": 6, "rom_base": 0, "instr_width": 14,
        "family": "rpage_port56",
    },
    # ── XC8P8600 系列 (ADC 型) ──
    "XC8P8600": {
        "rom_size": 2048, "ram_size": 96, "ram_base": 64,
        "opt_size": 4, "rom_base": 0, "instr_width": 14,
        "family": "rpage_port6",
    },
    # ── XC8P8610 系列 (16-bit 指令宽度, 不同架构) ──
    "XC8P8610": {
        "rom_size": 2048, "ram_size": 256, "ram_base": 128,
        "opt_size": 6, "rom_base": 0, "instr_width": 16,
        "family": "r180xx",
    },
    "XC8P8613": {
        "rom_size": 2045, "ram_size": 256, "ram_base": 0,
        "opt_size": 3, "rom_base": 0, "instr_width": 16,
        "family": "r080xx",
    },
    "XC8P8615": {
        "rom_size": 2048, "ram_size": 256, "ram_base": 128,
        "opt_size": 6, "rom_base": 0, "instr_width": 16,
        "family": "r180xx",
    },
    "XC8P8616": {
        "rom_size": 2048, "ram_size": 512, "ram_base": 176,
        "opt_size": 6, "rom_base": 0, "instr_width": 16,
        "family": "r180xx",
    },
    # ── XC8P9500 系列 (1KW 基础型) ──
    "XC8P9510": {
        "rom_size": 1024, "ram_size": 80, "ram_base": 48,
        "opt_size": 6, "rom_base": 0, "instr_width": 14,
        "family": "rpage_port6",
    },
    "XC8P9520": {
        "rom_size": 1024, "ram_size": 80, "ram_base": 48,
        "opt_size": 4, "rom_base": 0, "instr_width": 14,
        "family": "rpage_port6",
    },
    "XC8P9521": {
        "rom_size": 1024, "ram_size": 80, "ram_base": 48,
        "opt_size": 4, "rom_base": 0, "instr_width": 14,
        "family": "rpage_port56",
    },
    "XC8P9525": {
        "rom_size": 1024, "ram_size": 80, "ram_base": 48,
        "opt_size": 4, "rom_base": 0, "instr_width": 14,
        "family": "rpage_port6",
    },
    "XC8P9527": {
        "rom_size": 512, "ram_size": 80, "ram_base": 48,
        "opt_size": 6, "rom_base": 0, "instr_width": 14,
        "family": "rpage_port6",
    },
    "XC8P9530": {
        "rom_size": 1024, "ram_size": 80, "ram_base": 48,
        "opt_size": 6, "rom_base": 0, "instr_width": 14,
        "family": "rpage_port6",
    },
    # ── 变体 / 兼容型号 ──
    "XC8P9530D": {
        "rom_size": 1024, "ram_size": 80, "ram_base": 48,
        "opt_size": 6, "rom_base": 0, "instr_width": 14,
        "family": "rpage_port6",
    },
    # ── XC8M 系列 (IDE 中有配置但无 datasheet) ──
    "XC8M4096": {
        "rom_size": 4096, "ram_size": 256, "ram_base": 64,
        "opt_size": 4, "rom_base": 0, "instr_width": 14,
        "family": "rpage_port6",
    },
}

# ============================================================
# SFR 寄存器名称映射 (0x0011 命令 offset=0x00 返回数据)
# 不同芯片家族有不同的寄存器布局
# ============================================================

# RPAGE 单端口系列: XC8P8600, XC8P9510, XC8P9520, XC8P9525, XC8P9527, XC8P9530
SFR_RPAGE_PORT6 = {
    0: "ACC",    1: "TC0C",   2: "PCL",    3: "STATUS",
    4: "RSR",    5: "PCH",    6: "PORT6",  7: "reserved",
}

# RPAGE 双端口系列: XC8E955E, XC8P8521, XC8P9521
SFR_RPAGE_PORT56 = {
    0: "ACC",    1: "TC0C",   2: "PCL",    3: "STATUS",
    4: "RSR",    5: "PORT5",  6: "PORT6",  7: "reserved",
}

# RPAGE 三端口系列: XC8P8508
SFR_RPAGE_PORT567 = {
    0: "ACC",    1: "TC0C",   2: "PCL",    3: "STATUS",
    4: "RSR",    5: "PORT5",  6: "PORT6",  7: "PORT7",
}

# XC8E855E: RPAGE + EEPROM, 有 PORT6 但无 PORT5
SFR_E855E = {
    0: "ACC",    1: "TC0C",   2: "PCL",    3: "STATUS",
    4: "RSR",    5: "PCH",    6: "PORT6",  7: "reserved",
}

# 16-bit R180 系列: XC8P8610, XC8P8615, XC8P8616
# 寄存器在 0x180-0x1FF, PCH 可读写
SFR_R180XX = {
    0: "RSR",    1: "PCH",    2: "PCL",    3: "STATUS",
    4: "TC0CON", 5: "TC0C",   6: "TBRDH",  7: "TBRDL",
}

# 16-bit R080 系列: XC8P8613
# 寄存器在 0x080-0x0FF
SFR_R080XX = {
    0: "R",      1: "Z",      2: "Y",      3: "PFLAG",
    4: "reserved", 5: "reserved", 6: "PFLAG", 7: "IRCCAL",
}

# 家族 → SFR 名称映射表
FAMILY_SFR_MAP = {
    "rpage_port6":   SFR_RPAGE_PORT6,
    "rpage_port56":  SFR_RPAGE_PORT56,
    "rpage_port567": SFR_RPAGE_PORT567,
    "e855e":         SFR_E855E,
    "r180xx":        SFR_R180XX,
    "r080xx":        SFR_R080XX,
}

# 默认 SFR (向后兼容)
SFR_NAMES = SFR_RPAGE_PORT6

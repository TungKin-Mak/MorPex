"""
astrocli — 高层调试命令
固件下载 / MCU 启动 / 运行控制 / 单步 / 寄存器读写
"""
import time
from .constants import (
    CMD_PASS1_DOWNLOAD, CMD_FLASH_VERIFY, CMD_PASS2_PROGRAM,
    CMD_PASS2_DUMP, CMD_READ_CPU_STATE, SFR_NAMES, FAMILY_SFR_MAP,
)
from .protocol import (
    build_cmd_with_wvalue, build_cmd_data, build_config_cmd, PRECOMPUTED,
)
from .transport import XJDevice
from .config import get_config


# ============================================================
# Phase 1-8: 固件下载
# ============================================================
def boot_download(dev: XJDevice, xbin: bytes, config: dict = None, verbose: bool = True):
    """
    完整固件下载流程 (Phase 1-8)，完全匹配 IDE 时序。

    Phase 1: 版本查询
    Phase 2: 握手 (INIT ×2 + QUERY_INFO)
    Phase 3: Pass1 下载 (33B 分块，byte7=chunk[0])
    Phase 4: 配置字写入
    Phase 5: Flash 校验 (CMD 0x02)
    Phase 6: Transition (0x08 → 0x22 → 0x12)
    Phase 7: Pass2 编程 (word 交织 [lo,0,0,hi])
    Phase 8: 回读校验 (CMD 0x04)
    """
    if config is None:
        config = get_config()

    rom_words = config["rom_size"]
    opt_size = config["opt_size"]
    config_words = config.get("config_words", [])
    instr_width = config.get("instr_width", 14)  # 14-bit 或 16-bit

    # 校验页数: ROM bytes / 32
    # 14-bit 芯片: rom_bytes = rom_words * 14 // 8
    # 16-bit 芯片: rom_bytes = rom_words * 16 // 8 = rom_words * 2
    rom_bytes = rom_words * instr_width // 8
    verify_pages = (rom_bytes + 31) // 32

    if verbose:
        print(f"[fw] {len(xbin)}B  MCU={config['name']} ROM={rom_words}W×{instr_width}b "
              f"OptSize={opt_size} VerifyPages={verify_pages}")

    # ── Phase 1: 握手 (IDE 不做 0x00FE 版本查询，直接从 INIT 开始) ──
    if verbose:
        print("[P1] 握手...")
    for step, name in enumerate(["INIT", "QUERY_INFO", "INIT"]):
        resp = dev.send_precomputed(name, 256, 500)
        if not resp or len(resp) < 10:
            raise RuntimeError(f"握手失败: {name} 无响应 (step {step+1}/3)")
        if resp[0] != 0x41:
            raise RuntimeError(f"握手失败: {name} 响应异常 (sync={resp[0]:02X})")

    # ── Phase 3: Pass1 下载 ──
    n = (len(xbin) + 32) // 33
    if verbose:
        print(f"[P2] Pass1 下载 ({n}×33B)...")
    for off in range(0, len(xbin), 32):
        chunk = xbin[off:off + 33]
        if len(chunk) < 33:
            chunk += b'\xFF' * (33 - len(chunk))
        wv = (((off >> 1) & 0xFF) << 8) | CMD_PASS1_DOWNLOAD
        dev.send_cmd(build_cmd_data(wv, 0x2000, chunk[0], chunk[1:33]), 64, 100)

    # ── Phase 4: 配置字 ──
    if verbose:
        print(f"[P3] 配置字 ({opt_size} words): {[f'0x{w:04X}' for w in config_words]}")
    if config_words:
        dev.write(build_config_cmd(config_words))
        time.sleep(0.02)
        dev.read(64, 100)

    # ── Phase 5: Flash 校验 ──
    if verbose:
        print(f"[P4] Flash 校验 ({verify_pages} pages)...")
    for page in range(verify_pages):
        addr = page * 0x10
        wv = ((addr & 0xFF) << 8) | CMD_FLASH_VERIFY
        dev.send_cmd(build_cmd_with_wvalue(wv, 0x2000, 0x00), 64, 100)

    # ── Phase 5: Transition ──
    if verbose:
        print("[P5] Transition...")
    dev.send_precomputed("TRANSITION", 64, 500)
    dev.send_precomputed("DISCONNECT_TRANSITION", 64, 500)
    time.sleep(0.005)
    dev.send_precomputed("SYNC_WAIT", 64, 500)
    time.sleep(0.010)
    dev.drain()  # Transition 可能产生多余 IN 包

    # ── Phase 7: Pass2 编程 ──
    n2 = (len(xbin) + 15) // 16
    if verbose:
        print(f"[P6] Pass2 编程 ({n2}×16B→32B)...")
    for off in range(0, len(xbin), 16):
        chunk = xbin[off:off + 17]
        if len(chunk) < 17:
            chunk += b'\xFF' * (17 - len(chunk))
        # Word 交织: [lo, 0x00, 0x00, hi]
        d = bytearray(32)
        for i in range(8):
            d[i * 4]     = chunk[i * 2 + 1]   # lo
            d[i * 4 + 1] = 0x00
            d[i * 4 + 2] = 0x00
            d[i * 4 + 3] = chunk[i * 2 + 2]   # hi
        wv = ((off & 0xFF) << 8) | CMD_PASS2_PROGRAM
        wi = 0x2000 + (off >> 8)
        dev.send_cmd(build_cmd_data(wv, wi, chunk[0], bytes(d)), 64, 500)
        time.sleep(0.005)  # 给设备时间处理 FPGA 编程

    # ── Phase 8: 回读校验 ──
    if verbose:
        print(f"[P7] 回读校验 ({n2}×32B)...")
    for off in range(0, len(xbin), 16):
        wv = ((off & 0xFF) << 8) | CMD_PASS2_DUMP
        wi = 0x2000 + (off >> 8)
        dev.send_cmd(build_cmd_with_wvalue(wv, wi, 0x00), 64, 200)

    if verbose:
        print("[OK] 固件下载完成")
    dev.drain()
    # 下载后直接进入调试-暂停态
    return start_mcu(dev, verbose, family=config.get("family") if config else None)


# ============================================================
# 一站式: 下载 + 进入调试-暂停态 (原子操作，中间不分步)
# ============================================================
def flash_and_debug(dev: XJDevice, xbin: bytes, config: dict = None,
                    verbose: bool = True, family: str = None) -> dict:
    """下载固件并进入调试-暂停态 (boot_download 已内置 start_mcu)。"""
    return boot_download(dev, xbin, config, verbose)


# ============================================================
# Phase 10: MCU 启动（进入调试模式）
# ============================================================
def start_mcu(dev: XJDevice, verbose: bool = True, family: str = None) -> dict:
    """
    进入调试模式，MCU 暂停在 main() 入口。
    精确时序:
      0x15 → 12.8ms → 0x24 → 232.7ms → 0x23 → 145ms → 0x26 → 1.3ms → 0x26

    参数:
      family — 芯片家族名，用于 SFR 名称映射
    返回 SFR 寄存器字典。
    """
    if verbose:
        print("[start] MCU 调试入口...")

    dev.send_precomputed("ENTER_DEBUG", 256, 500)
    time.sleep(0.013)  # IDE: ~12.8ms

    dev.send_precomputed("DEBUG_INIT", 256, 500)
    time.sleep(0.3)  # 略大于 IDE 的 232.7ms，提高稳定性

    resp = dev.send_precomputed("QUERY_STATUS", 256, 2000)
    if not resp:
        raise RuntimeError("进入调试失败: QUERY_STATUS 无响应")
    if verbose:
        print("  -> 已进入调试模式")
    time.sleep(0.145)

    # HALT ×2
    dev.send_precomputed("HALT_STEP", 256, 500)
    time.sleep(0.002)  # ~2ms, 向上取整到 Windows 粒度
    dev.send_precomputed("HALT_STEP", 256, 500)

    # 读取 SFR
    sfr = read_regs(dev, family=family)
    if verbose:
        pcl = sfr.get("PCL", 0)
        acc = sfr.get("ACC", 0)
        status = sfr.get("STATUS", 0)
        print(f"  ACC=0x{acc:02X}  PCL=0x{pcl:02X}  STATUS=0x{status:02X}")
    return sfr


# ============================================================
# 寄存器读取
# ============================================================
def read_regs(dev: XJDevice, family: str = None) -> dict:
    """
    读取 CPU 寄存器（偏移 0x00 区域）。
    根据芯片家族使用对应的 SFR 名称映射。

    参数:
      family — 芯片家族名 (rpage_port6, rpage_port56, r180xx, ...)
              为 None 时使用默认 SFR_NAMES
    返回 dict: {"ACC": val, "PCL": val, ...}
    """
    sfr_map = FAMILY_SFR_MAP.get(family, SFR_NAMES) if family else SFR_NAMES

    # 0x0011 偏移 0x00: wValue=0x0011, wIndex=0x2000, byte7=0x00
    wv = CMD_READ_CPU_STATE  # 0x0011
    wi = 0x2000
    resp = dev.send_cmd(build_cmd_with_wvalue(wv, wi, 0x00), 256, 500)

    if len(resp) < 10:
        return {}

    # byte7 就是第一个数据字节 (ACC=offset 0)
    # 数据从 resp[7] 开始，到 resp[-3] 结束 (不含 CRC)
    payload = resp[7:-2] if len(resp) >= 10 else b""
    result = {}
    for offset, name in sfr_map.items():
        if offset < len(payload):
            result[name] = payload[offset]
    return result


def read_ram(dev: XJDevice, addr: int) -> int:
    """
    读取 RAM 地址的值。
    RAM 数据在 0x0011 响应中，从 resp[7] 开始的偏移 addr 处。
    """
    wv = CMD_READ_CPU_STATE
    wi = 0x2000
    resp = dev.send_cmd(build_cmd_with_wvalue(wv, wi, 0x00), 256, 500)
    payload = resp[7:-2] if len(resp) >= 10 else b""
    if addr < len(payload):
        return payload[addr]
    return 0


def read_regs_full(dev: XJDevice) -> dict:
    """
    读取全部三组寄存器（偏移 0x00, 0x20, 0x40）。
    返回 dict: {0x00: bytes, 0x20: bytes, 0x40: bytes}
    """
    results = {}
    for offset in [0x00, 0x20, 0x40]:
        wv = CMD_READ_CPU_STATE | (offset << 8)
        wi = 0x2000
        resp = dev.send_cmd(build_cmd_with_wvalue(wv, wi, 0x00), 256, 500)
        if len(resp) >= 10:
            results[offset] = bytes(resp[7:-2])  # byte7 起为数据
        else:
            results[offset] = b""
    return results


# ============================================================
# 运行控制
# ============================================================
def run_mcu(dev: XJDevice, verbose: bool = True):
    """启动 MCU 全速运行（0x16 RUN）"""
    if verbose:
        print("[run] 启动运行...")
    dev.send_precomputed("RUN", 256, 500)


def stop_mcu(dev: XJDevice, verbose: bool = True):
    """停止 MCU（0x14 STOP）"""
    if verbose:
        print("[stop] 停止 CPU...")
    dev.send_precomputed("STOP", 256, 500)


def freerun_mcu(dev: XJDevice, verbose: bool = True):
    """自由运行（0x13 FREE_RUN，无断点，无轮询）"""
    if verbose:
        print("[freerun] 自由运行...")
    dev.send_precomputed("FREE_RUN", 256, 500)


# ============================================================
# 单步执行
# ============================================================
def step_one(dev: XJDevice) -> dict:
    """
    执行一条指令。
    时序: 0x23 → ~145ms → 0x26(第3次) → 0x11

    返回 SFR 字典。
    """
    dev.send_precomputed("QUERY_STATUS", 64, 500)
    time.sleep(0.145)  # IDE: ~145ms, 足够在 Windows 上可靠
    dev.send_precomputed("HALT_STEP", 64, 500)  # 第3次 = 单步

    return read_regs(dev)


def step_multi(dev: XJDevice, n: int, verbose: bool = True) -> list[dict]:
    """
    连续执行 n 条指令，返回每步的 SFR 列表。
    """
    results = []
    for i in range(n):
        sfr = step_one(dev)
        results.append(sfr)
        if verbose:
            pcl = sfr.get("PCL", 0)
            acc = sfr.get("ACC", 0)
            status = sfr.get("STATUS", 0)
            print(f"  [{i+1:3d}] PCL=0x{pcl:02X}  ACC=0x{acc:02X}  STATUS=0x{status:02X}")
    return results


# ============================================================
# 复位
# ============================================================
def reset_mcu(dev: XJDevice, verbose: bool = True) -> dict:
    """
    复位 MCU（重复停止+读取寄存器序列）。
    0x24 → 0x23 → 0x26 ×2 → 0x11
    """
    if verbose:
        print("[reset] 复位...")
    dev.send_precomputed("DEBUG_INIT", 256, 500)
    dev.send_precomputed("QUERY_STATUS", 256, 500)
    dev.send_precomputed("HALT_STEP", 256, 500)
    dev.send_precomputed("HALT_STEP", 256, 500)
    return read_regs(dev)


# ============================================================
# 状态查询
# ============================================================
def query_status(dev: XJDevice) -> bytes:
    """查询设备状态，返回原始响应"""
    return dev.send_precomputed("QUERY_STATUS", 256, 500)


# ============================================================
# 断开连接
# ============================================================
def disconnect(dev: XJDevice, verbose: bool = True):
    """断开与仿真器的连接。发送完整序列确保在任何状态下都能正确退出。
    序列: ENTER_DEBUG → DEBUG_INIT → QUERY_STATUS → HALT_STEP×2 → DISCONNECT_FINAL
    即使已在调试-暂停态，重复发送也无副作用。
    """
    if verbose:
        print("[disconnect] 断开连接...")
    import time
    # 1. 进入调试
    dev.send_precomputed("ENTER_DEBUG", 256, 500)
    time.sleep(0.013)
    # 2. 调试初始化
    dev.send_precomputed("DEBUG_INIT", 256, 500)
    time.sleep(0.25)
    # 3. 查询状态
    dev.send_precomputed("QUERY_STATUS", 256, 500)
    time.sleep(0.15)
    # 4. 暂停 MCU
    dev.send_precomputed("HALT_STEP", 256, 500)
    time.sleep(0.002)
    dev.send_precomputed("HALT_STEP", 256, 500)
    # 5. 最终断开
    dev.send_precomputed("DISCONNECT_FINAL", 256, 500)
    dev._disconnected = True
    if verbose:
        print("[disconnect] 完成")


# ============================================================
# Keepalive 监控（用于 run 后的轮询）
# ============================================================
def keepalive_loop(dev: XJDevice, verbose: bool = True, interval: float = 0.5):
    """
    0x17/0x23 交替 keepalive，MCU 全速运行。
    Ctrl+C 中断。设备断开时自动退出。
    """
    if verbose:
        print("\n[keepalive] 0x17/0x23 交替轮询 (Ctrl+C 停止)")
        print(f"{'#':>6s}  {'PCL':>5s}  {'STATUS':>7s}  {'ACC':>4s}")
        print("-" * 40)

    count = 0
    fail_count = 0
    try:
        while True:
            # IDE: 交替 0x17 / 0x23
            if count % 2 == 0:
                resp = dev.send_precomputed("RUN_POLL", 64, 500)
            else:
                resp = dev.send_precomputed("QUERY_STATUS", 64, 500)

            if not resp:
                fail_count += 1
                if fail_count >= 3:
                    print("\n[WARN] 设备无响应，可能已断开")
                    break
            else:
                fail_count = 0

            if count % 10 == 0 and verbose:
                sfr = read_regs(dev)
                if sfr:
                    print(f"{count:5d}  0x{sfr.get('PCL',0):02X}   "
                          f"0x{sfr.get('STATUS',0):02X}       "
                          f"0x{sfr.get('ACC',0):02X}")

            count += 1
            time.sleep(interval)
    except KeyboardInterrupt:
        if verbose:
            print(f"\n[stop] {count} keepalive 包")


# ============================================================
# 完整会话：flash + debug (一站式)
# ============================================================
def session_flash_debug(dev: XJDevice, xbin_path: str, mpj_path: str = None,
                        verbose: bool = True) -> dict:
    """
    完整会话：下载固件 → 进入调试 → 返回 SFR。
    """
    with open(xbin_path, "rb") as f:
        xbin = f.read()

    config = get_config(xbin_path, mpj_path)
    # boot_download 已内置 start_mcu，直接获取返回值
    sfr = boot_download(dev, xbin, config, verbose)

    pcl = sfr.get("PCL", 0)
    if pcl == 0x01 and verbose:
        print("\n[OK] MCU 停在 main() 入口 (PCL=0x01)")

    return sfr

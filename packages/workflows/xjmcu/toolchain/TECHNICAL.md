# astrocli 技术实现文档

> XJ-IDE V2.0 硬件仿真器命令行调试工具  
> 版本 0.1.0 | 2026-06-09

---

## 目录

1. [USB 通信层](#1-usb-通信层)
2. [设备发现](#2-设备发现)
3. [CRC-16/XMODEM](#3-crc-16xmodem)
4. [数据包格式](#4-数据包格式)
5. [命令全集](#5-命令全集)
6. [固件下载流程](#6-固件下载流程)
7. [调试与运行控制](#7-调试与运行控制)
8. [寄存器与 RAM 读取](#8-寄存器与-ram-读取)
9. [配置解析](#9-配置解析)
10. [CLI 架构](#10-cli-架构)
11. [交互 Shell](#11-交互-shell)
12. [已知问题与注意事项](#12-已知问题与注意事项)

---

## 1. USB 通信层

### 1.1 设备标识

| 属性 | 值 |
|------|-----|
| VID | `0x8235` |
| PID | `0x584B` |
| 设备名称 | XJ-IDE V2.0 |
| USB 版本 | USB 2.0 (0x0200) |
| 设备类别 | 0xFF (Vendor Specific) |

### 1.2 WinUSB Pipe ID（非端点地址）

**这是最常见的错误来源。** USB 端点地址与 WinUSB Pipe ID 是不同的概念：

```
端点地址    →  WinUSB Pipe ID
EP2 OUT 0x02 → OUT pipe 0x02 (本设备第一个 OUT pipe)
EP6 IN  0x86 → IN pipe  0x86 (本设备第一个 IN pipe)
```

Pipe ID 通过 `WinUsb_QueryPipe` 动态枚举获取，存储在 `self._ep_out` 和 `self._ep_in` 中，不依赖硬编码常量。

### 1.3 设备发现 — SetupDi API

```python
# transport.py — discover()
def discover():
    # GUID: 先查 WinUSB 设备接口，再查通用 USB 接口
    GUID_WINUSB = "{BF60B811-930D-E69C-4A05-1551C7987908}"
    GUID_USB    = "{A5DCBF10-6530-11D2-901F-00C04FB951ED}"
    
    # SetupDiGetClassDevsW → 枚举设备接口
    # SetupDiEnumDeviceInterfaces → 遍历接口
    # SetupDiGetDeviceInterfaceDetailW → 获取设备路径
    # 在路径中匹配 vid_8235 和 pid_584b
```

设备路径格式：
```
\\?\usb#vid_8235&pid_584b#80897afa0001#{bf60b811-930d-e69c-4a05-1551c7987908}
```

### 1.4 WinUSB 初始化序列

```python
# transport.py — XJDevice.open()
def open(self):
    # 1. 发现设备路径
    dev_path = discover()
    
    # 2. CreateFileW 打开设备
    #    dwDesiredAccess=0xC0000000 (GENERIC_READ|GENERIC_WRITE)
    #    dwShareMode=3 (FILE_SHARE_READ|FILE_SHARE_WRITE)
    #    dwFlagsAndAttributes=0x40000000 (FILE_FLAG_OVERLAPPED)
    h = CreateFileW(dev_path, 0xC0000000, 3, None, 3, 0x40000000, None)
    
    # 3. WinUsb_Initialize 获取 WinUSB 句柄
    wu = WinUsb_Initialize(h)
    
    # 4. WinUsb_QueryPipe 枚举管道
    #    扫描 AlternateSetting 0-3, PipeIndex 0-7
    #    获取 pipe 类型、ID、最大包大小、轮询间隔
    
    # 5. WinUsb_SetPipePolicy 设置超时
    #    PIPE_TRANSFER_TIMEOUT (policy 3) = 3000ms
    #    对 OUT pipe 和 IN pipe 分别设置
```

### 1.5 数据写入（带重试）

```python
# transport.py — XJDevice.write()
def write(self, data: bytes):
    # WinUsb_WritePipe(handle, pipe_id, buffer, length, &bytes_written, NULL)
    # 同步写入，无 OVERLAPPED
    
    # 错误重试: 22, 31, 121, 433, 995, 1167
    # 重试流程: AbortPipe → ResetPipe → sleep(50ms) → WritePipe 重试
    # 重试仍失败则抛出 RuntimeError
```

### 1.6 数据读取与排空

```python
# transport.py — XJDevice.read()
def read(self, size=256):
    # WinUsb_ReadPipe(handle, pipe_id, buffer, size, &bytes_read, NULL)
    # 超时由 PIPE_TRANSFER_TIMEOUT 策略控制 (默认 3000ms)

# transport.py — XJDevice.drain(timeout_ms=50)
def drain(self, timeout_ms=50):
    # 临时将 IN pipe 超时设为短值 (50ms)
    # 循环读取最多 10 次，直到无数据返回
    # 排空后恢复默认超时 (3000ms)
    # 用于 0x0011 命令后的多余响应包清理
```

### 1.7 协议级收发

```python
# transport.py — XJDevice.send_raw()
def send_raw(self, data, rsize=256, timeout=3000):
    self.write(data)           # 写入命令
    time.sleep(0.02)           # 20ms 等待设备处理
    return self.read(rsize)    # 读取响应

# transport.py — XJDevice.send_cmd()
def send_cmd(self, data, rsize=256, timeout=3000):
    resp = self.send_raw(data, rsize)
    # 自动排空: 0x0011 命令 (bit0=0x11) 会触发 drain()
    if len(data) >= 4 and data[2] == 0x11:
        self.drain()
    return resp
```

---

## 2. 设备发现

### 2.1 Windows SetupDi 流程

```
SetupDiGetClassDevsW(GUID, NULL, NULL, DIGCF_PRESENT|DIGCF_DEVICEINTERFACE)
    ↓
SetupDiEnumDeviceInterfaces(handle, NULL, &guid, index, &iface_data)
    ↓
SetupDiGetDeviceInterfaceDetailW(handle, &iface_data, NULL, 0, &required_size, NULL)
    ↓
SetupDiGetDeviceInterfaceDetailW(handle, &iface_data, detail, required_size, &required_size, NULL)
    ↓
从 DevicePath 中匹配 "vid_8235" 和 "pid_584b"
```

### 2.2 GUID 解析

```python
def _parse_guid(s):
    # "{BF60B811-930D-E69C-4A05-1551C7987908}"
    # → GUID{Data1=0xBF60B811, Data2=0x930D, Data3=0xE69C,
    #        Data4=[0x4A,0x05,0x15,0x51,0xC7,0x98,0x79,0x08]}
```

---

## 3. CRC-16/XMODEM

### 3.1 算法规格

| 属性 | 值 |
|------|-----|
| 算法 | CRC-16/XMODEM |
| 多项式 | `0x1021` |
| 初始值 | `0x0000` |
| 输入反转 | 否 |
| 输出反转 | 否 |
| 存储格式 | 小端序 (LE) |

### 3.2 实现

```python
# protocol.py — calc_crc()
def calc_crc(data: bytes) -> int:
    """使用 Python 内置 binascii.crc_hqx"""
    return binascii.crc_hqx(data, 0)
```

`binascii.crc_hqx` 使用 MSB-first 算法，等价于：

```python
def crc16_manual(data: bytes) -> int:
    crc = 0
    for b in data:
        crc ^= (b << 8)
        for _ in range(8):
            if crc & 0x8000:
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF
            else:
                crc = (crc << 1) & 0xFFFF
    return crc
```

### 3.3 已验证测试向量（10/10 匹配）

| 数据 (hex) | CRC | LE 存储 |
|------------|-----|---------|
| `41000520150000e0` | `0xA07A` | `7A A0` |
| `4100fc00000000e0` | `0xD672` | `72 D6` |
| `41001500000000e0` | `0x15A8` | `A8 15` |
| `41002400000000e0` | `0x7F84` | `84 7F` |
| `41002300000000e0` | `0xB7C5` | `C5 B7` |
| `41002600000000e0` | `0xF4C4` | `C4 F4` |
| `41001600000000e0` | `0xDB48` | `48 DB` |
| `41001700000000e0` | `0x9EE8` | `E8 9E` |
| `41001400000000e0` | `0x5008` | `08 50` |
| `4100fe00000000e0` | `0x5D32` | `32 5D` |

---

## 4. 数据包格式

### 4.1 通用帧结构

```
Byte:  0    1    2    3    4    5    6    7    8..N-3   N-2 N-1
     ┌────┬────┬────┬────┬────┬────┬────┬────┬────────┬────┬────┐
     │ 41 │ 00 │ Cmd │  X  │  Y  │ 00 │ B7 │ 数据   │ CRC│ CRC│
     └────┴────┴────┴────┴────┴────┴────┴────┴────────┴────┴────┘
      SYNC  Flg  wValue LE  wIndex LE  Pad  Byte7  Payload  CRC LE
```

| 偏移 | 大小 | 字段 | 说明 |
|------|------|------|------|
| 0 | 1 | SYNC | 固定 `0x41` |
| 1 | 1 | Flags | `0x00`=命令, 变化=数据流 |
| 2-3 | 2 | wValue | 16位小端序，低字节=命令ID |
| 4-5 | 2 | wIndex | 16位小端序，参数/地址 |
| 6 | 1 | Pad | 固定 `0x00` |
| 7 | 1 | Byte7 | 命令标记(0xE0)/数据首字节/响应标记(0xE1) |
| 8~N-3 | 变长 | Payload | 参数/数据载荷 |
| N-2~N-1 | 2 | CRC | CRC-16/XMODEM 小端序 |

### 4.2 三种典型包

| 类型 | 长度 | 用途 |
|------|------|------|
| **10 字节短包** | 8B 头 + 2B CRC | 控制/查询命令 (无载荷) |
| **42 字节长包** | 8B 头 + 32B 数据 + 2B CRC | 寄存器读写、固件数据传输 |
| **19 字节配置包** | 3B 头 + 14B 数据 + 2B CRC | 配置字写入 (特殊格式) |

### 4.3 数据包构建函数

```python
# protocol.py

def build_cmd(cmd_id: int, wIndex: int = 0, byte7: int = 0xE0) -> bytes:
    """构建 10 字节短命令包"""
    wValue = cmd_id & 0xFFFF
    hdr = struct.pack("<BBHHBB", 0x41, 0x00, wValue, wIndex, 0x00, byte7)
    crc = calc_crc(hdr)
    return hdr + struct.pack("<H", crc)

def build_cmd_with_wvalue(wValue: int, wIndex: int = 0, byte7: int = 0xE0) -> bytes:
    """构建使用完整 wValue 的命令包 (如 INIT: wValue=0x2005)"""
    hdr = struct.pack("<BBHHBB", 0x41, 0x00, wValue, wIndex, 0x00, byte7)
    crc = calc_crc(hdr)
    return hdr + struct.pack("<H", crc)

def build_cmd_data(wValue: int, wIndex: int, byte7: int, data: bytes) -> bytes:
    """构建带数据载荷的包 (42B/19B)"""
    payload = struct.pack("<BBHHBB", 0x41, 0x00, wValue, wIndex, 0x00, byte7) + data
    crc = calc_crc(payload)
    return payload + struct.pack("<H", crc)

def build_config_cmd(words: list) -> bytes:
    """构建配置命令包 (特殊 19 字节格式)"""
    # 格式: [41][00][06][0C][words LE16...][E0][CRC LE]
    payload = bytes([0x0C])  # count = 12 (6 words × 2 bytes)
    for w in words:
        payload += struct.pack("<H", w)
    payload += bytes([0xE0])  # terminator
    pkt = struct.pack("<BBB", 0x41, 0x00, 0x06) + payload
    crc = calc_crc(pkt)
    return pkt + struct.pack("<H", crc)
```

### 4.4 预构建命令包（12 个）

所有预构建包的 CRC 均经验证，与协议文档字节级匹配：

```python
# protocol.py — PRECOMPUTED dict

PRECOMPUTED = {
    "INIT":                    build_cmd_with_wvalue(0x2005, 0x0015, 0xE0),
    "ENTER_DEBUG":             build_cmd(0x0015),
    "DEBUG_INIT":              build_cmd(0x0024),
    "QUERY_STATUS":            build_cmd(0x0023),
    "HALT_STEP":               build_cmd(0x0026),
    "RUN":                     build_cmd(0x0016),
    "RUN_POLL":                build_cmd(0x0017),
    "STOP":                    build_cmd(0x0014),
    "FREE_RUN":                build_cmd(0x0013),
    "SYNC_WAIT":               build_cmd(0x0012),
    "QUERY_INFO":              build_cmd(0x00FC),
    "TRANSITION":              build_cmd(0x0008),
    "DISCONNECT_TRANSITION":   build_cmd_with_wvalue(0x0022, 0x00FC, 0xE0),
    "DISCONNECT_FINAL":        build_cmd_with_wvalue(0x3F22, 0x00FF, 0xE0),
}
```

---

## 5. 命令全集

### 5.1 命令 ID 速查

| 命令 ID | 常量名 | 功能 | 包长度 | 方向 |
|---------|--------|------|--------|------|
| `0x0001` | `CMD_PASS1_DOWNLOAD` | Pass1 固件下载 (33B/包) | 42B | OUT |
| `0x0002` | `CMD_FLASH_VERIFY` | Flash 校验读取 | 10B→42B | OUT→IN |
| `0x0003` | `CMD_PASS2_PROGRAM` | Pass2 Word 交织编程 | 42B | OUT |
| `0x0004` | `CMD_PASS2_DUMP` | Pass2 回读校验 | 10B→42B | OUT→IN |
| `0x0005` | `CMD_INIT` | 初始化握手 (wValue=0x2005) | 10B | OUT |
| `0x0006` | `CMD_WRITE_CFG` | 写配置字 | 19B | OUT |
| `0x0008` | `CMD_TRANSITION` | 状态转换 | 10B | OUT |
| `0x0011` | `CMD_READ_CPU_STATE` | 读 CPU 状态/寄存器 | 10B→42B | OUT→IN |
| `0x0012` | `CMD_SYNC_WAIT` | 同步等待 | 10B | OUT |
| `0x0013` | `CMD_FREE_RUN` | 自由运行 (全速，无断点) | 10B | OUT |
| `0x0014` | `CMD_STOP` | 停止 CPU | 10B | OUT |
| `0x0015` | `CMD_ENTER_DEBUG` | 进入调试模式 | 10B | OUT |
| `0x0016` | `CMD_RUN` | 启动运行 (带断点) | 10B | OUT |
| `0x0017` | `CMD_RUN_POLL` | 运行轮询 | 10B | OUT |
| `0x0022` | `CMD_DISCONNECT` | 断开连接 | 10B | OUT |
| `0x0023` | `CMD_QUERY_STATUS` | 查询设备/调试状态 | 10B | OUT |
| `0x0024` | `CMD_DEBUG_INIT` | 调试初始化 | 10B | OUT |
| `0x0026` | `CMD_HALT_STEP` | 停止/单步 (多功能) | 10B | OUT |
| `0x00FC` | `CMD_QUERY_INFO` | 查询设备信息 | 10B | OUT |
| `0x00FE` | `CMD_VERSION` | 版本查询 (**已弃用**) | 10B | OUT |

### 5.2 关键命令详解

#### INIT (`0x0005`) — wValue=0x2005, wIndex=0x0015

```
发送: 41 00 05 20 15 00 00 E0 [CRC]
响应: 41 00 05 A1 00 00 00 E1 [CRC]
```
每次握手发送 2 次。

#### HALT_STEP (`0x0026`) — 多功能命令

```
第1次: CPU 停止       → 响应计数 0x0000
第2次: 停止确认        → 响应计数 0x0001
第3次: 单步执行一条指令  → 响应计数 0x0002
第4次: 单步执行一条指令  → 响应计数 0x0003
...
```

计数器在进入调试模式后累积，不会被 `0x0023` 重置。

#### DISCONNECT (`0x0022`)

```
Phase6 过渡: wValue=0x0022, wIndex=0x00FC  (过渡用)
最终断开:    wValue=0x3F22, wIndex=0x00FF  (完全断开)
```

---

## 6. 固件下载流程

### 6.1 完整流程 (boot_download)

```
Phase 1: 握手 (INIT ×2 + QUERY_INFO)
  ↓
Phase 2: Pass1 下载 (0x0001 × ceil(xbin_size/33))
  33B 分块编码: byte7=chunk[0], payload=chunk[1:33]
  wValue = (((off>>1) & 0xFF) << 8) | 0x0001
  wIndex = 0x2000
  ↓
Phase 3: 配置字写入 (0x0006, 19B 特殊格式)
  从 .mpj 文件读取 OPTIONVALUE0~5
  ↓
Phase 4: Flash 校验 (0x0002 × ceil(ROM_bytes/32))
  wValue = ((addr & 0xFF) << 8) | 0x0002
  wIndex = 0x2000
  ↓
Phase 5: Transition
  0x0008 → 0x0022(0x00FC) → sleep(5ms) → 0x0012 → sleep(10ms) → drain()
  ↓
Phase 6: Pass2 编程 (0x0003 × ceil(xbin_size/16))
  Word 交织编码: 16B 输入 → 32B 输出
  for i in 0..7: d[i*4]=chunk[i*2+1], d[i*4+3]=chunk[i*2+2]
  wValue = ((off & 0xFF) << 8) | 0x0003
  wIndex = 0x2000 + (off >> 8)
  每包后 sleep(5ms)
  ↓
Phase 7: 回读校验 (0x0004 × ceil(xbin_size/16))
  wValue = ((off & 0xFF) << 8) | 0x0004
  wIndex = 0x2000 + (off >> 8)
  每包超时 200ms
```

### 6.2 Pass1 33 字节分块编码

```python
# xbin 按 33B 分块
for off in range(0, len(xbin), 32):        # 步进 32 (每包承载 32B payload)
    chunk = xbin[off : off+33]             # 取 33 字节
    if len(chunk) < 33:
        chunk += b'\xFF' * (33 - len(chunk))  # 不足补 0xFF
    byte7 = chunk[0]                       # 第一字节放入 header byte7
    payload = chunk[1:33]                  # 剩余 32 字节放入数据区
    wValue = (((off >> 1) & 0xFF) << 8) | 0x0001
    # 线路上: 41 00 [wValue LE] [0x2000 LE] [00] [byte7] [32B payload] [CRC]
```

### 6.3 Pass2 Word 交织编码

```python
# xbin 按 16B 分块，每 14-bit word 展开为 4 字节
for off in range(0, len(xbin), 16):        # 步进 16
    chunk = xbin[off : off+17]
    if len(chunk) < 17:
        chunk += b'\xFF' * (17 - len(chunk))
    d = bytearray(32)
    for i in range(8):
        d[i*4]     = chunk[i*2+1]          # word 低字节
        d[i*4+1]   = 0x00                  # 填充
        d[i*4+2]   = 0x00                  # 填充
        d[i*4+3]   = chunk[i*2+2]          # word 高字节
    wValue = ((off & 0xFF) << 8) | 0x0003
    wIndex = 0x2000 + (off >> 8)
    # 线路上: 41 00 [wValue LE] [wIndex LE] [00] [chunk[0]] [32B d] [CRC]
```

### 6.4 XC8P9530 参数

| 参数 | 值 |
|------|-----|
| ROM | 1024 words (2048 bytes) |
| 有效代码 | ~19 bytes (其余为 0x3FFF Flash 擦除态) |
| Pass1 包数 | ceil(2048/33) = 63 包 |
| Pass2 包数 | ceil(2048/16) = 128 包 |
| 校验页数 | ceil(2048/32) = 64 页 (实际计算: (1024×14/8+31)/32 = 56) |

---

## 7. 调试与运行控制

### 7.1 MCU 启动序列 (start_mcu)

```
0x0015 (ENTER_DEBUG)
    ↓ sleep(13ms)  — 精确时序: 12.8ms
0x0024 (DEBUG_INIT)
    ↓ sleep(233ms) — 精确时序: 232.7ms
0x0023 (QUERY_STATUS)
    ↓ sleep(145ms) — 精确时序: 145ms
0x0026 (HALT_STEP ×1)    — 停止 CPU (计数=0)
    ↓ sleep(2ms)  — 精确时序: 1.3ms
0x0026 (HALT_STEP ×2)    — 停止确认 (计数=1)
    ↓
0x0011 (READ_CPU_STATE)  — 读取初始寄存器
```

成功进入后 MCU 停在 main() 入口: `PCL=0x01`

### 7.2 单步执行 (step_one)

```
0x0023 (QUERY_STATUS)
    ↓ sleep(145ms)
0x0026 (HALT_STEP 第3次) — 单步执行一条指令
    ↓
0x0011 (READ_CPU_STATE)  — 读取执行后的寄存器
    自动 drain() 排空多余响应
```

返回 `{PCL, ACC, STATUS, ...}` 字典。

### 7.3 运行控制

```python
# 全速运行 (带断点)
run_mcu(dev)    → 0x0016 (RUN) → keepalive_loop(0x17/0x23 交替轮询)

# 自由运行 (无断点，无轮询)
freerun_mcu(dev) → 0x0013 (FREE_RUN)

# 停止
stop_mcu(dev)   → 0x0014 (STOP)

# 复位
reset_mcu(dev)  → 0x0024 → 0x0023 → 0x0026×2 → 0x0011
```

### 7.4 Keepalive 轮询

```python
def keepalive_loop(dev, interval=0.5):
    count = 0
    while True:
        # 奇数次: RUN_POLL (0x0017)
        # 偶数次: QUERY_STATUS (0x0023)
        dev.send_precomputed("RUN_POLL" if count % 2 == 0 else "QUERY_STATUS")
        
        # 每 10 次读取寄存器显示
        if count % 10 == 0:
            sfr = read_regs(dev)
            print(f"PCL=0x{sfr['PCL']:02X} ...")
        
        count += 1
        time.sleep(interval)
```

---

## 8. 寄存器与 RAM 读取

### 8.1 SFR 寄存器 (read_regs)

`0x0011` 响应中 **byte7 是第一个数据字节**：

```
响应包结构:
Byte:  0   1   2   3   4   5   6   7   8   9   10  11  12  13  ...  N-2 N-1
     ┌───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┐
     │41 │00 │11 │00 │00 │20 │00 │ACC│TC0│PCL│STA│RSR│PCH│P6 │P7 │...│CRC│
     └───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┘
       SYNC Flg wValue  wIndex  Pad byte7 ← 数据区域 (32B) →   CRC LE
```

```python
# commands.py — read_regs()
def read_regs(dev):
    wv = CMD_READ_CPU_STATE  # 0x0011
    wi = 0x2000
    resp = dev.send_cmd(build_cmd_with_wvalue(wv, wi, 0x00), 256, 500)
    
    # byte7 就是第一个数据字节 (ACC=offset 0)
    # 数据从 resp[7] 到 resp[-3] (不含 CRC)
    payload = resp[7:-2]
    
    result = {}
    for offset, name in SFR_NAMES.items():
        if offset < len(payload):
            result[name] = payload[offset]
    return result
```

### 8.2 SFR 寄存器映射

| 偏移 | 名称 | 说明 |
|------|------|------|
| 0 | ACC | 累加器 |
| 1 | TC0C | Timer0 计数器 |
| 2 | PCL | 程序计数器低字节 |
| 3 | STATUS | 状态寄存器 |
| 4 | RSR | RAM 选择寄存器 |
| 5 | PCH | 程序计数器高字节 |
| 6 | PORT6 | 端口 6 |
| 7 | PORT7 | 端口 7 |

### 8.3 全三组寄存器 (read_regs_full)

```python
def read_regs_full(dev):
    results = {}
    for offset in [0x00, 0x20, 0x40]:
        wv = CMD_READ_CPU_STATE | (offset << 8)
        wi = 0x2000
        resp = dev.send_cmd(build_cmd_with_wvalue(wv, wi, 0x00), 256, 500)
        if len(resp) >= 10:
            results[offset] = bytes(resp[7:-2])  # 32B 寄存器数据
    return results
```

### 8.4 RAM 读取 (read_ram)

RAM 数据在 `0x0011` 响应的数据区域中，地址直接对应 payload 偏移：

```python
def read_ram(dev, addr: int) -> int:
    """读取 RAM 地址 addr 的值"""
    wv = CMD_READ_CPU_STATE
    wi = 0x2000
    resp = dev.send_cmd(build_cmd_with_wvalue(wv, wi, 0x00), 256, 500)
    payload = resp[7:-2] if len(resp) >= 10 else b""
    if addr < len(payload):
        return payload[addr]
    return 0

# 示例: 读取 Pwm (地址 0x12), Pwm1 (地址 0x13)
pwm  = read_ram(dev, 0x12)
pwm1 = read_ram(dev, 0x13)
```

---

## 9. 配置解析

### 9.1 .mpj 文件格式

`.mpj` 是 IDE 的项目文件，XML 格式：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Project>
    <Name>XC8P9530_INT</Name>
    <Chip>XC8P9530</Chip>
    <Options>
        <OPTIONVALUE0>1FFF</OPTIONVALUE0>
        <OPTIONVALUE1>3F77</OPTIONVALUE1>
        <OPTIONVALUE2>1FE5</OPTIONVALUE2>
        <OPTIONVALUE3>3BFF</OPTIONVALUE3>
        <OPTIONVALUE4>3FFF</OPTIONVALUE4>
        <OPTIONVALUE5>3FFF</OPTIONVALUE5>
    </Options>
</Project>
```

### 9.2 解析流程

```python
# config.py

def find_mpj(xbin_path: str) -> str | None:
    """在 xbin 同目录查找 .mpj 文件"""
    xbin_dir = os.path.dirname(os.path.abspath(xbin_path))
    for fname in os.listdir(xbin_dir):
        if fname.endswith(".mpj"):
            return os.path.join(xbin_dir, fname)
    return None

def parse_mpj(mpj_path: str) -> dict:
    """解析 .mpj，提取 Chip 和配置字"""
    tree = ET.parse(mpj_path)
    root = tree.getroot()
    
    # Chip → 从芯片数据库获取 rom_size, ram_size, opt_size 等
    chip_name = root.find("Chip").text.strip()
    chip_info = CHIP_DATABASE.get(chip_name.upper(), default)
    
    # Options → 配置字列表
    options = root.find("Options")
    config_words = []
    for child in options:
        if child.tag.startswith("OPTIONVALUE"):
            config_words.append(int(child.text.strip(), 16))
    
    # 截断到 opt_size 个
    config_words = config_words[:chip_info["opt_size"]]
    
    return {**chip_info, "name": chip_name, "config_words": config_words}

def get_config(xbin_path=None, mpj_path=None) -> dict:
    """主入口: mpj_path > xbin 同目录自动查找 > 默认配置"""
```

### 9.3 芯片数据库

```python
# constants.py — CHIP_DATABASE
CHIP_DATABASE = {
    "XC8P9530":  {"rom_size": 1024, "ram_size": 80, "ram_base": 48, "opt_size": 6, "rom_base": 0},
    "XC8P9530D": {"rom_size": 1024, "ram_size": 80, "ram_base": 48, "opt_size": 6, "rom_base": 0},
    "XC8M4096":  {"rom_size": 4096, "ram_size": 256, "ram_base": 64, "opt_size": 4, "rom_base": 0},
}
```

---

## 10. CLI 架构

### 10.1 两种运行模式

**单次命令模式（AI Agent 可操作）：**
```bash
astrocli connect
astrocli flash  test.xbin [--mpj test.mpj]
astrocli debug  test.xbin [--mpj test.mpj]
astrocli run    test.xbin [--mpj test.mpj] [--interval 0.5]
astrocli step   test.xbin -n 10 [--mpj test.mpj]
astrocli freerun test.xbin [--duration 3.0] [--mpj test.mpj]
astrocli regs
astrocli stop
astrocli reset
astrocli disconnect
```

**交互 Shell 模式（持久连接）：**
```bash
astrocli shell test.xbin [--mpj test.mpj]
astro> flash      # 重新下载固件
astro> debug      # 进入调试模式
astro> step 10    # 单步 10 条
astro> regs       # 读寄存器
astro> regs_all   # 读全部三组
astro> run        # 全速运行 (Ctrl+C 停止)
astro> freerun 5  # 自由运行 5 秒
astro> stop       # 停止
astro> reset      # 复位
astro> status     # 查询状态
astro> quit       # 退出
```

### 10.2 文件结构

```
astrocli/
├── __init__.py        # 包入口, v0.1.0
├── __main__.py        # python -m astrocli 入口
├── constants.py       # 常量: VID/PID, 命令码, 芯片库, SFR 映射
├── protocol.py        # 协议层: CRC, 封包, 12 预构建命令
├── transport.py       # WinUSB 传输层: 设备发现, 读写, pipe 管理
├── config.py          # 配置解析: .mpj → MCU 参数 + 配置字
├── commands.py        # 高层命令: 固件下载, 调试, 运行控制, 寄存器读写
├── astrocli.py        # CLI 入口: argparse 11 子命令 + 交互 Shell
├── .gitignore
└── TECHNICAL.md       # 本文档
```

### 10.3 依赖

```python
# 标准库: ctypes, struct, time, sys, argparse, cmd, os, re, binascii, xml.etree.ElementTree
# 系统: winusb.dll (Windows 内置), kernel32.dll, setupapi.dll
# 无第三方依赖
```

---

## 11. 交互 Shell

### 11.1 状态机

```
Shell 启动
    ↓
[未烧录] ──flash──→ [已烧录] ──debug──→ [调试就绪]
    ↑                   ↑                   │
    └───────────────────┴───────────────────┘
         flash 可重新烧录, debug 可重新进入
```

### 11.2 实现

```python
class AstroCliShell(cmd.Cmd):
    prompt = "astro> "
    
    def _ensure_ready(self):
        """确保设备已烧录并进入调试模式"""
        if self._debug_ready:
            return True
        if not self._flashed:
            boot_download(self.dev, xbin, config)
            self._flashed = True
        start_mcu(self.dev)
        self._debug_ready = True
    
    # 所有 do_* 方法调用 _ensure_ready() 后执行操作
    def do_step(self, arg): ...
    def do_run(self, arg): ...
    def do_regs(self, arg): ...
    def do_quit(self, arg): ...
```

---

## 12. 已知问题与注意事项

### 12.1 已修复的关键 Bug

| Bug | 修复 |
|-----|------|
| `0x00FE` 版本查询破坏设备状态 | 移除，IDE 从不发送此命令 |
| 寄存器偏移错误 (`resp[8:-2]` 应为 `resp[7:-2]`) | byte7 是第一个数据字节 |
| Pass2 包间缺延迟导致超时 | 每包后 sleep(5ms) |
| Transition 后缺排空导致后续 stall | sleep(10ms) + drain() |
| `open()` 时 Abort/Reset 管道导致 stall | 只在错误恢复时使用，不在初始化使用 |

### 12.2 通信注意事项

1. **USB 重连**: 每次完整下载会话后建议物理重连 USB，否则可能 err=22/31/121
2. **时序敏感**: Phase 间延迟不能缩短（特别是 Transition 后的 5ms 和 Pass2 包间 5ms）
3. **Pipe 排空**: `0x0011` 命令后必须 `drain()`，否则 IN pipe 残留数据导致 USB stall
4. **WinUSB Pipe ID**: 通过 `WinUsb_QueryPipe` 动态获取，不能假设 pipe ID 等于端点地址
5. **超时 vs 轮询**: 默认 pipe 超时 3000ms 适用于所有操作，drain 用 50ms 短超时

### 12.3 平台限制

- **仅 Windows**: 依赖 WinUSB API (winusb.dll, setupapi.dll)
- **驱动要求**: XJ-IDE V2.0 驱动已安装 (VID=0x8235, PID=0x584B)
- **权限**: 可能需要管理员权限访问 USB 设备

---

## 13. v0.2.0 更新 (2026-06-13)

### 13.1 设备发现修复

**问题**: XJ-IDE V2.0 使用自定义设备类 GUID `{88bae032-5a81-49f0-bc3d-a4ff138216d6}`，而非标准 WinUSB GUID。原 `discover()` 只搜索 `GUID_WINUSB` 和 `GUID_USB`，导致设备无法发现。

**修复**: `constants.py` 新增 `GUID_XJIDE`，`transport.py` 的 `discover()` 优先搜索该 GUID。

```python
# constants.py
GUID_XJIDE = "{88bae032-5a81-49f0-bc3d-a4ff138216d6}"

# transport.py — discover()
for guid_str in [GUID_XJIDE, GUID_WINUSB, GUID_USB]:  # XJ-IDE 优先
```

### 13.2 断开连接机制重构

**问题**: 脚本异常退出时，仿真器停留在下载/调试模式，LED 常亮。根因是 `close()` 只释放 WinUSB 句柄，不发送断开命令。

**核心发现**: `DISCONNECT_FINAL` 只有在 MCU 处于**调试-暂停态**时才生效。仅下载固件未进入调试时，FINAL 无法熄灭 LED。必须先执行 `ENTER_DEBUG → DEBUG_INIT → QUERY_STATUS → HALT_STEP×2` 进入暂停态，再发 FINAL。

**修复**:

1. **`boot_download()` 原子化** (`commands.py`): 下载完成后自动调用 `start_mcu()`，确保设备始终处于调试-暂停态。

```python
def boot_download(dev, xbin, config=None, verbose=True):
    # ... Phase 1-7 ...
    dev.drain()
    return start_mcu(dev, verbose, family=config.get("family"))  # 原子操作
```

2. **`disconnect()` 完整序列** (`commands.py`): 不再只发 FINAL，改为发送完整序列，覆盖所有设备状态。

```python
def disconnect(dev, verbose=True):
    dev.send_precomputed("ENTER_DEBUG", 256, 500); time.sleep(0.013)
    dev.send_precomputed("DEBUG_INIT", 256, 500);  time.sleep(0.25)
    dev.send_precomputed("QUERY_STATUS", 256, 500); time.sleep(0.15)
    dev.send_precomputed("HALT_STEP", 256, 500);   time.sleep(0.002)
    dev.send_precomputed("HALT_STEP", 256, 500)
    dev.send_precomputed("DISCONNECT_FINAL", 256, 500)
    dev._disconnected = True
```

3. **`XJDevice.__exit__()` 自动清理** (`transport.py`): `with` 语句退出时自动发送完整断开序列，确保异常路径也能正确退出。使用 `send_precomputed`（写+读响应）而非裸 `write`，因为设备状态机需要消费响应才能正常跳转。

```python
def __exit__(self, *args):
    if not self._disconnected and self._wu:
        # 完整断开序列（内联，避免循环导入）
        self.send_precomputed("ENTER_DEBUG", 256, 500); time.sleep(0.013)
        self.send_precomputed("DEBUG_INIT", 256, 500);  time.sleep(0.25)
        self.send_precomputed("QUERY_STATUS", 256, 500); time.sleep(0.15)
        self.send_precomputed("HALT_STEP", 256, 500);   time.sleep(0.002)
        self.send_precomputed("HALT_STEP", 256, 500)
        self.send_precomputed("DISCONNECT_FINAL", 256, 500)
        self._disconnected = True
    self.close()
```

4. **`_disconnected` 标志位**: 防止 `disconnect()` 和 `__exit__()` 重复发送断开序列。

5. **`agent.py` 错误处理**: `exec_firmware()` 改用 `try/finally` 包裹，确保任何退出路径都调用 `disconnect()`。

### 13.3 start_mcu 稳定性

- `DEBUG_INIT` 后延迟从 232.7ms 增加到 300ms，提高稳定性
- `boot_download` 结束后调用 `drain()` 清理管道残留

### 13.4 通信架构原则

**下载后必须直接进入调试-暂停态，中间不分步。** 分步会导致设备处于不稳定中间状态，断开命令无法生效。

```
boot_download()                    # 下载 + 自动进入调试-暂停
  ├─ Phase 1-7: 固件下载
  └─ start_mcu(): 调试入口

disconnect() / __exit__()           # 统一断开序列
  └─ ENTER_DEBUG → DEBUG_INIT → QUERY_STATUS → HALT×2 → FINAL
```

### 13.5 已知限制

- **err=22/121**: USB 管道级故障，任何命令无法发送（包括断开）。只能物理重插 USB 恢复。
- **err=22 触发条件**: 上一次会话异常退出后，USB 管道残留 stall 状态。IDE 关闭时 Windows 驱动层会复位 USB，等效物理重插。

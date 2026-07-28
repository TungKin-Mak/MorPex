# XC8P9530 代码生成注意点

> 基于实际硬件仿真验证总结的 C 代码编写注意事项  
> 编译器: SLCC (SDCC xj port) | 芯片: XC8P9530 | 2026-06-13

---

## 1. 编译器行为

### 1.1 `>=` 比较被编译为 `>`

**现象**: `if (x >= N)` 在汇编层面被编译为 `if (N < x)`（严格大于），而非 `if (N <= x)`。

**汇编等价**:
```asm
MOV   A, @N          ; A = N
SUB   A, _x          ; A = N - x
JBTS  STATUS, 0      ; C=1 (N >= x) → 跳过 if 体
JMP   _skip
; if 体: 当 C=0 (N < x, 即 x > N) 时执行
```

**影响**: 软件分频计数器阈值需减1。例如 `if (cnt >= 16)` 实际触发于 `cnt == 17`。

**推荐方案**: 使用递减归零法替代递增比较法。

```c
// ❌ 递增比较 — 编译器行为不确定
tc0_soft_cnt++;
if (tc0_soft_cnt >= 16) {  // 实际在 17 时触发
    tc0_soft_cnt = 0;
    timer_count++;
}

// ✅ 递减归零 — 行为确定
tc0_soft_cnt--;
if (tc0_soft_cnt == 0) {   // 精确在 0 时触发
    tc0_soft_cnt = 16;      // 重载
    timer_count++;
}
```

### 1.2 `__sfr` 寄存器访问

XC8P9530 有两类寄存器页:
- **R 页** (0x00-0x0F): 直接通过变量名访问。如 `TC0C = 12;`
- **IOC 页** (0x02, 0x06, 0x09, 0x0A, 0x0B, 0x0D, 0x0E, 0x0F): 必须通过专用宏访问

```c
// R 页 — 直接赋值
TC0C = 12;
TC1CON = 0x8F;
INTF = 0x00;

// IOC 页 — 必须用宏
CONTW(0x87);              // 写 TC0CON (IOC2)
IOCP_W(INTE, 0x09);       // 写 INTE (IOCF)
IOCP_W(WDTCON, 0x00);     // 写 WDTCON (IOCE)
```

---

## 2. 中断服务函数

### 2.1 ISR 模板

```c
volatile __at(0x10) unsigned char A_BUFF;   // ACC 缓存 (必须 0x10)
volatile __at(0x11) unsigned char R3_BUFF;   // STATUS 缓存 (必须 0x11)

void int_isr(void) __interrupt
{
    __asm__("org 0x08");          // 中断向量
    PUSH(_A_BUFF, _R3_BUFF);      // 保护 ACC 和 STATUS

    if (TC0IF) {
        TC0C += 重载值;
        INTF = 0xFE;              // 清除 bit0
        // 处理...
    }

    if (TC1IF) {
        INTF = 0xF7;              // 清除 bit3
        // 处理...
    }

    POP(_A_BUFF, _R3_BUFF);       // 恢复
}
```

### 2.2 中断标志清除

- `INTF` 可软件写 0 清位，**不可软件写 1 置位**
- 必须使用 `INTF = 0xFE` (MOV 指令)，不能用 `BTC` 或 `AND`
- 写 1 的位不变化，只有写 0 的位被清除

### 2.3 必需宏定义

```c
#define EI()    __asm__(" ei ")
#define DI()    __asm__(" di ")
#define NOP()   __asm__(" nop ")
#define CWDT()  __asm__(" CWDT ")
#define CONTW(VAL)       __asm__("mov a,@"#VAL"\n ctw")
#define IOCP_W(REG, VAL) __asm__("mov a,@"#VAL"\n iw "#REG)
#define PUSH(A, R3)      __asm__("mov "#A",a\n swap "#A"\n swapa STATUS\n mov "#R3",a")
#define POP(A, R3)       __asm__("swapa "#R3"\n mov STATUS,a\n swapa "#A)
```

---

## 3. 定时器配置

### 3.1 时钟参数

| 参数 | 值 |
|------|-----|
| IRC 频率 | 8 MHz |
| 默认分频 | 4T → 指令周期 0.5 μs |
| TC0 位宽 | 8-bit (溢出值 256) |
| TC1 位宽 | 12-bit (PRD 最大值 4095) |

### 3.2 TC0 配置

```
TC0 溢出周期 = 指令周期 × 预分频 × (256 - TC0C)
```

```c
// TC0CON (IOC2) via CONTW:
//   bit7 TC0EN=1, bit3 PAB=0(预分频给TC0), bit2-0=预分频
//   0x87 = 1:256 预分频, 0x82 = 1:8, 0x81 = 1:4
CONTW(0x87);        // 使能, 1:256
TC0C = 12;          // (256-12)×128μs = 31.232ms
```

### 3.3 TC1 配置

```
TC1 溢出周期 = 指令周期 × 预分频 × (TC1PRD + 1)
```

```c
// TC1CON (R8):
//   bit7 TC1EN=1, bit3 TC1PTEN=1, bit2-0=预分频
//   0x8F = 1:256 预分频
TC1CON = 0x8F;
TC1PRDL  = 0x43;    // PRD 低 8 位
TC1PRDTH = 0xF0;    // PRD 高 4 位在 bit7-4 (0xF)
// PRD = 0xF43 = 3907 → 3908×128μs = 500.2ms
```

### 3.4 预分频速查

| TC0CON[2:0] / TC1CON[2:0] | 预分频比 | tick@4T |
|---------------------------|----------|---------|
| 000 (TC1PTEN=0) | 1:1 | 0.5 μs |
| 000 (TC1PTEN=1) | 1:2 | 1 μs |
| 001 | 1:4 | 2 μs |
| 010 | 1:8 | 4 μs |
| 011 | 1:16 | 8 μs |
| 100 | 1:32 | 16 μs |
| 101 | 1:64 | 32 μs |
| 110 | 1:128 | 64 μs |
| 111 | 1:256 | 128 μs |

---

## 4. RAM 清零

XC8P9530 的通用 RAM 在 0x10-0x3F (48 字节)。上电后值不确定，必须清零。

```c
void file_clrRam(void)
{
    for (RSR = 0xD0; RSR < 0xFF; RSR++) {
        IAR = 0;
    }
    IAR = 0;
}
```

**原理**: RSR 是 RAM 选择寄存器，IAR 是间接寻址寄存器。`IAR = 0` 将 RSR 指向的地址清零。

---

## 5. 配置字

```c
// @config 0x1FFF, 0x3F77, 0x1FE5, 0x3BFF, 0x3FFF, 0x3FFF
```

| Word | 值 | 关键位 |
|------|-----|--------|
| 0 | 0x1FFF | IRC=8MHz, 1K OTP |
| 1 | 0x3F77 | **WDT 禁止**, **4 Clocks** |
| 2 | 0x1FE5 | LVR=1.8V |
| 3 | 0x3BFF | 查表范围=1K |
| 4-5 | 0x3FFF | 保留 |

---

## 6. 实测验证数据

### 6.1 500ms 定时器 (TC0)

| 参数 | 值 |
|------|-----|
| 预分频 | 1:256 |
| TC0C 重载 | 12 |
| 溢出周期 | 31.232 ms |
| 软件分频 | 16 |
| 实测周期 | 499.7 ms |
| 3 秒计数值 | **6** ✅ |

### 6.2 1s 定时器 (TC1)

| 参数 | 值 |
|------|-----|
| 预分频 | 1:256 |
| PRD | 3907 |
| 溢出周期 | 500.2 ms |
| 软件分频 | 2 (递减法) |
| 实测周期 | 1000.2 ms |
| 3 秒计数值 | **3** ✅ |

### 6.3 变量地址

| 变量 | RAM 地址 |
|------|----------|
| A_BUFF | 0x10 (固定) |
| R3_BUFF | 0x11 (固定) |
| timer0_count | 0x12 |
| timer1_count | 0x13 |
| tc0_soft_cnt | 0x14 |
| tc1_soft_cnt | 0x15 |

---

## 7. GPIO 编程

### 7.1 初始化顺序 (铁律)

```
第1步: P6 = 0x00        ← 预置输出数据锁存器 (防毛刺)
第2步: P6AE = analog    ← 配置模拟口 (先隔离模拟引脚)
第3步: P6PH/P6PD        ← 配置上下拉 (引脚还在高阻输入态)
第4步: P6CON = dir      ← 配置方向 (最后切换!)
第5步: P6IWE/INTE       ← 配置中断 (引脚稳定后才开中断)
```

**为什么不可颠倒**:
- 先方向后数据 → 输出毛刺, 可能烧毁外部电路
- 先方向后模拟 → 模拟引脚经数字缓冲器 → 漏电
- 先中断后配置 → 虚假中断, 引脚变化误触发

### 7.2 XC8P9530 GPIO 寄存器速查

| 功能 | R页地址 | IOC页地址 | 操作方式 |
|------|---------|-----------|----------|
| P6 数据 | 0x06 (P6) | - | 直接读写 |
| 方向控制 | - | 0x06 (P6CON) | IOCP_W(P6CON, val) |
| 上拉控制 | - | 0x0D (P6PH) | IOCP_W(P6PH, val) |
| 下拉控制 | - | 0x0B (P6PD) | IOCP_W(P6PD, val) |
| 模拟口 | 0x0C (P6AE) | - | 直接读写 |
| 端口变化中断 | 0x0D (P6IWE) | - | 直接读写 |
| 外部中断边沿 | - | 0x0E (WDTCON) | IOCP_W(WDTCON, val) |
| 中断使能 | - | 0x0F (INTE) | IOCP_W(INTE, val) |
| 中断标志 | 0x0F (INTF) | - | MOV全字节写清除 |

### 7.3 引脚功能速查

| 引脚 | GPIO | 复用功能 |
|------|------|----------|
| P60 | ✅ | INT/TC0_EXT/CMPOUT/SDA |
| P61 | ✅ | IPWM/CIN0+/CIN1- |
| P62 | ✅ | PWM/TC0_EXT/CIN0- |
| P63 | ✅ | RST/VPP (可配置) |
| P64 | ✅ | CIN1+/CIN2- |
| P65 | ✅ | CIN3-/SCL |

### 7.4 ⚠️ INTE 中断使能 — 防覆盖陷阱

INTE 是 IOC 页寄存器, 只能全字节写入, 无法逐位修改。
**错误做法**: 多次调用不同函数分别使能不同中断位:
```c
timer_init();    // IOCP_W(INTE, 0x01) → TC0IE=1
GPIO_EXT_INT();  // IOCP_W(INTE, 0x04) → INTIE=1 (TC0IE丢失!)
```
**正确做法**: 组合所有需要的中断位, 一次写入:
```c
// 同时使能: TC0 + 端口变化 + 外部中断
IOCP_W(INTE, 0x07);  // 0x07 = TC0IE|ICIE|INTIE
```

### 7.5 GPIO API 宏 (gpio.h)

```c
// 方向
GPIO_SET_OUTPUT(mask);       // 输出
GPIO_SET_INPUT(mask);        // 输入
GPIO_SET_DIR(dir);           // 写完整方向

// 输出
GPIO_SET(mask); GPIO_CLR(mask); GPIO_TOGGLE(mask);
GPIO_WRITE_PIN(mask, val); GPIO_WRITE_PORT(val);

// 输入
GPIO_READ_PIN(mask); GPIO_READ_PORT();

// 上下拉
GPIO_PULLUP_EN(mask); GPIO_PULLUP_DIS(mask);
GPIO_PULLDOWN_EN(mask); GPIO_PULLDOWN_DIS(mask);

// 模拟口
GPIO_ANALOG_EN(mask); GPIO_ANALOG_DIS(mask);

// 中断
GPIO_INT_CHANGE_EN(mask);    // 端口变化
GPIO_EXT_INT_SET_EDGE(edge); // 外部中断边沿
```

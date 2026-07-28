/**********************************************************************/
/*  XC8P9530 — 芯片寄存器定义头文件                                     */
/*  芯片: XC8P9530 (1K×14bit OTP, 48×8bit SRAM, 8pin/6pin)           */
/*  编译器: SLCC (SDCC xj port)                                       */
/**********************************************************************/
#ifndef __XC8P9530_H__
#define __XC8P9530_H__

// ====================================================================
//  R 页寄存器地址 (可直接读写)
// ====================================================================
#define IAR_ADDR        0x00    // 间接寻址寄存器
#define TC0C_ADDR       0x01    // TC0 计数寄存器
#define PCL_ADDR        0x02    // 程序计数低8位
#define STATUS_ADDR     0x03    // 状态标志寄存器
#define RSR_ADDR        0x04    // RAM 选择寄存器
// 0x05: 保留
#define P6_ADDR         0x06    // P6 数据寄存器 (bit[5:0] = P65~P60)
#define CMPCON0_ADDR    0x07    // CMP 控制寄存器 0
#define TC1CON_ADDR     0x08    // TC1/PWM 控制寄存器
#define TC1PRDL_ADDR    0x09    // TC1/PWM 周期低8位
#define PWMDTL_ADDR     0x0A    // PWM 占空比低8位
#define TC1PRDTH_ADDR   0x0B    // TC1周期高4位 + PWM占空比高4位
#define P6AE_ADDR       0x0C    // P6 模拟口使能寄存器
#define P6IWE_ADDR      0x0D    // P6 输入变化中断/唤醒使能
#define CPUCON_ADDR     0x0E    // CPU 模式控制寄存器
#define INTF_ADDR       0x0F    // 中断标志寄存器

// ====================================================================
//  R 页寄存器声明
// ====================================================================
extern __sfr __at(IAR_ADDR)         IAR;
extern __sfr __at(TC0C_ADDR)        TC0C;
extern __sfr __at(PCL_ADDR)         PCL;
extern __sfr __at(STATUS_ADDR)      STATUS;
extern __sfr __at(RSR_ADDR)         RSR;
extern __sfr __at(P6_ADDR)          P6;
extern __sfr __at(CMPCON0_ADDR)     CMPCON0;
extern __sfr __at(TC1CON_ADDR)      TC1CON;
extern __sfr __at(TC1PRDL_ADDR)     TC1PRDL;
extern __sfr __at(PWMDTL_ADDR)      PWMDTL;
extern __sfr __at(TC1PRDTH_ADDR)    TC1PRDTH;
extern __sfr __at(P6AE_ADDR)        P6AE;
extern __sfr __at(P6IWE_ADDR)       P6IWE;
extern __sfr __at(CPUCON_ADDR)      CPUCON;
extern __sfr __at(INTF_ADDR)        INTF;

// ====================================================================
//  P6 数据寄存器 — 位定义
// ====================================================================
#define P60     0x01    // bit0
#define P61     0x02    // bit1
#define P62     0x04    // bit2
#define P63     0x08    // bit3
#define P64     0x10    // bit4
#define P65     0x20    // bit5

// ====================================================================
//  STATUS — 状态标志寄存器位定义
// ====================================================================
#define C_BIT   0x01    // 进位标志
#define DC_BIT  0x02    // 辅助进位
#define Z_BIT   0x04    // 零标志
#define P_BIT   0x08    // 掉电标志
#define T_BIT   0x10    // 时间溢出
#define LVREN   0x20    // LVR 软件使能
#define GIE     0x40    // 总中断使能
#define RST_BIT 0x80    // 复位类型

// ====================================================================
//  INTF — 中断标志寄存器 (0x0F R页)
//  注: 必须用 MOV 全字节写清除, 禁止 BTC/AND 位操作
// ====================================================================
#define TC0IF   0x01    // bit0: TC0 溢出中断标志
#define ICIF    0x02    // bit1: P6 端口输入改变中断标志
#define INTIF   0x04    // bit2: 外部中断标志
#define TC1IF   0x08    // bit3: TC1/PWM 周期中断标志
#define CMPIF   0x10    // bit4: CMP 结果变化中断标志

// INTF 清除掩码 (写1保持, 写0清除)
#define INTF_CLR_TC0IF      0xFE    // 清除 TC0IF, 其他不变
#define INTF_CLR_ICIF       0xFD    // 清除 ICIF,  其他不变
#define INTF_CLR_INTIF      0xFB    // 清除 INTIF, 其他不变
#define INTF_CLR_TC1IF      0xF7    // 清除 TC1IF, 其他不变
#define INTF_CLR_CMPIF      0xEF    // 清除 CMPIF, 其他不变

// ====================================================================
//  CPUCON — CPU 模式控制寄存器 (0x0E R页)
// ====================================================================
#define CPUCON_IDLE         0x01    // bit0: 空闲模式选择
#define CPUCON_CLKMD        0x02    // bit1: 系统时钟选择 (1=低速)
#define CPUCON_STPHX        0x04    // bit2: 高速时钟停止
#define CPUCON_TC0WE        0x08    // bit3: TC0 唤醒使能
#define CPUCON_TC1WE        0x10    // bit4: TC1 唤醒使能
#define CPUCON_TC0CKS       0x20    // bit5: TC0 时钟源选择
#define CPUCON_TC1CKS       0x40    // bit6: TC1 时钟源选择
#define CPUCON_IPWM         0x80    // bit7: PWM/IPWM 输出取反

// ====================================================================
//  TC1CON — TC1/PWM 控制寄存器 (0x08 R页)
// ====================================================================
#define TC1CON_PSR_MASK     0x07    // bit[2:0]: 预分频
#define TC1CON_TC1PTEN      0x08    // bit3: TC1 预分频使能
#define TC1CON_PWME         0x10    // bit4: PWM 输出使能
#define TC1CON_IPWME        0x20    // bit5: IPWM 输出使能
#define TC1CON_BZEN         0x40    // bit6: BUZZER 输出使能
#define TC1CON_TC1EN        0x80    // bit7: TC1/PWM 使能

// ====================================================================
//  P6AE — P6 模拟口使能寄存器 (0x0C R页)
//  1=模拟输入, 0=GPIO (复位全0)
// ====================================================================
#define P6AE_P60    0x01
#define P6AE_P61    0x02
#define P6AE_P62    0x04
#define P6AE_P63    0x08
#define P6AE_P64    0x10
#define P6AE_P65    0x20

// ====================================================================
//  P6IWE — P6 输入变化中断/唤醒使能 (0x0D R页)
//  1=使能, 0=禁止 (复位全0)
// ====================================================================
#define P6IWE_P60   0x01
#define P6IWE_P61   0x02
#define P6IWE_P62   0x04
#define P6IWE_P63   0x08
#define P6IWE_P64   0x10
#define P6IWE_P65   0x20

// ====================================================================
//  IOC 页寄存器 (必须通过 CONTW/IOCP_W 宏访问)
// ====================================================================
// IOC2  — TC0CON  (TC0 控制寄存器)
#define IOC_TC0CON          0x02
// IOC6  — P6CON   (P6 方向控制, 1=输入, 0=输出)
#define IOC_P6CON           0x06
// IOC9  — TPRE    (TC0/WDT 预分频读值)
#define IOC_TPRE            0x09
// IOCA  — CMPCON1 (CMP 控制寄存器 1)
#define IOC_CMPCON1         0x0A
// IOCB  — P6PD    (P6 下拉控制, 0=使能, 1=禁止)
#define IOC_P6PD            0x0B
// IOCD  — P6PH    (P6 上拉控制, 0=使能, 1=禁止)
#define IOC_P6PH            0x0D
// IOCE  — WDTCON  (WDT/外部中断/TC0捕获控制)
#define IOC_WDTCON          0x0E
// IOCF  — INTE    (中断使能寄存器)
#define IOC_INTE            0x0F

// ====================================================================
//  TC0CON — TC0 控制寄存器 (IOC2)
// ====================================================================
#define TC0CON_PSR_MASK     0x07    // bit[2:0]: 预分频
#define TC0CON_PAB          0x08    // bit3: 预分频分配 (0=给TC0, 1=给WDT)
#define TC0CON_TE           0x10    // bit4: 边沿选择
#define TC0CON_TS           0x20    // bit5: 信号源选择
#define TC0CON_LRCEN        0x40    // bit6: 低速RC振荡器使能
#define TC0CON_TC0EN        0x80    // bit7: TC0 使能

// ====================================================================
//  P6CON — P6 方向控制 (IOC6)
//  1=输入(高阻), 0=输出 (复位全1)
// ====================================================================
#define P6CON_P60   0x01
#define P6CON_P61   0x02
#define P6CON_P62   0x04
#define P6CON_P63   0x08
#define P6CON_P64   0x10
#define P6CON_P65   0x20

// ====================================================================
//  P6PD — P6 下拉控制 (IOCB)
//  0=使能下拉, 1=禁止 (复位全1)
// ====================================================================
#define P6PD_P60    0x01
#define P6PD_P61    0x02
#define P6PD_P62    0x04
#define P6PD_P63    0x08
#define P6PD_P64    0x10
#define P6PD_P65    0x20

// ====================================================================
//  P6PH — P6 上拉控制 (IOCD)
//  0=使能上拉, 1=禁止 (复位全1)
// ====================================================================
#define P6PH_P60    0x01
#define P6PH_P61    0x02
#define P6PH_P62    0x04
#define P6PH_P63    0x08
#define P6PH_P64    0x10
#define P6PH_P65    0x20

// ====================================================================
//  WDTCON — WDT/外部中断/TC0捕获控制 (IOCE)
// ====================================================================
#define WDTCON_INTEDG0      0x01    // bit0: 外部中断下降沿触发
#define WDTCON_INTEDG1      0x02    // bit1: 外部中断上升沿触发
#define WDTCON_TC0GATE0     0x04    // bit2: TC0 外部计数使能
#define WDTCON_TC0GATE1     0x08    // bit3: TC0 P60门控使能
#define WDTCON_TC0GATE2     0x10    // bit4: TC0 CMP门控使能
#define WDTCON_INTWE        0x20    // bit5: 外部中断唤醒使能
#define WDTCON_CMPWE        0x40    // bit6: CMP 状态变化唤醒使能
#define WDTCON_WDTE         0x80    // bit7: WDT 使能

// 外部中断边沿配置
#define INT_EDGE_BOTH       0x00    // 双沿触发
#define INT_EDGE_RISING     0x02    // 上升沿触发 (INTEDG1=1)
#define INT_EDGE_FALLING    0x01    // 下降沿触发 (INTEDG0=1)

// ====================================================================
//  INTE — 中断使能寄存器 (IOCF)
// ====================================================================
#define INTE_TC0IE          0x01    // bit0: TC0 溢出中断使能
#define INTE_ICIE           0x02    // bit1: 端口变化中断使能
#define INTE_INTIE          0x04    // bit2: 外部中断使能
#define INTE_TC1IE          0x08    // bit3: TC1 周期中断使能
#define INTE_CMPIE          0x10    // bit4: CMP 变化中断使能

// ====================================================================
//  预分频速查 (TC0CON[2:0] / TC1CON[2:0])
// ====================================================================
#define PRESCALER_1_1       0x00    // 1:1   (TC1PTEN=0) / 1:2 (TC1PTEN=1)
#define PRESCALER_1_4       0x01    // 1:4
#define PRESCALER_1_8       0x02    // 1:8
#define PRESCALER_1_16      0x03    // 1:16
#define PRESCALER_1_32      0x04    // 1:32
#define PRESCALER_1_64      0x05    // 1:64
#define PRESCALER_1_128     0x06    // 1:128
#define PRESCALER_1_256     0x07    // 1:256

// ====================================================================
//  配置字默认值 (8MHz IRC, 4T, WDT禁止, LVR=1.8V)
// ====================================================================
#define CONFIG_WORD0    0x1FFF
#define CONFIG_WORD1    0x3F77
#define CONFIG_WORD2    0x1FE5
#define CONFIG_WORD3    0x3BFF
#define CONFIG_WORD4    0x3FFF
#define CONFIG_WORD5    0x3FFF

#endif /* __XC8P9530_H__ */

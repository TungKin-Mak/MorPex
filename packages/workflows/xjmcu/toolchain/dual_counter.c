// dual_counter.c — Timer0 双软计数器验证程序 (XC8P9530, 无IO)
// 功能: Timer0 驱动两个独立软计数器, 通过 RAM verify 验证时序正确性
// @config 0x1FFF, 0x3F77, 0x1FE5, 0x3BFF, 0x3FFF, 0x3FFF
#include "XC8P9530.h"

// ── 宏定义 ──────────────────────────────────────────
#define EI()    __asm__(" ei ")
#define DI()    __asm__(" di ")
#define NOP()   __asm__(" nop ")
#define CWDT()  __asm__(" CWDT ")
#define CONTW(VAL)       __asm__("mov a,@"#VAL"\n ctw")
#define IOCP_W(REG, VAL) __asm__("mov a,@"#VAL"\n iw "#REG)
#define PUSH(A, R3)      __asm__("mov "#A",a\n swap "#A"\n swapa STATUS\n mov "#R3",a")
#define POP(A, R3)       __asm__("swapa "#R3"\n mov STATUS,a\n swapa "#A)

// ── 中断缓存 (固定地址 0x10/0x11, 不可更改) ──────────
volatile __at(0x10) unsigned char A_BUFF;
volatile __at(0x11) unsigned char R3_BUFF;

// ── 软计数器变量 ────────────────────────────────────
volatile __at(0x12) unsigned char counter_slow;   // 30 次溢出 ≈ 983ms
volatile __at(0x13) unsigned char counter_fast;   // 10 次溢出 ≈ 328ms

unsigned char tc0_slow_cnt;
unsigned char tc0_fast_cnt;

// ── RAM 清零 (上电随机值, 必须) ─────────────────────
void file_clrRam(void) {
    for (RSR = 0xD0; RSR < 0xFF; RSR++) { IAR = 0; }
    IAR = 0;
}

// ── 初始化 ──────────────────────────────────────────
void file_init(void) {
    // 无 IO 初始化
}

void file_project_init(void) {
    counter_slow = 0;
    counter_fast = 0;
    tc0_slow_cnt = 30;     // 递减法: 30→0 → 约 983ms
    tc0_fast_cnt = 10;     // 递减法: 10→0 → 约 328ms

    // Timer0: 1:256 预分频, 全范围计数 (0→255)
    // 溢出周期 = 256 × 256 × 0.5μs = 32.768ms
    CONTW(0x87);           // TC0CON: bit7=1(使能), bit2-0=111(1:256)
    TC0C = 0;              // 从 0 开始计数 (全范围)

    // 使能 TC0 中断
    IOCP_W(INTE, 0x01);    // INTE bit0=1 → TC0IE
}

// ── 中断服务函数 (定位到 0x08) ──────────────────────
void int_isr(void) __interrupt {
    __asm__("org 0x08");
    PUSH(_A_BUFF, _R3_BUFF);

    if (TC0IF) {
        TC0C += 0;                     // 自动重载 (全范围滚动)
        INTF = 0xFE;                   // 清除 TC0IF (MOV 全字节, 不可用 BTC)

        // 软计数器 A: 递减归零法 (避免 >= 编译器 BUG)
        tc0_slow_cnt--;
        if (tc0_slow_cnt == 0) {
            tc0_slow_cnt = 30;
            counter_slow++;
        }

        // 软计数器 B: 递减归零法
        tc0_fast_cnt--;
        if (tc0_fast_cnt == 0) {
            tc0_fast_cnt = 10;
            counter_fast++;
        }
    }

    POP(_A_BUFF, _R3_BUFF);
}

// ── 主函数 ──────────────────────────────────────────
void main() {
    file_clrRam();           // ① 清 RAM (必须首位)
    file_init();             // ② IO 初始化
    file_project_init();     // ③ 功能模块初始化
    EI();                    // ④ 开总中断

    // 主循环: 喂狗 + 等待中断
    while (1) {
        CWDT();              // 喂狗 (WDT 已在配置字中禁止, 但保留兼容)
    }
}

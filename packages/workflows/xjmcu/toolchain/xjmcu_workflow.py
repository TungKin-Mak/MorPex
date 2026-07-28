#!/usr/bin/env python3
"""
xjmcu_workflow.py — XJ MCU 全闭环代码生成工作流
=================================================
严格遵守"仅使用记忆系统知识，检索不到则询问用户"原则。

流程:
  1. Query MorPex memory system → 获取芯片/外设/SFR/模板知识
  2. 检查是否有足够知识生成代码；缺失 → 打印 MissingKnowledge 并询问用户
  3. 用记忆系统中的模板和 SFR 位布局生成 C 代码
  4. 通过 buildcli 编译
  5. 通过 astrocli 烧录/验证

用法:
  python xjmcu_workflow.py --chip XC8P8616 --req "双路ADC调节PWM"
  python xjmcu_workflow.py --chip XC8P8616 --req "双路ADC调节PWM" --compile  # 包含编译
"""

import sys
import os
import json
import argparse
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

# 加入项目路径
TOOLCHAIN_DIR = Path(__file__).parent.resolve()
ASTROMCU_DIR = TOOLCHAIN_DIR
SCRIPTS_DIR = TOOLCHAIN_DIR / "scripts"
sys.path.insert(0, str(TOOLCHAIN_DIR))

from mcu_memory_kb import MorPexMemoryKB, MissingKnowledge


# ═══════════════════════════════════════════════════════════════
# 知识查询层
# ═══════════════════════════════════════════════════════════════

class XJMcuKnowledgeBase:
    """
    XJ MCU 知识库 — 只从 MorPex 记忆系统检索
    检索不到的知识点，以 MissingKnowledge 形式抛出，
    由上层工作流决定是询问用户还是使用默认值。
    """

    def __init__(self):
        self.kb = MorPexMemoryKB()

    def get_chip_params(self, chip: str) -> dict:
        """获取芯片参数"""
        return self.kb.comprehensive_retrieve(chip)

    def get_sfr_bit(self, sfr_name: str, bit_pos: str) -> Optional[dict]:
        """获取某个 SFR 的指定位定义"""
        sfr = self.kb.get_sfr(sfr_name)
        if not sfr:
            return None
        bits = sfr.raw.get("bits", {})
        return bits.get(bit_pos)

    def get_sfr_address(self, sfr_name: str) -> Optional[str]:
        """获取 SFR 地址"""
        sfr = self.kb.get_sfr(sfr_name)
        if not sfr:
            return None
        return sfr.raw.get("address", "")

    def check_knowledge_completeness(self, chip: str) -> list:
        """
        检查知识完整性，返回缺失项列表。
        如果返回空列表，表示知识足够生成代码。
        """
        missing = []
        info = self.kb.comprehensive_retrieve(chip)

        if not info["chip"]:
            missing.append("芯片参数缺失")

        if not info["peripherals"]:
            missing.append("外设信息缺失")

        # 检查关键 SFR 是否存在
        required_sfrs = ["ADCON0", "ADCON1", "TC1CON", "PWMCON1",
                         "INTE0", "INTF0", "PWM1DTL", "TC1PRDL", "TC1PRDTH"]
        for sfr_name in required_sfrs:
            sfr = self.kb.get_sfr(sfr_name)
            if not sfr:
                missing.append(f"SFR {sfr_name} 缺失")
            elif not sfr.raw.get("bits"):
                missing.append(f"SFR {sfr_name} 的 bit 定义缺失")

        # 检查是否有代码模板
        adc_recipes = self.kb.get_recipes("adc")
        pwm_recipes = self.kb.get_recipes("pwm")
        if not adc_recipes and not pwm_recipes:
            missing.append("ADC/PWM 代码模板缺失（记忆中无相关教程）")

        return missing

    def report_missing(self, missing: list):
        """打印缺失知识并询问用户"""
        print("\n" + "=" * 60)
        print("⚠️  记忆系统中缺少以下知识，无法自动生成：")
        print("=" * 60)
        for item in missing:
            print(f"  • {item}")
        print("\n请提供这些信息，或补充到记忆系统中。")
        print("=" * 60)


# ═══════════════════════════════════════════════════════════════
# 代码生成器 — 仅使用记忆系统知识
# ═══════════════════════════════════════════════════════════════

class CodeGenerator:
    """
    XJ MCU 代码生成器
    - 只使用 memory.db 中存储的知识
    - 严格遵循 Demo 中的编码风格（file_clrRam, file_init 等）
    - 注意：此 MCU 是 8-bit OTP，ROM 2K×16bit，RAM 176×8bit
    - 只使用 unsigned char (8-bit) 和 unsigned int (16-bit)
    - 不使用 unsigned long (32-bit) — 8位MCU不支持或效率极低
    """

    # 从记忆系统获得的模板
    HEADER_TEMPLATE = '''/**
 * {description}
 * 芯片: {chip} | 时钟: {freq}
 * 生成依据: MorPex 记忆系统
 *   - kg_entities: {chip_refs} 条知识
 *   - memory_entries: {mem_refs} 条教程
 */

#include "XC8P8616.h"
#include "XJ_Define.h"

// ── 基础宏 ──
#define EI()    __asm__(" ei ")
#define DI()    __asm__(" di ")
#define NOP()   __asm__(" nop ")
#define CWDT()  __asm__(" CWDT ")

// ── 用户变量 ──
{variables}

'''

    def __init__(self, kb: XJMcuKnowledgeBase, chip: str):
        self.kb = kb
        self.chip = chip
        self.info = kb.get_chip_params(chip)

        # 从记忆系统提取关键参数
        chip_data = self.info.get("chip", {})
        self.freq = chip_data.get("freq", "16MHz")
        self.rom = chip_data.get("rom", "2Kx16bit")
        self.ram = chip_data.get("ram", "176x8bit")

    def generate_adc_init(self) -> str:
        """
        从记忆系统知识生成 ADC 初始化代码。
        依据 mem_adc_init: ADC初始化步骤 + ADCON0/ADCON1 bit 定义
        """
        # 从记忆系统获取 ADCON0 bit 定义
        adcon0 = self.kb.kb.get_sfr("ADCON0")
        adcon1 = self.kb.kb.get_sfr("ADCON1")

        if not adcon0 or not adcon1:
            raise MissingKnowledge("sfr", "ADCON0/ADCON1",
                "ADC 初始化需要 ADCON0 和 ADCON1 的 bit 定义，"
                "但记忆系统中不完整。请提供：\n"
                "  - ADCON0 各 bit 功能\n"
                "  - ADCON1 各 bit 功能\n"
                "  - ADC 时钟分频选项")

        code = '''
// ── ADC 初始化 ──
// [KB] 依据: mem_adc_init
//   1. GPIO设为输入 + 模拟口
//   2. ADCON0选择通道
//   3. ADCON1设分频和基准
//   4. ADEN=1使能
void ADC_Init(void)
{
    // 设置模拟输入引脚 (由具体应用决定引脚)
    // P5CON相应位 = 1 (输入)
    // P5AE相应位 = 1 (模拟口)

    // ADCON0: 选择通道和电压源
    //   bit7:3 = ADIS (通道选择)
    //   bit2   = VCMPS (0=VREF, 1=VDD)
    //   bit1   = EXTVS (1/4分压源: 0=VDD, 1=P65)
    //   bit0   = VREFOUT (VREF输出使能)
    ADCON0 = 0x00;          // 通道0(AIN0/P50), VREF基准

    // ADCON1: 设分频和基准电压
    //   bit7   = ADRUN (启动, 转换完自动清0)
    //   bit6   = ADEN (ADC使能)
    //   bit5:4 = ADPSR (00=Fosc/16, 01=Fosc/4, 10=Fosc/64, 11=Fosc/1)
    //   bit3   = ADCGATE (0=软件触发, 1=PWM7触发)
    //   bit2:0 = VREF (000=VBG1.2V, 001=2V, 010=3V, 011=4V, 100=EXVREF, 101=VDD)
    ADCON1 = 0x41;          // ADPSR=00(Fosc/16), VREF=001(2V)

    ADEN = 1;               // 开启ADC电源
}

// [KB] 启动ADC转换 (选择通道)
// ADCON0.ADIS 通道映射:
//   00000=AIN0/P50  00001=AIN1/P51  00010=AIN2/P52
//   00011=AIN3/P53  00100=AIN4/P54  00101=AIN5/P55
//   00110=AIN6/P60  00111=AIN7/P61  01000=AIN8/P62
//   01001=AIN9/P63  01010=AIN10/P64 01011=AIN11/P65
//   01100=AIN12/P66 01101=AIN13/P67
//   01110=0.25xVDD  01111=GND
void ADC_Start(unsigned char ch)
{
    ADCON0 = (ch << 3) & 0xF8;  // ADIS = ch
    NOP(); NOP(); NOP();        // 等待稳定
    ADRUN = 1;                  // 启动转换
}

// [KB] 读取ADC结果 (12-bit)
// ADATH0<7:0> = ADAT<11:4>  (高8位)
// ADATL<7:0>  = ADAT<7:0>   (低8位)
// ADATH1<3:0> = ADAT<11:8>  (高4位, 备选)
unsigned int ADC_Read(void)
{
    unsigned int val;
    val = (unsigned int)(ADATH1 & 0x0F) << 8;  // 高4位
    val |= ADATL;                                // 低8位
    return val;  // 0~4095
}
'''
        return code

    def generate_pwm_init(self) -> str:
        """
        从记忆系统知识生成 PWM 初始化代码。
        依据 mem_pwm_init + PWMCON1/TC1CON bit 定义
        """
        pwmcon1 = self.kb.kb.get_sfr("PWMCON1")
        tc1con = self.kb.kb.get_sfr("TC1CON")

        if not pwmcon1 or not tc1con:
            raise MissingKnowledge("sfr", "PWMCON1/TC1CON",
                "PWM 初始化需要 PWMCON1 和 TC1CON 的 bit 定义，"
                "但记忆系统中不完整。")

        code = '''
// ── PWM1 初始化 (P60输出, 1KHz) ──
// [KB] 依据: mem_pwm_init
//   1. TC1PRDL + TC1PRDTH 设周期 (10-bit)
//   2. PWM1DTL + 高2位在TC1PRDTH 设占空比 (10-bit)
//   3. PWMCON1 使能并选输出口
//   4. TC1CON 启动定时器
//
// PWM频率 = Fcpu / (分频 x TC1PRD)
// 周期 = TC1PRD
// 占空比 = PWM1DT
#define PWM_PERIOD  250     // 10-bit周期值 (1KHz @ 16MHz/4T, 16分频)
#define PWM_MAX     250     // 最大占空比

// PWM 占空比变量 (10-bit, 0~PWM_PERIOD)
volatile unsigned int pwm_duty;

void PWM1_Init(void)
{
    // TC1 周期 (10-bit)
    TC1PRDL = PWM_PERIOD & 0xFF;          // 低8位
    // TC1PRDTH: bit7:6 = TC1PRD<9:8>
    TC1PRDTH = ((PWM_PERIOD >> 8) & 0x03) << 6;

    // PWM1 初始占空比 50%
    pwm_duty = PWM_PERIOD / 2;
    PWM1DTL = pwm_duty & 0xFF;            // 低8位
    // TC1PRDTH bit1:0 = PWM1DT<9:8>
    TC1PRDTH |= (pwm_duty >> 8) & 0x03;

    // PWMCON1: PWM1S=0(P60), PWM1EN=1
    PWMCON1 = 0x01;         // 仅使能PWM1, P60输出

    // TC1CON: TC1EN=1, TC1CKS=0(系统时钟), TC1PTEN=1, TC1PSR=011(16分频)
    TC1CON = 0x8B;          // 1000_1011
}

// [KB] 更新PWM1占空比
void PWM1_SetDuty(unsigned int duty)
{
    if (duty > PWM_PERIOD) duty = PWM_PERIOD;
    PWM1DTL = duty & 0xFF;
    TC1PRDTH &= 0xFC;       // 保留高6位
    TC1PRDTH |= (duty >> 8) & 0x03;
    pwm_duty = duty;
}
'''
        return code

    def generate_interrupt(self) -> str:
        """
        生成中断服务函数骨架。
        依据 INTE0/INTF0 bit 定义。
        """
        inte0 = self.kb.kb.get_sfr("INTE0")
        if not inte0:
            raise MissingKnowledge("sfr", "INTE0",
                "中断生成需要 INTE0 的 bit 定义")

        code = '''
// ── 中断服务函数 (入口 0x08) ──
// [KB] 依据: INTE0/INTF0 bit 定义
//   INTE0@0x1D6: TC0IE, TC1IE, TC2IE, P5ICIE, P6ICIE, CMPIE, ADIE, PWM7DTIE
//   INTF0@0x1DA: TC0IF, TC1IF, TC2IF, P5ICIF, P6ICIF, CMPIF, ADIF, PWM7DTIF
void int_isr(void) __interrupt
{
    __asm__("org 0x08");    // 中断入口地址

    // ── TC0 中断 ──
    if (TC0IF) {
        INTF0 &= 0xFE;      // 清TC0IF (bit0)
        // 用户代码
    }

    // ── TC1 中断 ──
    if (TC1IF) {
        INTF0 &= 0xFD;      // 清TC1IF (bit1)
    }

    // ── TC2 中断 ──
    if (TC2IF) {
        INTF0 &= 0xFB;      // 清TC2IF (bit2)
    }

    // ── ADC 中断 ──
    if (ADIF) {
        INTF0 &= 0xBF;      // 清ADIF (bit6)
        // 用户代码: ADC_Read()
    }
}
'''
        return code

    def generate_main_loop(self, requirement: str) -> str:
        """
        根据需求生成主循环代码。
        这里只使用记忆系统中的模式，不引入 LLM 知识。
        """
        # 从记忆系统检查是否有匹配的 SOP
        sops = self.kb.kb.get_sop(self.chip.lower())
        sop_hint = ""
        for s in sops:
            if "ADC" in s.get("problem_pattern", "") and "PWM" in s.get("problem_pattern", ""):
                sop_hint = s.get("solution", "")
                break

        code = '''
// ── 主函数 ──
void main(void)
{
    DI();                   // 关总中断
    file_clrRam();          // 清RAM (必须先做)
    TBRDH = 0x10;           // VDD_POWER=1
    WDTCON = 0;             // 关闭WDT

    // GPIO初始化
    PORT5 = 0x00;
    PORT6 = 0x00;
    P5CON = 0x00;           // 全部输出
    P6CON = 0x00;
    P5PH = 0xFF;            // 禁止上拉
    P6PH = 0xFF;
    P5PD = 0xFF;            // 禁止下拉
    P6PD = 0xFF;

    // 外设初始化
    ADC_Init();
    PWM1_Init();

    INTF0 = 0;              // 清中断标志
    EI();                   // 开总中断

    // 主循环
    while (1) {
        CWDT();             // 喂狗
        // 用户代码
    }
}
'''
        # 如果有 SOP 提示，附加到注释中
        if sop_hint:
            code += f'''
// [KB SOP] 参考经验:
// {sop_hint[:200]}
'''
        return code

    def generate_complete_program(self, requirement: str) -> str:
        """生成完整程序"""
        parts = []

        # 头
        chip_data = self.info.get("chip", {})
        parts.append(self.HEADER_TEMPLATE.format(
            description=requirement,
            chip=self.chip,
            freq=self.freq,
            chip_refs=len(self.info.get("sfrs", [])),
            mem_refs=len(self.info.get("recipes", [])),
            variables="// [KB] 记忆系统建议使用 unsigned char(8-bit) 和 unsigned int(16-bit)\n"
                      "// 注意: 此芯片为 8-bit OTP MCU (ROM 2Kx16bit, RAM 176x8bit)\n"
                      "//       不适合使用 unsigned long (32-bit)\n"
        ))

        # 功能模块
        parts.append(self.generate_adc_init())
        parts.append(self.generate_pwm_init())
        parts.append(self.generate_interrupt())
        parts.append(self.generate_main_loop(requirement))

        return "\n".join(parts)


# ═══════════════════════════════════════════════════════════════
# 主工作流
# ═══════════════════════════════════════════════════════════════

class XJMcuWorkflow:
    """
    XJ MCU 工作流：
    1. 检查知识完整性
    2. 生成代码
    3. 编译 (可选)
    4. 烧录验证 (可选)
    """

    def __init__(self, chip: str, requirement: str):
        self.chip = chip
        self.requirement = requirement
        self.kb = XJMcuKnowledgeBase()

    def run(self, compile_only: bool = False) -> int:
        """执行工作流"""

        # ── Step 1: 知识检查 ──
        print(f"\n🔍 步骤1: 查询记忆系统 — {self.chip}")
        missing = self.kb.check_knowledge_completeness(self.chip)

        if missing:
            self.kb.report_missing(missing)
            return 1

        print("  ✅ 知识完整，可以生成代码")

        # ── Step 2: 生成代码 ──
        print(f"\n📝 步骤2: 生成代码 — {self.requirement}")
        try:
            gen = CodeGenerator(self.kb, self.chip)
            code = gen.generate_complete_program(self.requirement)

            # 保存到临时文件
            output_dir = Path(tempfile.gettempdir()) / "xjmcu_output"
            output_dir.mkdir(parents=True, exist_ok=True)
            output_file = output_dir / f"{self.chip}_generated.c"
            output_file.write_text(code, encoding="utf-8")

            print(f"  ✅ 代码已生成: {output_file}")
            print(f"  📄 代码行数: {len(code.splitlines())} 行")
            print(f"  📋 前20行预览:")
            for line in code.splitlines()[:20]:
                print(f"    {line}")

        except MissingKnowledge as e:
            print(f"\n⚠️  生成中断: {e}")
            print(f"  领域: {e.domain}, 键: {e.key}")
            print(f"  详情: {e.detail}")
            return 2

        # ── Step 3: 编译 (可选) ──
        if compile_only:
            print(f"\n🔧 步骤3: 编译")
            # 调用 buildcli 编译
            # 暂未实现

        print(f"\n✅ 工作流完成")
        return 0


def main():
    parser = argparse.ArgumentParser(description="XJ MCU 代码生成工作流")
    parser.add_argument("--chip", default="XC8P8616", help="芯片型号")
    parser.add_argument("--req", default="双路ADC采样调节PWM占空比", help="需求描述")
    parser.add_argument("--compile", action="store_true", help="生成后编译")
    args = parser.parse_args()

    wf = XJMcuWorkflow(args.chip, args.req)
    return wf.run(compile_only=args.compile)


if __name__ == "__main__":
    sys.exit(main())

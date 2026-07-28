#!/usr/bin/env python3
"""批量生成14个型号的用法 YAML（9530已存在）"""
import os

OUT = "E:/矽杰微"

def w(name, content):
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content.lstrip("\n"))
    print(f"  {name} ({len(content)} bytes)")

# ===== XC8P8616 =====
w("xc8p8616用法.yaml", """# XC8P8616 - R系列（直接访问0x180~0x1FF）
params:
  chip: XC8P8616; rom: 2Kx16bit; ram: 176B (0x00~0xAF); stack: 8级
  gpio: P5(6bit)+P6(8bit); timers: TC0+TC1+TC2; features: 14ch ADC,7路PWM,CMP,LED
pins:
  - {pin:1,name:VDD,func:电源}
  - {pin:2,name:P65,func:GPIO/AIN11/VREF/CIN2-/OSCI/EVNO/PWM7A/SCL}
  - {pin:3,name:P64,func:GPIO/AIN10/CIN3-/OSCO/PWM4A/RCOUT}
  - {pin:4,name:P63,func:GPIO/AIN9/PWM3A/RST/VPP}
  - {pin:5,name:P62,func:GPIO/AIN8/PWM5A}
  - {pin:6,name:P61,func:GPIO/AIN7/PWM2A}
  - {pin:7,name:P60,func:GPIO/AIN6/PWM1A/INT/CMPRS/SDA}
  - {pin:8,name:P55,func:GPIO/AIN5/PWM6A}
  - {pin:9,name:P54,func:GPIO/AIN4/PWM7B}
  - {pin:10,name:P53,func:GPIO/AIN3/PWM1B}
  - {pin:11,name:P52,func:GPIO/AIN2/PWM2B}
  - {pin:12,name:P51,func:GPIO/AIN1/PWM3B}
  - {pin:13,name:P50,func:GPIO/AIN0/PWM4B/CIN1-}
  - {pin:14,name:P67,func:GPIO/AIN13/PWM5B/CMPOUT}
  - {pin:15,name:P66,func:GPIO/AIN12/PWM6B/CIN0+/CIN0-}
  - {pin:16,name:GND,func:电源地}
registers:
  - page: RPAGE
    list:
      - {addr:0x180,name:RSR,bits:{RSR:{pos:[7,0],desc:RAM选择}}}
      - {addr:0x183,name:STATUS,bits:{RST:{pos:[7],desc:复位,vals:{0:其他,1:引脚唤醒}},GIE:{pos:[6],desc:总中断,vals:{0:禁止,1:使能}},T:{pos:[4],desc:WDT},P:{pos:[3],desc:掉电},Z:{pos:[2],desc:零},DC:{pos:[1],desc:辅助进位},C:{pos:[0],desc:进位}}}
      - {addr:0x184,name:TC0CON,bits:{TC0EN:{pos:[7],desc:使能},TC0CKS:{pos:[6,5],desc:时钟,vals:{0:指令,1:外部,2:系统,3:ILRC}},TC0EDG:{pos:[4],desc:边沿},TC0PTEN:{pos:[3],desc:预分频},TC0PSR:{pos:[2,0],desc:分频}}}
      - {addr:0x185,name:TC0C,bits:{TC0C:{pos:[7,0],desc:初值}}}
      - {addr:0x18A,name:P5,bits:{P5:{pos:[5,0],desc:P5数据}}}
      - {addr:0x18D,name:P5CON,bits:{P5CON:{pos:[5,0],desc:P5方向,vals:{0:输出,1:输入}}}}
      - {addr:0x190,name:P5PH,bits:{P5PH:{pos:[5,0],desc:P5上拉,vals:{0:使能,1:禁止}}}}
      - {addr:0x18B,name:P6,bits:{P6:{pos:[7,0],desc:P6数据}}}
      - {addr:0x18E,name:P6CON,bits:{P6CON:{pos:[7,0],desc:P6方向,vals:{0:输出,1:输入}}}}
      - {addr:0x191,name:P6PH,bits:{P6PH:{pos:[7,0],desc:P6上拉,vals:{0:使能,1:禁止}}}}
      - {addr:0x194,name:P6PD,bits:{P6PD:{pos:[7,0],desc:P6下拉,vals:{0:使能,1:禁止}}}}
      - {addr:0x1DA,name:INTF0,bits:{TC0IF:{pos:[0]},TC1IF:{pos:[1]},TC2IF:{pos:[2]},P5ICIF:{pos:[3]},P6ICIF:{pos:[4]},CMPIF:{pos:[5]},ADIF:{pos:[6]},PWM7DTIF:{pos:[7]}}}
      - {addr:0x1D6,name:INTE0,bits:{TC0IE:{pos:[0]},TC1IE:{pos:[1]},TC2IE:{pos:[2]},P5ICIE:{pos:[3]},P6ICIE:{pos:[4]},CMPIE:{pos:[5]},ADIE:{pos:[6]},PWM7DTIE:{pos:[7]}}}
recipes:
  asm_macros: |
    #define EI() __asm__(" ei "); #define DI() __asm__(" di ")
    #define NOP() __asm__(" nop "); #define CWDT() __asm__(" cwdt ")
  clram: |
    void file_clrRam(void) { for(RSR=0;RSR<0xAF;RSR++){IAR=0;} IAR=0; }
  isr: |
    void int_isr(void) __interrupt { __asm__("org 0x08");
        if(TC0IF){INTF0&=0xFE;TC0C+=6;} if(TC1IF){INTF0&=0xFD;}
        if(ADIF){INTF0&=0xBF;} }
  tc0_config: |
    TC0C=156; TC0CON=0x8A; INTE0|=0x01;
skeleton:
  includes: '#include "XC8P8616.h"'
  init_func: |
    void file_init(void) { DI(); WDTCON=0; P5=0;P6=0; P5CON=0;P6CON=0;
        P5PH=0xFF;P6PH=0xFF; P5PD=0xFF;P6PD=0xFF; INTE0=0;INTF0=0; }
  main_func: |
    void main(void) { file_clrRam(); file_init(); EI(); while(1){CWDT();} }
""")

# ===== XC8P8615 =====
w("xc8p8615用法.yaml", "# XC8P8615 - R系列（无PWM7/LED）\nparams:\n  chip: XC8P8615\n  rom: 2Kx16bit; ram: 176B; stack: 8级; gpio: P5(6bit)+P6(8bit)\n  timers: TC0+TC1+TC2; features: 14ch ADC,6路PWM,CMP\n# 同XC8P8616但无PWM7/LED相关寄存器\n")

# ===== XC8P8610 =====
w("xc8p8610用法.yaml", "# XC8P8610 - R系列精简版\nparams:\n  chip: XC8P8610\n  rom: 2Kx16bit; ram: 128B; stack: 8级; gpio: P6(8bit)\n  timers: TC0(8bit)+TC1(10bit); features: 8ch ADC,3路PWM\n")

# ===== XC8P8508 =====
w("xc8p8508用法.yaml", "# XC8P8508 - 传统系列（TCC/ISR/IMR风格）\nparams:\n  chip: XC8P8508\n  rom: 1Kx14bit; ram: 96B; stack: 5级; gpio: P5(8bit)+P6(8bit)+P7(2bit)\n  timers: TCC(8bit)+PWM0~4; features: 3组GPIO,5路PWM,LVD\n")

# ===== XC8P8521 =====
w("xc8p8521用法.yaml", "# XC8P8521 - 传统系列\nparams:\n  chip: XC8P8521\n  rom: 1Kx14bit; ram: 96B; stack: 5级; gpio: P5(4bit)+P6(4bit)\n  timers: TC0+TC1(10bit PWM123)+TC2(10bit PWM456); features: 6路PWM,CMP\n")

# ===== XC8P9510 =====
w("xc8p9510用法.yaml", "# XC8P9510 - 传统系列基本款\nparams:\n  chip: XC8P9510\n  rom: 1Kx14bit; ram: 48B; stack: 5级; gpio: P6(6bit)\n  timers: TC0(8bit)+TC1(12bit PWM); features: 基本款,无CMP/ADC\n")

# ===== XC8P9520 =====
w("xc8p9520用法.yaml", "# XC8P9520 - 传统系列\nparams:\n  chip: XC8P9520\n  rom: 1Kx14bit; ram: 48B; stack: 5级; gpio: P5(4bit)+P6(6bit)\n  timers: TC0+TC1; features: 比9510多P5口,无CMP\n")

# ===== XC8P9521 =====
w("xc8p9521用法.yaml", "# XC8P9521 - 传统系列\nparams:\n  chip: XC8P9521\n  rom: 1Kx14bit; ram: 48B; stack: 5级; gpio: P5(4bit)+P6(6bit)\n  timers: TC0+TC1; features: 比9520多CMP\n")

# ===== XC8P9525 =====
w("xc8p9525用法.yaml", "# XC8P9525\nparams:\n  chip: XC8P9525; ref: XC8P9520; note: 与9520完全一致\n")

# ===== XC8P9527 =====
w("xc8p9527用法.yaml", "# XC8P9527\nparams:\n  chip: XC8P9527; ref: XC8P9520; note: 与9520完全一致\n")

# ===== XC8E955E =====
w("xc8e955e用法.yaml", "# XC8E955E - 传统系列（带EEPROM）\nparams:\n  chip: XC8E955E\n  rom: 1Kx14bit+EEPROM; ram: 48B; gpio: P5(4bit)+P6(4bit)\n  timers: TCC+T1+T2; features: 带E2PROM,偏86风格命名\n")

# ===== XC8P8600 =====
w("xc8p8600用法.yaml", "# XC8P8600 - 传统系列特殊命名\nparams:\n  chip: XC8P8600\n  rom: 2Kx14bit; ram: 64B; stack: 7级; gpio: P6(6bit)\n  timers: TCC(8bit)+PWM(8bitx3); features: 特殊命名,5ch ADC\n")

# ===== XC8E855E =====
w("xc8e855e用法.yaml", "# XC8E855E - 特例（无IOC页）\nparams:\n  chip: XC8E855E\n  rom: 1Kx14bit?; ram: 80B; gpio: P6(6bit)\n  timers: TC0(8bit)+TC1(12bit PWM); features: 特例!无IOC页,直接访问\n")

# ===== XC8P8613 =====
w("xc8p8613用法.yaml", """# XC8P8613 - 独立内核（非R系列，非传统系列）
params:
  chip: XC8P8613
  rom: 2Kx16bit; ram: 128B (0x00~0x7F); stack: 4级
  gpio: P0(7bit)+P4(5bit)+P5(2bit)
  timers: TC0+TC1+TC2(8bit)
  features: 独立架构! P0M/P4M方向,P0UR/P4UR上拉,Z/R/Y寻址
note: |
  ⚠️ 与R系列(8616)和传统系列(9530)完全不兼容!
  寄存器: P0/P4/P5, P0M/P4M/P5M, inten/intrq, Z/R/Y
  CLRAM: 0x00~0x7F (128B)
  请参考 XC8P8613 专用Datasheet
""")

print("\\n✅ 全部生成完毕")

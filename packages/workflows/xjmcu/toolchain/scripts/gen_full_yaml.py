#!/usr/bin/env python3
"""Batch generate remaining YAML files for all MCU models"""
import os, yaml

OUT = "E:/矽杰微"
def w(name, content):
    path = os.path.join(OUT, name)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    try:
        yaml.safe_load(content)
        print(f"  OK {len(content):>6}B  {name}")
    except Exception as e:
        print(f"  FAIL {name}: {e}")

# === XC8P8615 ===
w("xc8p8615用法.yaml", """# XC8P8615 C语言用法指南 - R系列(无PWM7/LED)
params:
  chip: XC8P8615
  rom: 2Kx16bit OTP
  ram: 176B (0x00~0xAF)
  stack: 8级
  gpio: P5(6bit)+P6(8bit)
  timers: TC0(8bit)+TC1(10bit)+TC2(10bit)
  features: 14ch ADC,6路PWM,1路CMP,无PWM7/无LED
registers:
  - page: RPAGE
    list:
      - {addr:0x180,name:RSR,bits:{RSR:{pos:[7,0],desc:RAM选择}}}
      - {addr:0x183,name:STATUS,bits:{RST:{pos:[7]},GIE:{pos:[6]},T:{pos:[4]},P:{pos:[3]},Z:{pos:[2]},DC:{pos:[1]},C:{pos:[0]}}}
      - {addr:0x184,name:TC0CON,bits:{TC0EN:{pos:[7]},TC0CKS:{pos:[6,5]},TC0PSR:{pos:[2,0]}}}
      - {addr:0x185,name:TC0C,bits:{TC0C:{pos:[7,0]}}}
      - {addr:0x18A,name:P5,bits:{P5:{pos:[5,0]}}}
      - {addr:0x18D,name:P5CON,bits:{P5CON:{pos:[5,0],vals:{0:输出,1:输入}}}}
      - {addr:0x190,name:P5PH,bits:{P5PH:{pos:[5,0],vals:{0:使能,1:禁止}}}}
      - {addr:0x193,name:P5PD,bits:{P5PD:{pos:[5,0],vals:{0:使能,1:禁止}}}}
      - {addr:0x18B,name:P6,bits:{P6:{pos:[7,0]}}}
      - {addr:0x18E,name:P6CON,bits:{P6CON:{pos:[7,0],vals:{0:输出,1:输入}}}}
      - {addr:0x191,name:P6PH,bits:{P6PH:{pos:[7,0],vals:{0:使能,1:禁止}}}}
      - {addr:0x194,name:P6PD,bits:{P6PD:{pos:[7,0],vals:{0:使能,1:禁止}}}}
      - {addr:0x1B0,name:TC1CON,bits:{TC1EN:{pos:[7]},TC1CKS:{pos:[4]},TC1PSR:{pos:[2,0]}}}
      - {addr:0x1B8,name:TC2CON,bits:{TC2EN:{pos:[7]},TC2CKS:{pos:[4]},TC2PSR:{pos:[2,0]}}}
      - {addr:0x1DA,name:INTF0,bits:{TC0IF:{pos:[0]},TC1IF:{pos:[1]},TC2IF:{pos:[2]},P5ICIF:{pos:[3]},P6ICIF:{pos:[4]},CMPIF:{pos:[5]},ADIF:{pos:[6]}}}
      - {addr:0x1D6,name:INTE0,bits:{TC0IE:{pos:[0]},TC1IE:{pos:[1]},TC2IE:{pos:[2]},P5ICIE:{pos:[3]},P6ICIE:{pos:[4]},CMPIE:{pos:[5]},ADIE:{pos:[6]}}}
recipes:
  asm_macros: "#define EI() __asm__(\" ei \")\\n#define DI() __asm__(\" di \")\\n#define NOP() __asm__(\" nop \")\\n#define CWDT() __asm__(\" cwdt \")"
  clram: "void f(void){for(RSR=0;RSR<0xAF;RSR++){IAR=0;}IAR=0;}"
  isr: "void int_isr(void)__interrupt{__asm__(\"org 0x08\");if(TC0IF){INTF0&=0xFE;TC0C+=6;}if(ADIF){INTF0&=0xBF;}}"
  tc0_config: "TC0C=156;TC0CON=0x8A;INTE0|=0x01;"
skeleton:
  includes: '#include "XC8P8615.h"'
  init_func: "void f(void){DI();WDTCON=0;P5=0;P6=0;P5CON=0;P6CON=0;P5PH=0xFF;P6PH=0xFF;P5PD=0xFF;P6PD=0xFF;INTE0=0;INTF0=0;}"
  main_func: "void main(void){f();EI();while(1){CWDT();}}"
""")

# === XC8P8610 ===
w("xc8p8610用法.yaml", """# XC8P8610 C语言用法指南 - R系列精简版
params:
  chip: XC8P8610
  rom: 2Kx16bit OTP; ram: 128B (0x00~0x7F); stack: 8级
  gpio: P6(8bit); timers: TC0(8bit)+TC1(10bit)
  features: 8ch ADC,3路PWM,无P5口,无CMP
registers:
  - page: RPAGE
    list:
      - {addr:0x180,name:RSR,bits:{RSR:{pos:[6,0],desc:RAM选择(bit7固定1)}}}
      - {addr:0x183,name:STATUS,bits:{RST:{pos:[7]},GIE:{pos:[6]},GP0:{pos:[5]},T:{pos:[4]},P:{pos:[3]},Z:{pos:[2]},DC:{pos:[1]},C:{pos:[0]}}}
      - {addr:0x184,name:TC0CON,bits:{TC0EN:{pos:[7]},TC0CKS:{pos:[6,5]},TC0PSR:{pos:[2,0]}}}
      - {addr:0x185,name:TC0C,bits:{TC0C:{pos:[7,0]}}}
      - {addr:0x188,name:CPUCON,bits:{WDTWE:{pos:[7]},INTWE:{pos:[6]},ADCWE:{pos:[5]},TC1WE:{pos:[4]},TC0WE:{pos:[3]},STPHX:{pos:[2]},CLKMD:{pos:[1]},IDLE:{pos:[0]}}}
      - {addr:0x18B,name:P6,bits:{P6:{pos:[7,0]}}}
      - {addr:0x18E,name:P6CON,bits:{P6CON:{pos:[7,0],vals:{0:输出,1:输入}}}}
      - {addr:0x191,name:P6PH,bits:{P6PH:{pos:[7,0],vals:{0:使能,1:禁止}}}}
      - {addr:0x194,name:P6PD,bits:{P6PD:{pos:[7,0],vals:{0:使能,1:禁止}}}}
      - {addr:0x1DA,name:INTF,bits:{TC0IF:{pos:[0]},TC1IF:{pos:[2]},P6ICIF:{pos:[4]},ADIF:{pos:[6]}}}
      - {addr:0x1D6,name:INTE,bits:{TC0IE:{pos:[0]},TC1IE:{pos:[2]},P6ICIE:{pos:[4]},ADIE:{pos:[6]}}}
recipes:
  asm_macros: "#define EI() __asm__(\" ei \")\\n#define DI() __asm__(\" di \")\\n#define NOP() __asm__(\" nop \")\\n#define CWDT() __asm__(\" cwdt \")"
  clram: "void f(void){for(RSR=0;RSR<0x7F;RSR++){IAR=0;}IAR=0;}"
  isr: "void int_isr(void)__interrupt{__asm__(\"org 0x08\");if(TC0IF){INTF&=0xFE;TC0C+=6;}if(ADIF){INTF&=0xBF;}}"
  tc0_config: "TC0C=156;TC0CON=0x8A;INTE|=0x01;"
skeleton:
  includes: '#include "XC8P8610.h"'
  init_func: "void f(void){DI();WDTCON=0;P6=0;P6CON=0;P6PH=0xFF;P6PD=0xFF;INTE=0;INTF=0;}"
  main_func: "void main(void){f();EI();while(1){CWDT();}}"
""")

# === XC8P8508 ===
w("xc8p8508用法.yaml", """# XC8P8508 C语言用法指南 - 传统系列(86风格:TCC/ISR/IMR)
params:
  chip: XC8P8508; rom: 1Kx14bit OTP; ram: 96B; stack: 5级
  gpio: P5(8bit)+P6(8bit)+P7(2bit); timers: TCC(8bit)+PWM0~4
  features: 3组GPIO,5路PWM,LVD,偏86风格命名
registers:
  - page: RPAGE
    list:
      - {addr:0x01,name:TCC,bits:{TCC:{pos:[7,0],desc:定时计数器}}}
      - addr:0x03
        name: STATUS
        bits:
          WKTP:{pos:[7],desc:唤醒类型}; GP1:{pos:[6]}; GP0:{pos:[5]}
          T:{pos:[4]}; P:{pos:[3]}; Z:{pos:[2]}; DC:{pos:[1]}; C:{pos:[0]}
      - {addr:0x06,name:PORT6,bits:{P6:{pos:[7,0]}}}
      - addr:0x0F
        name: ISR
        bits:
          TCIF:{pos:[0]}; P6ICIF:{pos:[1]}; EXIF:{pos:[2]}; P5ICIF:{pos:[3]}
          LVDIF:{pos:[4]}; PWM0IF:{pos:[5]}; PWM1IF:{pos:[6]}; PWM2IF:{pos:[7]}
  - page: IOC
    list:
      - addr:0x01
        name: CONT
        bits: {INT:{pos:[6]},TS:{pos:[5]},TE:{pos:[4]},PAB:{pos:[3]},PSR:{pos:[2,0]}}
      - {addr:0x06,name:P6CR,bits:{P6CR:{pos:[7,0],vals:{0:输出,1:输入}}}}
      - addr:0x0F
        name: IMR
        bits: {TCIE:{pos:[0]},ICIE:{pos:[1]},EXIE:{pos:[2]},P5ICIE:{pos:[3]},LVDIE:{pos:[4]},PWM0IE:{pos:[5]},PWM1IE:{pos:[6]},PWM2IE:{pos:[7]}}
recipes:
  clram: "void f(void){for(RSR=0x90;RSR<0xEF;RSR++){IAR=0;}IAR=0;}"
  isr: "void int_isr(void)__interrupt{__asm__(\"org 0x08\");PUSH(_A_BUFF,_R3_BUFF);if(TCIF){ISR=0xFE;TCC+=6;}if(P6ICIF){ISR=0xFD;}if(EXIF){ISR=0xFB;}POP(_A_BUFF,_R3_BUFF);}"
skeleton:
  includes: '#include "XC8P8508.h"'
  init_func: "void f(void){DI();IOCP_W(WDTCR,0x00);CONTW(0x02);TCC=6;PORT6=0;IOCP_W(P6CR,0x00);IOCP_W(IMR,0x01);ISR=0;}"
  main_func: "void main(void){f();EI();while(1){CWDT();}}"
""")

# === XC8P8521 ===
w("xc8p8521用法.yaml", """# XC8P8521 C语言用法指南 - 传统系列(6路PWM+CMP)
params:
  chip: XC8P8521; rom: 1Kx14bit OTP; ram: 96B; stack: 5级
  gpio: P5(4bit)+P6(4bit); timers: TC0(8bit)+TC1(10bit)+TC2(10bit)
  features: 6路PWM(PWM1~6),1路CMP
registers:
  - page: RPAGE
    list:
      - {addr:0x03,name:STATUS,bits:{RST:{pos:[7]},GIE:{pos:[6]},LVREN:{pos:[5]},T:{pos:[4]},P:{pos:[3]},Z:{pos:[2]},DC:{pos:[1]},C:{pos:[0]}}}
      - {addr:0x06,name:PORT6,bits:{P6:{pos:[3,0]}}}
      - {addr:0x07,name:CMPCON0,bits:{CMPEN:{pos:[7]},CMPOUT:{pos:[6]},CMPRS:{pos:[5,0]}}}
      - {addr:0x0E,name:CPUCON,bits:{CMPWE:{pos:[7]},INTWE:{pos:[6]},TC2WE:{pos:[5]},TC1WE:{pos:[4]},TC0WE:{pos:[3]},STPHX:{pos:[2]},CLKMD:{pos:[1]},IDLE:{pos:[0]}}}
      - addr:0x0F
        name: INTF
        bits: {TC0IF:{pos:[0]},P6ICIF:{pos:[1]},INTIF:{pos:[2]},TC1IF:{pos:[3]},CMPIF:{pos:[4]},TC2IF:{pos:[5]},P5ICIF:{pos:[6]}}
  - page: IOC
    list:
      - {addr:0x02,name:TC0CON,bits:{TC0EN:{pos:[7]},TC0PSR:{pos:[2,0]}}}
      - {addr:0x06,name:P6CON,bits:{P6CON:{pos:[3,0],vals:{0:输出,1:输入}}}}
      - addr:0x0F
        name: INTE
        bits: {TC0IE:{pos:[0]},ICIE:{pos:[1]},INTIE:{pos:[2]},TC1IE:{pos:[3]},CMPIE:{pos:[4]},TC2IE:{pos:[5]},P5ICIE:{pos:[6]}}
recipes:
  clram: "void f(void){for(RSR=0x90;RSR<0xEF;RSR++){IAR=0;}IAR=0;}"
  isr: "void int_isr(void)__interrupt{__asm__(\"org 0x08\");PUSH(_A_BUFF,_R3_BUFF);if(TC0IF){INTF=0xFE;TC0C+=6;}if(P6ICIF){INTF=0xFD;}if(INTIF){INTF=0xFB;}POP(_A_BUFF,_R3_BUFF);}"
skeleton:
  includes: '#include "XC8P8521.h"'
  init_func: "void f(void){DI();IOCP_W(WDTCON,0x00);CONTW(0x82);TC0C=6;PORT6=0;IOCP_W(P6CON,0x00);IOCP_W(P6PH,0xFF);IOCP_W(P6PD,0xFF);IOCP_W(INTE,0x01);INTF=0;}"
  main_func: "void main(void){f();EI();while(1){CWDT();}}"
""")

# === XC8P9510 ===
w("xc8p9510用法.yaml", """# XC8P9510 C语言用法指南 - 传统系列基本款
params:
  chip: XC8P9510; rom: 1Kx14bit OTP; ram: 48B; stack: 5级
  gpio: P6(6bit); timers: TC0(8bit)+TC1(12bit PWM)
  features: 基本款,无CMP,无ADC
registers:
  - page: RPAGE
    list:
      - {addr:0x03,name:STATUS,bits:{RST:{pos:[7]},GIE:{pos:[6]},LVREN:{pos:[5]},T:{pos:[4]},P:{pos:[3]},Z:{pos:[2]},DC:{pos:[1]},C:{pos:[0]}}}
      - {addr:0x06,name:PORT6,bits:{P6:{pos:[5,0]}}}
      - addr:0x0F
        name: INTF
        bits: {TC0IF:{pos:[0]},ICIF:{pos:[1]},INTIF:{pos:[2]},TC1IF:{pos:[3]}}
  - page: IOC
    list:
      - {addr:0x06,name:P6CON,bits:{P6CON:{pos:[5,0],vals:{0:输出,1:输入}}}}
      - addr:0x0F
        name: INTE
        bits: {TC0IE:{pos:[0]},ICIE:{pos:[1]},INTIE:{pos:[2]},TC1IE:{pos:[3]}}
recipes:
  clram: "void f(void){for(RSR=0xD0;RSR<0xFF;RSR++){IAR=0;}IAR=0;}"
  isr: "void int_isr(void)__interrupt{__asm__(\"org 0x08\");PUSH(_A_BUFF,_R3_BUFF);if(TC0IF){INTF=0xFE;TC0C+=6;}POP(_A_BUFF,_R3_BUFF);}"
skeleton:
  includes: '#include "XC8P9510.h"'
  init_func: "void f(void){DI();IOCP_W(WDTCON,0x00);CONTW(0x82);TC0C=6;PORT6=0;IOCP_W(P6CON,0x00);IOCP_W(P6PH,0xFF);IOCP_W(P6PD,0xFF);IOCP_W(INTE,0x01);INTF=0;}"
  main_func: "void main(void){f();EI();while(1){CWDT();}}"
""")

# === XC8P9520/9521/9525/9527/955E ===
w("xc8p9520用法.yaml", "# XC8P9520 - 传统系列\nparams:\n  chip: XC8P9520; rom: 1Kx14bit OTP; ram: 48B; stack: 5级\n  gpio: P5(4bit)+P6(6bit); timers: TC0(8bit)+TC1(12bit PWM)\n  features: 比9510多P5口,无CMP\n")
w("xc8p9521用法.yaml", "# XC8P9521 - 传统系列\nparams:\n  chip: XC8P9521; rom: 1Kx14bit OTP; ram: 48B; stack: 5级\n  gpio: P5(4bit)+P6(6bit); timers: TC0+TC1\n  features: 比9520多CMP\n")
w("xc8p9525用法.yaml", "# XC8P9525\nparams:\n  chip: XC8P9525; ref: XC8P9520; note: 与9520完全一致\n")
w("xc8p9527用法.yaml", "# XC8P9527\nparams:\n  chip: XC8P9527; ref: XC8P9520; note: 与9520完全一致\n")
w("xc8e955e用法.yaml", "# XC8E955E - 传统系列(带EEPROM)\nparams:\n  chip: XC8E955E; rom: 1Kx14bit+EEPROM; ram: 48B\n  gpio: P5(4bit)+P6(4bit); timers: TCC+T1+T2\n  features: 带E2PROM,偏86风格(TCC/ISR/IMR)\n")

# === XC8P8600 ===
w("xc8p8600用法.yaml", """# XC8P8600 C语言用法指南 - 传统系列特殊命名
params:
  chip: XC8P8600; rom: 2Kx14bit OTP; ram: 64B; stack: 7级
  gpio: P6(6bit); timers: TCC(8bit)+PWM(8bitx3)
  features: 特殊命名(TCC/ISR/IMR/CONT/P6CR),5ch 12bit ADC
registers:
  - page: RPAGE
    list:
      - {addr:0x01,name:TCC,bits:{TCC:{pos:[7,0],desc:定时计数器}}}
      - {addr:0x03,name:STATUS,bits:{RST:{pos:[7]},GB1:{pos:[6]},GB0:{pos:[5]},T:{pos:[4]},P:{pos:[3]},Z:{pos:[2]},DC:{pos:[1]},C:{pos:[0]}}}
      - {addr:0x06,name:PORT6,bits:{PORT6:{pos:[5,0]}}}
      - {addr:0x07,name:ADCON,bits:{ADRUN:{pos:[7]},ADPD:{pos:[6]},VREFS:{pos:[5]}}}
      - {addr:0x08,name:PWMCON,bits:{T1EN:{pos:[7]},PWM1EN:{pos:[4]},T1PSR:{pos:[2,0]}}}
      - {addr:0x09,name:PRD,bits:{PRD:{pos:[7,0],desc:PWM周期}}}
      - {addr:0x0A,name:PDC1,bits:{PDC1:{pos:[7,0],desc:PWM1占空比}}}
      - {addr:0x0E,name:CPUCON,bits:{IPWM1:{pos:[7]},PWMCKS:{pos:[6]},TCCCKS:{pos:[5]},STPHX:{pos:[2]},CLKMD:{pos:[1]},IDLE:{pos:[0]}}}
      - addr:0x0F
        name: ISR
        bits: {TCIF:{pos:[0]},ICIF:{pos:[1]},EXIF:{pos:[2]},T1IF:{pos:[3]},ADIF:{pos:[4]}}
  - page: IOC
    list:
      - addr:0x01
        name: CONT
        bits: {INT:{pos:[6]},TS:{pos:[5]},TE:{pos:[4]},PAB:{pos:[3]},PSR:{pos:[2,0]}}
      - {addr:0x06,name:P6CR,bits:{P6CR:{pos:[5,0],vals:{0:输出,1:输入}}}}
      - {addr:0x0E,name:WDTCR,bits:{WDTEN:{pos:[7]},EIS:{pos:[6]}}}
      - addr:0x0F
        name: IMR
        bits: {TCIE:{pos:[0]},ICIE:{pos:[1]},EXIE:{pos:[2]},T1IE:{pos:[3]},ADIE:{pos:[4]}}
recipes:
  clram: "void f(void){for(RSR=0x90;RSR<0xFF;RSR++){IAR=0;}IAR=0;}"
  isr: "void int_isr(void)__interrupt{__asm__(\"org 0x08\");PUSH(_A_BUFF,_R3_BUFF);if(TCIF){ISR=0xFE;TCC+=6;}if(EXIF){ISR=0xFB;}POP(_A_BUFF,_R3_BUFF);}"
skeleton:
  includes: '#include "XC8P8600.h"'
  init_func: "void f(void){DI();IOCP_W(WDTCR,0x00);CONTW(0x02);TCC=6;PORT6=0;IOCP_W(P6CR,0x00);IOCP_W(PHCR,0xFF);IOCP_W(PDCR,0xFF);IOCP_W(IMR,0x01);ISR=0;}"
  main_func: "void main(void){f();EI();while(1){CWDT();}}"
""")

# === XC8E855E ===
w("xc8e855e用法.yaml", """# XC8E855E C语言用法指南 - 特例(无IOC页,直接访问)
params:
  chip: XC8E855E; rom: 1Kx14bit OTP; ram: 80B; stack: "?"
  gpio: P6(6bit); timers: TC0(8bit)+TC1(12bit PWM)
  features: 特例!无IOC页,全部直接访问,3路PWM
registers:
  - page: RPAGE(直接访问)
    list:
      - {addr:0x01,name:TC0C,bits:{TC0C:{pos:[7,0]}}}
      - {addr:0x06,name:PORT6,bits:{PORT6:{pos:[5,0]}}}
      - {addr:0x08,name:TC1CON,bits:{TC1EN:{pos:[7]},TC1PSR:{pos:[2,0]}}}
      - addr:0x0F
        name: INTF
        bits: {TCIF:{pos:[0]},T1IF:{pos:[3]}}
  - page: DIRECT(0x70~0x7F)
    list:
      - {addr:0x70,name:SYSCON,bits:{SYSCON:{pos:[7,0],desc:系统控制(WDT)}}}
      - {addr:0x71,name:TC0CON,bits:{TC0EN:{pos:[7]},TC0PSR:{pos:[2,0]}}}
      - {addr:0x72,name:P6CON,bits:{P6CON:{pos:[5,0],vals:{0:输出,1:输入}}}}
      - {addr:0x73,name:P6PH,bits:{P6PH:{pos:[5,0],vals:{0:使能,1:禁止}}}}
      - {addr:0x74,name:P6PD,bits:{P6PD:{pos:[5,0],vals:{0:使能,1:禁止}}}}
      - {addr:0x75,name:INTE,bits:{TC0IE:{pos:[0]},TC1IE:{pos:[3]}}}
recipes:
  clram: "void f(void){for(RSR=0x90;RSR<0xDF;RSR++){IAR=0;}IAR=0;}"
  isr: "void int_isr(void)__interrupt{__asm__(\"org 0x08\");PUSH(_A_BUFF,_R3_BUFF);if(TCIF){INTF=0xFE;TC0C+=6;}if(T1IF){INTF=0xF7;}POP(_A_BUFF,_R3_BUFF);}"
  tc0_config: "SYSCON=0x00;TC0CON=0x82;TC0C=6;INTE|=0x01;"
skeleton:
  includes: '#include "XC8E855E.h"'
  init_func: "void f(void){SYSCON=0x00;TC0CON=0x82;TC0C=6;PORT6=0;P6CON=0x00;P6PH=0xFF;P6PD=0xFF;INTE=0x01;INTF=0;}"
  main_func: "void main(void){f();EI();while(1){CWDT();}}"
""")

# === XC8P8613 ===
w("xc8p8613用法.yaml", """# XC8P8613 C语言用法指南 - 独立内核
params:
  chip: XC8P8613; rom: 2Kx16bit OTP; ram: 128B; stack: 4级
  gpio: P0(7bit)+P4(5bit)+P5(2bit); timers: TC0+TC1+TC2(8bit)
  features: 独立架构!与R系列/传统系列不兼容,6ch ADC,3路PWM
note: |
  ⚠️ 完全不同的内核!
  GPIO: P0/P4/P5端口, PxM方向(1=输出), PxUR上拉(1=使能), PxPD下拉(1=使能)
  中断: inten(使能)/intrq(标志)/pflag(状态)
  寻址: Z(地址)/R(结束)/Y(=0清RAM)
  CLRAM: 0x00~0x7F(128B) 使用@YZ循环
  请参考XC8P8613专用Datasheet和Demo代码
""")

print("Done - all files generated")

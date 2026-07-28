#!/usr/bin/env python3
"""Extend 5 remaining models to full version"""
import os

OUT = "E:/矽杰微"

def w(fname, content):
    path = os.path.join(OUT, fname)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content.lstrip("\n"))
    print(f"  {fname} ({len(content)}B)")

# ==== 1. XC8P8521 ====
w("xc8p8521用法.yaml", """# XC8P8521 - 传统系列(RPAGE+IOC)
params:
  chip: XC8P8521; rom: 1Kx14bit; ram: 96B(0x10~0x6F); stack: 5\u7ea7
  gpio: P5(4bit)+P6(4bit); timers: TC0+TC1(10bit P123)+TC2(10bit P456)
  features: 6\u8defPWM,1\u8defCMP
registers:
  - page: RPAGE
    list:
      - {addr:0x00,name:IAR,bits:{IAR:{pos:[7,0],desc:\u95f4\u63a5\u5bfb\u5740}}}
      - {addr:0x01,name:TC0C,bits:{TC0C:{pos:[7,0],desc:TC0\u8ba1\u6570}}}
      - {addr:0x04,name:RSR,bits:{RSR:{pos:[5,0],desc:RAM\u9009\u62e9}}}
      - {addr:0x05,name:PORT5,bits:{P5:{pos:[3,0],desc:P5\u6570\u636e}}}
      - {addr:0x06,name:PORT6,bits:{P6:{pos:[3,0],desc:P6\u6570\u636e}}}
      - {addr:0x07,name:CMPCON0,bits:{CMPEN:{pos:[7]},CMPOUT:{pos:[6]},CMPRS:{pos:[5,0]}}}
      - {addr:0x08,name:CMPCON1,bits:{CMPOE:{pos:[7]},CMPINV:{pos:[6]},CMPIS:{pos:[5,0]}}}
      - {addr:0x0C,name:P5IWE,bits:{P5IWE:{pos:[3,0]}}}
      - {addr:0x0D,name:P6IWE,bits:{P6IWE:{pos:[3,0]}}}
      - addr:0x0E
        name: CPUCON
        bits:
          CMPWE:{pos:[7]};INTWE:{pos:[6]};TC2WE:{pos:[5]};TC1WE:{pos:[4]};TC0WE:{pos:[3]}
          STPHX:{pos:[2],vals:{0:\u6b63\u5e38,1:\u505c\u6b62}};CLKMD:{pos:[1],vals:{0:IHRC,1:ILRC}};IDLE:{pos:[0]}
      - addr:0x0F
        name: INTF
        bits:
          TC0IF:{pos:[0]};P6ICIF:{pos:[1]};INTIF:{pos:[2]};TC1IF:{pos:[3]};CMPIF:{pos:[4]};TC2IF:{pos:[5]};P5ICIF:{pos:[6]}
      - {addr:0x70,name:TC1CON,bits:{TC1EN:{pos:[7]},TC1CKS:{pos:[4]},TC1PSR:{pos:[2,0]}}}
      - {addr:0x71,name:TC1PRDL,bits:{TC1PRD:{pos:[7,0]}}}
      - {addr:0x72,name:PWM1DTL,bits:{PWM1DT:{pos:[7,0]}}}
      - {addr:0x73,name:PWM2DTL,bits:{PWM2DT:{pos:[7,0]}}}
      - {addr:0x74,name:PWM3DTL,bits:{PWM3DT:{pos:[7,0]}}}
      - {addr:0x76,name:PWMCON0,bits:{PWM1EN:{pos:[0]},PWM2EN:{pos:[1]},PWM3EN:{pos:[2]},IPWM1EN:{pos:[3]}}}
      - {addr:0x77,name:TC2CON,bits:{TC2EN:{pos:[7]},TC2CKS:{pos:[4]},TC2PSR:{pos:[2,0]}}}
      - {addr:0x78,name:TC2PRDL,bits:{TC2PRD:{pos:[7,0]}}}
      - {addr:0x79,name:PWM4DTL,bits:{PWM4DT:{pos:[7,0]}}}
      - {addr:0x7A,name:PWM5DTL,bits:{PWM5DT:{pos:[7,0]}}}
      - {addr:0x7B,name:PWM6DTL,bits:{PWM6DT:{pos:[7,0]}}}
      - {addr:0x7D,name:PWMCON1,bits:{PWM4EN:{pos:[0]},PWM5EN:{pos:[1]},PWM6EN:{pos:[2]},IPWM4EN:{pos:[3]}}}
  - page: IOC
    list:
      - {addr:0x01,name:CONT,bits:{INT:{pos:[6]},TS:{pos:[5]},TE:{pos:[4]},PAB:{pos:[3]},PSR:{pos:[2,0]}}}
      - {addr:0x02,name:TC0CON,bits:{TC0EN:{pos:[7]},LRCEN:{pos:[6]},TS:{pos:[5]},TE:{pos:[4]},PAB:{pos:[3]},TC0PSR:{pos:[2,0]}}}
      - {addr:0x05,name:P5CON,bits:{P5CON:{pos:[3,0],desc:P5\u65b9\u5411,vals:{0:\u8f93\u51fa,1:\u8f93\u5165}}}}
      - {addr:0x06,name:P6CON,bits:{P6CON:{pos:[3,0],desc:P6\u65b9\u5411,vals:{0:\u8f93\u51fa,1:\u8f93\u5165}}}}
      - {addr:0x0E,name:WDTCON,bits:{WDTE:{pos:[7]},INTEDG:{pos:[1,0]}}}
      - addr:0x0F
        name: INTE
        bits:
          TC0IE:{pos:[0]};ICIE:{pos:[1]};INTIE:{pos:[2]};TC1IE:{pos:[3]};CMPIE:{pos:[4]};TC2IE:{pos:[5]};P5ICIE:{pos:[6]}
recipes:
  asm_macros: "#define EI() __asm__(\" ei \")\\n#define DI() __asm__(\" di \")\\n#define NOP() __asm__(\" nop \")\\n#define CWDT() __asm__(\" cwdt \")\\n#define CONTW(V) __asm__(\"mov a,@\"#V\"\\n ctw\")\\n#define IOCP_W(R,V) __asm__(\"mov a,@\"#V\"\\n iw \"#R)\\n#define PUSH(A,R3) __asm__(\"mov \"#A\",a\\n swap \"#A\"\\n swapa STATUS\\n mov \"#R3\",a\")\\n#define POP(A,R3) __asm__(\"swapa \"#R3\"\\n mov STATUS,a\\n swapa \"#A)"
  clram: "void f(){for(RSR=0x90;RSR<0xEF;RSR++){IAR=0;}IAR=0;}"
  isr: "void int_isr(void)__interrupt{__asm__(\"org 0x08\");PUSH(_A_BUFF,_R3_BUFF);if(TC0IF){INTF=0xFE;TC0C+=6;}if(TC1IF){INTF=0xF7;}POP(_A_BUFF,_R3_BUFF);}"
skeleton:
  includes: '#include "XC8P8521.h"'
  global_vars: "volatile __at(0x10)unsigned char A_BUFF;volatile __at(0x11)unsigned char R3_BUFF;"
  init_func: "void f(){DI();IOCP_W(WDTCON,0x00);CONTW(0x82);TC0C=6;PORT5=0;PORT6=0;IOCP_W(P5CON,0x00);IOCP_W(P6CON,0x00);IOCP_W(INTE,0x01);INTF=0;}"
  main_func: "void main(void){file_clrRam();file_init();EI();while(1){CWDT();}}"
""")

# ==== 2. XC8P9510 ====
w("xc8p9510用法.yaml", """# XC8P9510 - \u4f20\u7edf\u7cfb\u5217\u57fa\u672c\u6b3e
params:
  chip: XC8P9510; rom: 1Kx14bit; ram: 48B(0x10~0x3F); stack: 5\u7ea7
  gpio: P6(6bit); timers: TC0(8bit)+TC1(12bit PWM)
  features: \u57fa\u672c\u6b3e,\u65e0CMP/ADC
registers:
  - page: RPAGE
    list:
      - {addr:0x00,name:IAR,bits:{IAR:{pos:[7,0]}}}
      - {addr:0x01,name:TC0C,bits:{TC0C:{pos:[7,0]}}}
      - {addr:0x04,name:RSR,bits:{RSR:{pos:[5,0]}}}
      - {addr:0x06,name:PORT6,bits:{P6:{pos:[5,0]}}}
      - {addr:0x08,name:TC1CON,bits:{TC1EN:{pos:[7]},PWME:{pos:[4]},TC1PSR:{pos:[2,0]}}}
      - {addr:0x09,name:TC1PRDL,bits:{TC1PRD:{pos:[7,0]}}}
      - {addr:0x0A,name:PWMDTL,bits:{PWMDT:{pos:[7,0]}}}
      - {addr:0x0B,name:TC1PRDTH,bits:{TC1PRD:{pos:[7,4]},PWMDT:{pos:[3,0]}}}
      - {addr:0x0C,name:P6AE,bits:{P6AE:{pos:[5,0]}}}
      - {addr:0x0D,name:P6IWE,bits:{P6IWE:{pos:[5,0]}}}
      - addr:0x0E
        name: CPUCON
        bits:
          IPWM:{pos:[7]};TC1CKS:{pos:[6]};TC0CKS:{pos:[5]};TC1WE:{pos:[4]};TC0WE:{pos:[3]}
          STPHX:{pos:[2],vals:{0:\u6b63\u5e38,1:\u505c\u6b62}}
          CLKMD:{pos:[1],vals:{0:IHRC,1:ILRC}};IDLE:{pos:[0]}
      - addr:0x0F
        name: INTF
        bits: {TC0IF:{pos:[0]},ICIF:{pos:[1]},INTIF:{pos:[2]},TC1IF:{pos:[3]}}
  - page: IOC
    list:
      - {addr:0x01,name:CONT,bits:{INT:{pos:[6]},TS:{pos:[5]},TE:{pos:[4]},PAB:{pos:[3]},PSR:{pos:[2,0]}}}
      - {addr:0x02,name:TC0CON,bits:{TC0EN:{pos:[7]},TS:{pos:[5]},PAB:{pos:[3]},TC0PSR:{pos:[2,0]}}}
      - {addr:0x06,name:P6CON,bits:{P6CON:{pos:[5,0],vals:{0:\u8f93\u51fa,1:\u8f93\u5165}}}}
      - {addr:0x0B,name:P6PD,bits:{P6PD:{pos:[5,0],vals:{0:\u4f7f\u80fd,1:\u7981\u6b62}}}}
      - {addr:0x0D,name:P6PH,bits:{P6PH:{pos:[5,0],vals:{0:\u4f7f\u80fd,1:\u7981\u6b62}}}}
      - {addr:0x0E,name:WDTCON,bits:{WDTE:{pos:[7]},INTEDG:{pos:[1,0]}}}
      - addr:0x0F
        name: INTE
        bits: {TC0IE:{pos:[0]},ICIE:{pos:[1]},INTIE:{pos:[2]},TC1IE:{pos:[3]}}
recipes:
  asm_macros: "#define EI() __asm__(\" ei \")\\n#define DI() __asm__(\" di \")\\n#define NOP() __asm__(\" nop \")\\n#define CWDT() __asm__(\" cwdt \")\\n#define CONTW(V) __asm__(\"mov a,@\"#V\"\\n ctw\")\\n#define IOCP_W(R,V) __asm__(\"mov a,@\"#V\"\\n iw \"#R)\\n#define PUSH(A,R3) __asm__(\"mov \"#A\",a\\n swap \"#A\"\\n swapa STATUS\\n mov \"#R3\",a\")\\n#define POP(A,R3) __asm__(\"swapa \"#R3\"\\n mov STATUS,a\\n swapa \"#A)"
  clram: "void f(){for(RSR=0xD0;RSR<0xFF;RSR++){IAR=0;}IAR=0;}"
  isr: "void int_isr(void)__interrupt{__asm__(\"org 0x08\");PUSH(_A_BUFF,_R3_BUFF);if(TC0IF){INTF=0xFE;TC0C+=6;}if(TC1IF){INTF=0xF7;}POP(_A_BUFF,_R3_BUFF);}"
skeleton:
  includes: '#include "XC8P9510.h"'
  global_vars: "volatile __at(0x10)unsigned char A_BUFF;volatile __at(0x11)unsigned char R3_BUFF;"
  init_func: "void f(){DI();IOCP_W(WDTCON,0x00);CONTW(0x82);TC0C=6;PORT6=0;IOCP_W(P6CON,0x00);IOCP_W(P6PH,0xFF);IOCP_W(P6PD,0xFF);IOCP_W(INTE,0x01);INTF=0;}"
  main_func: "void main(void){file_clrRam();file_init();EI();while(1){CWDT();}}"
""")

# ==== 3. XC8P9520 (9510+P5) ====
w("xc8p9520用法.yaml", """# XC8P9520 - \u4f20\u7edf\u7cfb\u5217(\u591aP5\u53e3)
params:
  chip: XC8P9520; rom: 1Kx14bit; ram: 48B(0x10~0x3F); stack: 5\u7ea7
  gpio: P5(4bit)+P6(6bit); timers: TC0+TC1
  features: \u57fa\u672c\u6b3e,\u65e0CMP
# \u540c9510\u4f46\u589e\u52a0P5\u53e3: PORT5@0x05, IOC: P5CON/P5PH/P5PD
registers:
  - page: RPAGE
    list:
      - {addr:0x00,name:IAR,bits:{IAR:{pos:[7,0]}}}
      - {addr:0x01,name:TC0C,bits:{TC0C:{pos:[7,0]}}}
      - {addr:0x04,name:RSR,bits:{RSR:{pos:[5,0]}}}
      - {addr:0x05,name:PORT5,bits:{P5:{pos:[3,0]}}}
      - {addr:0x06,name:PORT6,bits:{P6:{pos:[5,0]}}}
      - {addr:0x08,name:TC1CON,bits:{TC1EN:{pos:[7]},PWME:{pos:[4]},TC1PSR:{pos:[2,0]}}}
      - {addr:0x0E,name:CPUCON,bits:{STPHX:{pos:[2]},CLKMD:{pos:[1]},IDLE:{pos:[0]}}}
      - {addr:0x0F,name:INTF,bits:{TC0IF:{pos:[0]},ICIF:{pos:[1]},INTIF:{pos:[2]},TC1IF:{pos:[3]}}}
  - page: IOC
    list:
      - {addr:0x01,name:CONT,bits:{PSR:{pos:[2,0]}}}
      - {addr:0x02,name:TC0CON,bits:{TC0EN:{pos:[7]},TC0PSR:{pos:[2,0]}}}
      - {addr:0x05,name:P5CON,bits:{P5CON:{pos:[3,0],vals:{0:\u8f93\u51fa,1:\u8f93\u5165}}}}
      - {addr:0x06,name:P6CON,bits:{P6CON:{pos:[5,0],vals:{0:\u8f93\u51fa,1:\u8f93\u5165}}}}
      - {addr:0x0E,name:WDTCON,bits:{WDTE:{pos:[7]}}}
      - {addr:0x0F,name:INTE,bits:{TC0IE:{pos:[0]},ICIE:{pos:[1]},INTIE:{pos:[2]},TC1IE:{pos:[3]}}}
recipes:
  asm_macros: "#define EI() __asm__(\" ei \")\\n#define DI() __asm__(\" di \")\\n#define NOP() __asm__(\" nop \")\\n#define CWDT() __asm__(\" cwdt \")\\n#define CONTW(V) __asm__(\"mov a,@\"#V\"\\n ctw\")\\n#define IOCP_W(R,V) __asm__(\"mov a,@\"#V\"\\n iw \"#R)\\n#define PUSH(A,R3) __asm__(\"mov \"#A\",a\\n swap \"#A\"\\n swapa STATUS\\n mov \"#R3\",a\")\\n#define POP(A,R3) __asm__(\"swapa \"#R3\"\\n mov STATUS,a\\n swapa \"#A)"
  clram: "void f(){for(RSR=0xD0;RSR<0xFF;RSR++){IAR=0;}IAR=0;}"
  isr: "void int_isr(void)__interrupt{__asm__(\"org 0x08\");PUSH(_A_BUFF,_R3_BUFF);if(TC0IF){INTF=0xFE;TC0C+=6;}POP(_A_BUFF,_R3_BUFF);}"
skeleton:
  includes: '#include "XC8P9520.h"'
  global_vars: "volatile __at(0x10)unsigned char A_BUFF;volatile __at(0x11)unsigned char R3_BUFF;"
  init_func: "void f(){DI();IOCP_W(WDTCON,0x00);CONTW(0x82);TC0C=6;PORT5=0;PORT6=0;IOCP_W(P5CON,0x00);IOCP_W(P6CON,0x00);IOCP_W(INTE,0x01);INTF=0;}"
  main_func: "void main(void){file_clrRam();file_init();EI();while(1){CWDT();}}"
""")

# ==== 4. XC8P9521 (9520+CMP) ====
w("xc8p9521用法.yaml", """# XC8P9521 - \u4f20\u7edf\u7cfb\u5217(+CMP)
params:
  chip: XC8P9521; rom: 1Kx14bit; ram: 48B(0x10~0x3F); stack: 5\u7ea7
  gpio: P5(4bit)+P6(6bit); timers: TC0+TC1
  features: \u6bd49520\u591aCMP
# \u540c9520\u4f46\u589e\u52a0CMPCON0@0x07, CMPCON1@IOC0x0A, INTE/INTF\u589e\u52a0CMPIF(bit4)
registers:
  - page: RPAGE
    list:
      - {addr:0x00,name:IAR,bits:{IAR:{pos:[7,0]}}}
      - {addr:0x01,name:TC0C,bits:{TC0C:{pos:[7,0]}}}
      - {addr:0x04,name:RSR,bits:{RSR:{pos:[5,0]}}}
      - {addr:0x05,name:PORT5,bits:{P5:{pos:[3,0]}}}
      - {addr:0x06,name:PORT6,bits:{P6:{pos:[5,0]}}}
      - {addr:0x07,name:CMPCON0,bits:{CMPEN:{pos:[7]},CMPOUT:{pos:[6]},CMPRS:{pos:[5,0]}}}
      - {addr:0x0E,name:CPUCON,bits:{STPHX:{pos:[2]},CLKMD:{pos:[1]},IDLE:{pos:[0]}}}
      - {addr:0x0F,name:INTF,bits:{TC0IF:{pos:[0]},ICIF:{pos:[1]},INTIF:{pos:[2]},TC1IF:{pos:[3]},CMPIF:{pos:[4]}}}
  - page: IOC
    list:
      - {addr:0x01,name:CONT,bits:{PSR:{pos:[2,0]}}}
      - {addr:0x02,name:TC0CON,bits:{TC0EN:{pos:[7]},TC0PSR:{pos:[2,0]}}}
      - {addr:0x05,name:P5CON,bits:{P5CON:{pos:[3,0]}}}
      - {addr:0x06,name:P6CON,bits:{P6CON:{pos:[5,0]}}}
      - {addr:0x0A,name:CMPCON1,bits:{CMPOE:{pos:[7]},CMPINV:{pos:[6]},CMPIS:{pos:[5,0]}}}
      - {addr:0x0E,name:WDTCON,bits:{WDTE:{pos:[7]}}}
      - {addr:0x0F,name:INTE,bits:{TC0IE:{pos:[0]},ICIE:{pos:[1]},INTIE:{pos:[2]},TC1IE:{pos:[3]},CMPIE:{pos:[4]}}}
recipes:
  asm_macros: "#define EI() __asm__(\" ei \")\\n#define DI() __asm__(\" di \")\\n#define NOP() __asm__(\" nop \")\\n#define CWDT() __asm__(\" cwdt \")\\n#define CONTW(V) __asm__(\"mov a,@\"#V\"\\n ctw\")\\n#define IOCP_W(R,V) __asm__(\"mov a,@\"#V\"\\n iw \"#R)\\n#define PUSH(A,R3) __asm__(\"mov \"#A\",a\\n swap \"#A\"\\n swapa STATUS\\n mov \"#R3\",a\")\\n#define POP(A,R3) __asm__(\"swapa \"#R3\"\\n mov STATUS,a\\n swapa \"#A)"
  clram: "void f(){for(RSR=0xD0;RSR<0xFF;RSR++){IAR=0;}IAR=0;}"
  isr: "void int_isr(void)__interrupt{__asm__(\"org 0x08\");PUSH(_A_BUFF,_R3_BUFF);if(TC0IF){INTF=0xFE;TC0C+=6;}if(CMPIF){INTF=0xEF;}POP(_A_BUFF,_R3_BUFF);}"
skeleton:
  init_func: "void f(){DI();IOCP_W(WDTCON,0x00);CONTW(0x82);TC0C=6;PORT5=0;PORT6=0;IOCP_W(P5CON,0x00);IOCP_W(P6CON,0x00);IOCP_W(INTE,0x01);INTF=0;}"
  main_func: "void main(void){file_clrRam();file_init();EI();while(1){CWDT();}}"
""")

# ==== 5. XC8E955E (EEPROM, 86\u98ce\u683c\u547d\u540d) ====
w("xc8e955e用法.yaml", """# XC8E955E - \u4f20\u7edf\u7cfb\u5217(\u5e26EEPROM,\u547d\u540d\u504f86\u98ce\u683c)
params:
  chip: XC8E955E; rom: 1Kx14bit+EEPROM; ram: 48B(0x10~0x3F); stack: 5\u7ea7
  gpio: P5(4bit)+P6(4bit); timers: TCC+T1+T2
  features: \u5e26E2PROM,TCC/ISR/IMR\u98ce\u683c\u547d\u540d
# \u6ce8\u610f: \u5bc4\u5b58\u5668\u547d\u540d\u504f86\u98ce\u683c(TCC\u66ff\u4ee3TC0C,ISR\u66ff\u4ee3INTF,IMR\u66ff\u4ee3INTE)
# P6CR\u66ff\u4ee3P6CON, PHCR\u66ff\u4ee3P6PH, PDCR\u66ff\u4ee3P6PD
# EEPROM\u5bc4\u5b58\u5668\u8bf7\u53c2\u8003\u4e13\u7528Datasheet
registers:
  - page: RPAGE
    list:
      - {addr:0x00,name:IAR,bits:{IAR:{pos:[7,0]}}}
      - {addr:0x01,name:TCC,bits:{TCC:{pos:[7,0]}}}
      - {addr:0x04,name:RSR,bits:{RSR:{pos:[5,0]}}}
      - {addr:0x06,name:PORT6,bits:{P6:{pos:[3,0]}}}
      - {addr:0x0E,name:CPUCON,bits:{STPHX:{pos:[2]},CLKMD:{pos:[1]},IDLE:{pos:[0]}}}
      - {addr:0x0F,name:ISR,bits:{TCIF:{pos:[0]},ICIF:{pos:[1]},EXIF:{pos:[2]},T1IF:{pos:[3]}}}
  - page: IOC
    list:
      - {addr:0x01,name:CONT,bits:{INT:{pos:[6]},TS:{pos:[5]},TE:{pos:[4]},PAB:{pos:[3]},PSR:{pos:[2,0]}}}
      - {addr:0x06,name:P6CR,bits:{P6CR:{pos:[3,0],vals:{0:\u8f93\u51fa,1:\u8f93\u5165}}}}
      - {addr:0x0D,name:PHCR,bits:{PHCR:{pos:[3,0],vals:{0:\u4f7f\u80fd,1:\u7981\u6b62}}}}
      - {addr:0x0B,name:PDCR,bits:{PDCR:{pos:[3,0],vals:{0:\u4f7f\u80fd,1:\u7981\u6b62}}}}
      - {addr:0x0E,name:WDTCR,bits:{WDTEN:{pos:[7]}}}
      - {addr:0x0F,name:IMR,bits:{TCIE:{pos:[0]},ICIE:{pos:[1]},EXIE:{pos:[2]},T1IE:{pos:[3]}}}
recipes:
  asm_macros: "#define EI() __asm__(\" ei \")\\n#define DI() __asm__(\" di \")\\n#define NOP() __asm__(\" nop \")\\n#define CWDT() __asm__(\" cwdt \")\\n#define CONTW(V) __asm__(\"mov a,@\"#V\"\\n ctw\")\\n#define IOCP_W(R,V) __asm__(\"mov a,@\"#V\"\\n iw \"#R)\\n#define PUSH(A,R3) __asm__(\"mov \"#A\",a\\n swap \"#A\"\\n swapa STATUS\\n mov \"#R3\",a\")\\n#define POP(A,R3) __asm__(\"swapa \"#R3\"\\n mov STATUS,a\\n swapa \"#A)"
  clram: "void f(){for(RSR=0xD0;RSR<0xFF;RSR++){IAR=0;}IAR=0;}"
  isr: "void int_isr(void)__interrupt{__asm__(\"org 0x08\");PUSH(_A_BUFF,_R3_BUFF);if(TCIF){ISR=0xFE;TCC+=6;}POP(_A_BUFF,_R3_BUFF);}"
skeleton:
  includes: '#include "XC8E955E.h"'
  global_vars: "volatile __at(0x10)unsigned char A_BUFF;volatile __at(0x11)unsigned char R3_BUFF;"
  init_func: "void f(){DI();IOCP_W(WDTCR,0x00);CONTW(0x82);TCC=6;PORT6=0;IOCP_W(P6CR,0x00);IOCP_W(PHCR,0xFF);IOCP_W(PDCR,0xFF);IOCP_W(IMR,0x01);ISR=0;}"
  main_func: "void main(void){file_clrRam();file_init();EI();while(1){CWDT();}}"
""")

# ==== \u9a8c\u8bc1 ====
import yaml, glob
ok = fail = 0
for f in sorted(glob.glob(OUT + "/*8521*.yaml") + glob.glob(OUT + "/*9510*.yaml") + glob.glob(OUT + "/*952[0157]*.yaml") + glob.glob(OUT + "/*955E*.yaml")):
    try:
        with open(f, "r", encoding="utf-8") as fh:
            yaml.safe_load(fh)
        ok += 1
    except Exception as e:
        fail += 1
        print(f"FAIL {os.path.basename(f)}: {str(e).split(chr(10))[0][:80]}")
print(f"{ok} OK, {fail} FAIL (expected: 6 files: 8521/9510/9520/9521/9525/9527/955E)")

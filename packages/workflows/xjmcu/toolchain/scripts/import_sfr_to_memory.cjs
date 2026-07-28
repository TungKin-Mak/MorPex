/**
 * 将 XC8P8616 SFR 位级知识导入 MorPex 记忆系统
 * 数据来源：E:/矽杰微/mcu_datasheet_md/XC8P8616.md 寄存器表格
 * 导入目标：E:/Morpex/data/memory.db → kg_entities
 */
const BetterDB = require('better-sqlite3');
const db = new BetterDB('E:/Morpex/data/memory.db');
const now = Date.now();

const sfrs = [
  { name: 'ADCON0', address: '0x1A6', bits: {
      bit0: { name: 'VREFOUT', desc: 'VREF输出使能(P65)' },
      bit1: { name: 'EXTVS', desc: '1/4分压源: 0=VDD, 1=P65' },
      bit2: { name: 'VCMPS', desc: '比较器基准: 0=VREF, 1=VDD' },
      bit3: { name: 'ADIS<0>', desc: '通道选择 bit0' },
      bit4: { name: 'ADIS<1>', desc: '通道选择 bit1' },
      bit5: { name: 'ADIS<2>', desc: '通道选择 bit2' },
      bit6: { name: 'ADIS<3>', desc: '通道选择 bit3' },
      bit7: { name: 'ADIS<4>', desc: '通道选择 bit4' } },
    channel_map: { '00000': 'AIN0/P50','00001': 'AIN1/P51','00010': 'AIN2/P52','00011': 'AIN3/P53',
      '00100': 'AIN4/P54','00101': 'AIN5/P55','00110': 'AIN6/P60','00111': 'AIN7/P61',
      '01000': 'AIN8/P62','01001': 'AIN9/P63','01010': 'AIN10/P64','01011': 'AIN11/P65',
      '01100': 'AIN12/P66','01101': 'AIN13/P67','01110': '0.25xVDD/P65','01111': 'GND' } },

  { name: 'ADCON1', address: '0x1A7', bits: {
      bit0: { name: 'VREF<0>', desc: '基准电压 bit0' },
      bit1: { name: 'VREF<1>', desc: '基准电压 bit1' },
      bit2: { name: 'VREF<2>', desc: '基准电压 bit2: 000=VBG1.2V 001=2V 010=3V 011=4V 100=EXVREF 101=VDD' },
      bit3: { name: 'ADCGATE', desc: 'ADC触发: 0=软件 1=PWM7占空比下降沿' },
      bit4: { name: 'ADPSR<0>', desc: 'ADC时钟分频 bit0: 00=Fosc/16 01=Fosc/4 10=Fosc/64 11=Fosc/1' },
      bit5: { name: 'ADPSR<1>', desc: 'ADC时钟分频 bit1' },
      bit6: { name: 'ADEN', desc: 'ADC使能' },
      bit7: { name: 'ADRUN', desc: '启动转换(转换结束自动清0)' } } },

  { name: 'TC1CON', address: '0x1B0', bits: {
      bit0: { name: 'TC1PSR<0>', desc: '预分频: 000=2 001=4 010=8 011=16 100=32 101=64 110=128 111=256' },
      bit1: { name: 'TC1PSR<1>', desc: '预分频 bit1' },
      bit2: { name: 'TC1PSR<2>', desc: '预分频 bit2' },
      bit3: { name: 'TC1PTEN', desc: '预分频器使能' },
      bit4: { name: 'TC1CKS', desc: '时钟源: 0=系统时钟 1=外部(P62)' },
      bit5: { name: 'PWM1GATE', desc: 'PWM1门控: 0=直通 1=CMP结果控制' },
      bit6: { name: 'TC21EN', desc: 'TC2级联使能(TC1+TC2)' },
      bit7: { name: 'TC1EN', desc: 'TC1使能' } } },

  { name: 'TC2CON', address: '0x1B8', bits: {
      bit0: { name: 'TC2PSR<0>', desc: '预分频 bit0' },
      bit1: { name: 'TC2PSR<1>', desc: '预分频 bit1' },
      bit2: { name: 'TC2PSR<2>', desc: '预分频 bit2' },
      bit3: { name: 'TC2PTEN', desc: '预分频器使能' },
      bit4: { name: 'TC2CKS', desc: '时钟源: 0=系统时钟 1=外部' },
      bit5: { name: 'PWM4GATE<0>', desc: 'PWM4门控 bit0' },
      bit6: { name: 'PWM4GATE<1>', desc: 'PWM4门控 bit1: 00=直通 01=CMP 10=EXINT' },
      bit7: { name: 'TC2EN', desc: 'TC2使能' } } },

  { name: 'PWMCON1', address: '0x1B7', bits: {
      bit0: { name: 'PWM1EN', desc: 'PWM1使能' },
      bit1: { name: 'PWM2EN', desc: 'PWM2使能' },
      bit2: { name: 'PWM3EN', desc: 'PWM3使能' },
      bit3: { name: 'IPWM1EN', desc: 'IPWM1使能(PWM2 XOR PWM3)' },
      bit4: { name: 'PWM1S', desc: '输出选择: 0=P60 1=P66' },
      bit5: { name: 'PWM2S', desc: '输出选择: 0=P61 1=P67' },
      bit6: { name: 'PWM3S', desc: '输出选择: 0=P63 1=P55' },
      bit7: { name: 'BZ1EN', desc: '蜂鸣器1使能(P60/P66)' } } },

  { name: 'PWMCON2', address: '0x1BF', bits: {
      bit0: { name: 'PWM4EN', desc: 'PWM4使能' },
      bit1: { name: 'PWM5EN', desc: 'PWM5使能' },
      bit2: { name: 'PWM6EN', desc: 'PWM6使能' },
      bit3: { name: 'IPWM4EN', desc: 'IPWM4使能(PWM5 XOR PWM6)' },
      bit4: { name: 'PWM4S', desc: '输出选择: 0=P64 1=P50' },
      bit5: { name: 'PWM5S', desc: '输出选择: 0=P62 1=P51' },
      bit6: { name: 'PWM6S', desc: '输出选择: 0=P55 1=P52' },
      bit7: { name: 'BZ2EN', desc: '蜂鸣器2使能(P50/P64)' } } },

  { name: 'PWM7CON', address: '0x1C3', bits: {
      bit0: { name: 'PWM7DT<8>', desc: '占空比高2位 bit0' },
      bit1: { name: 'PWM7DT<9>', desc: '占空比高2位 bit1' },
      bit2: { name: 'PWM7EN', desc: 'PWM7使能' },
      bit3: { name: 'PWM7S', desc: '输出选择: 0=P65 1=P53' },
      bit4: { name: 'PWM_PULSEEN', desc: '脉冲使能' },
      bit5: { name: 'PWMINV<4>', desc: 'PWM4输出取反' },
      bit6: { name: 'PWMINV<5>', desc: 'PWM5输出取反' },
      bit7: { name: 'PWMINV<6>', desc: 'PWM6输出取反' } } },

  { name: 'INTE0', address: '0x1D6', bits: {
      bit0: { name: 'TC0IE', desc: 'TC0溢出中断使能' },
      bit1: { name: 'TC1IE', desc: 'TC1周期匹配中断使能' },
      bit2: { name: 'TC2IE', desc: 'TC2周期匹配中断使能' },
      bit3: { name: 'P5ICIE', desc: 'P5端口变化中断使能' },
      bit4: { name: 'P6ICIE', desc: 'P6端口变化中断使能' },
      bit5: { name: 'CMPIE', desc: '比较器结果变化中断使能' },
      bit6: { name: 'ADIE', desc: 'ADC转换完成中断使能' },
      bit7: { name: 'PWM7DTIE', desc: 'PWM7占空比匹配中断使能' } } },

  { name: 'INTF0', address: '0x1DA', bits: {
      bit0: { name: 'TC0IF', desc: 'TC0溢出中断标志' },
      bit1: { name: 'TC1IF', desc: 'TC1周期匹配中断标志' },
      bit2: { name: 'TC2IF', desc: 'TC2周期匹配中断标志' },
      bit3: { name: 'P5ICIF', desc: 'P5端口变化中断标志' },
      bit4: { name: 'P6ICIF', desc: 'P6端口变化中断标志' },
      bit5: { name: 'CMPIF', desc: '比较器结果变化中断标志' },
      bit6: { name: 'ADIF', desc: 'ADC转换完成中断标志' },
      bit7: { name: 'PWM7DTIF', desc: 'PWM7占空比匹配中断标志' } } },

  { name: 'TC0CON', address: '0x184', bits: {
      bit0: { name: 'TC0PSR<0>', desc: '预分频: 000=2 001=4 010=8 011=16 100=32 101=64 110=128 111=256' },
      bit1: { name: 'TC0PSR<1>', desc: '预分频 bit1' },
      bit2: { name: 'TC0PSR<2>', desc: '预分频 bit2' },
      bit3: { name: 'TC0PTEN', desc: '预分频器使能' },
      bit4: { name: 'TC0EDG', desc: '外部边沿: 0=下降沿 1=上升沿' },
      bit5: { name: 'TC0CKS<0>', desc: '时钟: 00=指令 01=P62 10=系统 11=ILRC' },
      bit6: { name: 'TC0CKS<1>', desc: '时钟 bit1' },
      bit7: { name: 'TC0EN', desc: 'TC0使能' } } },

  { name: 'TC1PRDL', address: '0x1B1', bits: gen_data_bits('TC1PRD', '周期低8位') },
  { name: 'TC1PRDTH', address: '0x1B5', bits: gen_mux_bits() },
  { name: 'PWM1DTL', address: '0x1B2', bits: gen_data_bits('PWM1DT', '占空比低8位') },
  { name: 'PWM2DTL', address: '0x1B3', bits: gen_data_bits('PWM2DT', '占空比低8位') },
  { name: 'PWM3DTL', address: '0x1B4', bits: gen_data_bits('PWM3DT', '占空比低8位') },
  { name: 'TC2PRDL', address: '0x1B9', bits: gen_data_bits('TC2PRD', '周期低8位') },
  { name: 'TC2PRDTH', address: '0x1BD', bits: gen_mux_bits2() },
  { name: 'PWM4DTL', address: '0x1BA', bits: gen_data_bits('PWM4DT', '占空比低8位') },
  { name: 'PWM5DTL', address: '0x1BB', bits: gen_data_bits('PWM5DT', '占空比低8位') },
  { name: 'PWM6DTL', address: '0x1BC', bits: gen_data_bits('PWM6DT', '占空比低8位') },
  { name: 'PWM7DTL', address: '0x1C2', bits: gen_data_bits('PWM7DT', '占空比低8位') },
  { name: 'ADATH0', address: '0x1A3', bits: gen_data_bits('ADAT', 'ADC数据高8位') },
  { name: 'ADATL', address: '0x1A4', bits: gen_data_bits('ADAT', 'ADC数据低8位') },
  { name: 'ADATH1', address: '0x1A5', bits: gen_data_bits('ADAT', 'ADC数据高4位', 4) },
  { name: 'CMPCON0', address: '0x1C8', bits: {
      bit0: { name: 'CMPRS<0>', desc: '分压电阻修调 bit0' },
      bit1: { name: 'CMPRS<1>', desc: '分压电阻修调 bit1' },
      bit2: { name: 'CMPRS<2>', desc: '分压电阻修调 bit2' },
      bit3: { name: 'CMPRS<3>', desc: '分压电阻修调 bit3' },
      bit4: { name: 'CMPRS<4>', desc: '分压电阻修调 bit4' },
      bit5: { name: 'CMPRS<5>', desc: '分压电阻修调 bit5' },
      bit6: { name: 'CMPOUT', desc: '比较器输出(只读): 1=正>负' },
      bit7: { name: 'CMPEN', desc: '比较器使能' } } },
  { name: 'CMPCON1', address: '0x1C9', bits: {
      bit0: { name: 'CMPIS<0>', desc: '输入选择 bit0' },
      bit1: { name: 'CMPIS<1>', desc: '输入选择 bit1' },
      bit2: { name: 'CMPIS<2>', desc: '输入选择 bit2' },
      bit3: { name: 'CMPIS<3>', desc: '输入选择 bit3' },
      bit4: { name: 'CMPIS<4>', desc: '输入选择 bit4' },
      bit5: { name: 'CMPIS<5>', desc: '输入选择 bit5' },
      bit6: { name: 'CMPINV', desc: '输出取反' },
      bit7: { name: 'CMPOE', desc: '输出使能到P67' } } },
  { name: 'EXINTCON', address: '0x1AE', bits: {
      bit0: { name: 'CMPGATE', desc: 'CMP门控TC0捕获使能' },
      bit1: { name: 'INTGATE', desc: 'INT门控TC0捕获使能' },
      bit2: { name: 'INTEN', desc: '外部中断使能(P60)' },
      bit3: { name: 'INTEDG', desc: '触发边沿: 0=下降沿 1=上升沿' },
      bit4: { name: 'INTIE', desc: '外部中断中断使能' },
      bit5: { name: 'INTIF', desc: '外部中断标志(写0清除)' },
      bit6: { name: 'INTWE', desc: 'INT唤醒使能' } } },
  { name: 'WDTCON', address: '0x1AF', bits: {
      bit3: { name: 'RTCS', desc: 'RTC时钟源选择' },
      bit4: { name: 'LVREN', desc: '低电压复位使能' },
      bit5: { name: 'WDTPSR<0>', desc: 'WDT分频 bit0' },
      bit6: { name: 'WDTPSR<1>', desc: 'WDT分频 bit1' },
      bit7: { name: 'WDTE', desc: 'WDT使能' } } },
  { name: 'CPUCON', address: '0x188', bits: {
      bit0: { name: 'IDLE', desc: 'IDLE模式' },
      bit1: { name: 'CLKMD', desc: '时钟模式' },
      bit2: { name: 'STPHX', desc: 'HXT停止' },
      bit3: { name: 'TC0WE', desc: 'TC0写使能' },
      bit4: { name: 'TC1WE', desc: 'TC1写使能' },
      bit5: { name: 'TC2WE', desc: 'TC2写使能' },
      bit6: { name: 'CMPWE', desc: 'CMP写使能' },
      bit7: { name: 'ADCWE', desc: 'ADC写使能' } } },
  { name: 'TBRDH', address: '0x186', bits: {
      bit0: { name: 'RBIT<8>', desc: '查表指针 bit8' },
      bit1: { name: 'RBIT<9>', desc: '查表指针 bit9' },
      bit2: { name: 'RBIT<10>', desc: '查表指针 bit10' },
      bit4: { name: 'VDD_POWER', desc: 'VDD电源域(必须为1)' },
      bit6: { name: 'PWM1_LEDEN', desc: 'PWM1 LED级联使能' },
      bit7: { name: 'PWM4_LEDEN', desc: 'PWM4 LED级联使能' } } },
  { name: 'STATUS', address: '0x183', bits: {
      bit0: { name: 'C', desc: '进位标志' },
      bit1: { name: 'DC', desc: '辅助进位标志' },
      bit2: { name: 'Z', desc: '零标志' },
      bit3: { name: 'P', desc: '页标志' },
      bit4: { name: 'T', desc: '时基标志' },
      bit6: { name: 'GIE', desc: '全局中断使能' },
      bit7: { name: 'RST', desc: '复位标志' } } },
  { name: 'P5CON', address: '0x18D', bits: gen_gpio_bits('P5CON', 6) },
  { name: 'P6CON', address: '0x18E', bits: gen_gpio_bits('P6CON', 8) },
  { name: 'P5PH', address: '0x190', bits: gen_gpio_bits('P5PH', 6) },
  { name: 'P6PH', address: '0x191', bits: gen_gpio_bits('P6PH', 8) },
  { name: 'P5PD', address: '0x193', bits: gen_gpio_bits('P5PD', 6) },
  { name: 'P6PD', address: '0x194', bits: gen_gpio_bits('P6PD', 8) },
  { name: 'P5AE', address: '0x1A0', bits: gen_gpio_bits('P5AE', 6) },
  { name: 'P6AE', address: '0x1A1', bits: gen_gpio_bits('P6AE', 8) },
];

// 辅助函数
function gen_data_bits(base, desc, count = 8) {
  const bits = {};
  for (let i = 0; i < count; i++) {
    bits['bit' + i] = { name: base + '<' + i + '>', desc: desc + ' bit' + i };
  }
  // 对于ADATH1(高4位)，实际对应bit8~11
  if (count === 4 && base === 'ADAT') {
    for (let i = 0; i < 4; i++) {
      bits['bit' + i] = { name: 'ADAT<' + (i + 8) + '>', desc: 'ADC数据 bit' + (i + 8) };
    }
  }
  return bits;
}

function gen_gpio_bits(base, count) {
  const bits = {};
  const reg = base.replace(/[0-9]/g, '');
  const port = base.replace(/[A-Z]/g, '');
  for (let i = 0; i < count; i++) {
    bits['bit' + i] = { name: base + '<' + i + '>', desc: port + i + ' ' + (base.includes('CON') ? '方向(0=输出 1=输入)' : base.includes('PH') ? '上拉(0=使能 1=禁止)' : base.includes('PD') ? '下拉(0=使能 1=禁止)' : base.includes('AE') ? '模拟口(1=模拟)' : '') };
  }
  return bits;
}

function gen_mux_bits() {
  return {
    bit0: { name: 'PWM1DT<8>', desc: 'PWM1占空比高2位 bit0' },
    bit1: { name: 'PWM1DT<9>', desc: 'PWM1占空比高2位 bit1' },
    bit2: { name: 'PWM2DT<8>', desc: 'PWM2占空比高2位 bit0' },
    bit3: { name: 'PWM2DT<9>', desc: 'PWM2占空比高2位 bit1' },
    bit4: { name: 'PWM3DT<8>', desc: 'PWM3占空比高2位 bit0' },
    bit5: { name: 'PWM3DT<9>', desc: 'PWM3占空比高2位 bit1' },
    bit6: { name: 'TC1PRD<8>', desc: '周期高2位 bit0' },
    bit7: { name: 'TC1PRD<9>', desc: '周期高2位 bit1' },
  };
}

function gen_mux_bits2() {
  return {
    bit0: { name: 'PWM4DT<8>', desc: 'PWM4占空比高2位 bit0' },
    bit1: { name: 'PWM4DT<9>', desc: 'PWM4占空比高2位 bit1' },
    bit2: { name: 'PWM5DT<8>', desc: 'PWM5占空比高2位 bit0' },
    bit3: { name: 'PWM5DT<9>', desc: 'PWM5占空比高2位 bit1' },
    bit4: { name: 'PWM6DT<8>', desc: 'PWM6占空比高2位 bit0' },
    bit5: { name: 'PWM6DT<9>', desc: 'PWM6占空比高2位 bit1' },
    bit6: { name: 'TC2PRD<8>', desc: '周期高2位 bit0' },
    bit7: { name: 'TC2PRD<9>', desc: '周期高2位 bit1' },
  };
}

// 写入数据库
const upsert = db.prepare("INSERT OR REPLACE INTO kg_entities (id, type, name, domain, data_json, importance, created_at, updated_at) VALUES (?, 'SFR', ?, 'embedded', ?, 0.8, ?, ?)");

for (const sfr of sfrs) {
  const data = { address: sfr.address, bits: sfr.bits, channel_map: sfr.channel_map || null };
  const id = 'reg_' + sfr.name.toLowerCase();
  upsert.run(id, sfr.name, JSON.stringify(data), now, now);
  console.log('OK: ' + sfr.name);
}

const count = db.prepare("SELECT COUNT(*) as c FROM kg_entities WHERE type='SFR'").get();
console.log('\n记忆系统 SFR 总数: ' + count.c);
db.close();

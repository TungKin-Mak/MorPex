/**
 * scripts/batch-tasks.ts — 50 个真实任务集（多行业多场景）
 *
 * 行业分布：ecommerce/hardware/software/xjmcu 各 ≥12 + 跨域 2
 * 场景覆盖：常规成功 / 需审批（风险/合规触发）/ 复杂多步（DAG）/ 规则相关（keyword/白名单）
 */

export interface BatchTask {
  /** 任务目标 */
  goal: string;
  /** 部门 */
  departmentName: string;
  /** 期望（汇总参考，不断言死） */
  expected?: 'success' | 'either';
  /** 场景标签 */
  tags?: string[];
}

export const TASKS: BatchTask[] = [
  // ══════════ ecommerce（12）══════════
  { goal: '为电商部门生成商品价格合规检查方案并执行：检查价格披露是否含税、有无虚假紧迫感，输出检查报告产物', departmentName: 'ecommerce', expected: 'success', tags: ['rule-keyword', 'artifact'] },
  { goal: '制定电商商品 listing 优化清单：标题、五点描述、关键词布局，输出优化建议文档', departmentName: 'ecommerce', expected: 'success', tags: ['artifact'] },
  { goal: '评估电商退货退款流程的合规风险：列出可能导致平台处罚的环节并给出整改方案', departmentName: 'ecommerce', expected: 'success', tags: ['compliance'] },
  { goal: '分析电商广告投放预算分配：按品类 ROI 给出预算优化建议并输出报告', departmentName: 'ecommerce', expected: 'success', tags: ['budget'] },
  { goal: '生成电商库存预警机制方案：滞销品识别、补货阈值、缺货风险应对', departmentName: 'ecommerce', expected: 'success', tags: ['planning'] },
  { goal: '审查电商商品详情页文案合规性：禁用词、夸大宣传、虚假承诺检查并输出审查报告', departmentName: 'ecommerce', expected: 'success', tags: ['rule-keyword'] },
  { goal: '制定电商大促活动排期方案：预热、爆发、返场各阶段动作清单与执行计划', departmentName: 'ecommerce', expected: 'success', tags: ['planning'] },
  { goal: '评估跨境电商物流方案：对比时效、成本、清关风险，输出推荐方案', departmentName: 'ecommerce', expected: 'success', tags: ['risk'] },
  { goal: '生成电商客服话术规范：售前咨询、售后纠纷、差评应对的标准话术模板', departmentName: 'ecommerce', expected: 'success', tags: ['artifact'] },
  { goal: '分析电商用户评价数据并提出改进建议：差评归因、好评引导、评分提升策略', departmentName: 'ecommerce', expected: 'success', tags: ['analysis'] },
  { goal: '制定电商多平台店铺运营周报模板：销售、流量、转化、广告四维指标框架', departmentName: 'ecommerce', expected: 'success', tags: ['artifact'] },
  { goal: '生成电商供应商准入评估标准：资质、质量、价格、交期四维评分体系文档', departmentName: 'ecommerce', expected: 'success', tags: ['artifact'] },

  // ══════════ hardware（12）══════════
  { goal: '为硬件部门生成嵌入式固件开发方案：需求分析、架构设计、模块划分，输出开发计划', departmentName: 'hardware', expected: 'success', tags: ['planning', 'firmware'] },
  { goal: '制定硬件电路板设计审查清单：电源、信号完整性、EMC、热设计检查项', departmentName: 'hardware', expected: 'success', tags: ['artifact'] },
  { goal: '评估硬件产品 BOM 成本优化空间：元器件替代、采购策略、降本方案', departmentName: 'hardware', expected: 'success', tags: ['budget', 'risk'] },
  { goal: '生成硬件测试计划：功能测试、环境测试、可靠性测试用例设计框架', departmentName: 'hardware', expected: 'success', tags: ['planning'] },
  { goal: '制定硬件量产导入方案：试产、验证、工装、良率目标与风险预案', departmentName: 'hardware', expected: 'success', tags: ['risk'] },
  { goal: '评估硬件产品认证要求：CE/FCC/CCC 等合规路径与测试项清单', departmentName: 'hardware', expected: 'success', tags: ['compliance'] },
  { goal: '生成硬件散热设计方案：功耗估算、散热方案选型、热仿真要点', departmentName: 'hardware', expected: 'success', tags: ['planning'] },
  { goal: '制定硬件供应商质量管理规范：来料检验、过程管控、质量追溯体系', departmentName: 'hardware', expected: 'success', tags: ['artifact'] },
  { goal: '评估硬件产品信息安全风险：固件漏洞、通信安全、数据保护分析报告', departmentName: 'hardware', expected: 'success', tags: ['risk', 'security'] },
  { goal: '生成硬件开发里程碑计划：立项、设计、打样、测试、量产五阶段时间表', departmentName: 'hardware', expected: 'success', tags: ['planning'] },
  { goal: '制定硬件固件升级策略：OTA 方案、版本管理、回滚机制设计', departmentName: 'hardware', expected: 'success', tags: ['firmware'] },
  { goal: '评估硬件产品生命周期管理：停产、备件、售后支持策略报告', departmentName: 'hardware', expected: 'success', tags: ['analysis'] },

  // ══════════ software（12）══════════
  { goal: '为软件部门生成代码审查方案：审查流程、检查项清单、工具链配置建议', departmentName: 'software', expected: 'success', tags: ['planning'] },
  { goal: '制定软件 CI/CD 流水线优化方案：构建、测试、部署各阶段改进建议', departmentName: 'software', expected: 'success', tags: ['planning'] },
  { goal: '评估软件技术债：代码质量、依赖健康度、架构风险分析报告', departmentName: 'software', expected: 'success', tags: ['risk', 'analysis'] },
  { goal: '生成软件安全编码规范：输入校验、加密、认证授权、日志安全要点', departmentName: 'software', expected: 'success', tags: ['security', 'artifact'] },
  { goal: '制定软件测试策略：单元、集成、端到端、性能测试覆盖计划', departmentName: 'software', expected: 'success', tags: ['planning'] },
  { goal: '评估软件依赖风险：第三方库漏洞、许可证合规、升级策略报告', departmentName: 'software', expected: 'success', tags: ['risk', 'compliance'] },
  { goal: '生成软件 API 设计规范：REST 风格、错误处理、版本管理、文档要求', departmentName: 'software', expected: 'success', tags: ['artifact'] },
  { goal: '制定软件发布管理流程：版本规划、发布检查清单、回滚预案', departmentName: 'software', expected: 'success', tags: ['planning'] },
  { goal: '评估软件性能瓶颈：从架构、代码、数据库三层面分析优化方向', departmentName: 'software', expected: 'success', tags: ['analysis'] },
  { goal: '生成软件可观测性方案：日志、指标、追踪三支柱落地建议', departmentName: 'software', expected: 'success', tags: ['planning'] },
  { goal: '制定软件团队协作规范：Git 分支策略、Code Review、文档文化', departmentName: 'software', expected: 'success', tags: ['artifact'] },
  { goal: '评估软件迁移风险：遗留系统改造、数据迁移、双跑方案分析', departmentName: 'software', expected: 'success', tags: ['risk'] },

  // ══════════ xjmcu（12）══════════
  { goal: '为 MCU 部门生成微控制器初始化方案：时钟树、GPIO、外设配置清单，输出初始化代码设计', departmentName: 'xjmcu', expected: 'success', tags: ['mcu', 'rule-whitelist'] },
  { goal: '制定 MCU 中断处理设计规范：NVIC 配置、中断优先级、临界区保护要点', departmentName: 'xjmcu', expected: 'success', tags: ['mcu', 'rule-whitelist', 'interrupt'] },
  { goal: '评估 MCU 低功耗方案：睡眠模式选择、外设功耗、唤醒源设计报告', departmentName: 'xjmcu', expected: 'success', tags: ['mcu', 'analysis'] },
  { goal: '生成 MCU 通信接口设计：UART/SPI/I2C 选型与配置要点文档', departmentName: 'xjmcu', expected: 'success', tags: ['mcu', 'artifact'] },
  { goal: '制定 MCU 内存管理方案：Flash/RAM 分配、堆栈设置、内存保护策略', departmentName: 'xjmcu', expected: 'success', tags: ['mcu', 'planning'] },
  { goal: '评估 MCU 固件升级可靠性：Bootloader 设计、升级失败恢复、校验机制', departmentName: 'xjmcu', expected: 'success', tags: ['mcu', 'risk'] },
  { goal: '生成 MCU 外设驱动开发规范：寄存器操作、驱动分层、错误处理要点', departmentName: 'xjmcu', expected: 'success', tags: ['mcu', 'artifact'] },
  { goal: '制定 MCU 实时性保障方案：RTOS 选型、任务划分、时序分析', departmentName: 'xjmcu', expected: 'success', tags: ['mcu', 'planning'] },
  { goal: '评估 MCU 产品 EMC 风险：引脚噪声、PCB 布局、滤波方案分析', departmentName: 'xjmcu', expected: 'success', tags: ['mcu', 'risk'] },
  { goal: '生成 MCU 调试与测试方案：JTAG/SWD、日志输出、单元测试框架选择', departmentName: 'xjmcu', expected: 'success', tags: ['mcu', 'planning'] },
  { goal: '制定 MCU 代码规范：命名、注释、模块化、静态检查工具配置', departmentName: 'xjmcu', expected: 'success', tags: ['mcu', 'artifact'] },
  { goal: '评估 MCU 量产烧录方案：烧录方式、序列号管理、产测流程设计', departmentName: 'xjmcu', expected: 'success', tags: ['mcu', 'planning'] },

  // ══════════ 跨域（2）══════════
  { goal: '制定电商+硬件跨部门联合项目方案：智能硬件产品从设计到上架的全流程协作计划', departmentName: 'ecommerce', expected: 'success', tags: ['cross-domain', 'planning'] },
  { goal: '评估软件+MCU 联合开发风险：固件与上层软件接口、版本对齐、联调计划报告', departmentName: 'xjmcu', expected: 'success', tags: ['cross-domain', 'risk'] },

  // ========== 追加批次（100 任务）==========
  { goal: '制定电商库存预警方案：库存周转、滞销处理、补货策略', departmentName: 'ecommerce', expected: 'success', tags: ['ecommerce', 'planning'] },
  { goal: '评估电商物流时效风险：配送延误、偏远地区覆盖、物流商选择', departmentName: 'ecommerce', expected: 'success', tags: ['ecommerce', 'planning'] },
  { goal: '生成电商广告投放策略：关键词、预算分配、效果追踪方案', departmentName: 'ecommerce', expected: 'success', tags: ['ecommerce', 'planning'] },
  { goal: '制定电商差评处理流程：差评分类、回复模板、跟进机制', departmentName: 'ecommerce', expected: 'success', tags: ['ecommerce', 'planning'] },
  { goal: '评估电商供应商合规：资质审查、商品来源、质量标准', departmentName: 'ecommerce', expected: 'success', tags: ['ecommerce', 'planning'] },
  { goal: '制定电商促销活动规则：折扣、满减、限购、活动排期', departmentName: 'ecommerce', expected: 'success', tags: ['ecommerce', 'planning'] },
  { goal: '生成电商税费计算说明：各类目税率、跨境税费、申报要点', departmentName: 'ecommerce', expected: 'success', tags: ['ecommerce', 'planning'] },
  { goal: '制定电商客服响应规范：响应时效、话术、升级路径', departmentName: 'ecommerce', expected: 'success', tags: ['ecommerce', 'planning'] },
  { goal: '生成电商销售数据分析报告：销售额、转化率、客单价趋势', departmentName: 'ecommerce', expected: 'success', tags: ['ecommerce', 'planning'] },
  { goal: '制定电商选品策略：市场调研、竞品分析、品类组合', departmentName: 'ecommerce', expected: 'success', tags: ['ecommerce', 'planning'] },
  { goal: '生成电商品牌页优化建议：品牌故事、视觉规范、转化路径', departmentName: 'ecommerce', expected: 'success', tags: ['ecommerce', 'planning'] },
  { goal: '制定电商多站点运营方案：区域市场、本地化、物流适配', departmentName: 'ecommerce', expected: 'success', tags: ['ecommerce', 'planning'] },
  { goal: '生成硬件 PCB 布局规范：层叠、走线、去耦、热设计', departmentName: 'hardware', expected: 'success', tags: ['hardware', 'planning'] },
  { goal: '制定硬件电源设计方案：LDO/DC-DC 选型、纹波、热耗', departmentName: 'hardware', expected: 'success', tags: ['hardware', 'planning'] },
  { goal: '评估硬件传感器选型：精度、功耗、接口、环境适应性', departmentName: 'hardware', expected: 'success', tags: ['hardware', 'planning'] },
  { goal: '制定硬件产品外壳设计要求：材质、结构、散热、防水', departmentName: 'hardware', expected: 'success', tags: ['hardware', 'planning'] },
  { goal: '评估硬件认证合规：CE/FCC/CCC 要求、测试项、文档准备', departmentName: 'hardware', expected: 'success', tags: ['hardware', 'planning'] },
  { goal: '制定硬件散热方案：被动散热、风扇、热管、散热模拟', departmentName: 'hardware', expected: 'success', tags: ['hardware', 'planning'] },
  { goal: '生成硬件电池管理方案：充放电、保护、电量计、安全', departmentName: 'hardware', expected: 'success', tags: ['hardware', 'planning'] },
  { goal: '制定硬件连接器选型：接口类型、引脚数、可靠性、成本', departmentName: 'hardware', expected: 'success', tags: ['hardware', 'planning'] },
  { goal: '评估硬件可靠性测试：温循、振动、跌落、老化测试计划', departmentName: 'hardware', expected: 'success', tags: ['hardware', 'planning'] },
  { goal: '制定硬件成本优化方案：BOM 降本、替代料、工艺选择', departmentName: 'hardware', expected: 'success', tags: ['hardware', 'planning'] },
  { goal: '生成硬件调试工具方案：示波器、逻辑分析仪、仿真器使用', departmentName: 'hardware', expected: 'success', tags: ['hardware', 'planning'] },
  { goal: '制定硬件量产测试方案：产测项、治具、数据采集、良率', departmentName: 'hardware', expected: 'success', tags: ['hardware', 'planning'] },
  { goal: '制定软件系统架构方案：分层、模块划分、依赖管理', departmentName: 'software', expected: 'success', tags: ['software', 'planning'] },
  { goal: '生成软件 API 设计规范：REST 风格、鉴权、错误码、版本', departmentName: 'software', expected: 'success', tags: ['software', 'planning'] },
  { goal: '制定软件数据库设计：表结构、索引、迁移、备份策略', departmentName: 'software', expected: 'success', tags: ['software', 'planning'] },
  { goal: '生成软件测试策略：单元/集成/E2E、覆盖率、CI 集成', departmentName: 'software', expected: 'success', tags: ['software', 'planning'] },
  { goal: '制定软件部署方案：容器化、环境、灰度、回滚', departmentName: 'software', expected: 'success', tags: ['software', 'planning'] },
  { goal: '评估软件性能优化：瓶颈分析、缓存、异步、数据库调优', departmentName: 'software', expected: 'success', tags: ['software', 'planning'] },
  { goal: '制定软件安全规范：输入校验、注入防护、敏感数据、审计', departmentName: 'software', expected: 'success', tags: ['software', 'planning'] },
  { goal: '生成软件日志与监控方案：日志规范、指标、告警、追踪', departmentName: 'software', expected: 'success', tags: ['software', 'planning'] },
  { goal: '制定软件 CI/CD 流水线：构建、测试、发布、通知', departmentName: 'software', expected: 'success', tags: ['software', 'planning'] },
  { goal: '生成软件代码评审规范：评审清单、流程、自动化检查', departmentName: 'software', expected: 'success', tags: ['software', 'planning'] },
  { goal: '制定软件重构计划：代码坏味道、优先级、风险控制', departmentName: 'software', expected: 'success', tags: ['software', 'planning'] },
  { goal: '评估软件微服务拆分：边界、通信、数据一致性、治理', departmentName: 'software', expected: 'success', tags: ['software', 'planning'] },
  { goal: '制定软件开源合规：许可证、依赖审查、SBOM 管理', departmentName: 'software', expected: 'success', tags: ['software', 'planning'] },
  { goal: '制定 MCU 时钟系统配置：时钟源、PLL、分频、低功耗切换', departmentName: 'xjmcu', expected: 'success', tags: ['mcu', 'planning'] },
  { goal: '生成 MCU GPIO 使用规范：模式配置、电气特性、中断设计', departmentName: 'xjmcu', expected: 'success', tags: ['mcu', 'planning'] },
  { goal: '制定 MCU 定时器应用方案：PWM、输入捕获、输出比较', departmentName: 'xjmcu', expected: 'success', tags: ['mcu', 'planning'] },
  { goal: '评估 MCU ADC 采集精度：参考电压、采样率、滤波、校准', departmentName: 'xjmcu', expected: 'success', tags: ['mcu', 'planning'] },
  { goal: '制定 MCU 看门狗方案：超时设置、喂狗策略、复位处理', departmentName: 'xjmcu', expected: 'success', tags: ['mcu', 'planning'] },
  { goal: '生成 MCU 启动流程设计：复位向量、时钟初始化、外设使能', departmentName: 'xjmcu', expected: 'success', tags: ['mcu', 'planning'] },
  { goal: '制定 MCU 错误处理框架：错误码、日志、恢复策略', departmentName: 'xjmcu', expected: 'success', tags: ['mcu', 'planning'] },
  { goal: '评估 MCU 安全特性：读保护、加密、防篡改、安全启动', departmentName: 'xjmcu', expected: 'success', tags: ['mcu', 'planning'] },
  { goal: '制定 MCU 多任务调度：任务优先级、消息队列、互斥、死锁预防', departmentName: 'xjmcu', expected: 'success', tags: ['mcu', 'planning'] },
  { goal: '生成 MCU 外设驱动测试：单元测试、硬件在环、模拟器', departmentName: 'xjmcu', expected: 'success', tags: ['mcu', 'planning'] },
  { goal: '制定 MCU 产品需求分解：功能清单、性能指标、验收标准', departmentName: 'xjmcu', expected: 'success', tags: ['mcu', 'planning'] },
  { goal: '评估 MCU 供应链风险：芯片选型、备货、替代方案、停产应对', departmentName: 'xjmcu', expected: 'success', tags: ['mcu', 'planning'] },
];

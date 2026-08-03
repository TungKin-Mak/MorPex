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
];

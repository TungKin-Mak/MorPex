export interface GoldenTask {
  id: string;
  category: 'software' | 'hardware' | 'business' | 'content' | 'ecommerce';
  title: string;
  goal: string;
  expectedCapabilities: string[];
  expectedArtifactTypes: string[];
  difficulty: 1 | 2 | 3 | 4 | 5;
}

export const GOLDEN_TASKS: GoldenTask[] = [
  // === 软件 (12) ===
  { id: 'sw-001', category: 'software', title: 'Todo SaaS', goal: '开发一个 Todo 管理 SaaS 应用，包含用户认证、任务CRUD、团队协作', expectedCapabilities: ['Backend Development', 'Frontend Development'], expectedArtifactTypes: ['code', 'document'], difficulty: 3 },
  { id: 'sw-002', category: 'software', title: 'REST API', goal: '设计并实现一个 RESTful API 用于博客系统', expectedCapabilities: ['Backend Development'], expectedArtifactTypes: ['code', 'document'], difficulty: 2 },
  { id: 'sw-003', category: 'software', title: 'CLI 工具', goal: '开发一个命令行工具用于批量图片压缩', expectedCapabilities: ['Backend Development'], expectedArtifactTypes: ['code'], difficulty: 2 },
  { id: 'sw-004', category: 'software', title: 'Chrome 插件', goal: '开发一个 Chrome 扩展用于网页截图', expectedCapabilities: ['Frontend Development'], expectedArtifactTypes: ['code'], difficulty: 3 },
  { id: 'sw-005', category: 'software', title: '数据库设计', goal: '为电商平台设计数据库 schema', expectedCapabilities: ['Backend Development'], expectedArtifactTypes: ['document'], difficulty: 2 },
  { id: 'sw-006', category: 'software', title: 'OAuth 集成', goal: '集成 Google OAuth 登录到现有应用', expectedCapabilities: ['Backend Development', 'Frontend Development'], expectedArtifactTypes: ['code'], difficulty: 3 },
  { id: 'sw-007', category: 'software', title: 'WebSocket 聊天', goal: '实现一个 WebSocket 实时聊天功能', expectedCapabilities: ['Backend Development', 'Frontend Development'], expectedArtifactTypes: ['code'], difficulty: 3 },
  { id: 'sw-008', category: 'software', title: 'Docker 部署', goal: '为 Node.js 应用编写 Dockerfile 和 docker-compose', expectedCapabilities: ['Backend Development'], expectedArtifactTypes: ['code', 'document'], difficulty: 2 },
  { id: 'sw-009', category: 'software', title: 'CI/CD 配置', goal: '配置 GitHub Actions CI/CD 流水线', expectedCapabilities: ['Backend Development'], expectedArtifactTypes: ['code'], difficulty: 2 },
  { id: 'sw-010', category: 'software', title: 'API 文档', goal: '使用 OpenAPI 规范生成 API 文档', expectedCapabilities: ['Backend Development'], expectedArtifactTypes: ['document'], difficulty: 1 },
  { id: 'sw-011', category: 'software', title: '单元测试', goal: '为现有代码添加单元测试覆盖', expectedCapabilities: ['Backend Development'], expectedArtifactTypes: ['code'], difficulty: 2 },
  { id: 'sw-012', category: 'software', title: '性能优化', goal: '分析并优化 API 响应时间', expectedCapabilities: ['Backend Development'], expectedArtifactTypes: ['document'], difficulty: 3 },

  // === 硬件 (10) ===
  { id: 'hw-001', category: 'hardware', title: '智能温控器', goal: '设计一个智能温控器，包含温度传感器、WiFi模块、手机App控制', expectedCapabilities: ['PCB Design', 'Firmware Development', 'Industrial Design'], expectedArtifactTypes: ['design', 'code', 'document'], difficulty: 4 },
  { id: 'hw-002', category: 'hardware', title: '空气质量检测仪', goal: '设计一个空气质量检测设备，支持 PM2.5/温湿度/CO2 检测', expectedCapabilities: ['PCB Design', 'Firmware Development'], expectedArtifactTypes: ['design', 'code'], difficulty: 4 },
  { id: 'hw-003', category: 'hardware', title: '智能插座', goal: '设计 WiFi 智能插座，支持远程开关和电量统计', expectedCapabilities: ['PCB Design', 'Firmware Development', 'Industrial Design'], expectedArtifactTypes: ['design', 'code'], difficulty: 3 },
  { id: 'hw-004', category: 'hardware', title: 'USB Hub', goal: '设计 4 口 USB 3.0 Hub 电路板', expectedCapabilities: ['PCB Design'], expectedArtifactTypes: ['design'], difficulty: 2 },
  { id: 'hw-005', category: 'hardware', title: 'LED 控制器', goal: '设计一个手机 App 控制的 RGB LED 灯带控制器', expectedCapabilities: ['PCB Design', 'Firmware Development', 'Frontend Development'], expectedArtifactTypes: ['design', 'code'], difficulty: 3 },
  { id: 'hw-006', category: 'hardware', title: '电池管理板', goal: '设计 3S 锂电池充放电管理电路', expectedCapabilities: ['PCB Design'], expectedArtifactTypes: ['design'], difficulty: 3 },
  { id: 'hw-007', category: 'hardware', title: '传感器集线器', goal: '设计多传感器数据采集模块，支持 I2C/SPI/UART', expectedCapabilities: ['PCB Design', 'Firmware Development'], expectedArtifactTypes: ['design', 'code'], difficulty: 4 },
  { id: 'hw-008', category: 'hardware', title: '3D 打印外壳', goal: '为 PCB 设计 3D 打印外壳', expectedCapabilities: ['Industrial Design'], expectedArtifactTypes: ['design'], difficulty: 2 },
  { id: 'hw-009', category: 'hardware', title: '产品规格书', goal: '编写智能硬件产品规格书', expectedCapabilities: [], expectedArtifactTypes: ['document'], difficulty: 1 },
  { id: 'hw-010', category: 'hardware', title: 'FCC 文档', goal: '准备 FCC 认证申请文档', expectedCapabilities: [], expectedArtifactTypes: ['document'], difficulty: 2 },

  // === 商业 (10) ===
  { id: 'bz-001', category: 'business', title: '市场分析', goal: '分析智能家居市场趋势和竞争格局', expectedCapabilities: [], expectedArtifactTypes: ['document'], difficulty: 2 },
  { id: 'bz-002', category: 'business', title: '竞品分析', goal: '对 5 个竞品进行 SWOT 分析', expectedCapabilities: [], expectedArtifactTypes: ['document'], difficulty: 2 },
  { id: 'bz-003', category: 'business', title: '商业计划书', goal: '编写智能硬件创业商业计划书', expectedCapabilities: [], expectedArtifactTypes: ['document'], difficulty: 3 },
  { id: 'bz-004', category: 'business', title: '定价策略', goal: '为新产品的定价策略提供建议', expectedCapabilities: [], expectedArtifactTypes: ['document'], difficulty: 2 },
  { id: 'bz-005', category: 'business', title: '用户调研', goal: '设计用户调研问卷并分析结果', expectedCapabilities: [], expectedArtifactTypes: ['document'], difficulty: 2 },
  { id: 'bz-006', category: 'business', title: '成本分析', goal: '分析硬件产品的 BOM 成本', expectedCapabilities: [], expectedArtifactTypes: ['document'], difficulty: 2 },
  { id: 'bz-007', category: 'business', title: '融资方案', goal: '制定种子轮融资方案', expectedCapabilities: [], expectedArtifactTypes: ['document'], difficulty: 3 },
  { id: 'bz-008', category: 'business', title: '供应链计划', goal: '制定电子元器件供应链计划', expectedCapabilities: [], expectedArtifactTypes: ['document'], difficulty: 3 },
  { id: 'bz-009', category: 'business', title: '风险分析', goal: '识别项目风险并制定缓解措施', expectedCapabilities: [], expectedArtifactTypes: ['document'], difficulty: 2 },
  { id: 'bz-010', category: 'business', title: '路线图规划', goal: '制定 12 个月产品路线图', expectedCapabilities: [], expectedArtifactTypes: ['document'], difficulty: 2 },

  // === 内容 (10) ===
  { id: 'ct-001', category: 'content', title: 'YouTube 频道方案', goal: '规划一个科技评测 YouTube 频道的内容策略', expectedCapabilities: ['Video Production'], expectedArtifactTypes: ['document', 'media'], difficulty: 3 },
  { id: 'ct-002', category: 'content', title: '产品视频脚本', goal: '为新产品撰写 2 分钟宣传视频脚本', expectedCapabilities: [], expectedArtifactTypes: ['document'], difficulty: 2 },
  { id: 'ct-003', category: 'content', title: '社交媒体计划', goal: '制定产品上市社交媒体推广计划', expectedCapabilities: [], expectedArtifactTypes: ['document'], difficulty: 2 },
  { id: 'ct-004', category: 'content', title: '博客文章', goal: '撰写一篇技术博客文章', expectedCapabilities: [], expectedArtifactTypes: ['document'], difficulty: 1 },
  { id: 'ct-005', category: 'content', title: '产品说明书', goal: '编写产品用户手册', expectedCapabilities: [], expectedArtifactTypes: ['document'], difficulty: 2 },
  { id: 'ct-006', category: 'content', title: '营销邮件', goal: '设计产品发布电子邮件营销 campaign', expectedCapabilities: [], expectedArtifactTypes: ['document'], difficulty: 2 },
  { id: 'ct-007', category: 'content', title: 'KOL 合作方案', goal: '制定 KOL/网红合作推广方案', expectedCapabilities: [], expectedArtifactTypes: ['document'], difficulty: 2 },
  { id: 'ct-008', category: 'content', title: '广告文案', goal: '为 Amazon 产品页面撰写广告文案', expectedCapabilities: ['Amazon Listing'], expectedArtifactTypes: ['document'], difficulty: 2 },
  { id: 'ct-009', category: 'content', title: '着陆页设计', goal: '为产品设计营销着陆页方案', expectedCapabilities: ['Frontend Development'], expectedArtifactTypes: ['document', 'design'], difficulty: 3 },
  { id: 'ct-010', category: 'content', title: '演示文稿', goal: '制作投资人演示文稿', expectedCapabilities: [], expectedArtifactTypes: ['document'], difficulty: 2 },

  // === 电商 (10) ===
  { id: 'ec-001', category: 'ecommerce', title: 'Amazon 上架', goal: '将硬件产品上架到 Amazon US 站点', expectedCapabilities: ['Amazon Listing', 'Keyword Research'], expectedArtifactTypes: ['document', 'media'], difficulty: 3 },
  { id: 'ec-002', category: 'ecommerce', title: '关键词优化', goal: '优化 Amazon 产品关键词排名', expectedCapabilities: ['Keyword Research'], expectedArtifactTypes: ['document'], difficulty: 2 },
  { id: 'ec-003', category: 'ecommerce', title: '产品摄影方案', goal: '制定电商产品摄影方案', expectedCapabilities: ['Image Generation'], expectedArtifactTypes: ['document', 'media'], difficulty: 2 },
  { id: 'ec-004', category: 'ecommerce', title: 'A+ 内容', goal: '创建 Amazon A+ 品牌内容', expectedCapabilities: ['Amazon Listing'], expectedArtifactTypes: ['document'], difficulty: 2 },
  { id: 'ec-005', category: 'ecommerce', title: 'PPC 广告', goal: '设置 Amazon PPC 广告 campaign', expectedCapabilities: [], expectedArtifactTypes: ['document'], difficulty: 3 },
  { id: 'ec-006', category: 'ecommerce', title: '库存计划', goal: '制定 FBA 库存补货计划', expectedCapabilities: [], expectedArtifactTypes: ['document'], difficulty: 2 },
  { id: 'ec-007', category: 'ecommerce', title: '竞品定价分析', goal: '分析 Amazon 竞品定价策略', expectedCapabilities: ['Keyword Research'], expectedArtifactTypes: ['document'], difficulty: 2 },
  { id: 'ec-008', category: 'ecommerce', title: '产品 Bundle', goal: '设计产品捆绑销售策略', expectedCapabilities: ['Amazon Listing'], expectedArtifactTypes: ['document'], difficulty: 2 },
  { id: 'ec-009', category: 'ecommerce', title: 'Review 管理', goal: '制定 Amazon Review 获取策略', expectedCapabilities: [], expectedArtifactTypes: ['document'], difficulty: 2 },
  { id: 'ec-010', category: 'ecommerce', title: '跨境物流', goal: '制定跨境物流和清关方案', expectedCapabilities: [], expectedArtifactTypes: ['document'], difficulty: 3 },
];

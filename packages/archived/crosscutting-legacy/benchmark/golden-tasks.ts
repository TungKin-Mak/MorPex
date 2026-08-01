/**
 * Golden Benchmark — 黄金基准任务集
 *
 * 每个任务包含：
 *   - goal:       问题描述（类似 GAIA 的 question / SWE-bench 的 issue）
 *   - verification: 答案标准（类似 GAIA 的 ground truth / SWE-bench 的 test suite）
 *     - checkpoints[]: 检查点列表，每个检查点是一个具体的"答案断言"
 *     - minPassRate:    该任务至少需要通过的检查点比例
 *
 * 评分时，TaskVerifier 对照 checkpoints 逐条验证执行产出，
 * 得到 VerificationScore，纳入最终 Overall 评分。
 */

// ── 检查点类型 ──

export interface ArtifactCheckParams {
  /** 期望的产物类型，如 ['code', 'document'] */
  artifactTypes: string[];
  /** 最少匹配数，默认 1 */
  minMatch?: number;
}

export interface CapabilityCheckParams {
  /** 期望使用的能力 */
  capabilities: string[];
  /** 最少匹配数，默认 1 */
  minMatch?: number;
}

export interface KeywordCheckParams {
  /** 产出内容中应出现的关键词 */
  keywords: string[];
  /** 最少匹配数，默认所有 */
  minMatch?: number;
}

export interface FunctionCheckParams {
  /** 产出代码中应包含的函数/类/API 名称 */
  functions: string[];
  /** 最少匹配数，默认所有 */
  minMatch?: number;
}

export type CheckpointParams =
  | { type: 'artifact';  params: ArtifactCheckParams }
  | { type: 'capability'; params: CapabilityCheckParams }
  | { type: 'keyword';   params: KeywordCheckParams }
  | { type: 'function';  params: FunctionCheckParams };

export interface VerificationCheckpoint {
  /** 检查点类型 */
  type: 'artifact' | 'capability' | 'keyword' | 'function';
  /** 人类可读描述 */
  description: string;
  /** 权重 0-1，同一任务内所有 checkpoint weight 之和 = 1 */
  weight: number;
  /** 检查参数，按 type 区分 */
  params: CheckpointParams['params'];
}

export interface TaskVerification {
  /** 检查点列表 */
  checkpoints: VerificationCheckpoint[];
  /** 最低通过率 0-1，低于此值的任务记为 fail */
  minPassRate: number;
}

// ── 任务定义 ──

export interface GoldenTask {
  id: string;
  category: 'software' | 'hardware' | 'business' | 'content' | 'ecommerce';
  title: string;
  goal: string;
  expectedCapabilities: string[];
  expectedArtifactTypes: string[];
  difficulty: 1 | 2 | 3 | 4 | 5;
  /** 答案标准 — 验证检查点集 */
  verification: TaskVerification;
}

// ═══════════════════════════════════════════════════════════════
// 52 个黄金任务
// ═══════════════════════════════════════════════════════════════

export const GOLDEN_TASKS: GoldenTask[] = [
  // ═══════════════════════════════════════════════════════════
  // 软件 (12)
  // ═══════════════════════════════════════════════════════════
  {
    id: 'sw-001', category: 'software', title: 'Todo SaaS',
    goal: '开发一个 Todo 管理 SaaS 应用，包含用户认证、任务CRUD、团队协作',
    expectedCapabilities: ['Backend Development', 'Frontend Development'],
    expectedArtifactTypes: ['code', 'document'], difficulty: 3,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.25, description: '包含用户认证（注册/登录/会话）', params: { keywords: ['register', 'login', 'auth', 'session', 'token', 'password'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含任务 CRUD（创建/读取/更新/删除）', params: { keywords: ['create', 'read', 'update', 'delete', 'crud', 'todo', 'task'], minMatch: 3 } },
        { type: 'keyword', weight: 0.20, description: '包含团队协作功能', params: { keywords: ['team', 'share', 'collaborat', 'project', 'member'], minMatch: 2 } },
        { type: 'artifact', weight: 0.15, description: '产出代码和文档', params: { artifactTypes: ['code', 'document'], minMatch: 2 } },
        { type: 'capability', weight: 0.15, description: '使用了后端+前端能力', params: { capabilities: ['Backend Development', 'Frontend Development'], minMatch: 2 } },
      ],
      minPassRate: 0.6,
    },
  },
  {
    id: 'sw-002', category: 'software', title: 'REST API',
    goal: '设计并实现一个 RESTful API 用于博客系统',
    expectedCapabilities: ['Backend Development'],
    expectedArtifactTypes: ['code', 'document'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.30, description: '包含 REST 风格的端点设计', params: { keywords: ['GET', 'POST', 'PUT', 'DELETE', 'api', 'endpoint', 'route'], minMatch: 3 } },
        { type: 'keyword', weight: 0.25, description: '包含博客核心模型', params: { keywords: ['post', 'article', 'blog', 'comment', 'author', 'user'], minMatch: 2 } },
        { type: 'keyword', weight: 0.20, description: '包含数据持久化', params: { keywords: ['database', 'model', 'schema', 'orm', 'sql', 'mongodb', 'prisma'], minMatch: 1 } },
        { type: 'artifact', weight: 0.15, description: '产出代码和文档', params: { artifactTypes: ['code', 'document'], minMatch: 2 } },
        { type: 'capability', weight: 0.10, description: '使用后端开发能力', params: { capabilities: ['Backend Development'], minMatch: 1 } },
      ],
      minPassRate: 0.6,
    },
  },
  {
    id: 'sw-003', category: 'software', title: 'CLI 工具',
    goal: '开发一个命令行工具用于批量图片压缩',
    expectedCapabilities: ['Backend Development'],
    expectedArtifactTypes: ['code'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.30, description: '支持命令行参数解析', params: { keywords: ['argv', 'commander', 'yargs', 'cli', 'argument', 'option', '--'], minMatch: 2 } },
        { type: 'keyword', weight: 0.30, description: '包含图片压缩功能', params: { keywords: ['compress', 'image', 'png', 'jpeg', 'sharp', 'resize', 'optimize'], minMatch: 2 } },
        { type: 'keyword', weight: 0.20, description: '支持批量处理', params: { keywords: ['batch', 'glob', 'directory', 'fs', 'walk', 'recurse'], minMatch: 1 } },
        { type: 'artifact', weight: 0.20, description: '产出代码', params: { artifactTypes: ['code'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'sw-004', category: 'software', title: 'Chrome 插件',
    goal: '开发一个 Chrome 扩展用于网页截图',
    expectedCapabilities: ['Frontend Development'],
    expectedArtifactTypes: ['code'], difficulty: 3,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.30, description: '包含 Chrome Extension 核心文件', params: { keywords: ['manifest.json', 'background', 'content_script', 'popup', 'chrome.'], minMatch: 2 } },
        { type: 'keyword', weight: 0.30, description: '包含截图功能', params: { keywords: ['capture', 'screenshot', 'tab', 'canvas', 'image', 'blob'], minMatch: 2 } },
        { type: 'keyword', weight: 0.20, description: '包含权限声明', params: { keywords: ['permissions', 'activeTab', 'storage', 'downloads'], minMatch: 1 } },
        { type: 'artifact', weight: 0.20, description: '产出代码', params: { artifactTypes: ['code'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'sw-005', category: 'software', title: '数据库设计',
    goal: '为电商平台设计数据库 schema',
    expectedCapabilities: ['Backend Development'],
    expectedArtifactTypes: ['document'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.25, description: '包含电商核心实体', params: { keywords: ['product', 'user', 'order', 'cart', 'category', 'customer'], minMatch: 3 } },
        { type: 'keyword', weight: 0.25, description: '包含关系定义', params: { keywords: ['foreign key', 'relation', 'join', 'reference', 'one-to-many', 'many-to-many'], minMatch: 2 } },
        { type: 'keyword', weight: 0.20, description: '包含字段和类型定义', params: { keywords: ['schema', 'table', 'column', 'type', 'varchar', 'int', 'decimal', 'timestamp'], minMatch: 2 } },
        { type: 'keyword', weight: 0.15, description: '包含索引或约束', params: { keywords: ['index', 'primary key', 'unique', 'constraint', 'not null'], minMatch: 1 } },
        { type: 'artifact', weight: 0.15, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.6,
    },
  },
  {
    id: 'sw-006', category: 'software', title: 'OAuth 集成',
    goal: '集成 Google OAuth 登录到现有应用',
    expectedCapabilities: ['Backend Development', 'Frontend Development'],
    expectedArtifactTypes: ['code'], difficulty: 3,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.30, description: '包含 OAuth 流程', params: { keywords: ['oauth', 'google', 'auth', 'redirect', 'callback', 'token'], minMatch: 3 } },
        { type: 'keyword', weight: 0.25, description: '包含 passport 或类似库', params: { keywords: ['passport', 'strategy', 'google-auth', 'openid', 'jwt'], minMatch: 1 } },
        { type: 'keyword', weight: 0.25, description: '包含前端登录按钮/跳转', params: { keywords: ['signin', 'login', 'google-button', 'redirect', 'consent'], minMatch: 1 } },
        { type: 'artifact', weight: 0.20, description: '产出代码', params: { artifactTypes: ['code'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'sw-007', category: 'software', title: 'WebSocket 聊天',
    goal: '实现一个 WebSocket 实时聊天功能',
    expectedCapabilities: ['Backend Development', 'Frontend Development'],
    expectedArtifactTypes: ['code'], difficulty: 3,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.30, description: '包含 WebSocket 服务端实现', params: { keywords: ['websocket', 'socket.io', 'ws://', 'wss://', 'connection', 'server'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含消息收发逻辑', params: { keywords: ['message', 'send', 'emit', 'receive', 'on', 'broadcast'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含前端聊天界面', params: { keywords: ['chat', 'room', 'input', 'submit', 'message-list', 'conversation'], minMatch: 2 } },
        { type: 'artifact', weight: 0.20, description: '产出代码', params: { artifactTypes: ['code'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'sw-008', category: 'software', title: 'Docker 部署',
    goal: '为 Node.js 应用编写 Dockerfile 和 docker-compose',
    expectedCapabilities: ['Backend Development'],
    expectedArtifactTypes: ['code', 'document'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.30, description: '包含 Dockerfile', params: { keywords: ['FROM', 'WORKDIR', 'COPY', 'RUN', 'CMD', 'EXPOSE', 'dockerfile'], minMatch: 3 } },
        { type: 'keyword', weight: 0.30, description: '包含 docker-compose 配置', params: { keywords: ['docker-compose', 'services', 'volumes', 'ports', 'environment', 'depends_on'], minMatch: 3 } },
        { type: 'keyword', weight: 0.20, description: '包含多阶段构建或优化', params: { keywords: ['multi-stage', 'alpine', 'slim', 'build', 'production', 'node'], minMatch: 1 } },
        { type: 'artifact', weight: 0.20, description: '产出代码和文档', params: { artifactTypes: ['code', 'document'], minMatch: 2 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'sw-009', category: 'software', title: 'CI/CD 配置',
    goal: '配置 GitHub Actions CI/CD 流水线',
    expectedCapabilities: ['Backend Development'],
    expectedArtifactTypes: ['code'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.30, description: '包含 GitHub Actions 配置', params: { keywords: ['github', 'actions', 'workflow', '.github', 'on:', 'jobs:'], minMatch: 3 } },
        { type: 'keyword', weight: 0.25, description: '包含 CI 步骤（安装/测试/构建）', params: { keywords: ['install', 'test', 'build', 'lint', 'checkout', 'node'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含 CD 部署步骤', params: { keywords: ['deploy', 'publish', 'release', 'docker', 'upload', 'ssh'], minMatch: 1 } },
        { type: 'artifact', weight: 0.20, description: '产出代码', params: { artifactTypes: ['code'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'sw-010', category: 'software', title: 'API 文档',
    goal: '使用 OpenAPI 规范生成 API 文档',
    expectedCapabilities: ['Backend Development'],
    expectedArtifactTypes: ['document'], difficulty: 1,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.30, description: '遵循 OpenAPI/Swagger 规范', params: { keywords: ['openapi', 'swagger', 'spec', 'paths', 'components', '3.0'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含 API 端点定义', params: { keywords: ['get', 'post', 'put', 'delete', 'parameters', 'responses', 'requestBody'], minMatch: 3 } },
        { type: 'keyword', weight: 0.25, description: '包含 schema/model 定义', params: { keywords: ['schema', 'properties', 'type', 'required', 'ref'], minMatch: 2 } },
        { type: 'artifact', weight: 0.20, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'sw-011', category: 'software', title: '单元测试',
    goal: '为现有代码添加单元测试覆盖',
    expectedCapabilities: ['Backend Development'],
    expectedArtifactTypes: ['code'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.30, description: '包含测试框架引用', params: { keywords: ['describe', 'it', 'test', 'expect', 'assert', 'jest', 'vitest', 'mocha'], minMatch: 3 } },
        { type: 'keyword', weight: 0.30, description: '包含测试用例', params: { keywords: ['should', 'test', 'case', 'mock', 'spy', 'stub'], minMatch: 2 } },
        { type: 'keyword', weight: 0.20, description: '覆盖多种场景', params: { keywords: ['beforeEach', 'afterEach', 'setup', 'teardown', 'coverage'], minMatch: 1 } },
        { type: 'artifact', weight: 0.20, description: '产出代码', params: { artifactTypes: ['code'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'sw-012', category: 'software', title: '性能优化',
    goal: '分析并优化 API 响应时间',
    expectedCapabilities: ['Backend Development'],
    expectedArtifactTypes: ['document'], difficulty: 3,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.25, description: '包含性能分析（profiling）', params: { keywords: ['profile', 'benchmark', 'latency', 'response time', 'slow', 'bottleneck'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含优化措施', params: { keywords: ['cache', 'index', 'query', 'optimize', 'async', 'batch', 'pool'], minMatch: 2 } },
        { type: 'keyword', weight: 0.20, description: '包含前后对比数据', params: { keywords: ['before', 'after', 'comparison', 'improvement', 'reduction', 'speedup'], minMatch: 2 } },
        { type: 'keyword', weight: 0.15, description: '包含工具/方法说明', params: { keywords: ['apm', 'monitor', 'trace', 'log', 'metric', 'instrument'], minMatch: 1 } },
        { type: 'artifact', weight: 0.15, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.6,
    },
  },

  // ═══════════════════════════════════════════════════════════
  // 硬件 (10)
  // ═══════════════════════════════════════════════════════════
  {
    id: 'hw-001', category: 'hardware', title: '智能温控器',
    goal: '设计一个智能温控器，包含温度传感器、WiFi模块、手机App控制',
    expectedCapabilities: ['PCB Design', 'Firmware Development', 'Industrial Design'],
    expectedArtifactTypes: ['design', 'code', 'document'], difficulty: 4,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.25, description: '包含温度传感器', params: { keywords: ['temperature', 'sensor', 'thermistor', 'ds18b20', 'dht', 'ntc'], minMatch: 1 } },
        { type: 'keyword', weight: 0.20, description: '包含 WiFi 模块', params: { keywords: ['wifi', 'esp8266', 'esp32', 'mqtt', 'http', 'network'], minMatch: 1 } },
        { type: 'keyword', weight: 0.20, description: '包含手机 App 控制', params: { keywords: ['app', 'mobile', 'control', 'dashboard', 'bluetooth', 'iot'], minMatch: 1 } },
        { type: 'keyword', weight: 0.15, description: '包含固件逻辑', params: { keywords: ['firmware', 'arduino', 'microcontroller', 'pwm', 'pid', 'relay'], minMatch: 1 } },
        { type: 'artifact', weight: 0.20, description: '产出设计、代码和文档', params: { artifactTypes: ['design', 'code', 'document'], minMatch: 2 } },
      ],
      minPassRate: 0.6,
    },
  },
  {
    id: 'hw-002', category: 'hardware', title: '空气质量检测仪',
    goal: '设计一个空气质量检测设备，支持 PM2.5/温湿度/CO2 检测',
    expectedCapabilities: ['PCB Design', 'Firmware Development'],
    expectedArtifactTypes: ['design', 'code'], difficulty: 4,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.25, description: '包含 PM2.5 检测', params: { keywords: ['pm2.5', 'particle', 'dust', 'sensor', 'sharp', 'pms5003'], minMatch: 1 } },
        { type: 'keyword', weight: 0.20, description: '包含温湿度检测', params: { keywords: ['humidity', 'temperature', 'dht22', 'sht', 'bme280'], minMatch: 1 } },
        { type: 'keyword', weight: 0.20, description: '包含 CO2 检测', params: { keywords: ['co2', 'mhz19', 'ccs811', 'sgp30', 'carbon dioxide'], minMatch: 1 } },
        { type: 'keyword', weight: 0.15, description: '包含数据显示', params: { keywords: ['display', 'led', 'oled', 'lcd', 'screen', 'indicator'], minMatch: 1 } },
        { type: 'artifact', weight: 0.20, description: '产出设计和代码', params: { artifactTypes: ['design', 'code'], minMatch: 2 } },
      ],
      minPassRate: 0.6,
    },
  },
  {
    id: 'hw-003', category: 'hardware', title: '智能插座',
    goal: '设计 WiFi 智能插座，支持远程开关和电量统计',
    expectedCapabilities: ['PCB Design', 'Firmware Development', 'Industrial Design'],
    expectedArtifactTypes: ['design', 'code'], difficulty: 3,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.25, description: '包含继电器/开关控制', params: { keywords: ['relay', 'switch', 'mosfet', 'triac', 'power', 'control'], minMatch: 1 } },
        { type: 'keyword', weight: 0.25, description: '包含电量计量', params: { keywords: ['power', 'energy', 'current', 'voltage', 'hlw8032', 'ina226', 'meter'], minMatch: 1 } },
        { type: 'keyword', weight: 0.20, description: '包含 WiFi 远程控制', params: { keywords: ['wifi', 'esp', 'remote', 'mqtt', 'http', 'cloud'], minMatch: 1 } },
        { type: 'artifact', weight: 0.30, description: '产出设计和代码', params: { artifactTypes: ['design', 'code'], minMatch: 2 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'hw-004', category: 'hardware', title: 'USB Hub',
    goal: '设计 4 口 USB 3.0 Hub 电路板',
    expectedCapabilities: ['PCB Design'],
    expectedArtifactTypes: ['design'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.30, description: '包含 USB 3.0 控制器', params: { keywords: ['usb 3.0', 'hub', 'controller', 'vl813', 'gl3520', 'hub ic'], minMatch: 1 } },
        { type: 'keyword', weight: 0.25, description: '包含 4 端口设计', params: { keywords: ['4-port', 'port', 'downstream', 'upstream', 'channel'], minMatch: 1 } },
        { type: 'keyword', weight: 0.25, description: '包含电源管理', params: { keywords: ['power', 'voltage', 'regulator', 'overcurrent', 'protection', '5v'], minMatch: 1 } },
        { type: 'artifact', weight: 0.20, description: '产出设计文件', params: { artifactTypes: ['design'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'hw-005', category: 'hardware', title: 'LED 控制器',
    goal: '设计一个手机 App 控制的 RGB LED 灯带控制器',
    expectedCapabilities: ['PCB Design', 'Firmware Development', 'Frontend Development'],
    expectedArtifactTypes: ['design', 'code'], difficulty: 3,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.25, description: '包含 RGB LED 驱动', params: { keywords: ['rgb', 'led', 'pwm', 'ws2812', 'neopixel', 'driver'], minMatch: 1 } },
        { type: 'keyword', weight: 0.20, description: '包含手机 App 控制', params: { keywords: ['app', 'mobile', 'bluetooth', 'control', 'color', 'brightness'], minMatch: 2 } },
        { type: 'keyword', weight: 0.20, description: '包含颜色/模式选择', params: { keywords: ['color', 'mode', 'effect', 'pattern', 'animation', 'fade'], minMatch: 1 } },
        { type: 'artifact', weight: 0.35, description: '产出设计和代码', params: { artifactTypes: ['design', 'code'], minMatch: 2 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'hw-006', category: 'hardware', title: '电池管理板',
    goal: '设计 3S 锂电池充放电管理电路',
    expectedCapabilities: ['PCB Design'],
    expectedArtifactTypes: ['design'], difficulty: 3,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.25, description: '支持 3S 锂电池', params: { keywords: ['3s', 'lipo', 'lithium', 'battery', '11.1v', '12.6v', 'cell'], minMatch: 1 } },
        { type: 'keyword', weight: 0.25, description: '包含充电管理', params: { keywords: ['charge', 'charger', 'balance', 'cc/cv', 'tp4056', 'bms'], minMatch: 1 } },
        { type: 'keyword', weight: 0.25, description: '包含保护电路', params: { keywords: ['protection', 'overcharge', 'overdischarge', 'short circuit', 'current limit'], minMatch: 2 } },
        { type: 'artifact', weight: 0.25, description: '产出设计文件', params: { artifactTypes: ['design'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'hw-007', category: 'hardware', title: '传感器集线器',
    goal: '设计多传感器数据采集模块，支持 I2C/SPI/UART',
    expectedCapabilities: ['PCB Design', 'Firmware Development'],
    expectedArtifactTypes: ['design', 'code'], difficulty: 4,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.25, description: '支持 I2C 接口', params: { keywords: ['i2c', 'sda', 'scl', 'address', 'wire'], minMatch: 1 } },
        { type: 'keyword', weight: 0.20, description: '支持 SPI 接口', params: { keywords: ['spi', 'mosi', 'miso', 'sck', 'cs'], minMatch: 1 } },
        { type: 'keyword', weight: 0.20, description: '支持 UART 接口', params: { keywords: ['uart', 'serial', 'tx', 'rx', 'baud'], minMatch: 1 } },
        { type: 'keyword', weight: 0.15, description: '包含多传感器采集', params: { keywords: ['sensor', 'data acquisition', 'multiplex', 'analog', 'digital'], minMatch: 1 } },
        { type: 'artifact', weight: 0.20, description: '产出设计和代码', params: { artifactTypes: ['design', 'code'], minMatch: 2 } },
      ],
      minPassRate: 0.6,
    },
  },
  {
    id: 'hw-008', category: 'hardware', title: '3D 打印外壳',
    goal: '为 PCB 设计 3D 打印外壳',
    expectedCapabilities: ['Industrial Design'],
    expectedArtifactTypes: ['design'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.30, description: '包含外壳 3D 设计', params: { keywords: ['3d', 'case', 'enclosure', 'shell', 'housing', 'stl', 'step'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含 PCB 安装结构', params: { keywords: ['mount', 'standoff', 'slot', 'holder', 'pocket', 'cutout'], minMatch: 1 } },
        { type: 'keyword', weight: 0.25, description: '包含接口/开孔', params: { keywords: ['hole', 'opening', 'connector', 'vent', 'port'], minMatch: 1 } },
        { type: 'artifact', weight: 0.20, description: '产出设计文件', params: { artifactTypes: ['design'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'hw-009', category: 'hardware', title: '产品规格书',
    goal: '编写智能硬件产品规格书',
    expectedCapabilities: [],
    expectedArtifactTypes: ['document'], difficulty: 1,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.25, description: '包含产品概述', params: { keywords: ['product', 'overview', 'description', 'introduction', 'summary'], minMatch: 1 } },
        { type: 'keyword', weight: 0.25, description: '包含技术参数', params: { keywords: ['specification', 'parameter', 'dimension', 'voltage', 'power', 'weight'], minMatch: 2 } },
        { type: 'keyword', weight: 0.20, description: '包含功能特性', params: { keywords: ['feature', 'function', 'capability', 'mode', 'operation'], minMatch: 1 } },
        { type: 'keyword', weight: 0.15, description: '包含接口说明', params: { keywords: ['interface', 'connector', 'pin', 'port', 'protocol'], minMatch: 1 } },
        { type: 'artifact', weight: 0.15, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.6,
    },
  },
  {
    id: 'hw-010', category: 'hardware', title: 'FCC 文档',
    goal: '准备 FCC 认证申请文档',
    expectedCapabilities: [],
    expectedArtifactTypes: ['document'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.25, description: '包含 FCC 标准引用', params: { keywords: ['fcc', 'part 15', 'emission', 'compliance', 'certification'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含测试报告模板', params: { keywords: ['test', 'report', 'measurement', 'radiated', 'conducted', 'spectrum'], minMatch: 2 } },
        { type: 'keyword', weight: 0.20, description: '包含设备描述', params: { keywords: ['equipment', 'description', 'model', 'manufacturer', 'product'], minMatch: 1 } },
        { type: 'artifact', weight: 0.30, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },

  // ═══════════════════════════════════════════════════════════
  // 商业 (10)
  // ═══════════════════════════════════════════════════════════
  {
    id: 'bz-001', category: 'business', title: '市场分析',
    goal: '分析智能家居市场趋势和竞争格局',
    expectedCapabilities: [],
    expectedArtifactTypes: ['document'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.25, description: '包含市场规模数据', params: { keywords: ['market size', 'growth', 'revenue', 'cagr', 'billion', 'share'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含竞争格局分析', params: { keywords: ['competitive', 'competitor', 'landscape', 'market share', 'player'], minMatch: 2 } },
        { type: 'keyword', weight: 0.20, description: '包含趋势分析', params: { keywords: ['trend', 'driver', 'opportunity', 'challenge', 'forecast'], minMatch: 2 } },
        { type: 'keyword', weight: 0.15, description: '包含数据来源引用', params: { keywords: ['source', 'data', 'report', 'statista', 'research', 'citation'], minMatch: 1 } },
        { type: 'artifact', weight: 0.15, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.6,
    },
  },
  {
    id: 'bz-002', category: 'business', title: '竞品分析',
    goal: '对 5 个竞品进行 SWOT 分析',
    expectedCapabilities: [],
    expectedArtifactTypes: ['document'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.25, description: '包含 SWOT 框架', params: { keywords: ['swot', 'strength', 'weakness', 'opportunity', 'threat'], minMatch: 3 } },
        { type: 'keyword', weight: 0.25, description: '覆盖至少 5 个竞品', params: { keywords: ['competitor', 'alternative', 'comparison', 'vs', 'benchmark'], minMatch: 2 } },
        { type: 'keyword', weight: 0.20, description: '包含分析维度', params: { keywords: ['price', 'feature', 'market', 'customer', 'strategy'], minMatch: 2 } },
        { type: 'artifact', weight: 0.30, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'bz-003', category: 'business', title: '商业计划书',
    goal: '编写智能硬件创业商业计划书',
    expectedCapabilities: [],
    expectedArtifactTypes: ['document'], difficulty: 3,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.20, description: '包含执行摘要', params: { keywords: ['executive summary', 'mission', 'vision', 'overview'], minMatch: 1 } },
        { type: 'keyword', weight: 0.20, description: '包含市场分析', params: { keywords: ['market', 'target', 'customer', 'segment', 'tam', 'sam'], minMatch: 2 } },
        { type: 'keyword', weight: 0.20, description: '包含产品或服务描述', params: { keywords: ['product', 'solution', 'technology', 'feature', 'roadmap'], minMatch: 2 } },
        { type: 'keyword', weight: 0.20, description: '包含财务预测', params: { keywords: ['financial', 'revenue', 'cost', 'profit', 'forecast', 'projection'], minMatch: 2 } },
        { type: 'artifact', weight: 0.20, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.6,
    },
  },
  {
    id: 'bz-004', category: 'business', title: '定价策略',
    goal: '为新产品的定价策略提供建议',
    expectedCapabilities: [],
    expectedArtifactTypes: ['document'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.30, description: '包含定价模型分析', params: { keywords: ['pricing', 'price', 'model', 'strategy', 'tier', 'subscription'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含竞品定价对比', params: { keywords: ['competitor', 'comparison', 'benchmark', 'market price'], minMatch: 1 } },
        { type: 'keyword', weight: 0.25, description: '包含定价建议', params: { keywords: ['recommend', 'suggest', 'optimal', 'price point', 'value'], minMatch: 1 } },
        { type: 'artifact', weight: 0.20, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'bz-005', category: 'business', title: '用户调研',
    goal: '设计用户调研问卷并分析结果',
    expectedCapabilities: [],
    expectedArtifactTypes: ['document'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.30, description: '包含调研问卷设计', params: { keywords: ['survey', 'questionnaire', 'question', 'respondent', 'feedback'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含数据分析', params: { keywords: ['analysis', 'result', 'data', 'chart', 'statistic', 'insight'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含结论和建议', params: { keywords: ['conclusion', 'recommend', 'action', 'improve', 'next step'], minMatch: 1 } },
        { type: 'artifact', weight: 0.20, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'bz-006', category: 'business', title: '成本分析',
    goal: '分析硬件产品的 BOM 成本',
    expectedCapabilities: [],
    expectedArtifactTypes: ['document'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.30, description: '包含 BOM 清单', params: { keywords: ['bom', 'bill of material', 'component', 'part', 'item'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含成本明细', params: { keywords: ['cost', 'price', 'unit', 'total', 'usd', 'estimate'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含成本优化建议', params: { keywords: ['optimize', 'alternative', 'reduce', 'saving', 'cheaper'], minMatch: 1 } },
        { type: 'artifact', weight: 0.20, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'bz-007', category: 'business', title: '融资方案',
    goal: '制定种子轮融资方案',
    expectedCapabilities: [],
    expectedArtifactTypes: ['document'], difficulty: 3,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.25, description: '包含融资需求说明', params: { keywords: ['funding', 'seed', 'raise', 'capital', 'investment', 'round'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含估值分析', params: { keywords: ['valuation', 'equity', 'dilution', 'cap table', 'worth'], minMatch: 1 } },
        { type: 'keyword', weight: 0.25, description: '包含资金用途计划', params: { keywords: ['use of funds', 'allocation', 'budget', 'spend', 'hiring', 'marketing'], minMatch: 2 } },
        { type: 'artifact', weight: 0.25, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'bz-008', category: 'business', title: '供应链计划',
    goal: '制定电子元器件供应链计划',
    expectedCapabilities: [],
    expectedArtifactTypes: ['document'], difficulty: 3,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.25, description: '包含供应商评估', params: { keywords: ['supplier', 'vendor', 'source', 'procurement', 'distributor'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含采购计划', params: { keywords: ['procurement', 'order', 'lead time', 'moq', 'purchase'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含风险管理', params: { keywords: ['risk', 'shortage', 'buffer', 'alternative', 'contingency'], minMatch: 1 } },
        { type: 'artifact', weight: 0.25, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'bz-009', category: 'business', title: '风险分析',
    goal: '识别项目风险并制定缓解措施',
    expectedCapabilities: [],
    expectedArtifactTypes: ['document'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.30, description: '包含风险识别', params: { keywords: ['risk', 'threat', 'issue', 'uncertainty', 'challenge'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含风险评估', params: { keywords: ['impact', 'probability', 'severity', 'rating', 'matrix'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含缓解措施', params: { keywords: ['mitigation', 'action', 'plan', 'prevent', 'response'], minMatch: 2 } },
        { type: 'artifact', weight: 0.20, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'bz-010', category: 'business', title: '路线图规划',
    goal: '制定 12 个月产品路线图',
    expectedCapabilities: [],
    expectedArtifactTypes: ['document'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.30, description: '包含时间阶段划分', params: { keywords: ['phase', 'quarter', 'month', 'milestone', 'timeline', 'roadmap'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含里程碑节点', params: { keywords: ['milestone', 'goal', 'deliverable', 'launch', 'release'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含资源分配', params: { keywords: ['resource', 'team', 'budget', 'allocate', 'priority'], minMatch: 1 } },
        { type: 'artifact', weight: 0.20, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },

  // ═══════════════════════════════════════════════════════════
  // 内容 (10)
  // ═══════════════════════════════════════════════════════════
  {
    id: 'ct-001', category: 'content', title: 'YouTube 频道方案',
    goal: '规划一个科技评测 YouTube 频道的内容策略',
    expectedCapabilities: ['Video Production'],
    expectedArtifactTypes: ['document', 'media'], difficulty: 3,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.25, description: '包含频道定位', params: { keywords: ['channel', 'niche', 'audience', 'position', 'brand'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含内容计划', params: { keywords: ['content', 'video', 'schedule', 'series', 'episode', 'upload'], minMatch: 2 } },
        { type: 'keyword', weight: 0.20, description: '包含变现方式', params: { keywords: ['monetize', 'revenue', 'sponsor', 'adsense', 'merch'], minMatch: 1 } },
        { type: 'keyword', weight: 0.15, description: '包含推广策略', params: { keywords: ['promote', 'social', 'seo', 'thumbnail', 'title'], minMatch: 1 } },
        { type: 'artifact', weight: 0.15, description: '产出文档', params: { artifactTypes: ['document', 'media'], minMatch: 1 } },
      ],
      minPassRate: 0.6,
    },
  },
  {
    id: 'ct-002', category: 'content', title: '产品视频脚本',
    goal: '为新产品撰写 2 分钟宣传视频脚本',
    expectedCapabilities: [],
    expectedArtifactTypes: ['document'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.30, description: '包含视频脚本结构', params: { keywords: ['scene', 'shot', 'narration', 'voiceover', 'script'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含产品卖点', params: { keywords: ['feature', 'benefit', 'unique', 'advantage', 'value'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含时间标注', params: { keywords: ['second', 'duration', '0:', '1:', 'timeline', 'minute'], minMatch: 1 } },
        { type: 'artifact', weight: 0.20, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'ct-003', category: 'content', title: '社交媒体计划',
    goal: '制定产品上市社交媒体推广计划',
    expectedCapabilities: [],
    expectedArtifactTypes: ['document'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.25, description: '包含平台选择', params: { keywords: ['platform', 'twitter', 'linkedin', 'instagram', 'tiktok', 'facebook'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含内容日历', params: { keywords: ['calendar', 'schedule', 'post', 'content plan', 'frequency'], minMatch: 2 } },
        { type: 'keyword', weight: 0.20, description: '包含 KPI 指标', params: { keywords: ['kpi', 'metric', 'engagement', 'reach', 'conversion', 'impression'], minMatch: 2 } },
        { type: 'artifact', weight: 0.30, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'ct-004', category: 'content', title: '博客文章',
    goal: '撰写一篇技术博客文章',
    expectedCapabilities: [],
    expectedArtifactTypes: ['document'], difficulty: 1,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.30, description: '包含文章标题和引言', params: { keywords: ['title', 'introduction', 'overview', 'begin', 'start'], minMatch: 1 } },
        { type: 'keyword', weight: 0.30, description: '包含技术内容主体', params: { keywords: ['code', 'example', 'tutorial', 'guide', 'implement', 'step'], minMatch: 2 } },
        { type: 'keyword', weight: 0.20, description: '包含结论', params: { keywords: ['conclusion', 'summary', 'next', 'learn', 'resource'], minMatch: 1 } },
        { type: 'artifact', weight: 0.20, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'ct-005', category: 'content', title: '产品说明书',
    goal: '编写产品用户手册',
    expectedCapabilities: [],
    expectedArtifactTypes: ['document'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.25, description: '包含产品开箱', params: { keywords: ['unbox', 'package', 'content', 'included', 'what\'s in the box'], minMatch: 1 } },
        { type: 'keyword', weight: 0.25, description: '包含使用说明', params: { keywords: ['instruction', 'how to', 'use', 'operate', 'setup', 'guide'], minMatch: 2 } },
        { type: 'keyword', weight: 0.20, description: '包含安全注意事项', params: { keywords: ['warning', 'caution', 'safety', 'attention', 'do not'], minMatch: 1 } },
        { type: 'keyword', weight: 0.15, description: '包含故障排除', params: { keywords: ['troubleshoot', 'problem', 'solution', 'faq', 'support'], minMatch: 1 } },
        { type: 'artifact', weight: 0.15, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.6,
    },
  },
  {
    id: 'ct-006', category: 'content', title: '营销邮件',
    goal: '设计产品发布电子邮件营销 campaign',
    expectedCapabilities: [],
    expectedArtifactTypes: ['document'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.25, description: '包含邮件主题行', params: { keywords: ['subject', 'headline', 'title', 'open rate'], minMatch: 1 } },
        { type: 'keyword', weight: 0.25, description: '包含邮件正文设计', params: { keywords: ['email', 'body', 'content', 'cta', 'button', 'link'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含受众细分', params: { keywords: ['segment', 'audience', 'target', 'list', 'personalize'], minMatch: 1 } },
        { type: 'artifact', weight: 0.25, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'ct-007', category: 'content', title: 'KOL 合作方案',
    goal: '制定 KOL/网红合作推广方案',
    expectedCapabilities: [],
    expectedArtifactTypes: ['document'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.30, description: '包含 KOL 筛选标准', params: { keywords: ['kol', 'influencer', 'criteria', 'selection', 'reach'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含合作模式', params: { keywords: ['collaboration', 'sponsor', 'partnership', 'review', 'affiliate'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含预算和 ROI', params: { keywords: ['budget', 'roi', 'cost', 'payment', 'compensation'], minMatch: 1 } },
        { type: 'artifact', weight: 0.20, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'ct-008', category: 'content', title: '广告文案',
    goal: '为 Amazon 产品页面撰写广告文案',
    expectedCapabilities: ['Amazon Listing'],
    expectedArtifactTypes: ['document'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.30, description: '包含产品标题优化', params: { keywords: ['title', 'headline', 'keyword', 'brand', 'feature'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含卖点描述', params: { keywords: ['benefit', 'bullet point', 'feature', 'advantage', 'unique'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含产品描述', params: { keywords: ['description', 'detail', 'specification', 'usage', 'quality'], minMatch: 1 } },
        { type: 'artifact', weight: 0.20, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'ct-009', category: 'content', title: '着陆页设计',
    goal: '为产品设计营销着陆页方案',
    expectedCapabilities: ['Frontend Development'],
    expectedArtifactTypes: ['document', 'design'], difficulty: 3,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.25, description: '包含页面结构设计', params: { keywords: ['landing page', 'layout', 'hero', 'section', 'header', 'footer'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含转化元素', params: { keywords: ['cta', 'button', 'signup', 'form', 'convert', 'lead'], minMatch: 2 } },
        { type: 'keyword', weight: 0.20, description: '包含视觉设计', params: { keywords: ['design', 'color', 'typography', 'image', 'mockup', 'wireframe'], minMatch: 1 } },
        { type: 'artifact', weight: 0.30, description: '产出文档和设计', params: { artifactTypes: ['document', 'design'], minMatch: 2 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'ct-010', category: 'content', title: '演示文稿',
    goal: '制作投资人演示文稿',
    expectedCapabilities: [],
    expectedArtifactTypes: ['document'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.25, description: '包含公司介绍', params: { keywords: ['company', 'mission', 'vision', 'team', 'background'], minMatch: 1 } },
        { type: 'keyword', weight: 0.25, description: '包含产品/解决方案', params: { keywords: ['product', 'solution', 'technology', 'innovation', 'value'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含市场机会', params: { keywords: ['market', 'opportunity', 'growth', 'tam', 'customer'], minMatch: 2 } },
        { type: 'artifact', weight: 0.25, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },

  // ═══════════════════════════════════════════════════════════
  // 电商 (10)
  // ═══════════════════════════════════════════════════════════
  {
    id: 'ec-001', category: 'ecommerce', title: 'Amazon 上架',
    goal: '将硬件产品上架到 Amazon US 站点',
    expectedCapabilities: ['Amazon Listing', 'Keyword Research'],
    expectedArtifactTypes: ['document', 'media'], difficulty: 3,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.25, description: '包含 listing 优化', params: { keywords: ['listing', 'title', 'bullet point', 'description', 'a+', 'ebc'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含关键词研究', params: { keywords: ['keyword', 'search term', 'rank', 'volume', 'competition'], minMatch: 2 } },
        { type: 'keyword', weight: 0.20, description: '包含图片和视频要求', params: { keywords: ['image', 'photo', 'video', 'infographic', 'media'], minMatch: 1 } },
        { type: 'artifact', weight: 0.30, description: '产出文档', params: { artifactTypes: ['document', 'media'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'ec-002', category: 'ecommerce', title: '关键词优化',
    goal: '优化 Amazon 产品关键词排名',
    expectedCapabilities: ['Keyword Research'],
    expectedArtifactTypes: ['document'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.30, description: '包含关键词列表', params: { keywords: ['keyword', 'search', 'volume', 'competition', 'relevant'], minMatch: 2 } },
        { type: 'keyword', weight: 0.30, description: '包含排名策略', params: { keywords: ['rank', 'optimize', 'strategy', 'position', 'ppc', 'organic'], minMatch: 2 } },
        { type: 'keyword', weight: 0.20, description: '包含效果跟踪', params: { keywords: ['track', 'monitor', 'performance', 'metric', 'improve'], minMatch: 1 } },
        { type: 'artifact', weight: 0.20, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'ec-003', category: 'ecommerce', title: '产品摄影方案',
    goal: '制定电商产品摄影方案',
    expectedCapabilities: ['Image Generation'],
    expectedArtifactTypes: ['document', 'media'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.30, description: '包含摄影计划', params: { keywords: ['photography', 'photo', 'shoot', 'lighting', 'setup'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含设备清单', params: { keywords: ['camera', 'lens', 'light', 'tripod', 'backdrop', 'equipment'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含后期处理', params: { keywords: ['edit', 'retouch', 'color', 'background', 'optimize'], minMatch: 1 } },
        { type: 'artifact', weight: 0.20, description: '产出文档', params: { artifactTypes: ['document', 'media'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'ec-004', category: 'ecommerce', title: 'A+ 内容',
    goal: '创建 Amazon A+ 品牌内容',
    expectedCapabilities: ['Amazon Listing'],
    expectedArtifactTypes: ['document'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.30, description: '包含品牌故事', params: { keywords: ['brand', 'story', 'heritage', 'quality', 'mission'], minMatch: 1 } },
        { type: 'keyword', weight: 0.30, description: '包含产品对比模块', params: { keywords: ['comparison', 'chart', 'feature', 'difference', 'vs'], minMatch: 2 } },
        { type: 'keyword', weight: 0.20, description: '包含图文描述', params: { keywords: ['image', 'text', 'module', 'layout', 'rich content'], minMatch: 1 } },
        { type: 'artifact', weight: 0.20, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'ec-005', category: 'ecommerce', title: 'PPC 广告',
    goal: '设置 Amazon PPC 广告 campaign',
    expectedCapabilities: [],
    expectedArtifactTypes: ['document'], difficulty: 3,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.20, description: '包含 campaign 结构', params: { keywords: ['campaign', 'ad group', 'keyword targeting', 'match type'], minMatch: 2 } },
        { type: 'keyword', weight: 0.20, description: '包含出价策略', params: { keywords: ['bid', 'budget', 'bid strategy', 'dynamic', 'fixed'], minMatch: 2 } },
        { type: 'keyword', weight: 0.20, description: '包含否定关键词', params: { keywords: ['negative keyword', 'exclude', 'irrelevant'], minMatch: 1 } },
        { type: 'keyword', weight: 0.20, description: '包含预算和指标', params: { keywords: ['budget', 'acos', 'roas', 'impression', 'click', 'conversion'], minMatch: 2 } },
        { type: 'artifact', weight: 0.20, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.6,
    },
  },
  {
    id: 'ec-006', category: 'ecommerce', title: '库存计划',
    goal: '制定 FBA 库存补货计划',
    expectedCapabilities: [],
    expectedArtifactTypes: ['document'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.30, description: '包含库存预测', params: { keywords: ['forecast', 'inventory', 'demand', 'projection', 'plan'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含补货策略', params: { keywords: ['replenish', 'order', 'lead time', 'safety stock', 'reorder point'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含 FBA 费用分析', params: { keywords: ['fba', 'fee', 'storage', 'fulfillment', 'cost'], minMatch: 1 } },
        { type: 'artifact', weight: 0.20, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'ec-007', category: 'ecommerce', title: '竞品定价分析',
    goal: '分析 Amazon 竞品定价策略',
    expectedCapabilities: ['Keyword Research'],
    expectedArtifactTypes: ['document'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.30, description: '包含竞品价格对比', params: { keywords: ['competitor', 'price', 'comparison', 'range', 'chart'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含定价策略分析', params: { keywords: ['strategy', 'premium', 'economy', 'penetration', 'skimming'], minMatch: 1 } },
        { type: 'keyword', weight: 0.25, description: '包含定价建议', params: { keywords: ['recommend', 'optimal', 'price point', 'position'], minMatch: 1 } },
        { type: 'artifact', weight: 0.20, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'ec-008', category: 'ecommerce', title: '产品 Bundle',
    goal: '设计产品捆绑销售策略',
    expectedCapabilities: ['Amazon Listing'],
    expectedArtifactTypes: ['document'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.30, description: '包含捆绑组合设计', params: { keywords: ['bundle', 'package', 'set', 'combo', 'kit'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含定价策略', params: { keywords: ['price', 'discount', 'saving', 'value', 'margin'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含交叉销售分析', params: { keywords: ['cross-sell', 'related', 'frequently bought', 'upsell'], minMatch: 1 } },
        { type: 'artifact', weight: 0.20, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'ec-009', category: 'ecommerce', title: 'Review 管理',
    goal: '制定 Amazon Review 获取策略',
    expectedCapabilities: [],
    expectedArtifactTypes: ['document'], difficulty: 2,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.30, description: '包含 Review 获取方法', params: { keywords: ['review', 'rating', 'feedback', 'testimonial', 'social proof'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含合规策略', params: { keywords: ['compliance', 'policy', 'tos', 'guideline', 'legal'], minMatch: 1 } },
        { type: 'keyword', weight: 0.25, description: '包含差评处理', params: { keywords: ['negative', 'bad review', 'complaint', 'response', 'resolution'], minMatch: 1 } },
        { type: 'artifact', weight: 0.20, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
  {
    id: 'ec-010', category: 'ecommerce', title: '跨境物流',
    goal: '制定跨境物流和清关方案',
    expectedCapabilities: [],
    expectedArtifactTypes: ['document'], difficulty: 3,
    verification: {
      checkpoints: [
        { type: 'keyword', weight: 0.25, description: '包含物流方式选择', params: { keywords: ['shipping', 'logistics', 'freight', 'express', 'air', 'sea'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含清关流程', params: { keywords: ['customs', 'clearance', 'tariff', 'hs code', 'declaration', 'duty'], minMatch: 2 } },
        { type: 'keyword', weight: 0.25, description: '包含成本计算', params: { keywords: ['cost', 'fee', 'estimate', 'tax', 'vat', 'duty'], minMatch: 2 } },
        { type: 'artifact', weight: 0.25, description: '产出文档', params: { artifactTypes: ['document'], minMatch: 1 } },
      ],
      minPassRate: 0.5,
    },
  },
];

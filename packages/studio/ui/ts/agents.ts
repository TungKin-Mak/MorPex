/* ═══════════════════════════════════════════════════════════════════════
   agents.ts — @ 提及的专职 Agent 列表配置
   
   设计规则：
   - 无 @ 前缀 → 默认闲聊/对话模式（无需注册）
   - 有 @ 前缀 → 路由到对应的专职 Agent
   
   易扩展：添加条目即可在 @ 面板中显示。
   前端只需加条目，后端需同步：
     1. 在 AGENT_LIST 中添加条目
     2. 在后端 agentDispatchMap 中添加 handler
     3. 在后端 /api/agents/suggestions 中添加数据
   ═══════════════════════════════════════════════════════════════════════ */

export interface AgentOption {
  key: string;
  name: string;
  desc: string;
  /** 匹配关键词，用于模糊搜索（自动包含 name + key） */
  keywords?: string[];
}

/**
 * Agent 列表
 * 
 * 添加新 Agent：
 *   { key: '新名字', name: '@新名字', desc: '简短描述', keywords: ['...'] }
 * 
 * 未来候选人（示例）：
 *   { key: '张骞', name: '@张骞', desc: '搜索 GitHub 开源项目', keywords: ['github', '搜索', '开源'] }
 *   { key: '徐霞客', name: '@徐霞客', desc: '爬取网页资料', keywords: ['爬虫', '网页', '采集'] }
 *   { key: '墨子', name: '@墨子', desc: '代码审查与重构', keywords: ['code', '代码', '审查'] }
 *   { key: '张衡', name: '@张衡', desc: '数据分析与可视化', keywords: ['data', '数据', '分析'] }
 */
export const AGENT_LIST: AgentOption[] = [
  {
    key: '鲁班',
    name: '@鲁班',
    desc: '任务规划、创作执行、复杂工作流',
    keywords: ['task', '任务', '做', '规划', '工作流', '文档', '生成', '鲁班', '执行'],
  },
  {
    key: '司马迁',
    name: '@司马迁',
    desc: '检索历史记忆和知识库',
    keywords: ['memory', '记忆', '司马迁', '历史', '检索', '知识库', '搜索', '忆'],
  },
];

/** 根据搜索文本模糊匹配 Agent */
export function filterAgents(search: string): AgentOption[] {
  const s = search.trim().toLowerCase();
  if (!s) return AGENT_LIST;
  return AGENT_LIST.filter((a) => {
    const haystack = [a.key.toLowerCase(), a.name.toLowerCase(), a.desc.toLowerCase(), ...(a.keywords ?? [])].join(' ');
    return haystack.includes(s);
  });
}

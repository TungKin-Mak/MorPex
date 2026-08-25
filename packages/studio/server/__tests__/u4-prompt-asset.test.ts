/**
 * U4 测试：Prompt 资产化逐字等价 + Webhook 触发路由
 *
 * 1. buildArtifactGenerationPrompt 与 git HEAD 原内联模板语义逐字等价（五类 type 全覆盖）
 * 2. POST /api/hooks/trigger：secret 对→受理 / 错→401 / 未配置 MORPEX_HOOK_SECRET→404（不暴露存在性）
 *
 * webhook 不真触发 executeGoal（bootstrap 全链过重）——校验鉴权与参数层，
 * 受理后的执行链路复用 chat/send 已验证路径。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildArtifactGenerationPrompt } from '../../../core/src/cognition/prompts/artifact-generation-prompt.js';

// ── 1) Prompt 逐字等价 ──

/** git HEAD 原内联模板的忠实重建（三元逻辑照抄，仅作等价基准） */
function legacyPrompt(type: string, specification: string, knowledgeBlock: string): string {
  const prompt = `你是一个专业的${type === 'code' ? '程序员' : type === 'doc' ? '技术文档写手' : type === 'config' ? '运维工程师' : type === 'data' ? '数据分析师' : '报告撰写专家'}。

任务: 根据以下规格生成${type === 'code' ? '代码' : type === 'doc' ? '文档' : type === 'config' ? '配置文件' : type === 'data' ? '数据' : '报告'}。

规格说明:
${specification}

${knowledgeBlock}

请输出 JSON 格式:
{
  "files": [
    { "path": "文件名（含路径）", "content": "完整文件内容", "type": "文件类型" }
  ]
}

要求:
- 内容必须基于给定的知识，不能捏造不存在的事实
- 如果知识不足以完成任务，请在 content 中注明知识缺口
- 只输出 JSON，不要其他内容`;
  return prompt;
}

describe('U4·prompt 资产化逐字等价', () => {
  const cases = [
    ['code', '实现登录接口'],
    ['doc', '写部署手册'],
    ['config', '生成 nginx 配置'],
    ['data', '导出季度数据'],
    ['report', '生成周报'], // 未知/兜底类型 → 报告撰写专家
  ] as const;
  for (const [type, spec] of cases) {
    it(`type=${type} 输出与原模板逐字一致`, () => {
      expect(buildArtifactGenerationPrompt(type, spec, '\n参考知识:\n  [1] 示例\n')).toBe(
        legacyPrompt(type, spec, '\n参考知识:\n  [1] 示例\n'),
      );
    });
  }
});

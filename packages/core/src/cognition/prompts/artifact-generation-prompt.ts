/**
 * ArtifactGenerationPrimitive 提示词资产（12-Factor F2·U4 资产化）
 *
 * 从 primitive 内联三元嵌套模板逐字迁入（只做资产化，不做文案调优）。
 * knowledgeBlock 由调用方构造后传入（保持原拼接语义）。
 */

const ARTIFACT_TYPE_ROLE: Record<string, string> = {
  code: '程序员',
  doc: '技术文档写手',
  config: '运维工程师',
  data: '数据分析师',
};

export function buildArtifactGenerationPrompt(
  type: string,
  specification: string,
  knowledgeBlock: string,
): string {
  const role = ARTIFACT_TYPE_ROLE[type] ?? '报告撰写专家';
  const label =
    type === 'code'
      ? '代码'
      : type === 'doc'
        ? '文档'
        : type === 'config'
          ? '配置文件'
          : type === 'data'
            ? '数据'
            : '报告';
  return `你是一个专业的${role}。

任务: 根据以下规格生成${label}。

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
}

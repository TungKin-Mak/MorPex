/**
 * yamlConfig — 极简 YAML 解析器（无外部依赖）
 *
 * 仅支持 MorPex 配置文件（config/morpex.yaml）所需子集：
 *   - `key: value` / `key: "string"` / `key: 'string'`
 *   - 2 层缩进嵌套（顶层对象 + 子层键值）
 *   - `#` 注释（行内/行首）
 *   - 布尔 / 数字自动转换
 *   - 环境变量引用：值中 `${VAR}` → 从 process.env 读取（敏感值不写明文）
 *
 * 不引 js-yaml（仓库无该依赖），够用即可。若未来配置复杂度上升，
 * 再引入正式 YAML 解析库。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** LLM 网关配置（config/morpex.yaml 的 llm 块） */
export interface LlmGatewayConfig {
  enabled?: boolean;
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  contextWindow?: number;
  maxTokens?: number;
}

/** MorPex 配置文件结构 */
export interface MorpexConfig {
  llm?: LlmGatewayConfig;
}

/**
 * parseYaml — 解析 YAML 文本（顶层 + 2 层缩进嵌套）
 *
 * @param text YAML 文本
 * @returns 扁平结构：顶层对象的值可以是标量或子对象
 */
export function parseYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentObj: Record<string, unknown> | null = null;

  for (const rawLine of text.split('\n')) {
    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;
    // 去注释（# 前有空格或行首）
    const line = rawLine.replace(/\s*#.*$/, '').trim();
    if (!line) continue;

    const eq = line.indexOf(':');
    if (eq === -1) continue;

    const key = line.substring(0, eq).trim();
    let value: string | number | boolean = line.substring(eq + 1).trim();

    // 去引号
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.substring(1, value.length - 1);
    } else if (value === 'true') {
      value = true;
    } else if (value === 'false') {
      value = false;
    } else if (/^\d+$/.test(value)) {
      value = Number(value);
    }

    if (indent > 0 && currentObj) {
      // 子层：归属当前顶层对象
      currentObj[key] = value;
    } else if (value === '') {
      // 顶层对象开始（如 `llm:` 无值 → 后续子层归属它）
      currentObj = {};
      result[key] = currentObj;
    } else {
      // 顶层标量
      currentObj = null;
      result[key] = value;
    }
  }
  return result;
}

/**
 * resolveEnvRefs — 将字符串中的 `${VAR}` 环境变量引用替换为实际值
 *
 * 用法：apiKey: ${GROK2API_API_KEY} → 读 process.env.GROK2API_API_KEY
 * 未设置的环境变量 → 替换为空串（调用方应校验缺失）
 */
export function resolveEnvRefs(value: string): string {
  return value.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_, name: string) => process.env[name] ?? '');
}

/**
 * loadMorpexConfig — 读取并解析 config/morpex.yaml
 *
 * @param path 配置文件路径（默认 config/morpex.yaml，相对项目根）
 * @returns 解析后的配置；文件不存在 / 解析失败 → null（不抛错）
 *
 * 解析后会对 llm 块的字符串字段应用 `${VAR}` 环境变量引用解析
 * （敏感 apiKey 支持从环境变量读取，不要求明文写入 YAML）。
 */
export function loadMorpexConfig(path?: string): MorpexConfig | null {
  const configPath = path ?? resolve(process.cwd(), 'config/morpex.yaml');
  try {
    const text = readFileSync(configPath, 'utf-8');
    const parsed = parseYaml(text) as MorpexConfig;
    // 环境变量引用解析（llm 块的字符串字段）
    if (parsed.llm) {
      const llm = parsed.llm;
      for (const key of ['provider', 'baseUrl', 'apiKey', 'model'] as const) {
        const v = llm[key];
        if (typeof v === 'string' && v.includes('${')) {
          llm[key] = resolveEnvRefs(v);
        }
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * extractJson — 从 LLM 响应中提取 JSON 字符串（三级修复）
 *
 * 处理 LLM 可能返回的各种格式：
 *   - 纯 JSON
 *   - Markdown 代码块中的 JSON（```json ... ```）
 *   - 包含额外解释的 JSON
 *   - 截断不完整的 JSON（Level 2 补齐）
 *   - 格式错误无法修复时（Level 3 LLM 重试）
 *
 * Level 1: 逐字符括号匹配（已有）
 * Level 2: 截断补齐 — 找最后一个合法 key，补齐缺失的 }
 * Level 3: 带错误反馈的 1 次 LLM 重试
 *
 * @param raw - LLM 原始响应
 * @param options - 可选配置
 * @returns 提取到的 JSON 字符串，或 null
 */
export function extractJson(
  raw: string,
  options?: {
    repair?: boolean;        // 默认 true
    retryWithLLM?: boolean;  // 默认 false (需要 LLMCaller)
    llmCaller?: (prompt: string) => Promise<string>;
  },
): string | null {
  // 1. 尝试匹配 ```json ... ``` 代码块
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    const inner = codeBlockMatch[1].trim();
    // 递归提取代码块内部的 JSON（处理嵌套代码块中的 JSON）
    const result = extractBraceJson(inner) ?? inner;
    if (result) {
      // 验证是否为有效 JSON
      try {
        JSON.parse(result);
        return result;
      } catch {
        // 代码块内的内容也不是完整 JSON，继续尝试 Level 2/3
      }
    }
    // 没有找到完整 JSON，继续处理 raw 本身
  }

  // Level 1: 使用逐字符括号匹配提取顶层 JSON 对象
  let result = extractBraceJson(raw);
  if (result) {
    try {
      JSON.parse(result);
      return result;
    } catch {
      // 括号匹配成功但 JSON 无效，尝试 Level 2 修复
    }
  }

  // Level 2: 就地修复 — 找最后一个合法 key，补齐 }
  if (options?.repair !== false) {
    result = repairTruncatedJson(raw);
    if (result) {
      try {
        JSON.parse(result);
        return result;
      } catch {
        // 修复后 JSON 仍无效，进入 Level 3
      }
    }
  }

  // Level 3 需通过 extractJsonAsync 调用（异步）
  return null;
}

/**
 * extractJsonAsync — 异步版本（含 Level 3 LLM 重试）
 *
 * 用法同 extractJson，但支持 retryWithLLM 选项。
 */
export async function extractJsonAsync(
  raw: string,
  options?: {
    repair?: boolean;
    retryWithLLM?: boolean;
    llmCaller?: (prompt: string) => Promise<string>;
  },
): Promise<string | null> {
  // 先尝试同步提取
  const syncResult = extractJson(raw, { repair: options?.repair });
  if (syncResult) return syncResult;

  // Level 3: LLM 重试
  if (options?.retryWithLLM && options?.llmCaller) {
    return retryWithLLM(raw, options.llmCaller);
  }

  return null;
}

/**
 * extractBraceJson — 使用括号匹配算法提取顶层 JSON 对象
 *
 * 从第一个 '{' 开始，逐字符计数括号深度，
 * 匹配到对应的 '}' 时返回完整 JSON 字符串。
 * 避免贪婪正则匹配嵌套大括号时的错误。
 */
function extractBraceJson(raw: string): string | null {
  const startIdx = raw.indexOf('{');
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startIdx; i < raw.length; i++) {
    const ch = raw[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (inString) {
      if (ch === '\\') {
        escapeNext = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return raw.substring(startIdx, i + 1);
      }
    }
  }

  // 括号未闭合，尝试继续搜索后续可能独立的 JSON 对象
  const nextStart = raw.indexOf('{', startIdx + 1);
  if (nextStart !== -1) {
    return extractBraceJson(raw.substring(nextStart));
  }

  return null;
}

/**
 * repairTruncatedJson — Level 2: 截断 JSON 补齐
 *
 * 当 LLM 输出被截断时，尝试找到最后一个合法 key 并补齐缺失的 }。
 *
 * 策略：
 *   1. 从第一个 '{' 开始
 *   2. 逐字符括号匹配直到无法继续
 *   3. 记录已匹配的 key 和当前深度
 *   4. 在中断处补齐需要的 '}'
 *
 * @param raw - 可能被截断的 LLM 响应
 * @returns 修复后的 JSON 字符串，或 null
 */
function repairTruncatedJson(raw: string): string | null {
  const startIdx = raw.indexOf('{');
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let lastCompleteDepth = 0;
  let lastCompleteIdx = -1;
  let lastKey: string | null = null;
  let currentKey: string | null = null;
  let isReadingKey = false;
  let expectingColon = false;
  let expectingValue = false;

  for (let i = startIdx; i < raw.length; i++) {
    const ch = raw[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (inString) {
      if (ch === '\\') {
        escapeNext = true;
      } else if (ch === '"') {
        inString = false;
        if (isReadingKey) {
          currentKey = lastKey; // 刚读完 key
          isReadingKey = false;
          expectingColon = true;
        }
      } else {
        if (isReadingKey) {
          lastKey = (lastKey ?? '') + ch;
          currentKey = lastKey;
        }
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      isReadingKey = true;
      lastKey = '';
      expectingColon = false;
      expectingValue = false;
      continue;
    }

    if (ch === ':') {
      expectingColon = false;
      expectingValue = true;
      continue;
    }

    if (ch === '{') {
      depth++;
      expectingColon = false;
      expectingValue = false;
      continue;
    }

    if (ch === '}') {
      depth--;
      if (depth === 0) {
        // 完整的顶层对象
        return raw.substring(startIdx, i + 1);
      }
      lastCompleteDepth = depth;
      lastCompleteIdx = i;
      expectingValue = false;
      continue;
    }

    if (ch === ',' && depth > 0) {
      expectingColon = false;
      expectingValue = false;
      isReadingKey = false;
      continue;
    }

    if (ch === '[') {
      // 数组开始，跳过到匹配的 ]
      const arrayEnd = findMatchingBracket(raw, i, '[', ']');
      if (arrayEnd === -1) {
        // 数组未闭合，补齐 ]
        const prefix = raw.substring(startIdx, i + 1);
        return prefix + ']' + '}'.repeat(depth);
      }
      i = arrayEnd;
      continue;
    }

    // 跳过空白
    if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') {
      continue;
    }
  }

  // 执行到这里说明 raw 搜索完毕但括号未闭合
  // 补齐缺失的 }
  if (depth > 0 && startIdx >= 0) {
    const prefix = raw.substring(startIdx);
    // 去掉末尾不完整的 token
    const cleaned = trimPartialToken(prefix);
    return cleaned + '}'.repeat(depth);
  }

  return null;
}

/**
 * findMatchingBracket — 找到匹配的括号或方括号
 */
function findMatchingBracket(raw: string, startIdx: number, open: string, close: string): number {
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startIdx; i < raw.length; i++) {
    const ch = raw[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (inString) {
      if (ch === '\\') escapeNext = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') { inString = true; continue; }
    if (ch === open) depth++;
    if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1; // 未找到匹配
}

/**
 * trimPartialToken — 去掉末尾不完整的 token（最后一个 key 或 value 不完整时）
 *
 * 例如：{"name": "John, "age": 3 → {"name": "John" 去掉不完整的 "age": 3
 */
function trimPartialToken(s: string): string {
  // 从末尾开始，找到最后一个完整的 key-value 对
  const lastComma = s.lastIndexOf(',');
  if (lastComma === -1) return s;

  // 检查逗号后面的内容是否完整
  const afterComma = s.substring(lastComma + 1).trim();

  // 如果逗号后面包含不完整的字符串（有引号但没有结束引号）
  const quoteCount = (afterComma.match(/"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    return s.substring(0, lastComma);
  }

  // 如果最后一个 token 只有 key 没有值（如 "key": 后缺失值）
  if (/^"\w+"\s*:\s*$/.test(afterComma)) {
    return s.substring(0, lastComma);
  }

  return s;
}

/**
 * retryWithLLM — Level 3: 带错误反馈的 LLM 重试
 *
 * 将原始输出和解析错误发送给 LLM 要求修复。
 * 只重试一次，防止无限循环。
 *
 * @param raw - 原始有问题的 LLM 输出
 * @param llmCaller - LLM 调用函数
 * @returns 修复后的 JSON 字符串，或 null
 */
async function retryWithLLM(
  raw: string,
  llmCaller: (prompt: string) => Promise<string>,
): Promise<string | null> {
  const retryPrompt = `你之前输出的 JSON 格式有误，解析失败。请修复后只输出完整的 JSON，不要包含其他文字。

原始输出:
${raw}

请输出修复后的完整 JSON：`;

  try {
    const retryRaw = await llmCaller(retryPrompt);
    // 再走一次 Level 1 括号匹配
    const codeBlockMatch = retryRaw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const inner = codeBlockMatch ? codeBlockMatch[1].trim() : retryRaw;
    const result = extractBraceJson(inner) ?? inner;

    if (result) {
      try {
        JSON.parse(result);
        return result;
      } catch {
        // LLM 修复后仍然无效
      }
    }
  } catch {
    // LLM 调用失败
  }

  return null;
}

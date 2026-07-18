/**
 * readJSONLLines — 流式 JSONL 解析
 *
 * 统一的 JSONL 行解析，内置容错跳过损坏行。
 *
 * @param content - JSONL 文件内容
 * @returns 解析后的对象数组
 */
export function readJSONLLines<T = Record<string, any>>(content: string): T[] {
  const results: T[] = [];
  const lines = content.split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      results.push(JSON.parse(line) as T);
    } catch {
      // 跳过损坏行
    }
  }
  return results;
}

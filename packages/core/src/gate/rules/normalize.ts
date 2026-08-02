/**
 * gate/rules/normalize — 文本规范化管道（确定性，零 LLM 成本）
 *
 * 变体归一：`AirPods` / `air pods` / `ＡｉｒＰｏｄｓ`（全角）→ 全部归一化为 `airpods`
 *   ① Unicode NFKC（全角→半角、兼容字符→标准形式）
 *   ② 小写折叠
 *   ③ 去空白（\s+）
 *
 * 规则作者注意：disallowedPattern / aliases 也按同一管道规范化，
 * 因此规则隐含"不区分大小写、无空白"语义（Phase 1 约定，见 types.ts 注释）。
 *
 * ⚠️ 复杂正则警告（Phase 1）：由于文本与模式均去空白，以下构造会失效或语义漂移：
 *   - 空白类（\s、[ ]、a b）—— 匹配对象已无空白
 *   - 词边界 \b —— 边界位置在无空白文本上不同
 *   - 大小写敏感字符类（[A-Z]）—— 已被小写折叠
 *   规则应写成"规范化后的简单正则"（禁词用 | 连接即可），复杂语义留 Phase 3 LLM 复核。
 */

/**
 * normalizeText — 文本规范化（NFKC → lowercase → 去空白）
 */
export function normalizeText(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '');
}

/**
 * normalizePattern — 规范化规则模式（用于构造正则）
 *
 * 与 normalizeText 同一语义；正则元字符（| ( ) [ ] \d 等）保留。
 * 注意：去空白对"有意含空格的正则"不适用 —— Phase 1 按无空白语义约定。
 */
export function normalizePattern(pattern: string): string {
  return pattern.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

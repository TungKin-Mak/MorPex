/**
 * readAt — 指针式索引的唯一直读入口（T2）
 *
 * ═══════════════════════════════════════════════════════════════
 * ★ 字节域契约（实现红线，违反必错位）：
 *   transcript_events.byte_offset / byte_length 是「字节」偏移与长度，
 *   不是字符下标！UTF-8 下中文 3 字节/字符——用 string.slice(offset)
 *   或按字符下标切串必然读到别的行（T1 optimizer 冒烟第一版实测踩坑：
 *   position 62 直接错位到 line 2）。
 *
 *   唯一正确姿势：fd 读 → Buffer.subarray(offset, offset+length).toString('utf-8')。
 *   本模块是全仓库唯一的坐标消费点；新增消费场景一律复刻此函数语义，
 *   并在 code review 时 grep `slice(offset` 确认无人绕过。
 * ═══════════════════════════════════════════════════════════════
 */
import * as fs from 'node:fs';

/** 按字节坐标读取 jsonl 中的一条完整行并 JSON 解析；解析失败返回 null（坏行跳过，不影响其余） */
export function readEntryAt<T = Record<string, unknown>>(jsonlPath: string, byteOffset: number, byteLength: number): T | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(jsonlPath, 'r');
    const buf = Buffer.alloc(byteLength);
    const read = fs.readSync(fd, buf, 0, byteLength, byteOffset);
    if (read <= 0) return null;
    const line = buf.subarray(0, read).toString('utf-8').trim();
    if (!line) return null;
    try {
      return JSON.parse(line) as T;
    } catch {
      return null;
    }
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

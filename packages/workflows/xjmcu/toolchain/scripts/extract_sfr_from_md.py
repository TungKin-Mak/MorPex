#!/usr/bin/env python3
"""
extract_sfr_from_md.py — 从矽杰微 Datasheet Markdown 中提取 SFR bit 布局
=====================================================================
输入：XC8P8616.md（或其他芯片的 datasheet markdown，含 HTML 寄存器表格）
输出：标准 JSON 结构，可直接写入 MorPex 记忆系统

用法：
    python extract_sfr_from_md.py E:/矽杰微/mcu_datasheet_md/XC8P8616.md
    python extract_sfr_from_md.py E:/矽杰微/mcu_datasheet_md/XC8P8616.md --import  # 直接存入 memory.db
"""

import re
import json
import sys
import os
from html.parser import HTMLParser
from typing import Optional


# ── HTML 表格解析器 ──────────────────────────────

class TableParser(HTMLParser):
    """解析 HTML <table>，提取寄存器 bit 布局"""
    def __init__(self):
        super().__init__()
        self.in_table = False
        self.in_tr = False
        self.in_td = False
        self.in_th = False
        self.current_row = []
        self.tables = []
        self._td_content = ""
        self._colspan = 1
        self._reset()

    def _reset(self):
        self.tables = []
        self.in_table = False

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        if tag == "table":
            self.in_table = True
            self.current_table = []
        elif tag == "tr" and self.in_table:
            self.in_tr = True
            self.current_row = []
        elif tag in ("td", "th") and self.in_tr:
            self.in_td = True
            self._td_content = ""
            self._colspan = int(attrs_dict.get("colspan", "1"))

    def handle_endtag(self, tag):
        if tag == "table" and self.in_table:
            if self.current_row:
                self.current_table.append(self.current_row)
            self.tables.append(self.current_table)
            self.in_table = False
        elif tag == "tr" and self.in_tr:
            if self.current_row:
                self.current_table.append(self.current_row)
            self.in_tr = False
        elif tag in ("td", "th") and self.in_td:
            self.in_td = False
            content = self._td_content.strip().replace("\n", " ")
            # 展开 colspan
            for _ in range(self._colspan):
                self.current_row.append(content)

    def handle_data(self, data):
        if self.in_td:
            self._td_content += data


# ── 寄存器表格识别 ──────────────────────────────

def find_register_tables(md_content: str) -> list[dict]:
    """
    从 markdown 中提取所有寄存器表格。
    识别规则：表格前有标题行包含 "R1" 或寄存器名 + "寄存器"
    """
    lines = md_content.split("\n")
    results = []

    # 先找所有标题行（## 或 ### 开头）
    headings = []
    for i, line in enumerate(lines):
        if line.startswith("##") or line.startswith("###"):
            headings.append((i, line.strip()))

    # 解析所有 HTML 表格
    parser = TableParser()
    parser.feed(md_content)
    tables = parser.tables

    # 为每个表格找前面的标题
    table_idx = 0
    for i, line in enumerate(lines):
        if "<table>" in line and table_idx < len(tables):
            # 找最近的标题
            prev_heading = ""
            for h_idx, h_text in reversed(headings):
                if h_idx < i:
                    prev_heading = h_text
                    break

            table = tables[table_idx]
            if len(table) >= 2:  # 至少表头+一行数据
                results.append({
                    "heading": prev_heading,
                    "line": i + 1,
                    "table": table,
                })
            table_idx += 1

    return results


def parse_register_table(table_data: dict) -> Optional[dict]:
    """
    解析单个寄存器表格，返回结构化数据。
    
    识别的表格格式：
    | 地址 | Bit7 | Bit6 | ... | Bit0 |
    | 寄存器名 | bit7名 | bit6名 | ... | bit0名 |
    | 读/写 | ... |
    | 复位值 | ... |
    """
    table = table_data["table"]
    if len(table) < 2:
        return None

    # 第一行：检查是否包含地址信息
    header = table[0]
    # 找地址列（包含 0X 的）
    addr = ""
    for cell in header:
        if "0X" in cell.upper():
            addr = cell.strip()
            break

    # 第二行：寄存器名 + bit 定义
    if len(table) < 2:
        return None
    row1 = table[1]
    reg_name = row1[0].strip() if row1 else ""

    # 提取 bit 定义（跳过第一个单元格=寄存器名）
    bits = {}
    bit_pos = 7
    for cell in row1[1:]:
        bit_name = cell.strip()
        if bit_name and bit_name not in ("-", "", "—"):
            bits[f"bit{bit_pos}"] = bit_name
        bit_pos -= 1

    # 提取复位值（如果有第4行）
    reset_values = {}
    if len(table) >= 4:
        row3 = table[3]
        bit_pos = 7
        for cell in row3[1:]:
            val = cell.strip()
            if val and val not in ("-", "", "—"):
                reset_values[f"bit{bit_pos}"] = val
            bit_pos -= 1

    # 从标题中提取更完整的寄存器名
    heading = table_data.get("heading", "")
    # 尝试匹配 R1xx/REGNAME
    reg_match = re.search(r'R1([0-9A-Fa-f]{2})/(\w+)', heading)
    if reg_match:
        sfr_name = reg_match.group(2)
        sfr_addr = int(reg_match.group(1), 16)
    else:
        sfr_name = reg_name
        sfr_addr = 0

    result = {
        "name": sfr_name,
        "address": addr,
        "address_int": sfr_addr,
        "bits": {},
        "reset_values": reset_values,
    }

    for pos, name in bits.items():
        result["bits"][pos] = {
            "name": name,
            "description": "",  # 表格本身不含描述，需要从后续段落补
        }

    return result


def extract_sfr_descriptions(md_content: str, sfr_list: list[dict]) -> list[dict]:
    """
    从 markdown 正文中提取每个 SFR 的 bit 描述。
    在寄存器表格后面通常有 bullet list 说明每个 bit 的功能。
    """
    lines = md_content.split("\n")
    
    for sfr in sfr_list:
        name = sfr["name"]
        # 找寄存器表格出现的位置
        found_at = -1
        for i, line in enumerate(lines):
            if name.upper() in line.upper() and "<table>" in lines[i:i+3]:
                found_at = i
                break
        
        if found_at < 0:
            continue

        # 在表格后面找 bullet list（- 开头或 • 开头）
        desc_start = found_at + 10  # 跳过表格
        for j in range(desc_start, min(desc_start + 100, len(lines))):
            line = lines[j].strip()
            # 匹配 bit 描述行：如 "Bit7 xxx: 描述"
            bit_match = re.match(r'[*-]\s*[Bb]it(\d)\s*[:：]\s*(.+)', line)
            if bit_match:
                bit_pos = f"bit{bit_match.group(1)}"
                desc = bit_match.group(2).strip()
                if bit_pos in sfr["bits"]:
                    sfr["bits"][bit_pos]["description"] = desc
            
            # 也匹配 "Bit7=1 xxx" 格式
            bit_eq = re.match(r'[*-]\s*[Bb]it(\d)\s*=\s*(\d)\s*(.+)', line)
            if bit_eq:
                bit_pos = f"bit{bit_eq.group(1)}"
                desc = f"={bit_eq.group(2)}: {bit_eq.group(3).strip()}"
                if bit_pos in sfr["bits"]:
                    sfr["bits"][bit_pos]["description"] = desc

    return sfr_list


def extract_channel_values(md_content: str, sfr_list: list[dict]) -> list[dict]:
    """
    提取通道选择值（如 ADIS 编码）
    """
    for sfr in sfr_list:
        if sfr["name"] in ("ADCON0", "ADCON1"):
            # 找 "ADIS 通道选择" 表格
            lines = md_content.split("\n")
            in_table = False
            for i, line in enumerate(lines):
                if "ADIS" in line and "通道" in line:
                    in_table = True
                    continue
                if in_table and "<table>" in line:
                    # 解析通道映射表
                    parser = TableParser()
                    # 找到这个 table 的结束
                    end = lines[i:].index("</table>") if "</table>" in lines[i:] else 0
                    table_html = "\n".join(lines[i:i+end+1])
                    parser.feed(table_html)
                    if parser.tables:
                        sfr["channel_map"] = parse_channel_table(parser.tables[0])
                    break
    return sfr_list


def parse_channel_table(table: list) -> dict:
    """解析通道映射表"""
    mapping = {}
    for row in table[1:]:  # 跳过表头
        if len(row) >= 2:
            key = row[0].strip()
            val = row[1].strip()
            if key and val:
                mapping[key] = val
    return mapping


# ── 主流程 ──────────────────────────────────────

def extract_from_md(filepath: str) -> list[dict]:
    """从 markdown 文件提取所有 SFR 寄存器信息"""
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    # 1. 找所有寄存器表格
    tables = find_register_tables(content)
    print(f"找到 {len(tables)} 个 HTML 表格")

    # 2. 解析为 SFR
    sfrs = []
    for t in tables:
        parsed = parse_register_table(t)
        if parsed and parsed["name"]:
            sfrs.append(parsed)

    print(f"识别到 {len(sfrs)} 个 SFR 寄存器")

    # 3. 提取 bit 描述
    sfrs = extract_sfr_descriptions(content, sfrs)

    # 4. 提取通道映射
    sfrs = extract_channel_values(content, sfrs)

    return sfrs


def save_to_memory(sfrs: list[dict], db_path: str = "E:/Morpex/data/memory.db"):
    """将提取的 SFR 数据写入 MorPex 记忆系统"""
    import sqlite3
    conn = sqlite3.connect(db_path)
    now = 0  # 将由数据库自动处理
    
    for sfr in sfrs:
        name = sfr["name"]
        addr = sfr["address"]
        
        # 构建 data_json
        data = {
            "address": addr,
            "bits": sfr["bits"],
            "reset_values": sfr.get("reset_values", {}),
        }
        if "channel_map" in sfr:
            data["channel_map"] = sfr["channel_map"]
        
        data_json = json.dumps(data, ensure_ascii=False)
        
        # 更新或插入
        existing = conn.execute(
            "SELECT id FROM kg_entities WHERE name = ? AND type = 'SFR'",
            (name,)
        ).fetchone()
        
        if existing:
            conn.execute(
                "UPDATE kg_entities SET data_json = ?, updated_at = ? WHERE id = ?",
                (data_json, int(__import__('time').time()), existing["id"])
            )
            print(f"  ✅ 更新: {name} @ {addr}")
        else:
            eid = f"reg_{name.lower()}"
            conn.execute(
                "INSERT INTO kg_entities (id, type, name, domain, data_json, importance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (eid, "SFR", name, "embedded", data_json, 0.7, int(__import__('time').time()), int(__import__('time').time()))
            )
            print(f"  ✅ 新增: {name} @ {addr}")
    
    conn.commit()
    conn.close()
    print(f"\n共写入 {len(sfrs)} 个 SFR 到记忆系统")


# ── CLI 入口 ────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    filepath = sys.argv[1]
    if not os.path.isfile(filepath):
        print(f"文件不存在: {filepath}")
        sys.exit(1)

    sfrs = extract_from_md(filepath)

    # 输出 JSON
    if "--json" in sys.argv:
        print(json.dumps(sfrs, ensure_ascii=False, indent=2))
    
    # 导入记忆系统
    elif "--import" in sys.argv:
        save_to_memory(sfrs)
    
    # 默认：打印摘要
    else:
        print(f"\n提取结果摘要:")
        for s in sfrs:
            print(f"  {s['name']:12s} @ {s['address']:10s}  ({len(s['bits'])} bits)")
            for bp, binfo in s['bits'].items():
                desc = binfo.get('description', '')
                print(f"    {bp}: {binfo['name']:20s} {desc}")
            if 'channel_map' in s:
                print(f"    通道映射: {len(s['channel_map'])} 项")

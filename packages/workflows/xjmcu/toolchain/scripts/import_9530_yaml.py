#!/usr/bin/env python3
"""导入 xc8p9530用法.yaml 到 MorPex 记忆系统"""
import json
import sqlite3
import yaml
import os
import sys
from pathlib import Path

# 加载 YAML
yaml_path = "E:/矽杰微/xc8p9530用法.yaml"
with open(yaml_path, "r", encoding="utf-8") as f:
    data = yaml.safe_load(f)

chip_name = data["params"]["chip"]
print(f"导入芯片: {chip_name}")

# 连接 MorPex 记忆数据库
db_path = "E:/Morpex/data/memory.db"
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

# ==== 1. 删除旧数据 ====
print("删除旧数据...")
cur.execute("DELETE FROM kg_relations WHERE from_id IN (SELECT id FROM kg_entities WHERE name=?)", (chip_name,))
cur.execute("DELETE FROM kg_relations WHERE to_id IN (SELECT id FROM kg_entities WHERE name=?)", (chip_name,))
cur.execute("DELETE FROM kg_entities WHERE name=?", (chip_name,))
cur.execute("DELETE FROM kg_entities WHERE name LIKE 'XC8P9530_%'")
cur.execute("DELETE FROM memory_entries WHERE tags LIKE '%9530%' OR tags LIKE '%xc8p9530%'")
conn.commit()

# ==== 2. 导入芯片实体 ====
chip_id = chip_name
chip_info = {
    "manufacturer": "矽杰微",
    "arch": "传统系列(RPAGE+IOC)",
    "rom": data["params"]["rom"],
    "ram": data["params"]["ram"],
    "stack": data["params"]["stack"],
    "io": data["params"]["gpio"],
    "timers": data["params"]["timers"],
    "features": data["params"]["features"],
}
reg_list = []
if "registers" in data:
    for page_group in data["registers"]:
        page = page_group.get("page", "RPAGE")
        for reg in page_group.get("list", []):
            reg_list.append(reg)
            # 导入 SFR 实体
            sfr_id = f"{chip_name}_{reg['name']}"
            sfr_data = {
                "address": reg["addr"],
                "page": page,
                "desc": reg.get("desc", ""),
                "bits": reg.get("bits", {}),
                "bit_desc": reg.get("bit_desc", ""),
            }
            for bit_name, bit_info in reg.get("bits", {}).items():
                if isinstance(bit_info, dict):
                    sfr_data.setdefault("bits_detail", {})[bit_name] = {
                        "pos": bit_info.get("pos", []),
                        "desc": bit_info.get("desc", ""),
                        "vals": bit_info.get("vals", {}),
                        "note": bit_info.get("note", ""),
                    }
            cur.execute(
                "INSERT OR REPLACE INTO kg_entities (id, type, name, domain, tags, data_json) VALUES (?, ?, ?, ?, ?, ?)",
                (sfr_id, "SFR", reg["name"], "xjmcu", f"sfr,{chip_name},page_{page}",
                 json.dumps(sfr_data, ensure_ascii=False))
            )

cur.execute(
    "INSERT OR REPLACE INTO kg_entities (id, type, name, domain, tags, data_json) VALUES (?, ?, ?, ?, ?, ?)",
    (chip_id, "MCU", chip_name, "xjmcu", f"mcu,{chip_name}",
     json.dumps(chip_info, ensure_ascii=False))
)

# ==== 3. 导入引脚信息 ====
if "pins" in data:
    pins_info = {str(p["pin"]): {"name": p["name"], "func": p["func"]} for p in data["pins"]}
    pin_entry_id = f"{chip_name}_pins"
    cur.execute(
        "INSERT OR REPLACE INTO kg_entities (id, type, name, domain, tags, data_json) VALUES (?, ?, ?, ?, ?, ?)",
        (pin_entry_id, "PINS", f"{chip_name}_PINS", "xjmcu", f"pins,{chip_name}",
         json.dumps(pins_info, ensure_ascii=False))
    )
    cur.execute(
        "INSERT OR REPLACE INTO kg_relations (from_id, to_id, type) VALUES (?, ?, ?)",
        (chip_id, pin_entry_id, "has_pins")
    )

# ==== 4. 导入 recipes（代码模板） ====
recipes_added = 0
if "recipes" in data:
    for recipe_name, recipe_code in data["recipes"].items():
        if isinstance(recipe_code, str) and len(recipe_code) > 20:
            entry_id = f"{chip_name}_recipe_{recipe_name}"
            cur.execute(
                "INSERT OR REPLACE INTO memory_entries (id, mem_type, content, source, tags, importance) VALUES (?, ?, ?, ?, ?, ?)",
                (entry_id, "recipe", recipe_code, "yaml_import",
                 f"recipe,{recipe_name},{chip_name}", 5)
            )
            recipes_added += 1

# ==== 5. 导入 skeleton（框架） ====
if "skeleton" in data:
    for sk_name, sk_code in data["skeleton"].items():
        if isinstance(sk_code, str) and len(sk_code) > 20:
            entry_id = f"{chip_name}_skeleton_{sk_name}"
            cur.execute(
                "INSERT OR REPLACE INTO memory_entries (id, mem_type, content, source, tags, importance) VALUES (?, ?, ?, ?, ?, ?)",
                (entry_id, "skeleton", sk_code, "yaml_import",
                 f"skeleton,{sk_name},{chip_name}", 5)
            )

# ==== 6. 建立外设与芯片的关系 ====
periph_map = {
    "TC0": "TC0CON", "TC1/PWM": "TC1CON", "CMP": "CMPCON0",
    "GPIO": "P6CON", "WDT": "WDTCON", "INT": "INTF"
}
for periph_name, sfr_example in periph_map.items():
    periph_id = f"{chip_name}_{periph_name}"
    # 查找是否已存在
    existing = cur.execute("SELECT id FROM kg_entities WHERE id=?", (periph_id,)).fetchone()
    if not existing:
        cur.execute(
            "INSERT OR REPLACE INTO kg_entities (id, type, name, domain, tags, data_json) VALUES (?, ?, ?, ?, ?, ?)",
            (periph_id, "PERIPHERAL", periph_name, "xjmcu", f"peripheral,{chip_name}",
             json.dumps({"related_sfr": sfr_example}, ensure_ascii=False))
        )
    # 关联到芯片
    rel_exists = cur.execute(
        "SELECT id FROM kg_relations WHERE from_id=? AND to_id=? AND type='has_peripheral'",
        (chip_id, periph_id)
    ).fetchone()
    if not rel_exists:
        cur.execute(
            "INSERT OR REPLACE INTO kg_relations (from_id, to_id, type) VALUES (?, ?, ?)",
            (chip_id, periph_id, "has_peripheral")
        )

# 关联所有 SFR 到芯片
for reg in reg_list:
    sfr_id = f"{chip_name}_{reg['name']}"
    rel_exists = cur.execute(
        "SELECT id FROM kg_relations WHERE from_id=? AND to_id=? AND type='has_sfr'",
        (chip_id, sfr_id)
    ).fetchone()
    if not rel_exists:
        cur.execute(
            "INSERT OR REPLACE INTO kg_relations (from_id, to_id, type) VALUES (?, ?, ?)",
            (chip_id, sfr_id, "has_sfr")
        )

conn.commit()

# ==== 报告 ====
sfr_count = len(reg_list)
chip_count = cur.execute("SELECT COUNT(*) FROM kg_entities WHERE name=?", (chip_name,)).fetchone()[0]
recipe_count = cur.execute("SELECT COUNT(*) FROM memory_entries WHERE tags LIKE ?", (f"%{chip_name}%",)).fetchone()[0]
print(f"[OK] 导入完成:")
print(f"   - 芯片: {chip_name}")
print(f"   - SFR: {sfr_count}")
print(f"   - 记忆条目: {recipe_count}")
print(f"   - 外设: {len(periph_map)}")

conn.close()

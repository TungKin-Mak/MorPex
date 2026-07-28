#!/usr/bin/env python3
"""
mcu_memory_kb.py — MorPex 记忆系统知识库查询层
=================================================
不依赖 LLM 内部知识，只从 MorPex 的 memory.db + missions.db 检索。
检索不到的知识点 → 抛出 MissingKnowledge 异常，由上层询问用户。

用法:
    kb = MorPexMemoryKB()
    chip = kb.get_chip("XC8P8616")          # 返回芯片参数
    periphs = kb.get_peripherals("XC8P8616") # 返回外设列表
    sfr = kb.get_sfr("ADCON0")              # 返回 SFR 描述
    recipes = kb.get_recipes("adc")         # 返回记忆条目
    sop = kb.get_sop("xc8p8616")            # 返回 SOP 经验
"""

import json
import sqlite3
import os
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import Any, Optional


# ── 异常 ──────────────────────────────────────────

class MissingKnowledge(LookupError):
    """记忆系统中没有查到该知识点，需要询问用户"""
    def __init__(self, domain: str, key: str, detail: str = ""):
        self.domain = domain
        self.key = key
        self.detail = detail
        super().__init__(f"[MissingKnowledge] 领域={domain}, 键={key}: {detail}")


# ── 数据类型 ──────────────────────────────────────

@dataclass
class ChipSpec:
    """芯片规格（来自 kg_entities）"""
    id: str
    name: str
    manufacturer: str = ""
    arch: str = ""
    rom: str = ""
    ram: str = ""
    io: str = ""
    voltage: str = ""
    freq: str = ""
    raw: dict = field(default_factory=dict)


@dataclass
class PeripheralSpec:
    """外设规格"""
    id: str
    name: str
    resolution: str = ""
    channels: int = 0
    features: list = field(default_factory=list)
    registers: list = field(default_factory=list)
    raw: dict = field(default_factory=dict)


@dataclass
class SFRSpec:
    """SFR 寄存器"""
    id: str
    name: str
    address: str = ""
    description: str = ""
    raw: dict = field(default_factory=dict)


@dataclass
class MemoryEntry:
    """记忆条目"""
    id: str
    content: str
    tags: list = field(default_factory=list)


# ── 知识库查询层 ──────────────────────────────────

class MorPexMemoryKB:
    """从 MorPex 记忆系统查询 MCU 知识"""

    def __init__(self, db_path: Optional[str] = None):
        if db_path is None:
            # 默认路径：相对于项目根
            self.db_path = self._find_db()
        else:
            self.db_path = db_path
        self._conn: Optional[sqlite3.Connection] = None

    def _find_db(self) -> str:
        """自动查找 MorPex 的 memory.db"""
        candidates = [
            "./data/memory.db",
            "../data/memory.db",
            "../../data/memory.db",
            "E:/Morpex/data/memory.db",
        ]
        for p in candidates:
            if os.path.isfile(p):
                return os.path.abspath(p)
        raise FileNotFoundError(
            "找不到 memory.db，请设置 MorPex 数据目录路径"
        )

    @property
    def conn(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = sqlite3.connect(self.db_path)
            self._conn.row_factory = sqlite3.Row
        return self._conn

    def _query(self, sql: str, params: tuple = ()) -> list:
        return self.conn.execute(sql, params).fetchall()

    def _query_one(self, sql: str, params: tuple = ()) -> Optional[dict]:
        row = self.conn.execute(sql, params).fetchone()
        return dict(row) if row else None

    # ── 芯片查询 ──────────────────────────────────

    def get_chip(self, chip_name: str) -> ChipSpec:
        """查询芯片规格"""
        row = self._query_one(
            "SELECT * FROM kg_entities WHERE name = ? AND type = 'MCU'",
            (chip_name,)
        )
        if not row:
            raise MissingKnowledge("chip", chip_name,
                f"记忆系统中没有芯片 [{chip_name}] 的信息。"
                "请提供：厂商、架构、ROM/RAM大小、IO引脚数、工作电压、频率")

        data = json.loads(row["data_json"]) if row["data_json"] else {}
        return ChipSpec(
            id=row["id"],
            name=row["name"],
            manufacturer=data.get("manufacturer", ""),
            arch=data.get("arch", ""),
            rom=data.get("rom", ""),
            ram=data.get("ram", ""),
            io=data.get("io", ""),
            voltage=data.get("voltage", ""),
            freq=data.get("freq", ""),
            raw=data,
        )

    # ── 外设查询 ──────────────────────────────────

    def get_peripherals(self, chip_name: str) -> list[PeripheralSpec]:
        """查询芯片的所有外设"""
        # 先找芯片 ID
        chip = self._query_one(
            "SELECT id FROM kg_entities WHERE name = ? AND type = 'MCU'",
            (chip_name,)
        )
        if not chip:
            raise MissingKnowledge("chip", chip_name, f"芯片 {chip_name} 不在记忆系统中")

        # 找 has_peripheral 关系
        rels = self._query(
            "SELECT to_id FROM kg_relations WHERE from_id = ? AND type = 'has_peripheral'",
            (chip["id"],)
        )
        periphs = []
        for r in rels:
            row = self._query_one(
                "SELECT * FROM kg_entities WHERE id = ?", (r["to_id"],)
            )
            if row:
                data = json.loads(row["data_json"]) if row["data_json"] else {}
                periphs.append(PeripheralSpec(
                    id=row["id"],
                    name=row["name"],
                    resolution=data.get("resolution", ""),
                    channels=data.get("channels", 0),
                    features=data.get("features", []),
                    registers=data.get("regs", []),
                    raw=data,
                ))
        return periphs

    # ── SFR 查询 ──────────────────────────────────

    def get_sfr(self, sfr_name: str) -> Optional[SFRSpec]:
        """查询 SFR 寄存器"""
        row = self._query_one(
            "SELECT * FROM kg_entities WHERE name = ? AND type = 'SFR'",
            (sfr_name,)
        )
        if not row:
            return None  # SFR 可能不存在，返回 None 由调用方决定
        data = json.loads(row["data_json"]) if row["data_json"] else {}
        return SFRSpec(
            id=row["id"],
            name=row["name"],
            address=data.get("address", ""),
            description=data.get("desc", ""),
            raw=data,
        )

    def get_all_sfrs(self) -> list[SFRSpec]:
        """查询所有 SFR"""
        rows = self._query("SELECT * FROM kg_entities WHERE type = 'SFR'")
        result = []
        for row in rows:
            data = json.loads(row["data_json"]) if row["data_json"] else {}
            result.append(SFRSpec(
                id=row["id"],
                name=row["name"],
                address=data.get("address", ""),
                description=data.get("desc", ""),
                raw=data,
            ))
        return result

    # ── 记忆条目查询 ──────────────────────────────

    def get_recipes(self, tag: str) -> list[MemoryEntry]:
        """按标签查询记忆条目（代码模板/教程）"""
        rows = self._query(
            "SELECT id, content, tags FROM memory_entries WHERE tags LIKE ?",
            (f"%{tag}%",)
        )
        return [
            MemoryEntry(id=r["id"], content=r["content"],
                       tags=r["tags"].split(",") if r["tags"] else [])
            for r in rows
        ]

    def get_memory(self, mem_id: str) -> Optional[MemoryEntry]:
        """按 ID 查询记忆条目"""
        row = self._query_one(
            "SELECT id, content, tags FROM memory_entries WHERE id = ?",
            (mem_id,)
        )
        if not row:
            return None
        return MemoryEntry(
            id=row["id"], content=row["content"],
            tags=row["tags"].split(",") if row["tags"] else []
        )

    # ── SOP 查询 ──────────────────────────────────

    def get_sop(self, tag: str) -> list[dict]:
        """从 missions.db.shared_experiences 查询 SOP"""
        missions_db = self.db_path.replace("memory.db", "missions.db")
        if not os.path.isfile(missions_db):
            return []
        try:
            mconn = sqlite3.connect(missions_db)
            mconn.row_factory = sqlite3.Row
            rows = mconn.execute(
                "SELECT * FROM shared_experiences WHERE tags LIKE ?",
                (f"%{tag}%",)
            ).fetchall()
            mconn.close()
            return [dict(r) for r in rows]
        except Exception:
            return []

    # ── 综合查询 ──────────────────────────────────

    def comprehensive_retrieve(self, chip_name: str) -> dict:
        """综合查询，返回结构化知识包"""
        result = {
            "chip": None,
            "peripherals": [],
            "sfrs": [],
            "recipes": [],
            "sops": [],
            "missing": [],
        }

        try:
            result["chip"] = asdict(self.get_chip(chip_name))
        except MissingKnowledge as e:
            result["missing"].append(str(e))

        try:
            result["peripherals"] = [asdict(p) for p in self.get_peripherals(chip_name)]
        except MissingKnowledge as e:
            result["missing"].append(str(e))

        result["sfrs"] = [asdict(s) for s in self.get_all_sfrs()]

        for tag in ["adc", "pwm", chip_name.lower()]:
            result["recipes"].extend(
                [asdict(r) for r in self.get_recipes(tag)]
            )

        result["sops"] = self.get_sop(chip_name.lower())

        return result


# ── 自测 ──────────────────────────────────────────

if __name__ == "__main__":
    kb = MorPexMemoryKB()
    info = kb.comprehensive_retrieve("XC8P8616")
    print("=== 记忆系统知识查询结果 ===")
    print(f"芯片: {info['chip']}")
    print(f"外设 ({len(info['peripherals'])}):")
    for p in info['peripherals']:
        print(f"  - {p['name']}: resolution={p['resolution']}, channels={p['channels']}")
    print(f"SFR ({len(info['sfrs'])}):")
    for s in info['sfrs']:
        print(f"  - {s['name']} @ {s['address']}: {s['description']}")
    print(f"记忆条目 ({len(info['recipes'])}):")
    for r in info['recipes']:
        print(f"  - [{r['id']}] {r['content'][:60]}...")
    print(f"SOP ({len(info['sops'])}):")
    for s in info['sops']:
        print(f"  - {s['problem_pattern']}")
    if info['missing']:
        print(f"\n⚠️  缺失知识 ({len(info['missing'])}):")
        for m in info['missing']:
            print(f"  {m}")

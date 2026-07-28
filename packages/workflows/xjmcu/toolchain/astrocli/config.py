"""
astrocli — MCU 配置解析
从 .mpj / .xbin 文件路径自动推断 MCU 型号和配置字
"""
import os
import xml.etree.ElementTree as ET

from .constants import CHIP_DATABASE, FAMILY_SFR_MAP


# ============================================================
# 默认配置（XC8P9530）
# ============================================================
DEFAULT_CONFIG = {
    "name": "XC8P9530",
    "rom_size": 1024,
    "ram_size": 80,
    "ram_base": 48,
    "opt_size": 6,
    "rom_base": 0,
    "instr_width": 14,
    "family": "rpage_port6",
    "config_words": [0x3FFF, 0x3FFF, 0x3FFF, 0x3FFF, 0x3FFF, 0x3FFF],
}


# ============================================================
# .mpj 解析
# ============================================================
def parse_mpj(mpj_path: str) -> dict:
    """
    从 .mpj (XML) 文件中提取：
      - Chip: MCU 型号
      - Option values: 配置字列表

    返回 dict: {name, rom_size, ram_size, ram_base, opt_size, rom_base, config_words}
    """
    tree = ET.parse(mpj_path)
    root = tree.getroot()

    # 提取 MCU 型号
    chip_elem = root.find("Chip")
    chip_name = chip_elem.text.strip() if chip_elem is not None and chip_elem.text else "XC8P9530"

    # 提取配置字
    options = root.find("Options")
    config_words = []
    if options is not None:
        for child in options:
            if child.tag.startswith("OPTIONVALUE"):
                try:
                    config_words.append(int(child.text.strip(), 16))
                except (ValueError, AttributeError):
                    pass

    # 从芯片数据库获取参数 (找不到则 fallback 到 XC8P9530)
    chip_info = CHIP_DATABASE.get(chip_name.upper(), CHIP_DATABASE.get("XC8P9530", {}))
    opt_size = chip_info.get("opt_size", 6)

    config = {
        "name": chip_name,
        "rom_size": chip_info.get("rom_size", 1024),
        "ram_size": chip_info.get("ram_size", 80),
        "ram_base": chip_info.get("ram_base", 48),
        "opt_size": opt_size,
        "rom_base": chip_info.get("rom_base", 0),
        "instr_width": chip_info.get("instr_width", 14),
        "family": chip_info.get("family", "rpage_port6"),
        "config_words": config_words[: opt_size] if config_words else [],
    }

    # 如果配置字不足，用 0x3FFF (14-bit) 或 0xFFFF (16-bit) 填充
    default_fill = 0xFFFF if chip_info.get("instr_width") == 16 else 0x3FFF
    while len(config["config_words"]) < config["opt_size"]:
        config["config_words"].append(default_fill)

    return config


# ============================================================
# 自动查找 .mpj 文件
# ============================================================
def find_mpj(xbin_path: str) -> str | None:
    """
    根据 .xbin 路径查找同目录下的 .mpj 文件。
    返回 .mpj 路径，找不到返回 None。
    """
    xbin_dir = os.path.dirname(os.path.abspath(xbin_path))
    for fname in os.listdir(xbin_dir):
        if fname.endswith(".mpj"):
            mpj_path = os.path.join(xbin_dir, fname)
            if os.path.isfile(mpj_path):
                return mpj_path
    return None


# ============================================================
# 主入口：从 xbin 路径获取完整配置
# ============================================================
def get_config(xbin_path: str = None, mpj_path: str = None) -> dict:
    """
    获取 MCU 配置。
    优先级：mpj_path > 从 xbin_path 同目录自动查找 > 默认配置

    返回 config dict 包含:
      name, rom_size, ram_size, ram_base, opt_size, rom_base,
      instr_width, family, config_words

    用法:
      config = get_config("E:/test/XC8P9530_INT.xbin")
      # 自动在同目录找 .mpj → 解析 Chip + Option Values
    """
    if mpj_path and os.path.isfile(mpj_path):
        return parse_mpj(mpj_path)

    if xbin_path:
        found = find_mpj(xbin_path)
        if found:
            return parse_mpj(found)

    return dict(DEFAULT_CONFIG)

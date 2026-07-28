"""buildcli — Chip database from IDE XML configuration files."""

from __future__ import annotations
import xml.etree.ElementTree as ET
from functools import lru_cache
from pathlib import Path

from .errors import ChipNotFoundError
from .types import ChipInfo, FALLBACK_CHIP_DB


def _parse_chip_xml(xml_path: Path) -> ChipInfo:
    """Parse MCU parameters from an IDE ``config/*.XML`` file."""
    tree = ET.parse(str(xml_path))
    root = tree.getroot()

    def _int(tag: str, default: int = 0) -> int:
        el = root.find(tag)
        return int(el.text.strip()) if el is not None and el.text else default

    name = (root.findtext("Name", "") or "").strip()
    if not name or name.isdigit():
        name = xml_path.stem

    return ChipInfo(
        name=name,
        rom_size=_int("RomSize", 1024),
        ram_size=_int("RamSize", 80),
        ram_base=_int("RamBase", 48),
        option_size=_int("OptionSize", 6),
        rom_base=_int("RomBase", 0),
        option_base=_int("OptionBase", 0),
        instruction_width=_int("InstructionWidth", 14),
    )


@lru_cache(maxsize=64)
def get_chip_info(chip: str, ide_path: Path | None = None) -> ChipInfo:
    """Return :class:`ChipInfo` for *chip*.

    Priority: IDE XML > built-in fallback database.

    Raises:
        ChipNotFoundError: chip unknown.
    """
    chip_upper = chip.upper()

    if ide_path is not None:
        xml_path = ide_path / "config" / f"{chip_upper}.XML"
        if xml_path.exists():
            return _parse_chip_xml(xml_path)

    if chip_upper in FALLBACK_CHIP_DB:
        return ChipInfo(name=chip_upper, **FALLBACK_CHIP_DB[chip_upper])

    raise ChipNotFoundError(
        f"Unknown chip: {chip}. "
        f"Known: {sorted(FALLBACK_CHIP_DB)}"
    )


def list_chips(ide_path: Path | None = None) -> list[str]:
    """Return sorted list of all known chip names."""
    chips: set[str] = set(FALLBACK_CHIP_DB.keys())
    if ide_path is not None:
        config_dir = ide_path / "config"
        if config_dir.is_dir():
            for xml_file in config_dir.glob("*.XML"):
                chips.add(xml_file.stem.upper())
    return sorted(chips)

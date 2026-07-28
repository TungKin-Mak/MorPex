"""buildcli — Project file generation (.mpj XML and .xj binary).

Creates project scaffolding that 1:1 replicates what the official IDE produces.
"""

from __future__ import annotations
import os
import struct
import xml.etree.ElementTree as ET
from pathlib import Path

from .types import DEFAULT_CONFIG_WORDS


# ═══════════════════════════════════════════════════════════
# Config word extraction from source files
# ═══════════════════════════════════════════════════════════

import re as _re

# Matches:  // @config 0x1FFF, 0x3F77, 0x1FE5, ...
_CONFIG_COMMENT_RE = _re.compile(
    r'//\s*@config\s+(.*?)$',
    _re.IGNORECASE | _re.MULTILINE
)
# Matches:  #define BUILDCLI_CONFIG_WORD0 0x1FFF
_CONFIG_DEFINE_RE = _re.compile(
    r'#define\s+BUILDCLI_CONFIG_WORD(\d+)\s+(0x[0-9A-Fa-f]+)',
    _re.IGNORECASE
)


def extract_config_from_source(source_path: str) -> list[int] | None:
    """Extract config words from a C/H source file.

    Supports two conventions:

    1. Comment form (recommended)::

           // @config 0x1FFF, 0x3F77, 0x1FE5, 0x3BFF, 0x3FFF, 0x3FFF

    2. Define form::

           #define BUILDCLI_CONFIG_WORD0 0x1FFF
           #define BUILDCLI_CONFIG_WORD1 0x3F77

    Returns a list of config word ints, or None if nothing found.
    """
    try:
        with open(source_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except OSError:
        return None

    # Try comment form first
    m = _CONFIG_COMMENT_RE.search(content)
    if m:
        hex_vals = _re.findall(r'0x[0-9A-Fa-f]+', m.group(1))
        if hex_vals:
            return [int(v, 16) for v in hex_vals]

    # Try define form
    defines = {}
    for m in _CONFIG_DEFINE_RE.finditer(content):
        idx = int(m.group(1))
        val = int(m.group(2), 16)
        defines[idx] = val

    if defines:
        max_idx = max(defines.keys())
        return [defines.get(i, 0x3FFF) for i in range(max_idx + 1)]

    return None


def extract_config_from_sources(sources: list[str]) -> list[int] | None:
    """Try to extract config words from a list of source files.

    Scans .h files first, then .c files.  Returns first hit.
    """
    # Prefer .h over .c
    ordered = sorted(sources, key=lambda p: (0 if p.endswith('.h') else 1))
    for src in ordered:
        result = extract_config_from_source(src)
        if result:
            return result
    return None


# ═══════════════════════════════════════════════════════════
# .mpj XML project file
# ═══════════════════════════════════════════════════════════

_MPJ_TEMPLATE = """<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<Project>
\t<Name>{name}</Name>
\t<Path>{path}</Path>
\t<Chip>{chip}</Chip>
\t<FilterIndex>2</FilterIndex>
\t<Previous_Instruction_Set>0</Previous_Instruction_Set>
\t<FileList>
{file_list}
\t</FileList>
\t<H_FileList>
{h_file_list}
\t</H_FileList>
\t<List_FileList>
{list_file_list}
\t</List_FileList>
\t<Options>
{options}
\t</Options>
</Project>
"""


def generate_mpj(
    project_dir: str,
    name: str,
    chip: str,
    sources: list[str],
    headers: list[str] | None = None,
    config_words: list[int] | None = None,
) -> str:
    """Generate a .mpj XML project file as a string.

    Args:
        project_dir: Absolute path to the project directory.
        name: Project name (becomes ``<Name>``).
        chip: MCU model, e.g. ``XC8P9530``.
        sources: List of absolute paths to .c / .asm source files.
        headers: Optional list of absolute paths to .h header files.
        config_words: Optional config words (defaults to XC8P9530 defaults).

    Returns:
        XML string ready to write to ``{name}.mpj``.
    """
    if config_words is None:
        config_words = list(DEFAULT_CONFIG_WORDS)

    def _fmt_file_list(files: list[str], tag: str) -> str:
        if not files:
            return f"\t\t<{tag}/>"
        return "\n".join(f"\t\t<{tag}>{f}</{tag}>" for f in files)

    # List files
    lst_files = [os.path.join(project_dir, f"{name}.lst")]

    xml = _MPJ_TEMPLATE.format(
        name=name,
        path=project_dir,
        chip=chip,
        file_list=_fmt_file_list(sources, "File"),
        h_file_list=_fmt_file_list(headers or [], "H_File"),
        list_file_list=_fmt_file_list(lst_files, "List_File"),
        options="\n".join(
            f"\t\t<OPTIONVALUE{i}>{w:04X}</OPTIONVALUE{i}>"
            for i, w in enumerate(config_words)
        ),
    )
    return xml


def write_mpj(
    project_dir: str,
    name: str,
    chip: str,
    sources: list[str],
    headers: list[str] | None = None,
    config_words: list[int] | None = None,
) -> str:
    """Generate and write a .mpj file to *project_dir*.

    Returns:
        Absolute path to the written .mpj file.
    """
    xml = generate_mpj(project_dir, name, chip, sources, headers, config_words)
    mpj_path = os.path.join(project_dir, f"{name}.mpj")
    with open(mpj_path, "w", encoding="utf-8") as f:
        f.write(xml)
    return mpj_path


# ═══════════════════════════════════════════════════════════
# .mpj parsing (existing project)
# ═══════════════════════════════════════════════════════════

def parse_mpj(mpj_path: str) -> dict:
    """Parse an existing .mpj XML project file.

    Returns dict with keys: chip, name, sources, dir, config_words.
    """
    mpj_path = os.path.abspath(mpj_path)
    if not os.path.isfile(mpj_path):
        raise FileNotFoundError(f"MPJ file not found: {mpj_path}")

    tree = ET.parse(mpj_path)
    root = tree.getroot()
    proj_dir = os.path.dirname(mpj_path)

    chip = (root.findtext("Chip", "") or "").strip()
    name = (root.findtext("Name", "") or "project").strip()

    # Sources
    sources: list[str] = []
    file_list = root.find("FileList")
    if file_list is not None:
        for f in file_list.findall("File"):
            src = (f.text or "").strip()
            if not src:
                continue
            if not os.path.isabs(src):
                src = os.path.join(proj_dir, src)
            sources.append(os.path.normpath(src))

    # Fix corrupted .mpj paths (found in FRESH_TEST where backslashes are missing)
    fixed_sources: list[str] = []
    for src in sources:
        if os.path.isfile(src):
            fixed_sources.append(src)
            continue
        # Try to repair — some .mpj files have missing path separators
        repaired = _repair_mpj_path(src, proj_dir)
        if repaired:
            fixed_sources.append(repaired)
        else:
            fixed_sources.append(src)  # keep original, let caller handle

    # Config words
    config_words: list[int] = []
    options = root.find("Options")
    if options is not None:
        for child in options:
            if child.tag.startswith("OPTIONVALUE"):
                try:
                    val = (child.text or "").strip()
                    config_words.append(int(val, 16))
                except (ValueError, AttributeError):
                    pass

    return {
        "chip": chip,
        "name": name,
        "sources": fixed_sources,
        "dir": proj_dir,
        "config_words": config_words,
    }


def _repair_mpj_path(broken: str, project_dir: str) -> str | None:
    """Try to repair a corrupted .mpj file path.

    Some .mpj files lose backslash/dot characters, e.g.:
    ``mainE:\\cli\\3_FRESH_TESTc`` should be ``E:\\cli\\3_FRESH_TEST\\main.c``.
    """
    if os.path.isfile(broken):
        return os.path.normpath(broken)

    # Strategy: look for files in project_dir whose stem appears in broken path
    basename = os.path.basename(broken)
    for fname in os.listdir(project_dir):
        fpath = os.path.join(project_dir, fname)
        if not os.path.isfile(fpath):
            continue
        stem, ext = os.path.splitext(fname)
        if ext not in (".c", ".asm", ".h", ".inc"):
            continue
        # Match: either the stem appears in the broken path, or basename matches
        if stem in broken or fname == basename:
            return os.path.normpath(fpath)

    return None


# ═══════════════════════════════════════════════════════════
# .xj binary project file
# ═══════════════════════════════════════════════════════════

_XJ_CHIPNAME_LEN = 8


def generate_xj(
    chip: str,
    rom_data: bytes,
    config_words: list[int] | None = None,
    rom_words: int = 1024,
    build_counter: int = 1,
) -> bytes:
    """Generate a .xj binary project file.

    The .xj format is the IDE's native project descriptor.  Structure::

        Offset  Size  Description
        ------  ----  -----------
        0x00    8     Chip name (ASCII, zero-padded)
        0x08    24    Reserved (zeros)
        0x20    4     Build counter / timestamp (uint32 LE)
        0x24    12    Config words (6 × uint16 LE)
        0x30    4     ROM size in words (uint32 LE)
        0x34    2     Flags (uint16 LE, typically 0x1010)
        0x36    N     ROM image data

    Args:
        chip: MCU model name, e.g. ``XC8P9530``.
        rom_data: Raw ROM binary (words × 2 bytes).  Usually from :func:`~hexbin.hex_to_raw`.
        config_words: 6 config words.  Defaults to XC8P9530 defaults.
        rom_words: ROM size in words (default 1024).
        build_counter: Monotonic counter written to offset 0x20.

    Returns:
        Complete .xj file as bytes.
    """
    if config_words is None:
        config_words = list(DEFAULT_CONFIG_WORDS)

    buf = bytearray()

    # Chip name (8 bytes, zero-padded)
    name_bytes = chip.encode("ascii", errors="replace")[:_XJ_CHIPNAME_LEN]
    buf.extend(name_bytes.ljust(_XJ_CHIPNAME_LEN, b"\x00"))

    # Reserved (24 bytes)
    buf.extend(b"\x00" * 24)

    # Build counter (uint32 LE)
    buf.extend(struct.pack("<I", build_counter & 0xFFFFFFFF))

    # Config words (6 × uint16 LE)
    for i in range(6):
        w = config_words[i] if i < len(config_words) else 0x3FFF
        buf.extend(struct.pack("<H", w & 0xFFFF))

    # ROM size in words (uint32 LE)
    buf.extend(struct.pack("<I", rom_words))

    # Flags (uint16 LE)
    buf.extend(struct.pack("<H", 0x1010))

    # ROM data — pad or truncate to rom_words * 2
    expected_len = rom_words * 2
    if len(rom_data) < expected_len:
        rom_data = rom_data + b"\xff\x3f" * ((expected_len - len(rom_data)) // 2)
    buf.extend(rom_data[:expected_len])

    return bytes(buf)


def write_xj(
    xj_path: str,
    chip: str,
    rom_data: bytes,
    config_words: list[int] | None = None,
    rom_words: int = 1024,
    build_counter: int = 1,
) -> str:
    """Write a .xj file and return its path."""
    data = generate_xj(chip, rom_data, config_words, rom_words, build_counter)
    with open(xj_path, "wb") as f:
        f.write(data)
    return xj_path

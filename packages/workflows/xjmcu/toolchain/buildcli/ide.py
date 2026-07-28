"""buildcli — IDE discovery and resource path resolution.

Finds the XJ_C_IDE installation and resolves all tool paths.
"""

from __future__ import annotations
import glob
import os
from pathlib import Path
from typing import Optional

from .errors import IDENotFoundError

# ── Known search locations ──────────────────────────────
_KNOWN_PATTERNS: list[str] = [
    r"F:\DevTools\XJ_C_IDE_V*",
    r"C:\Program Files\XJ-IDE*",
    r"C:\Program Files (x86)\XJ-IDE*",
    r"D:\XJ_C_IDE*",
    r"E:\XJ_C_IDE*",
]


def _validate_ide(path: Path) -> bool:
    """Return True if *path* looks like a valid IDE root."""
    return (path / "bin" / "slcc.exe").exists()


def discover_ide(explicit: str | None = None) -> Path:
    """Find the IDE installation directory.

    Priority:
        1. *explicit* argument
        2. ``XJIDE_HOME`` environment variable
        3. ``BUILDCLI_IDE_PATH`` environment variable
        4. Known glob patterns

    Raises:
        IDENotFoundError: no valid installation found.
    """
    candidates: list[tuple[str, Path]] = []

    if explicit:
        candidates.append(("--ide-path", Path(explicit)))

    for env_var in ("XJIDE_HOME", "BUILDCLI_IDE_PATH"):
        val = os.environ.get(env_var)
        if val:
            candidates.append((env_var, Path(val)))

    for pattern in _KNOWN_PATTERNS:
        for match in sorted(glob.glob(pattern), reverse=True):
            candidates.append((f"glob({pattern})", Path(match)))

    for _source, path in candidates:
        if _validate_ide(path):
            return path.resolve()

    searched = [str(p) for _, p in candidates] or ["(none)"]
    raise IDENotFoundError(
        "IDE not found. Searched:\n  "
        + "\n  ".join(searched)
        + "\nSet XJIDE_HOME or use --ide-path."
    )


# ── Resource resolvers ──────────────────────────────────

def get_header_dir(ide: Path) -> Path:
    """Directory containing chip .h header files."""
    return ide / "header"


def get_include_dir(ide: Path) -> Path:
    """Directory containing .INC assembler include files."""
    return ide / "include"


def find_tool(ide: Path, name: str) -> Path:
    """Find a tool executable in the IDE bin directory.

    *name* may include or omit the ``.exe`` suffix.
    """
    exe = name if name.endswith(".exe") else f"{name}.exe"
    path = ide / "bin" / exe
    if path.exists():
        return path
    raise FileNotFoundError(f"Tool not found: {path}")


def find_lib(ide: Path, chip: str) -> Path:
    """Find the .lib library for *chip*."""
    path = ide / "lib" / f"{chip.lower()}.lib"
    if path.exists():
        return path
    # Some chips share libraries — try case-insensitive
    for candidate in (ide / "lib").glob("*.lib"):
        if candidate.stem.upper() == chip.upper():
            return candidate
    raise FileNotFoundError(f"Library not found for {chip}: searched {path}")


def find_lkr(ide: Path, chip: str) -> Path:
    """Find the .lkr linker script for *chip*."""
    path = ide / "lkr" / f"{chip}.lkr"
    if path.exists():
        return path
    # Try case-insensitive
    for candidate in (ide / "lkr").glob("*.lkr"):
        if candidate.stem.upper() == chip.upper():
            return candidate
    raise FileNotFoundError(f"Linker script not found for {chip}: searched {path}")


def find_inc(ide: Path, chip: str) -> Path:
    """Find the .INC assembler include for *chip*."""
    path = ide / "include" / f"{chip}.INC"
    if path.exists():
        return path
    for candidate in (ide / "include").glob("*.INC"):
        if candidate.stem.upper() == chip.upper():
            return candidate
    raise FileNotFoundError(f"INC file not found for {chip}")

"""buildcli — CLI argument parsing and routing.

Usage::

    python -m buildcli build --chip XC8P9530 --src main.c
    python -m buildcli init  --chip XC8P9530 --name MyProject
    python -m buildcli agent --chip XC8P9530 --src test.c
"""

from __future__ import annotations
import argparse
import os
import sys
from collections.abc import Callable
from pathlib import Path

from . import __version__
from .agent import exec_build
from .chipdb import get_chip_info, list_chips
from .hexbin import hex_to_raw
from .ide import discover_ide
from .patches import get_patch_manager
from .project import parse_mpj, write_mpj, write_xj
from .types import DEFAULT_CONFIG_WORDS


# ═══════════════════════════════════════════════════════════
# Shared argument builders
# ═══════════════════════════════════════════════════════════

def _add_build_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--chip", help="MCU model (e.g. XC8P9530)")
    parser.add_argument("--src", nargs="+", help="Source files (.c, .asm) or directories")
    parser.add_argument("--mpj", help=".mpj project file")
    parser.add_argument("--output", "-o", help="Output directory", default="build")
    parser.add_argument("--name", "-n", help="Project name")
    parser.add_argument("--ide-path", help="Path to XJ_C_IDE installation")
    parser.add_argument("--patch-dir", nargs="+", help="Additional patch directories")
    parser.add_argument("--include", "-I", nargs="+", help="Additional include directories",
                        dest="include_dirs")
    parser.add_argument("--config", "-C", help="Config words (hex, comma-separated). E.g. 1FFF,3F77,1FE5,3BFF,3FFF,3FFF")


# ═══════════════════════════════════════════════════════════
# Subcommand: build
# ═══════════════════════════════════════════════════════════

def cmd_build(args: argparse.Namespace) -> int:
    config_words = _parse_config_arg(getattr(args, 'config', None))
    exit_code, result = exec_build(
        sources=args.src,
        mpj=args.mpj,
        chip=args.chip,
        output_dir=args.output,
        project_name=args.name,
        ide_path=args.ide_path,
        patch_dirs=args.patch_dir,
        include_dirs=args.include_dirs,
        config_words=config_words,
        json_output=False,
    )
    print()
    if result["status"] == "pass":
        print("=" * 60)
        print(f"[PASS] {result['project']}  chip={result['chip']}  "
              f"ROM={result['rom_words']}W")
        _print_artifacts(result.get("artifacts") or {})
        print("=" * 60)
    else:
        _print_artifacts(result.get("artifacts") or {})
        print(f"[FAIL] {result.get('error', 'unknown error')}", file=sys.stderr)
    return exit_code


# ═══════════════════════════════════════════════════════════
# Subcommand: agent (AI mode)
# ═══════════════════════════════════════════════════════════

def cmd_agent(args: argparse.Namespace) -> int:
    config_words = _parse_config_arg(getattr(args, 'config', None))
    exit_code, _ = exec_build(
        sources=args.src,
        mpj=args.mpj,
        chip=args.chip,
        output_dir=args.output,
        project_name=args.name,
        ide_path=args.ide_path,
        patch_dirs=args.patch_dir,
        include_dirs=args.include_dirs,
        config_words=config_words,
        json_output=True,
    )
    return exit_code


# ═══════════════════════════════════════════════════════════
# Subcommand: init (create project)
# ═══════════════════════════════════════════════════════════

_INIT_TEMPLATE_C = """// {name} — created by buildcli v{version}
// Chip: {chip}
#include "{chip}.h"

void main()
{{
    while (1)
    {{
        // Your code here
    }}
}}
"""

_INIT_TEMPLATE_H = """// {name}.h — project header
"""


def cmd_init(args: argparse.Namespace) -> int:
    """Create a new project that 1:1 replicates IDE project structure."""
    chip = args.chip or "XC8P9530"
    name = args.name or "firmware"
    project_dir = os.path.abspath(args.output or ".")

    os.makedirs(project_dir, exist_ok=True)

    # 1. Generate main.c
    main_c_path = os.path.join(project_dir, f"{name}.c")
    if not os.path.exists(main_c_path) or args.force:
        with open(main_c_path, "w", encoding="utf-8") as f:
            f.write(_INIT_TEMPLATE_C.format(name=name, version=__version__, chip=chip))
        print(f"  Created: {main_c_path}")
    else:
        print(f"  Skipped (exists): {main_c_path}")

    # 2. Generate header
    h_path = os.path.join(project_dir, f"{name}.h")
    if not os.path.exists(h_path) or args.force:
        with open(h_path, "w", encoding="utf-8") as f:
            f.write(_INIT_TEMPLATE_H.format(name=name))
        print(f"  Created: {h_path}")

    # 3. Write .mpj
    sources = [main_c_path]
    headers = [h_path]
    config_words = (
        [int(w, 16) for w in args.config_words]
        if args.config_words
        else DEFAULT_CONFIG_WORDS
    )
    mpj_path = write_mpj(project_dir, name, chip, sources, headers, config_words)
    print(f"  Created: {mpj_path}")

    # 4. Write .xj (empty ROM)
    xj_path = os.path.join(project_dir, f"{name}.xj")
    rom_words = 1024  # default for XC8P9530
    try:
        info = get_chip_info(chip)
        rom_words = info.rom_size
    except Exception:
        pass
    empty_rom = b"\xff\x3f" * rom_words
    write_xj(xj_path, chip, empty_rom, config_words, rom_words)
    print(f"  Created: {xj_path}")

    print(f"\n[OK] Project '{name}' created in {project_dir}")
    print(f"     chip={chip}  rom={rom_words}W")
    return 0


# ═══════════════════════════════════════════════════════════
# Subcommand: discover
# ═══════════════════════════════════════════════════════════

def cmd_discover(args: argparse.Namespace) -> int:
    try:
        ide = discover_ide(args.ide_path)
        print(f"IDE found: {ide}")
        print(f"  bin:     {(ide / 'bin').exists()}")
        config_dir = ide / "config"
        print(f"  config:  {len(list(config_dir.glob('*.XML')))} XML files")
        header_dir = ide / "header"
        print(f"  header:  {len(list(header_dir.glob('*.h')))} headers")
        lib_dir = ide / "lib"
        print(f"  lib:     {len(list(lib_dir.glob('*.lib')))} libraries")
        return 0
    except Exception as exc:
        print(f"IDE not found: {exc}", file=sys.stderr)
        return 1


# ═══════════════════════════════════════════════════════════
# Subcommand: chip-info
# ═══════════════════════════════════════════════════════════

def cmd_chip_info(args: argparse.Namespace) -> int:
    try:
        ide_path = discover_ide(args.ide_path) if not args.no_ide else None
        info = get_chip_info(args.chip, ide_path)
        print(f"Chip: {info.name}")
        print(f"  ROM:  {info.rom_size} words ({info.instruction_width}-bit)")
        print(f"  RAM:  {info.ram_size} bytes (base=0x{info.ram_base:02X})")
        print(f"  Option: {info.option_size} words (base=0x{info.option_base:04X})")
        return 0
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


# ═══════════════════════════════════════════════════════════
# Subcommand: chips (list)
# ═══════════════════════════════════════════════════════════

def cmd_chips(args: argparse.Namespace) -> int:
    try:
        ide_path = discover_ide(args.ide_path) if not args.no_ide else None
        chips = list_chips(ide_path)
        for c in chips:
            print(c)
        return 0
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


# ═══════════════════════════════════════════════════════════
# Subcommand: hex2xbin
# ═══════════════════════════════════════════════════════════

def cmd_hex2xbin(args: argparse.Namespace) -> int:
    if not os.path.exists(args.hex):
        print(f"Error: file not found: {args.hex}", file=sys.stderr)
        return 1
    xbin = args.output or Path(args.hex).with_suffix(".xbin")
    raw = hex_to_raw(args.hex, args.rom_words)
    with open(xbin, "wb") as f:
        f.write(raw)
    print(f"xbin: {xbin} ({len(raw)} bytes)")
    return 0


# ═══════════════════════════════════════════════════════════
# Subcommand: mpj-info
# ═══════════════════════════════════════════════════════════

def cmd_mpj_info(args: argparse.Namespace) -> int:
    try:
        data = parse_mpj(args.mpj)
        print(f"Project: {data['name']}")
        print(f"Chip:    {data['chip']}")
        print(f"Dir:     {data['dir']}")
        print(f"Sources ({len(data['sources'])}):")
        for s in data["sources"]:
            exists = "[OK]" if os.path.isfile(s) else "[MISSING]"
            print(f"  {exists} {s}")
        if data["config_words"]:
            print(f"Config words ({len(data['config_words'])}):")
            for i, w in enumerate(data["config_words"]):
                print(f"  [{i}] 0x{w:04X}")
        return 0
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


# ═══════════════════════════════════════════════════════════
# Subcommand: patches
# ═══════════════════════════════════════════════════════════

def cmd_patches(args: argparse.Namespace) -> int:
    pm = get_patch_manager()
    names = pm.plugin_names
    if names:
        print(f"Loaded patches ({len(names)}):")
        for n in names:
            print(f"  - {n}")
    else:
        print("No patches loaded.")
    return 0


# ═══════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════

def _print_artifacts(artifacts: dict) -> None:
    """Print artifact paths, handling both single paths and lists."""
    # Order: linked artifacts first, then per-source
    order = ["hex", "xbin", "cof", "cofv", "xj", "mpj",
             "map", "cod", "lst", "asm", "err"]
    for name in order:
        val = artifacts.get(name)
        if not val:
            continue
        if isinstance(val, list):
            for p in val:
                if p and os.path.exists(p):
                    print(f"  {name:>8s}: {p}  ({os.path.getsize(p):,} bytes)")
        elif os.path.exists(val):
            print(f"  {name:>8s}: {val}  ({os.path.getsize(val):,} bytes)")
    # Catch any extra keys not in order
    for name, val in artifacts.items():
        if name in order:
            continue
        if isinstance(val, list):
            for p in val:
                if p and os.path.exists(p):
                    print(f"  {name:>8s}: {p}  ({os.path.getsize(p):,} bytes)")
        elif val and os.path.exists(str(val)):
            print(f"  {name:>8s}: {val}  ({os.path.getsize(str(val)):,} bytes)")


def _parse_config_arg(config_str: str | None) -> list[int] | None:
    """Parse --config '1FFF,3F77,1FE5,3BFF,3FFF,3FFF' → list of ints."""
    if not config_str:
        return None
    words = []
    for part in config_str.split(","):
        part = part.strip()
        if part:
            words.append(int(part, 16))
    return words if words else None


# ═══════════════════════════════════════════════════════════
# Route table + main
# ═══════════════════════════════════════════════════════════

_ROUTES: dict[str, Callable[[argparse.Namespace], int]] = {
    "build":      cmd_build,
    "agent":      cmd_agent,
    "init":       cmd_init,
    "discover":   cmd_discover,
    "chip-info":  cmd_chip_info,
    "chips":      cmd_chips,
    "hex2xbin":   cmd_hex2xbin,
    "mpj-info":   cmd_mpj_info,
    "patches":    cmd_patches,
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="buildcli",
        description=f"XJ-IDE CLI build toolchain v{__version__}",
    )
    parser.add_argument("--version", action="version",
                        version=f"buildcli v{__version__}")
    sub = parser.add_subparsers(dest="command", title="commands")

    # build
    _add_build_args(sub.add_parser("build", help="Compile project"))
    # agent
    _add_build_args(sub.add_parser("agent", help="AI agent mode (JSON output)"))
    # init
    p = sub.add_parser("init", help="Create a new project (1:1 IDE replica)")
    p.add_argument("--chip", help="MCU model (default XC8P9530)")
    p.add_argument("--name", "-n", help="Project name")
    p.add_argument("--output", "-o", help="Output directory", default=".")
    p.add_argument("--config-words", nargs="+",
                   help="Config words in hex (e.g. 1FFF 3F77)")
    p.add_argument("--force", "-f", action="store_true",
                   help="Overwrite existing files")
    # discover
    p = sub.add_parser("discover", help="Find IDE installation")
    p.add_argument("--ide-path")
    # chip-info
    p = sub.add_parser("chip-info", help="Show chip parameters")
    p.add_argument("chip")
    p.add_argument("--ide-path")
    p.add_argument("--no-ide", action="store_true")
    # chips
    p = sub.add_parser("chips", help="List all known chips")
    p.add_argument("--ide-path")
    p.add_argument("--no-ide", action="store_true")
    # hex2xbin
    p = sub.add_parser("hex2xbin", help="Convert Intel HEX to .xbin")
    p.add_argument("hex")
    p.add_argument("rom_words", nargs="?", type=int, default=1024)
    p.add_argument("--output", "-o")
    # mpj-info
    p = sub.add_parser("mpj-info", help="Parse .mpj project file")
    p.add_argument("mpj")
    # patches
    sub.add_parser("patches", help="List loaded patch plugins")

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command is None:
        parser.print_help()
        return 1

    handler = _ROUTES.get(args.command)
    if handler is None:
        parser.print_help()
        return 1

    return handler(args)


if __name__ == "__main__":
    sys.exit(main())

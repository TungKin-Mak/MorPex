"""buildcli — Compiler tool invocations.

Wraps slcc, slasm, sllink, slvo as subprocess calls with consistent logging.
"""

from __future__ import annotations
import re
import subprocess
import sys
from pathlib import Path


def _truncate(cmd: list[str], max_len: int = 120) -> str:
    s = " ".join(cmd)
    return s if len(s) <= max_len else s[: max_len - 3] + "..."


def _run(cmd: list[str], label: str, verbose: bool = True,
         err_path: str | None = None) -> subprocess.CompletedProcess:
    """Execute a compiler tool and return the completed process.

    If *err_path* is given, stderr is always saved to that file regardless of
    success/failure — just like the IDE's per-source .err convention.
    """
    if verbose:
        print(f"  [{label}] {_truncate(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if err_path and result.stderr:
        with open(err_path, "w", encoding="utf-8", errors="replace") as f:
            f.write(result.stderr)
    if verbose and result.returncode != 0 and result.stderr:
        print(result.stderr, file=sys.stderr)
    return result


# ── slcc: C → assembly ──────────────────────────────────

def slcc_compile(
    slcc_exe: str | Path,
    chip: str,
    src: str,
    out_asm: str,
    include_flags: list[str],
    verbose: bool = True,
    err_path: str | None = None,
) -> subprocess.CompletedProcess:
    """Compile a .c file to assembly with slcc.

    Equivalent to: ``slcc -S -pCHIP --use-non-free -o out.asm src.c``
    """
    cmd = [
        str(slcc_exe),
        "-S",
        *include_flags,
        f"-p{chip}",
        "--use-non-free",
        f"-o{out_asm}",
        src,
    ]
    return _run(cmd, f"slcc {Path(src).stem}", verbose, err_path)


# ── slasm: assembly → object ────────────────────────────

def slasm_assemble(
    slasm_exe: str | Path,
    chip: str,
    src_asm: str,
    out_obj: str,
    include_dir: str,
    extra_flags: list[str] | None = None,
    verbose: bool = True,
    err_path: str | None = None,
) -> subprocess.CompletedProcess:
    """Assemble a .asm file to object with slasm.

    Equivalent to: ``slasm -c -pCHIP -Iinclude_dir -o out.o src.asm``
    """
    flags = (extra_flags or [])
    cmd = [
        str(slasm_exe),
        "-c",
        f"-p{chip}",
        *flags,
        f"-I{include_dir}",
        f"-o{out_obj}",
        src_asm,
    ]
    return _run(cmd, f"slasm {Path(src_asm).stem}", verbose, err_path)


# ── sllink: objects → hex/cof/map ───────────────────────

def sllink_link(
    sllink_exe: str | Path,
    lkr_path: str,
    output_base: str,
    obj_paths: list[str],
    lib_path: str,
    verbose: bool = True,
    err_path: str | None = None,
) -> subprocess.CompletedProcess:
    """Link objects + library into .hex/.cof/.map.

    Equivalent to: ``sllink -c -m -slkr -ooutput_base objs... lib``
    """
    cmd = [
        str(sllink_exe),
        "-c",
        "-m",
        f"-s{lkr_path}",
        f"-o{output_base}",
        *obj_paths,
        lib_path,
    ]
    return _run(cmd, "sllink", verbose, err_path)


# ── slvo: COFF → text ───────────────────────────────────

def slvo_dump(
    slvo_exe: str | Path,
    cof_path: str,
    verbose: bool = True,
) -> subprocess.CompletedProcess:
    """Dump .cof debug info to text.

    Equivalent to: ``slvo -s -t file.cof``
    """
    cmd = [str(slvo_exe), "-s", "-t", cof_path]
    return _run(cmd, "slvo", verbose)


# ── ROM usage extraction ────────────────────────────────

_ROM_RE = re.compile(
    r"(?:Program Memory Used:\s*(\d+)\s*Words?|"
    r"(\d+)\s+program addresses? used|"
    r"Program Memory\s*(?:Words|Size)?\s*:?\s*(\d+)\s*/|"
    r"程序存储器\s*(?:使用|大小)?\s*:?\s*(\d+))",
    re.IGNORECASE,
)


def extract_rom_usage(stdout: str = "", stderr: str = "") -> int | None:
    """Try to parse ROM word count from sllink output (checks both stdout and stderr)."""
    m = _ROM_RE.search(stdout) or _ROM_RE.search(stderr)
    if m:
        for g in m.groups():
            if g:
                return int(g)
    return None

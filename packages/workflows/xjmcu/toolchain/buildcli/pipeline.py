"""buildcli — Build pipeline orchestrator.

The central module that chains together the full compilation flow:
discover IDE → resolve chip → compile → patch → assemble → link → hex2xbin → cofv.
"""

from __future__ import annotations
import os
from pathlib import Path

from .chipdb import get_chip_info
from .compiler import (
    extract_rom_usage,
    slasm_assemble,
    slcc_compile,
    sllink_link,
    slvo_dump,
)
from .hexbin import hex_to_raw
from .ide import (
    discover_ide,
    find_lib,
    find_lkr,
    find_tool,
    get_header_dir,
    get_include_dir,
)
from .patches import get_patch_manager
from .project import (
    extract_config_from_sources,
    parse_mpj,
    write_mpj,
)
from .types import BuildConfig, BuildResult, PhaseResult, DEFAULT_CONFIG_WORDS


# ── Configuration resolution ────────────────────────────

def resolve_config(
    sources: list[str] | None = None,
    mpj: str | None = None,
    chip: str | None = None,
    output_dir: str | None = None,
    project_name: str | None = None,
    ide_path: str | None = None,
    patch_dirs: list[str] | None = None,
    include_dirs: list[str] | None = None,
    config_words: list[int] | None = None,
) -> BuildConfig:
    """Build a :class:`BuildConfig` from CLI/API arguments."""
    cfg = BuildConfig(
        chip=chip or "",
        project_name=project_name or "firmware",
        output_dir=output_dir or "build",
        ide_path=ide_path,
        patch_dirs=patch_dirs or [],
        include_dirs=include_dirs or [],
        config_words=config_words,
    )

    # 1. Merge .mpj
    if mpj:
        _merge_mpj(cfg, mpj, project_name)

    # 2. Merge explicit sources
    if sources:
        for src in sources:
            if src.endswith(".mpj"):
                _merge_mpj(cfg, src, project_name)
            elif os.path.isdir(src):
                s = os.path.abspath(src)
                cfg.include_dirs.append(s)
                for f in os.listdir(s):
                    if f.endswith((".c", ".asm")):
                        cfg.sources.append(os.path.join(s, f))
            elif src.endswith((".c", ".asm")):
                cfg.sources.append(os.path.abspath(src))
                cfg.include_dirs.append(os.path.dirname(os.path.abspath(src)))

    # Deduplicate
    cfg.sources = list(dict.fromkeys(cfg.sources))
    cfg.include_dirs = list(dict.fromkeys(cfg.include_dirs))

    # Auto-extract config words from source files if not already set
    if cfg.config_words is None and cfg.sources:
        extracted = extract_config_from_sources(cfg.sources)
        if extracted:
            cfg.config_words = extracted

    return cfg


def _merge_mpj(cfg: BuildConfig, mpj_path: str, project_name: str | None) -> None:
    data = parse_mpj(mpj_path)
    cfg.chip = cfg.chip or data["chip"]
    cfg.project_name = project_name or data["name"]
    cfg.sources.extend(data["sources"])
    cfg.include_dirs.append(data["dir"])
    cfg.mpj_path = cfg.mpj_path or mpj_path
    # Config words from .mpj take precedence if user didn't specify
    if cfg.config_words is None and data.get("config_words"):
        cfg.config_words = list(data["config_words"])


# ── Pipeline ─────────────────────────────────────────────

def run_pipeline(cfg: BuildConfig, verbose: bool = True) -> BuildResult:
    """Execute the full build pipeline.

    Returns a :class:`BuildResult` (never raises on expected build failures).
    """
    result = BuildResult(
        chip=cfg.chip,
        project=cfg.project_name,
        output_dir=cfg.output_dir,
        sources_count=len(cfg.sources),
    )

    issues = cfg.validate()
    if issues:
        return _fail(result, "validate", "; ".join(issues))

    # ── Phase 1: IDE discovery ───────────────────────────
    try:
        ide = discover_ide(cfg.ide_path)
        result.phases["discover_ide"] = PhaseResult(status="ok", details=str(ide))

        slcc_exe   = find_tool(ide, "slcc")
        slasm_exe  = find_tool(ide, "slasm")
        sllink_exe = find_tool(ide, "sllink")
        slvo_exe   = find_tool(ide, "slvo")
        header_dir = str(get_header_dir(ide))
        include_dir = str(get_include_dir(ide))
        lib_path   = str(find_lib(ide, cfg.chip))
        lkr_path   = str(find_lkr(ide, cfg.chip))
    except Exception as exc:
        return _fail(result, "discover_ide", str(exc))

    # ── Phase 2: Chip info ───────────────────────────────
    try:
        info = get_chip_info(cfg.chip, ide)
        result.rom_words = info.rom_size
        result.phases["resolve_chip"] = PhaseResult(
            status="ok",
            details=f"{info.name}: ROM={info.rom_size}W RAM={info.ram_size}B",
        )
    except Exception as exc:
        return _fail(result, "resolve_chip", str(exc))

    # ── Prepare output ───────────────────────────────────
    out_base = os.path.join(cfg.output_dir, cfg.project_name)
    os.makedirs(cfg.output_dir, exist_ok=True)

    include_flags = [f"-I{header_dir}", f"-I{include_dir}"]
    for inc in cfg.include_dirs:
        if os.path.isdir(inc):
            include_flags.append(f"-I{inc}")
    include_flags = list(dict.fromkeys(include_flags))

    # ── Phase 3+4: Compile + Patch + Assemble ────────────
    obj_paths: list[str] = []
    patch_manager = get_patch_manager(extra_dirs=cfg.patch_dirs or None)
    obj_dir = os.path.join(cfg.output_dir, "obj")
    os.makedirs(obj_dir, exist_ok=True)

    compile_status: dict[str, str] = {}
    patch_status: dict[str, list] = {}
    assemble_status: dict[str, str] = {}

    for src in cfg.sources:
        stem = Path(src).stem
        asm_path = os.path.join(obj_dir, f"{stem}.asm")
        obj_path = os.path.join(obj_dir, f"{stem}.o")
        err_path = os.path.join(obj_dir, f"{stem}.err")

        if src.endswith(".c"):
            # Compile C → asm
            r = slcc_compile(slcc_exe, cfg.chip, src, asm_path, include_flags,
                             verbose, err_path=err_path)
            if r.returncode != 0:
                compile_status[stem] = "fail"
                result.artifacts.setdefault("err", []).append(err_path)
                _flush_compile_phases(result, compile_status, patch_status, assemble_status)
                return _fail(result, "compile", f"slcc failed on {stem}",
                             err_path=err_path)

            compile_status[stem] = "ok"

        elif src.endswith(".asm"):
            asm_path = src
            compile_status[stem] = "skipped"
        else:
            continue

        # Register .asm artifact
        if os.path.exists(asm_path):
            result.artifacts.setdefault("asm", []).append(asm_path)

        # Patch asm — apply to ALL assembly (both compiled and user-provided)
        pr = patch_manager.apply_all(asm_path, cfg.chip)
        patch_status[stem] = [
            p["plugin"] for p in pr if p["status"] == "ok"
        ]
        for p in pr:
            if p["status"] == "fail":
                result.warnings.append(f"patch {p['plugin']}: {p.get('reason', '')}")

        # Assemble — pass all include dirs (IDE + user-specified)
        r = slasm_assemble(slasm_exe, cfg.chip, asm_path, obj_path, include_dir,
                           include_flags, verbose, err_path=err_path)
        if r.returncode != 0:
            assemble_status[stem] = "fail"
            result.artifacts.setdefault("err", []).append(err_path)
            _flush_compile_phases(result, compile_status, patch_status, assemble_status)
            return _fail(result, "assemble", f"slasm failed on {stem}",
                         err_path=err_path)

        assemble_status[stem] = "ok"
        obj_paths.append(obj_path)

        # Register per-source .lst if slasm produced it
        per_lst = os.path.join(obj_dir, f"{stem}.lst")
        if os.path.exists(per_lst):
            result.artifacts.setdefault("lst", []).append(per_lst)

    _flush_compile_phases(result, compile_status, patch_status, assemble_status)

    # ── Phase 5: Link ────────────────────────────────────
    link_err = out_base + ".err"
    r = sllink_link(sllink_exe, lkr_path, out_base, obj_paths, lib_path,
                    verbose, err_path=link_err)
    if r.returncode != 0:
        result.artifacts.setdefault("err", []).append(link_err)
        return _fail(result, "link", f"sllink failed — see {link_err}", (r.stderr or "")[:500])

    used = extract_rom_usage(r.stdout, r.stderr)
    result.phases["link"] = PhaseResult(
        status="ok",
        details=f"{used or '?'} / {info.rom_size} words",
    )

    # ── Phase 6: HEX → xbin ──────────────────────────────
    hex_path = out_base + ".hex"
    xbin_path = out_base + ".xbin"

    # Register artifacts (even if missing)
    result.artifacts["hex"]  = hex_path if os.path.exists(hex_path) else None
    result.artifacts["xbin"] = None
    result.artifacts["cof"]  = None
    result.artifacts["cofv"] = None

    if os.path.exists(hex_path):
        try:
            raw = hex_to_raw(hex_path, info.rom_size)
            with open(xbin_path, "wb") as f:
                f.write(raw)
            result.artifacts["xbin"] = xbin_path
            result.phases["hex2xbin"] = PhaseResult(
                status="ok", details=f"{len(raw)} bytes"
            )
        except Exception as exc:
            result.phases["hex2xbin"] = PhaseResult(status="fail", details=str(exc))
            result.warnings.append(f"hex2xbin failed: {exc}")
            result.status = "fail"
            result.error = f"hex2xbin: {exc}"
    else:
        result.phases["hex2xbin"] = PhaseResult(status="fail", details="hex not found")
        result.status = "fail"
        result.error = "hex file not produced by linker"

    # ── Phase 7: COFF → text ─────────────────────────────
    cof_path = out_base + ".cof"
    if os.path.exists(cof_path):
        result.artifacts["cof"] = cof_path
        try:
            r = slvo_dump(slvo_exe, cof_path, verbose)
            cofv_path = out_base + ".cofv"
            with open(cofv_path, "w", encoding="utf-8") as f:
                f.write(r.stdout)
            result.artifacts["cofv"] = cofv_path
            result.phases["cofv"] = PhaseResult(status="ok")
        except Exception as exc:
            result.phases["cofv"] = PhaseResult(status="fail", details=str(exc))
            result.warnings.append(f"cofv failed: {exc}")

    # ── Resolve final config words ───────────────────────
    final_config = cfg.config_words or list(DEFAULT_CONFIG_WORDS)

    # ── Phase 8: Generate .xj (IDE project file) ────────
    xj_path = out_base + ".xj"
    if result.artifacts.get("xbin"):
        try:
            from .project import write_xj
            write_xj(xj_path, cfg.chip, raw, final_config, info.rom_size)
            result.artifacts["xj"] = xj_path
            result.phases["gen_xj"] = PhaseResult(status="ok", details=f"{len(raw)} bytes")
        except Exception as exc:
            result.phases["gen_xj"] = PhaseResult(status="fail", details=str(exc))
            result.warnings.append(f"xj generation failed: {exc}")

    # ── Phase 9: Generate .mpj (for astrocli config discovery) ──
    mpj_out_path = out_base + ".mpj"
    if not cfg.mpj_path or not os.path.exists(mpj_out_path):
        try:
            write_mpj(
                project_dir=os.path.dirname(out_base),
                name=cfg.project_name,
                chip=cfg.chip,
                sources=cfg.sources,
                headers=[s for s in cfg.sources if s.endswith('.h')],
                config_words=final_config,
            )
            result.artifacts["mpj"] = mpj_out_path
            result.phases["gen_mpj"] = PhaseResult(
                status="ok",
                details=", ".join(f"0x{w:04X}" for w in final_config[:6]),
            )
        except Exception as exc:
            result.phases["gen_mpj"] = PhaseResult(status="fail", details=str(exc))
            result.warnings.append(f"mpj generation failed: {exc}")

    # ── Register linked artifacts ─────────────────────────
    #  linked .lst → result.artifacts["linked_lst"]
    #  (per-source .lst already in result.artifacts["lst"])
    linked_lst = out_base + ".lst"
    if os.path.exists(linked_lst):
        result.artifacts["linked_lst"] = linked_lst
    for ext in [".map", ".cod"]:
        p = out_base + ext
        if os.path.exists(p):
            result.artifacts[ext.lstrip(".")] = p

    result.status = "pass"
    return result


# ── Helpers ──────────────────────────────────────────────

def _fail(result: BuildResult, phase: str, msg: str,
          details: str = "", err_path: str | None = None) -> BuildResult:
    result.status = "fail"
    result.error = msg
    result.phases[phase] = PhaseResult(status="fail", details=details or msg)
    # Read .err file content for AI agent consumption
    if err_path and os.path.isfile(err_path):
        try:
            with open(err_path, "r", encoding="utf-8", errors="replace") as f:
                err_content = f.read().strip()
            if err_content:
                result.error_detail = err_content
        except OSError:
            pass
    elif details:
        result.error_detail = details
    return result


def _flush_compile_phases(
    result: BuildResult,
    compile_status: dict[str, str],
    patch_status: dict[str, list],
    assemble_status: dict[str, str],
) -> None:
    result.phases["compile"] = {
        k: PhaseResult(status=v) for k, v in compile_status.items()
    }
    result.phases["patch"] = patch_status
    result.phases["assemble"] = {
        k: PhaseResult(status=v) for k, v in assemble_status.items()
    }

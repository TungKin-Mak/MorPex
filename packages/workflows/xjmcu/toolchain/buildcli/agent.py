"""buildcli — AI Agent interface.

Provides a clean, JSON-first API designed for consumption by AI coding agents.
All functions return ``(exit_code, result_dict)`` tuples — no ``sys.exit()``.
"""

from __future__ import annotations
import json
import sys

from .errors import (
    EXIT_COMPILE_ERROR,
    EXIT_IDE_NOT_FOUND,
    EXIT_INPUT_ERROR,
    EXIT_OK,
    EXIT_POST_ERROR,
)
from .pipeline import resolve_config, run_pipeline
from .types import BuildResult


def _print_json(obj: dict) -> None:
    print(json.dumps(obj, ensure_ascii=False, default=str))


def exec_build(
    sources: list[str] | None = None,
    mpj: str | None = None,
    chip: str | None = None,
    output_dir: str | None = None,
    project_name: str | None = None,
    ide_path: str | None = None,
    patch_dirs: list[str] | None = None,
    include_dirs: list[str] | None = None,
    config_words: list[int] | None = None,
    json_output: bool = True,
) -> tuple[int, dict]:
    """One-shot build — the primary AI agent entry point.

    Args:
        config_words: Optional list of config/option words (e.g. [0x1FFF, 0x3F77, ...]).
            If not provided, extracted from source comments or defaults used.

    Returns ``(exit_code, result_dict)``.  Never calls ``sys.exit()``.
    """
    try:
        cfg = resolve_config(
            sources=sources,
            mpj=mpj,
            chip=chip,
            output_dir=output_dir,
            project_name=project_name,
            ide_path=ide_path,
            patch_dirs=patch_dirs,
            include_dirs=include_dirs,
            config_words=config_words,
        )
    except FileNotFoundError as exc:
        result = {"status": "fail", "error": str(exc)}
        if json_output:
            _print_json(result)
        return EXIT_INPUT_ERROR, result

    issues = cfg.validate()
    if issues:
        result = {"status": "fail", "error": "; ".join(issues)}
        if json_output:
            _print_json(result)
        return EXIT_INPUT_ERROR, result

    build_result = run_pipeline(cfg, verbose=not json_output)
    result_dict = build_result.to_dict()
    exit_code = EXIT_OK if build_result.status == "pass" else _map_exit_code(build_result)

    if json_output:
        _print_json(result_dict)

    return exit_code, result_dict


def _phase_failed(phase) -> bool:
    """Check whether a phase (or dict of phases) contains a failure."""
    if phase is None:
        return False
    if hasattr(phase, "status"):
        return phase.status == "fail"
    if isinstance(phase, dict):
        return any(
            hasattr(v, "status") and v.status == "fail"
            for v in phase.values()
        )
    return False


def _map_exit_code(br: BuildResult) -> int:
    p = br.phases
    if _phase_failed(p.get("discover_ide")):
        return EXIT_IDE_NOT_FOUND
    if _phase_failed(p.get("resolve_chip")):
        return EXIT_INPUT_ERROR
    if any(_phase_failed(p.get(x)) for x in ("compile", "assemble", "link")):
        return EXIT_COMPILE_ERROR
    if any(_phase_failed(p.get(x)) for x in ("hex2xbin", "cofv")):
        return EXIT_POST_ERROR
    return EXIT_COMPILE_ERROR

"""buildcli — Patch plugin system.

Built-in patches that post-process assembly output to inject runtime logic.

Plugins are auto-discovered: any ``.py`` file in the ``patches/`` directory
that calls ``register()`` on a class implementing the patch protocol will be
loaded automatically.
"""

from __future__ import annotations
import importlib
import sys
from pathlib import Path
from typing import Protocol, runtime_checkable


@runtime_checkable
class PatchPlugin(Protocol):
    """Assembly post-processing plugin protocol."""

    name: str
    chip_filter: list[str] | None  # None = all chips

    def can_apply(self, asm_path: str, chip: str) -> bool: ...
    def apply(self, asm_path: str, chip: str) -> dict: ...


# ── Plugin registry ─────────────────────────────────────
_registry: dict[str, type[PatchPlugin]] = {}

_this_dir = Path(__file__).parent


def register(cls: type[PatchPlugin]) -> type[PatchPlugin]:
    """Register a patch plugin class."""
    _registry[getattr(cls, "name", cls.__name__)] = cls
    return cls


# ── Patch manager ───────────────────────────────────────


class PatchManager:
    """Discovers, loads, and executes patch plugins."""

    def __init__(self, extra_dirs: list[str] | None = None):
        self._plugins: list[PatchPlugin] = []
        self._loaded = False
        self._extra_dirs = extra_dirs or []

    # ── discovery ────────────────────────────────────────

    def _load_all(self) -> None:
        if self._loaded:
            return
        self._loaded = True

        # 1. Import patches.core (built-ins)
        try:
            importlib.import_module(".core", __package__)
        except ImportError:
            pass

        # 2. Import patches package (auto-discovers plugins)
        try:
            importlib.import_module(f".patches", __package__ or "buildcli")
        except ImportError:
            pass

        # 3. External dirs (BUILDCLI_PATCH_DIR env + extra_dirs)
        import os
        env_dir = os.environ.get("BUILDCLI_PATCH_DIR")
        dirs = list(self._extra_dirs)
        if env_dir:
            dirs.extend(env_dir.split(os.pathsep))
        for d in dirs:
            self._load_external_dir(Path(d))

        # 4. Instantiate registered plugins
        for name, cls in _registry.items():
            try:
                self._plugins.append(cls())
            except Exception as exc:
                print(f"[patch] WARNING: failed to load {name}: {exc}", file=sys.stderr)

    @staticmethod
    def _load_external_dir(directory: Path) -> None:
        if not directory.is_dir():
            return
        for py_file in sorted(directory.glob("*.py")):
            if py_file.name.startswith("_"):
                continue
            try:
                spec = importlib.util.spec_from_file_location(
                    f"buildcli_patch_{py_file.stem}", str(py_file)
                )
                if spec and spec.loader:
                    mod = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(mod)
            except Exception as exc:
                print(f"[patch] WARNING: failed {py_file}: {exc}", file=sys.stderr)

    # ── execution ────────────────────────────────────────

    def apply_all(self, asm_path: str, chip: str) -> list[dict]:
        """Apply every compatible patch to *asm_path*.

        Returns a list of result dicts::

            {"plugin": name, "status": "ok"|"fail"|"skipped", "reason": ...}
        """
        self._load_all()
        results: list[dict] = []
        chip_upper = chip.upper()
        for plugin in self._plugins:
            if plugin.chip_filter is not None and chip_upper not in plugin.chip_filter:
                continue
            try:
                if plugin.can_apply(asm_path, chip):
                    r = plugin.apply(asm_path, chip)
                else:
                    r = {"status": "skipped", "reason": "can_apply returned False"}
            except Exception as exc:
                r = {"status": "fail", "reason": str(exc)}
            results.append({"plugin": plugin.name, **r})
        return results

    @property
    def plugin_names(self) -> list[str]:
        self._load_all()
        return [p.name for p in self._plugins]


# ── Singleton ────────────────────────────────────────────
_default_manager: PatchManager | None = None


def get_patch_manager(extra_dirs: list[str] | None = None) -> PatchManager:
    """Return the global :class:`PatchManager`, creating it on first call."""
    global _default_manager
    if _default_manager is None or extra_dirs:
        _default_manager = PatchManager(extra_dirs=extra_dirs)
    return _default_manager

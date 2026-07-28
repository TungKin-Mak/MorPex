"""buildcli — Shared data types and fallback constants."""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any


# ═══════════════════════════════════════════════════════════
# Chip descriptor
# ═══════════════════════════════════════════════════════════

@dataclass
class ChipInfo:
    """MCU parameters parsed from IDE XML config."""
    name:             str
    rom_size:         int          # program memory in words
    rom_base:         int = 0
    ram_size:         int = 80     # SRAM in bytes
    ram_base:         int = 48
    option_size:      int = 6      # config words count
    option_base:      int = 0
    instruction_width: int = 14

    @property
    def rom_bytes(self) -> int:
        return self.rom_size * 2   # 14-bit words stored as 16-bit


# ═══════════════════════════════════════════════════════════
# Build configuration
# ═══════════════════════════════════════════════════════════

@dataclass
class BuildConfig:
    """All parameters for one build session."""
    chip:         str                = ""
    sources:      list[str]          = field(default_factory=list)
    project_name: str                = "firmware"
    output_dir:   str                = "build"
    ide_path:     str | None         = None
    patch_dirs:   list[str]          = field(default_factory=list)
    include_dirs: list[str]          = field(default_factory=list)
    mpj_path:     str | None         = None
    config_words: list[int] | None   = None   # user-specified option words

    def validate(self) -> list[str]:
        """Return list of problems; empty = valid."""
        issues: list[str] = []
        if not self.chip:
            issues.append("No chip specified (use --chip or --mpj)")
        if not self.sources:
            issues.append("No source files specified (use --src or --mpj)")
        return issues


# ═══════════════════════════════════════════════════════════
# Phase result
# ═══════════════════════════════════════════════════════════

@dataclass
class PhaseResult:
    """Outcome of a single pipeline phase."""
    status:  str   = "pending"   # ok | fail | skipped
    details: str   = ""
    files:   list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d: dict[str, Any] = {"status": self.status}
        if self.details:
            d["details"] = self.details
        if self.files:
            d["files"] = self.files
        return d


# ═══════════════════════════════════════════════════════════
# Build result
# ═══════════════════════════════════════════════════════════

@dataclass
class BuildResult:
    """Complete build result, JSON-serializable for AI agents."""
    status:        str          = "pending"
    chip:          str          = ""
    project:       str          = ""
    output_dir:    str          = ""
    rom_words:     int          = 0
    sources_count: int          = 0
    artifacts:     dict         = field(default_factory=dict)
    phases:        dict         = field(default_factory=dict)
    error:         str | None   = None
    error_detail:  str | None   = None   # full stderr from failed tool
    warnings:      list[str]    = field(default_factory=list)

    def to_dict(self) -> dict:
        return _serialize({
            "status":        self.status,
            "chip":          self.chip,
            "project":       self.project,
            "output_dir":    self.output_dir,
            "rom_words":     self.rom_words,
            "sources_count": self.sources_count,
            "artifacts":     self.artifacts,
            "phases":        self.phases,
            "error":         self.error,
            "error_detail":  self.error_detail,
            "warnings":      self.warnings,
        })


def _serialize(v: Any) -> Any:
    """Recursively convert PhaseResult and nested structures to dicts."""
    if isinstance(v, PhaseResult):
        return v.to_dict()
    if isinstance(v, dict):
        return {k: _serialize(i) for k, i in v.items()}
    if isinstance(v, list):
        return [_serialize(i) for i in v]
    return v


# ═══════════════════════════════════════════════════════════
# Fallback chip database (when IDE XML not available)
# ═══════════════════════════════════════════════════════════

FALLBACK_CHIP_DB: dict[str, dict] = {
    "XC8P9530":  {"rom_size": 1024, "ram_size": 80,  "ram_base": 48,
                  "option_size": 6, "rom_base": 0, "option_base": 1020},
    "XC8P9530D": {"rom_size": 1024, "ram_size": 80,  "ram_base": 48,
                  "option_size": 6, "rom_base": 0, "option_base": 1020},
    "XC8M4096":  {"rom_size": 4096, "ram_size": 256, "ram_base": 64,
                  "option_size": 4, "rom_base": 0},
}

# Default config words for XC8P9530 (matching IDE "default" settings)
DEFAULT_CONFIG_WORDS: list[int] = [
    0x1FFF, 0x3F77, 0x1FE5, 0x3BFF, 0x3FFF, 0x3FFF
]

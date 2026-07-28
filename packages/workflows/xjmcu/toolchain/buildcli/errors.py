"""buildcli — Error types and exit codes.

All exit codes are stable and safe for AI agent consumption.
"""

# ── Exit codes ──────────────────────────────────────────
EXIT_OK             = 0   # Build succeeded
EXIT_IDE_NOT_FOUND  = 1   # IDE installation not found
EXIT_COMPILE_ERROR  = 2   # Compiler / assembler / linker error
EXIT_INPUT_ERROR    = 3   # Bad arguments, missing files
EXIT_PATCH_ERROR    = 4   # Patch plugin failure
EXIT_POST_ERROR     = 5   # Post-processing error (hex2xbin, cofv)


# ── Exception hierarchy ────────────────────────────────
class BuildError(Exception):
    """Base for all build-related errors."""


class IDENotFoundError(BuildError):
    """IDE installation not found."""


class ChipNotFoundError(BuildError):
    """Unknown MCU chip model."""


class CompileError(BuildError):
    """Compiler / assembler / linker returned non-zero."""


class PatchError(BuildError):
    """Patch plugin execution failed."""


class PostProcessError(BuildError):
    """Post-processing conversion failed (hex2xbin / cofv)."""


class ProjectError(BuildError):
    """Project file parse or generation error."""

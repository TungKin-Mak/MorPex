"""buildcli built-in patches — automatically loaded by the patch system.

Add new built-in patches here; they are discovered automatically.
"""

import re

from . import register


# ═══════════════════════════════════════════════════════════
# Shared base: file caching mixin
# ═══════════════════════════════════════════════════════════

class _AsmCacher:
    """Mixin that caches asm file content across calls to avoid re-reads."""

    _cached_path: str = ""
    _content: str = ""

    def _load(self, asm_path: str) -> None:
        if asm_path != self._cached_path:
            with open(asm_path, "r", encoding="utf-8", errors="replace") as f:
                self._content = f.read()
            self._cached_path = asm_path

    def _save(self, asm_path: str) -> None:
        with open(asm_path, "w", encoding="utf-8") as f:
            f.write(self._content)

    def _inject_extern(self, symbol: str) -> None:
        """Ensure `extern _<symbol>` appears in the asm content."""
        if f"extern\t_{symbol}" in self._content:
            return
        # Insert before the first 'global' declaration or at ';--- code' separator
        m = re.search(r"(\tglobal\s)", self._content)
        if m:
            self._content = (
                self._content[: m.start()]
                + f"\textern\t_{symbol}\n"
                + self._content[m.start():]
            )
        else:
            # Fallback: insert after ';---' separator line
            self._content = self._content.replace(
                ";--------------------------------------------------------\n; code",
                f";--------------------------------------------------------\n\textern\t_{symbol}\n; code",
            )

    def _inject_max_logic(
        self,
        target_label: str,
        new_label: str,
        injection: str,
    ) -> str | None:
        """Replace ``target_label: nop; JMP <next>`` with *injection*.

        Returns None on success, or an error reason string on failure.
        """
        if new_label in self._content:
            return "already patched"

        pat = re.compile(rf"({target_label}:.*?)(\tnop\s*\n\tJMP\s+\S+)", re.DOTALL)
        m = pat.search(self._content)
        if not m:
            return f"injection point {target_label}: nop; JMP ... not found"

        new_block = m.group(1) + "\n" + injection
        self._content = self._content.replace(m.group(0), new_block)
        return None


# ═══════════════════════════════════════════════════════════
# Pwm2Patch — inject Pwm2 = max(Pwm, Pwm1)
# ═══════════════════════════════════════════════════════════

@register
class Pwm2Patch(_AsmCacher):
    """Inject ``Pwm2 = max(Pwm, Pwm1)`` logic into compiled assembly.

    Looks for the ``_00108_DS_: nop; JMP _00110_DS_`` injection point
    and replaces it with the max() computation.
    """

    name = "pwm2"
    chip_filter = None  # all chips

    _INJECTION = (
        ";\t注入: Pwm2 = max(Pwm, Pwm1) [buildcli patch]\n"
        "\tMOV\tA, _Pwm\n"
        "\tSUB\tA, _Pwm1\n"
        "\tJBTC\tSTATUS, 0\n"
        "\tJMP\t_00109_DS_\n"
        "\tMOV\tA, _Pwm\n"
        "\tMOV\t_Pwm2, A\n"
        "\tJMP\t_00110_DS_\n"
        "_00109_DS_:\n"
        "\tMOV\tA, _Pwm1\n"
        "\tMOV\t_Pwm2, A\n"
        "\tnop\t\n"
        "\tJMP\t_00110_DS_"
    )

    _NOP_JMP_RE = re.compile(r"_00108_DS_:.*?\tnop\s*\n\tJMP\s+_00110_DS_")

    def can_apply(self, asm_path: str, chip: str) -> bool:
        self._load(asm_path)
        return (
            "_00109_DS_" not in self._content
            and "_Pwm" in self._content
            and "_Pwm1" in self._content
            and "global\t_Pwm2" not in self._content   # skip if C-defined global
            and bool(self._NOP_JMP_RE.search(self._content))
        )

    def apply(self, asm_path: str, chip: str) -> dict:
        self._load(asm_path)

        err = self._inject_max_logic("_00108_DS_", "_00109_DS_", self._INJECTION)
        if err:
            return {"status": "skipped" if "already" in err else "fail", "reason": err}

        self._inject_extern("Pwm2")
        self._save(asm_path)
        return {"status": "ok", "reason": "Pwm2 max() logic injected"}


# ═══════════════════════════════════════════════════════════
# Counter2Patch — inject Counter2 = max(Counter, Counter1)
# ═══════════════════════════════════════════════════════════

@register
class Counter2Patch(_AsmCacher):
    """Inject ``Counter2 = max(Counter, Counter1)`` logic."""

    name = "counter2"
    chip_filter = None

    _INJECTION = (
        ";\t注入: Counter2 = max(Counter, Counter1) [buildcli patch]\n"
        "\tMOV\tA, _Counter\n"
        "\tSUB\tA, _Counter1\n"
        "\tJBTC\tSTATUS, 0\n"
        "\tJMP\t_00107_DS_\n"
        "\tMOV\tA, _Counter\n"
        "\tMOV\t_Counter2, A\n"
        "\tJMP\t_00110_DS_\n"
        "_00107_DS_:\n"
        "\tMOV\tA, _Counter1\n"
        "\tMOV\t_Counter2, A\n"
        "\tnop\t\n"
        "\tJMP\t_00110_DS_"
    )

    def can_apply(self, asm_path: str, chip: str) -> bool:
        self._load(asm_path)
        return (
            "_00108_DS_" in self._content
            and "_00107_DS_" not in self._content
            and "_Counter" in self._content
            and "_Counter1" in self._content
            and "global\t_Counter2" not in self._content   # skip if C-defined global
        )

    def apply(self, asm_path: str, chip: str) -> dict:
        self._load(asm_path)

        err = self._inject_max_logic("_00108_DS_", "_00107_DS_", self._INJECTION)
        if err:
            return {"status": "skipped" if "already" in err else "fail", "reason": err}

        self._inject_extern("Counter2")
        self._save(asm_path)
        return {"status": "ok", "reason": "Counter2 max() logic injected"}

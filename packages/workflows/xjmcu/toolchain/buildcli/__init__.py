"""buildcli — XJ-IDE CLI build toolchain

A standalone, IDE-free build tool for the XJ series of domestic MCUs
(XC8P9530, XC8M4096, etc.).  Replicates the official IDE compilation flow
exactly: slcc → patch → slasm → sllink → hex2xbin → cofv.

Usage::

    python -m buildcli build --chip XC8P9530 --src main.c
    python -m buildcli build --mpj project.mpj
    python -m buildcli init  --chip XC8P9530 --name MyProject
    python -m buildcli agent --chip XC8P9530 --src test.c

Agent usage::

    from buildcli.agent import exec_build
    exit_code, result = exec_build(sources=["main.c"], chip="XC8P9530")
"""

__version__ = "2.0.0"
__all__ = [
    "agent", "pipeline", "compiler", "project", "chipdb",
    "ide", "hexbin", "patches", "types", "errors",
]

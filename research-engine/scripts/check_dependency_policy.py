"""Fail CI when a prohibited dependency appears in a pip resolution report."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


def canonicalize(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: check_dependency_policy.py <pip-report.json>", file=sys.stderr)
        return 2

    report_path = Path(sys.argv[1])
    report = json.loads(report_path.read_text(encoding="utf-8"))
    packages = {
        canonicalize(item.get("metadata", {}).get("name", ""))
        for item in report.get("install", [])
    }
    packages.discard("")

    prohibited = {"pymupdf", "pymupdf4llm", "paper-qa-pymupdf"}
    found = sorted(packages & prohibited)
    if found:
        print(
            "Prohibited AGPL/commercial-license dependency detected: "
            + ", ".join(found),
            file=sys.stderr,
        )
        return 1

    print(f"Dependency policy passed ({len(packages)} resolved packages; no PyMuPDF backend).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

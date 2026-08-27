"""F143: prove the QR field-share guards can actually fail.

A QR that renders but opens the wrong page is worse than no control: it looks
convincing in the field, and the recipient discovers the failure only after
scanning it. The encoder has a separate decode-based guard
(`assets/verify-qr.py`); this runner proves the wiring guards catch six
independent removals:

  1. arbitrary payload validation
  2. the species card action slot
  3. the hotspot card action slot
  4. the checklist-row action slot
  5. a wrong typed route
  6. the delegated button click handler

Every mutation remains valid JavaScript. A syntax error would prove only that
Node parses JavaScript, not that the guard sees the removed behaviour.

    python assets/mutate-qr.py
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEST_QR = os.path.join(APP, "tests", "qr.test.js")
TEST_DOM = os.path.join(APP, "tests", "dom.test.js")

MUTATIONS = [
    (
        "typed identifier validation is removed",
        os.path.join(APP, "www", "qr.js"),
        "if (!QR_KINDS[kind] || !QR_KINDS[kind].test(id)) return '';",
        "if (false) return '';",
        "qr",
    ),
    (
        "species-card QR action is dropped",
        os.path.join(APP, "www", "cards-species.js"),
        "actions: v.actions ? '<div class=\"spact\">' + v.actions + '</div>' : '',",
        "actions: '',",
        "qr",
    ),
    (
        "hotspot-card QR action is dropped",
        os.path.join(APP, "www", "cards-hotspot.js"),
        "qr: v.qr ? '<div class=\"hsact\">' + v.qr + '</div>' : ''",
        "qr: ''",
        "qr",
    ),
    (
        "checklist-row QR action is dropped",
        os.path.join(APP, "www", "cards-checklist.js"),
        "if (v.qr) bits.push('<span class=\"ckqrwrap\">' + v.qr + '</span>');",
        "if (false) bits.push('<span class=\"ckqrwrap\">' + v.qr + '</span>');",
        "qr",
    ),
    (
        "hotspot QR points to a checklist instead",
        os.path.join(APP, "www", "index.html"),
        "if (kind === 'hotspot' && /^L[0-9]+$/.test(id)) return hotspotUrl(id);",
        "if (kind === 'hotspot' && /^L[0-9]+$/.test(id)) return checklistUrl(id);",
        "dom",
    ),
    (
        "delegated QR click handler no longer opens the sheet",
        os.path.join(APP, "www", "index.html"),
        "showQr(qr.getAttribute('data-qr-kind') || '', qr.getAttribute('data-qr-id') || '');",
        "hideSheet();",
        "dom",
    ),
]


def run_guard(scope: str) -> subprocess.CompletedProcess[str]:
    if scope == "qr":
        return subprocess.run(
            ["node", "--test", TEST_QR], cwd=APP, text=True, capture_output=True
        )
    return subprocess.run(
        [
            "node",
            "--test",
            "--test-name-pattern=QR controls open an accessible sheet",
            TEST_DOM,
        ],
        cwd=APP,
        text=True,
        capture_output=True,
    )


def output(result: subprocess.CompletedProcess[str]) -> str:
    return (result.stdout + result.stderr).strip()


def main() -> int:
    # Baseline first: a mutation run means nothing if its guard was already red.
    for scope in ("qr", "dom"):
        result = run_guard(scope)
        if result.returncode:
            print(f"[FAIL] unmutated {scope} guard is already red:\n{output(result)}")
            return 1
    print("[base] QR component and delegated-sheet guards pass")

    missed: list[str] = []
    for label, path, before, after, scope in MUTATIONS:
        with open(path, encoding="utf-8", newline="") as f:
            source = f.read()
        if before not in source:
            missed.append(f"{label}: mutation pattern was not found")
            continue
        fd, backup = tempfile.mkstemp(prefix="birdchaser-qr-", suffix=".bak")
        os.close(fd)
        shutil.copy2(path, backup)
        try:
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(source.replace(before, after, 1))
            result = run_guard(scope)
            if result.returncode == 0:
                missed.append(f"{label}: guard still passed")
                print(f"  [MISS] {label}")
            else:
                print(f"  [OK]   {label}")
        finally:
            shutil.copy2(backup, path)
            os.unlink(backup)

    # A failed restore would make later commands lie about the source under
    # test, so require both guard classes to be green after every file is back.
    for scope in ("qr", "dom"):
        result = run_guard(scope)
        if result.returncode:
            missed.append(f"{scope} guard is red after restoring sources")

    if missed:
        print(f"\n[FAIL] {len(missed)} mutation(s) escaped:")
        for item in missed:
            print("  " + item)
        return 1
    print(f"\n[OK] all {len(MUTATIONS)} QR wiring mutations were caught; sources restored")
    return 0


if __name__ == "__main__":
    sys.exit(main())

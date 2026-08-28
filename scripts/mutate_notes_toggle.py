"""Break F215 on purpose, and check the guards notice.

The mutation that matters is the THIRD one. A first cut painted the note
after `if (!marks) return;`, and `noteRequired` suppresses a bare note
badge on these lists - so exactly the notes the reader asked to see (the
ordinary ones, with no waypoint and no photo) were the ones that never
rendered. It looked right, the tests for the surrounding behaviour stayed
green, and it satisfied nothing.

The fourth checks the escaping. Note that it does NOT probe for the word
"onerror": letters survive escaping harmlessly, so a check for them passes
on a payload it has not made safe. That mistake was already made once in
F208, and the guard now asserts no ELEMENTS were produced.
"""
import os
import shutil
import subprocess
import sys
import tempfile

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(APP, "www", "index.html")
CARDS = os.path.join(APP, "www", "cards-checklist.js")

MUTATIONS = [
    (INDEX, "the toggle stops being read, so notes never paint",
     "if (rarityNotes() && det && det.c) {",
     "if (false && det && det.c) {",
     "notes on, the observer note"),
    (INDEX, "notes paint even when the reader switched them off",
     "if (rarityNotes() && det && det.c) {",
     "if (det && det.c) {",
     "notes on, the observer note"),
    (INDEX, "the note is painted AFTER the badge-suppression early return",
     "if (rarityNotes() && det && det.c) {\n              var prev = el.querySelector('.evnoterow');",
     "if (false && det && det.c) {\n              var prev = el.querySelector('.evnoterow');",
     "notes on, the observer note"),
    (INDEX, "the note is written as markup instead of text",
     "note.textContent = det.c;",
     "note.innerHTML = det.c;",
     "inserted as text"),
    (INDEX, "the notes toggle falls through and is stored as a filter",
     "var n = t.closest('.raritynotesbtn');",
     "var n = null && t.closest('.raritynotesbtn');",
     "notes button is actually wired"),
    (INDEX, "pressing the notes button no longer repaints the section",
     "            setRarityNotes(n.getAttribute('data-notes') === 'on');\n            reload();",
     "            setRarityNotes(n.getAttribute('data-notes') === 'on');",
     "notes button is actually wired"),
    (CARDS, "the note stops taking a line of its own",
     "'  flex: 0 0 100%; min-width: 0; margin: 2px 0 4px;',",
     "'  flex: 0 1 auto; min-width: 0; margin: 2px 0 4px;',",
     "note takes a line of its own"),
]


def run(pattern: str) -> bool:
    p = subprocess.run(
        ["node", "--test", "--test-timeout=300000",
         f"--test-name-pattern={pattern}", "tests/dom.test.js"],
        cwd=APP, capture_output=True, text=True, shell=False,
        encoding="utf-8", errors="replace")
    return p.returncode == 0


def main() -> int:
    originals = {p: open(p, encoding="utf-8", newline="").read()
                 for p in {m[0] for m in MUTATIONS}}
    for p, text in originals.items():
        shutil.copyfile(p, os.path.join(
            tempfile.gettempdir(), os.path.basename(p) + ".f215-backup"))
    caught = 0
    try:
        print("control: the files as they stand")
        for pattern in sorted({m[4] for m in MUTATIONS}):
            ok = run(pattern)
            print(f"  {'ok  ' if ok else 'RED '} {pattern}")
            if not ok:
                print("  already red - a mutation cannot be distinguished")
                return 1

        for path, label, needle, replacement, pattern in MUTATIONS:
            original = originals[path]
            if needle not in original:
                print(f"  ANCHOR MISSING  {label}")
                print(f"    looked for: {needle[:80]!r}")
                return 1
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(original.replace(needle, replacement, 1))
            still_passes = run(pattern)
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(original)
            if still_passes:
                print(f"  MISSED   {label}")
                print(f"           '{pattern}' stayed green with the fix removed")
            else:
                caught += 1
                print(f"  CAUGHT   {label}")
    finally:
        for p, text in originals.items():
            with open(p, "w", encoding="utf-8", newline="") as f:
                f.write(text)
        ok = all(open(p, encoding="utf-8", newline="").read() == t
                 for p, t in originals.items())
        print(f"\nrestored: {'yes' if ok else 'NO - RESTORE FROM TEMP BACKUPS'}")

    print(f"\n{caught} of {len(MUTATIONS)} mutations caught")
    return 0 if caught == len(MUTATIONS) else 1


if __name__ == "__main__":
    sys.exit(main())

"""Break F213 and F214 on purpose, and check the guards notice.

A check that cannot fail is not a check. This repo has been bitten three
times by guards that passed because they were looking at nothing - a regex
matching no rows, a required-bold pattern that skipped every line, and an
assertion on a literal that had moved - so a new guard is not trusted until
the code it audits has been broken in front of it.

Each mutation is a SINGLE realistic edit: the way the fix would actually be
lost, not a syntax error. The file is restored in a finally block, and the
control run happens first so a suite that was already red cannot be mistaken
for a mutation being caught.
"""
import os
import shutil
import subprocess
import sys
import tempfile

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(APP, "www", "index.html")

# (label, needle, replacement, test-name-pattern that MUST go red)
MUTATIONS = [
    ("the clipboard glyph is dropped from the checklist id",
     "'\\uD83D\\uDCCB ' + sub",
     "'' + sub",
     "a checklist id is rendered as a destination"),
    ("the id loses the class that sizes it",
     "'extlink cklid'",
     "'extlink'",
     "a checklist id is rendered as a destination"),
    ("the id is sized back down to the metadata around it",
     ".extlink.cklid { font-size: calc(15px * var(--s))",
     ".extlink.cklid { font-size: calc(13px * var(--s))",
     "the checklist id is really bigger"),
    ("the waiting label stops being italic",
     "<div class=\"sp dim ckwait\"><i>finding recent checklists</i>",
     "<div class=\"sp dim ckwait\">finding recent checklists",
     "found nothing"),
    ("the ellipsis stops animating",
     "<span class=\"loadingdots\" aria-hidden=\"true\">",
     "<span aria-hidden=\"true\">",
     "found nothing"),
]


def run(pattern: str) -> bool:
    """True when the named tests PASS."""
    p = subprocess.run(
        ["node", "--test", "--test-timeout=300000",
         f"--test-name-pattern={pattern}", "tests/dom.test.js"],
        cwd=APP, capture_output=True, text=True, shell=False,
        encoding="utf-8", errors="replace")
    return p.returncode == 0


def main() -> int:
    backup = os.path.join(tempfile.gettempdir(), "index.html.mutation-backup")
    shutil.copyfile(INDEX, backup)
    original = open(INDEX, encoding="utf-8", newline="").read()
    caught = 0
    try:
        print("control: the file as it stands")
        for _, _, _, pattern in {m[3]: m for m in MUTATIONS}.values():
            ok = run(pattern)
            print(f"  {'ok  ' if ok else 'RED '} {pattern}")
            if not ok:
                print("  the suite is already red — a mutation cannot be "
                      "distinguished from the existing failure")
                return 1

        for label, needle, replacement, pattern in MUTATIONS:
            if needle not in original:
                print(f"  ANCHOR MISSING  {label}")
                print(f"    could not find: {needle[:70]}")
                return 1
            mutated = original.replace(needle, replacement, 1)
            with open(INDEX, "w", encoding="utf-8", newline="") as f:
                f.write(mutated)
            still_passes = run(pattern)
            with open(INDEX, "w", encoding="utf-8", newline="") as f:
                f.write(original)
            if still_passes:
                print(f"  MISSED   {label}")
                print(f"           '{pattern}' stayed green with the fix removed")
            else:
                caught += 1
                print(f"  CAUGHT   {label}")
    finally:
        with open(INDEX, "w", encoding="utf-8", newline="") as f:
            f.write(original)
        same = open(INDEX, encoding="utf-8", newline="").read() == original
        print(f"\nrestored: {'yes' if same else 'NO — RESTORE FROM ' + backup}")

    print(f"\n{caught} of {len(MUTATIONS)} mutations caught")
    return 0 if caught == len(MUTATIONS) else 1


if __name__ == "__main__":
    sys.exit(main())

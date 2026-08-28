"""Break F212 on purpose, and check the guards notice.

The mutation that matters here is not "the badge disappears" - it is the
one where the badge appears for a bird it has no business claiming. An
archive that started on Tuesday makes EVERY bird look discovered on
Tuesday, which is the v1.0.23 "all-time" mistake in a new costume, and it
is invisible on a device that happens to have a long archive.

So the third mutation deletes the `f.found` test and keeps everything
else. The badge still renders, still says a date, still looks right - and
the guard has to fail anyway, because the claim is now unsupported.
"""
import os
import shutil
import subprocess
import sys
import tempfile

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(APP, "www", "index.html")

MUTATIONS = [
    ("the lane stops asking whether the bird is newly found",
     "found: megaFound(s.region, c) };",
     "found: null };",
     "found this week"),
    ("the badge loses its words and keeps only the glyph",
     "esc(megaFoundLabel(m.found))",
     "esc('')",
     "found this week"),
    ("a bird that was ALREADY HERE is called newly found",
     "if (!f || !f.found) return null;",
     "if (!f) return null;",
     "never claims more days"),
    ("the freshness window stops bounding anything",
     "if (!(days >= 0 && days <= MEGA_FRESH_DAYS)) return null;",
     "if (!(days >= 0)) return null;",
     "found this week"),
    ("the window is raised past the coverage that supports it",
     "var MEGA_FRESH_DAYS = 7;",
     "var MEGA_FRESH_DAYS = 45;",
     "never claims more days"),
    ("the alert badge becomes one more tinted pill",
     ".megafresh { font-size: calc(12px * var(--s)); font-weight: 800;\n                 color: #fff; background: var(--safe-blue);",
     ".megafresh { font-size: calc(12px * var(--s)); font-weight: 800;\n                 color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent);",
     "just-found badge"),
    # F211 lives in the same lane and fails the same way: silently.
    ("an empty Celebrity lane goes back to rendering nothing at all",
     "html += '<div class=\"status\">Nothing qualifies right now. A bird '",
     "html += '' + ('",
     "empty Celebrity lane"),
    ("the empty lane stops naming the gate it applied",
     "+ 'reported from a <b>public place</b> within <b>'\n            + chaseMaxMi() + ' mi</b>, and corroborated by more than a single '",
     "+ 'reported somewhere within <b>'\n            + '' + '</b>, and corroborated by more than a single '",
     "empty Celebrity lane"),
]


def run(pattern: str) -> bool:
    p = subprocess.run(
        ["node", "--test", "--test-timeout=300000",
         f"--test-name-pattern={pattern}", "tests/dom.test.js"],
        cwd=APP, capture_output=True, text=True, shell=False,
        encoding="utf-8", errors="replace")
    return p.returncode == 0


def main() -> int:
    backup = os.path.join(tempfile.gettempdir(), "index.html.f212-backup")
    shutil.copyfile(INDEX, backup)
    original = open(INDEX, encoding="utf-8", newline="").read()
    caught = 0
    try:
        print("control: the file as it stands")
        for pattern in sorted({m[3] for m in MUTATIONS}):
            ok = run(pattern)
            print(f"  {'ok  ' if ok else 'RED '} {pattern}")
            if not ok:
                print("  already red - a mutation cannot be distinguished")
                return 1

        for label, needle, replacement, pattern in MUTATIONS:
            if needle not in original:
                print(f"  ANCHOR MISSING  {label}")
                print(f"    looked for: {needle[:80]!r}")
                return 1
            with open(INDEX, "w", encoding="utf-8", newline="") as f:
                f.write(original.replace(needle, replacement, 1))
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
        print(f"\nrestored: {'yes' if same else 'NO - RESTORE FROM ' + backup}")

    print(f"\n{caught} of {len(MUTATIONS)} mutations caught")
    return 0 if caught == len(MUTATIONS) else 1


if __name__ == "__main__":
    sys.exit(main())

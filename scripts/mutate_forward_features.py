"""Prove the forward feature consumers reject independently removed behavior."""

import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


APP = Path(__file__).resolve().parents[1]
MUTATIONS = [
    ("removed maps still receive delayed size work",
     "if (_leafletMaps[el.id] !== map || canvas.parentNode !== el || !canvas.isConnected) return;",
     "if (false) return;", "F1393 delayed map fitting"),
    ("absent standing becomes an ambiguous label", "entry ? 'No rank' : 'n/a'",
     "entry ? 'Not listed' : 'n/a'", "F1389 header separates"),
    ("unknown checklist count becomes a fabricated zero", "? '—' : checklistText",
     "? '0' : checklistText", "F1389 header separates"),
    ("unsupported aggregate feeds become acquisition failures",
     "if (res && res.capabilityUnavailable === true && !res.cv)",
     "if (false && res && res.capabilityUnavailable === true && !res.cv)",
     "F1390 aggregate unavailable"),
    ("Bird Gen returns to the oversized background board",
     "Object.assign({}, rankPrimaryRegion(), { max: 500, rowLimit: 500 })",
     "Object.assign({}, rankPrimaryRegion(), { max: 10000, rowLimit: 10000 })",
     "F1390 actual aggregate Bird Gen"),
    ("Home falsely offers Close Find", "hidden = quickOrigin !== 'find';",
     "hidden = false;", "F1391 actual aggregate Home"),
    ("membership admits unrelated catalog regions",
     "function regionChoiceContains(row, code) {",
     "function regionChoiceContains(row, code) { return true;",
     "F1392 actual chooser filters"),
    ("Here silently uses saved Home", "var point = mode === 'home' ? getHome() : null;",
     "var point = getHome();", "F1392 successful Here is explicit"),
    ("resolved membership loses ownership",
     "return JSON.stringify([bcProfile(), identityRevision(), getReportSlug(),\n          mode === 'home' ? getHome() : null]);",
     "return 'unowned';", "F1392 resolved Home membership invalidates"),
    ("late responses replace a newer All selection",
     "return generation === _regionLocationGeneration && !$('regionChooser').hidden",
     "return true || generation === _regionLocationGeneration && !$('regionChooser').hidden",
     "F1392 Here failure never substitutes"),
    ("async Recent repaint removes missing-Home setup",
     "if (state.needsHome) {", "if (false && state.needsHome) {",
     "F1392 missing Home offers setup"),
]


def run(www, pattern):
    return subprocess.run(
        ["node", "--test", "--test-reporter=spec", f"--test-name-pattern={pattern}",
         str(APP / "tests" / "dom.test.js")], cwd=APP, env={**os.environ, "BIRDCHASER_WWW": str(www)},
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180,
        check=False,
    )


def main():
    source = (APP / "www" / "index.html").read_text(encoding="utf-8")
    with tempfile.TemporaryDirectory(prefix="bc-forward-mutations-") as temporary:
        www = Path(temporary)
        for bundled in (APP / "www").iterdir():
            if bundled.is_file() and bundled.name != "index.html":
                shutil.copyfile(bundled, www / bundled.name)
        candidate = www / "index.html"
        candidate.write_text(source, encoding="utf-8")
        control = run(www, "|".join(dict.fromkeys(row[3] for row in MUTATIONS)))
        if control.returncode:
            print(control.stdout + control.stderr)
            raise RuntimeError("The unmodified consumer controls must pass first")
        print("CONTROL: all selected actual consumers passed", flush=True)
        for label, old, new, pattern in MUTATIONS:
            if source.count(old) != 1:
                raise RuntimeError(f"Mutation needs one exact anchor: {label}")
            candidate.write_text(source.replace(old, new, 1), encoding="utf-8")
            result = run(www, pattern)
            output = result.stdout + result.stderr
            if (result.returncode != 1 or pattern not in output
                    or "SyntaxError" in output or "is not a function" in output):
                print(output)
                raise RuntimeError(f"Mutation was not rejected by its consumer: {label}")
            print("CAUGHT: " + label, flush=True)
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())

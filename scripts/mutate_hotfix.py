"""Exercise the forward hotfix's actual consumers against independent regressions."""

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


APP = Path(__file__).resolve().parents[1]
MUTATIONS = [
    ("personal completion autoloads over its compatible source owner",
     "repaint._at === 'surgeBtn' && _surgePersonalRepaint && _surgePersonalRepaint()",
     "false", "F1550 personal completion"),
    ("personal completion skips current unseen eligibility repaint",
     "paintSurgeModel();\n          return true;\n        };",
     "return true;\n        };", "F1550 personal completion"),
    ("obsolete source Retry silently broadens into full acquisition",
     "function requestSurgeSourceRetry(keys, button) {",
     "function requestSurgeSourceRetry(keys, button) { return loadSurge();",
     "F1550 obsolete"),
    ("source-dialog Retry feedback is hidden behind its modal",
     "var row = button.closest('[data-source-status]') || host;",
     "var row = $('surgeResults');", "F1550 obsolete dialog"),
    ("geographic restoration is falsely labelled explicit",
     "clearTempHome('geographic-home')", "clearTempHome()", "F1549 actual reset"),
    ("failed Temp removal is reported verified absent",
     "(cleared ? 'verified-absent' : 'absence-unverified')",
     "'verified-absent'", "F1549 actual reset"),
    ("navigation leaves the hidden Full feed paint loaded",
     "if (_surgeActiveLoad) _surgeActiveLoad.end('cancelled');\n          _autoLoaded[sectionId] = false;",
     "if (_surgeActiveLoad) _surgeActiveLoad.end('cancelled');\n          _autoLoaded[sectionId] = true;",
     "a hidden Bird Gen consumes"),
    ("Full feed bypasses its owned report Home gate",
     "resetSurgeCategory();\n        if (!activeSavedBase()) {",
     "resetSurgeCategory();\n        if (false) {", "F706 Bird Gen rejects"),
    ("Debug Clear leaves stopped timing evidence behind",
     "_phaseCapture.epoch++;\n        _phaseCapture.samples=[];",
     "void 0;", "F1548 phase timing"),
    ("phase timing runs without owner opt-in",
     "{enabled:false,epoch:0,nextId:0,samples:[]}",
     "{enabled:true,epoch:0,nextId:0,samples:[]}", "F1548 phase timing"),
    ("phase timing grows without a bound",
     "if (_phaseCapture.samples.length > 64) _phaseCapture.samples.shift();",
     "if (false) _phaseCapture.samples.shift();", "F1548 phase timing"),
    ("stopped timing capture admits deferred results",
     "if (!span || !_phaseCapture.enabled || span.epoch !== _phaseCapture.epoch) return;",
     "if (!span) return;", "F1548 phase timing"),
    ("phase timing leaks raw consumer arguments",
     "phaseTimingFinish(span,'ok',counts);",
     "span.phase=JSON.stringify(Array.prototype.slice.call(args)); phaseTimingFinish(span,'ok',counts);",
     "F1548 phase timing"),
    ("old clipboard completion confirms a newer copy",
     "if (!btn || generation !== _debugCopyGeneration) return;",
     "if (!btn) return;", "F1548 phase timing"),
    ("retained projection repeats polygon traversal for every species",
     "if (signature && membershipCache.has(signature)) return membershipCache.get(signature);",
     "if (false && signature && membershipCache.has(signature)) return membershipCache.get(signature);",
     "F1545 retained-scale provincial"),
    ("cold startup exposes raw report panels",
     'main[aria-busy="true"] > section.panel',
     'main[aria-busy="false"] > section.panel', "F1545 cold startup"),
    ("startup protection never releases navigation",
     "main.removeAttribute('aria-busy');",
     "main.setAttribute('aria-busy', 'true');", "F1545 cold startup"),
    ("search rebuilds the catalog per keystroke",
     "search.oninput = function () {",
     "search.oninput = function () { renderRegionChooser({ preserveSearch: true }); return;",
     "F1545 actual chooser"),
    ("feed work runs before feedback paint",
     "function birdGenFeedback(kind, start, prepare) {",
     "function birdGenFeedback(kind, start, prepare) { return start(prepare && prepare());",
     "F1545 Full feed"),
    ("a retired feedback handoff starts work",
     "return current() ? start(prepared) : false;",
     "return start(prepared);", "F1545 Full feed"),
    ("county results disappear from direct search",
     "return regionChoiceSearchText(row).indexOf(q) >= 0;",
     "return !row.parentValue && regionChoiceSearchText(row).indexOf(q) >= 0;",
     "F1445 shared chooser|F1445 cached county"),
    ("previous diagnostics no longer migrate",
     "return persistence.getJson(key, {\n            migrate: true, shouldWrite: function () {",
     "return persistence.getJson(key, {\n            migrate: false, shouldWrite: function () {",
     "F247 previous debug sessions"),
    ("Home always claims a house",
     "var kind = savedBaseKind(), active = !!activeSavedBase();",
     "var kind = 'home', active = !!activeSavedBase();", "F1546 F1547"),
    ("saved-base changes do not refresh shortcuts",
     "function savedBaseChanged() {\n        refreshSavedBaseShortcuts();",
     "function savedBaseChanged() {", "F1546 F1547"),
    ("submenu Home is omitted", 'id="navHome"', 'id="removedNavHome"', "F1546 F1547"),
    ("active Temp opens the wrong editor",
     "if (kind !== 'temp' && tempHome()) kind = 'temp';",
     "kind = 'home';", "F1546 F1547"),
    ("editor navigation silently clears Temp",
     "function openSavedLocationEditor(kind) {",
     "function openSavedLocationEditor(kind) { clearTempHome();", "F1546 F1547"),
    ("submenu return loses focus",
     "if (target) target.focus({ preventScroll: true });\n          }\n          _savedLocationReturn",
     "if (false && target) target.focus({ preventScroll: true });\n          }\n          _savedLocationReturn",
     "F1546 F1547"),
    ("Settings retires the Stakeout source origin",
     "&& id !== 'sec-abaBtn' && id !== 'settingsPanel')",
     "&& id !== 'sec-abaBtn')", "F1547 the Mega index"),
    ("Settings Back skips its owned Stakeout context",
     "if (_stakeOrigin && visibleSectionId() === 'sec-spLookupBtn')",
     "if (_stakeOrigin)", "F1547 the Mega index"),
    ("final summaries ignore delayed native evidence",
     "native_background_ms: timingOverlap(nativeBackgroundIntervals(), gap.start, gap.end),",
     "native_background_ms: 0,", "F1548 final heartbeat"),
    ("cache counters claim unobserved loss",
     ", instrumented hits 0; heuristic only, typed/mirror reads not fully observed; loss unverified",
     ", READ 0; cache loss proved", "F1548 actual cache"),
    ("owner diagnostics collapse distinct reasons",
     "reasons: reasons.length ? reasons : ['changed-before-diagnostic']",
     "reasons: ['unknown']", "F1548 actual ranking"),
    ("unsupported snapshot scope is called missing",
     "'durable snapshot not applicable to this scope'",
     "'missing; eligible scope'", "F1548 actual lazy snapshot"),
]


def run(www, pattern):
    return subprocess.run(
        ["node", "--test", "--test-reporter=spec", "--test-name-pattern=" + pattern,
         "tests/dom.test.js"], cwd=APP, env={**os.environ, "BIRDCHASER_WWW": str(www)},
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=240,
        check=False,
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--browser-baseline", action="store_true")
    args = parser.parse_args()
    source = (APP / "www" / "index.html").read_text(encoding="utf-8")
    with tempfile.TemporaryDirectory(prefix="bc-hotfix-proof-") as temporary:
        www = Path(temporary) / "www"
        if args.browser_baseline:
            shutil.copytree(APP / "www", www)
            baseline = subprocess.run(
                ["git", "show", "6fbe54252ac6e387cbbfdb9245250dd42fe53eb3:www/index.html"],
                cwd=APP, capture_output=True, check=True,
            ).stdout
            (www / "index.html").write_bytes(baseline)
            result = subprocess.run(
                ["node", "assets/audit-overflow.js", "320", "1.75"], cwd=APP,
                env={**os.environ, "BIRDCHASER_WWW": str(www), "AUDIT_FOCUS": "hotfix"},
                capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=240,
                check=False,
            )
            print(result.stdout + result.stderr)
            if result.returncode != 1 or "submenu Home must exist" not in result.stdout:
                raise RuntimeError("Published-source baseline must expose the actual missing submenu")
            return
        www.mkdir()
        for bundled in (APP / "www").iterdir():
            if bundled.is_file() and bundled.name != "index.html":
                shutil.copyfile(bundled, www / bundled.name)
        candidate = www / "index.html"
        candidate.write_text(source, encoding="utf-8")
        control = run(www, "|".join(dict.fromkeys(row[3] for row in MUTATIONS)))
        if control.returncode:
            print(control.stdout + control.stderr)
            raise RuntimeError("Unmodified actual consumers must pass before mutation")
        print("CONTROL: all hotfix consumers passed", flush=True)
        for label, old, new, pattern in MUTATIONS:
            if source.count(old) != 1:
                raise RuntimeError("Mutation needs one exact anchor: " + label)
            candidate.write_text(source.replace(old, new, 1), encoding="utf-8")
            result = run(www, pattern)
            output = result.stdout + result.stderr
            if (result.returncode != 1
                    or not any(name in output for name in pattern.split("|"))
                    or "SyntaxError" in output):
                print(output)
                raise RuntimeError("Mutation did not fail through its consumer: " + label)
            print("CAUGHT: " + label, flush=True)


if __name__ == "__main__":
    main()

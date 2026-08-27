"""F143: does www/qr.js produce a QR a DECODER can read?

A WRONG QR STILL LOOKS EXACTLY LIKE A QR. It renders as convincing noise and
fails in the field, where the person holding the phone cannot tell "broken
encoder" from "bad light". So it is machine-verified, not eyeballed.

⚠️ COMPARING MODULES AGAINST python-qrcode IS THE WRONG TEST, and it was the
first thing tried: it reported "268 of 841 modules differ" on every input,
which looks damning and proves nothing. A QR carries its MASK in its format
bits, so two encoders that pick different masks produce different-looking and
EQUALLY VALID codes. The reference picks the lowest-penalty mask; picking
another is legal.

What actually matters is whether a decoder gets the original string back. That
is the property; the module layout is not.

    python assets/verify-qr.py
"""
import io, os, subprocess, sys, json

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
QRJS = os.path.join(os.path.dirname(HERE), "www", "qr.js")

CASES = [
    "https://ebird.org/hotspot/L128530",
    "https://ebird.org/checklist/S123456789",
    "https://ebird.org/species/baleag/US-WA",
    "HELLO",
]

import numpy as np  # noqa: E402
import cv2  # noqa: E402


def mine(text):
    """Drive www/qr.js through node and get its matrix back."""
    script = (
        "const B = require(%s).BirdQR || require(%s);"
        "const m = B.matrix(process.argv[1]);"
        "process.stdout.write(JSON.stringify(m.map(r => r.map(c => c ? 1 : 0))));"
        % (json.dumps(QRJS), json.dumps(QRJS))
    )
    r = subprocess.run(["node", "-e", script, text],
                       capture_output=True, text=True)
    if r.returncode:
        return None, (r.stderr or "").strip().split("\n")[-1]
    try:
        return json.loads(r.stdout), None
    except ValueError:
        return None, "unparseable output: " + r.stdout[:120]


def render(matrix, scale=8, quiet=4):
    """Modules -> a real image, with the quiet zone a decoder requires."""
    n = len(matrix)
    side = (n + quiet * 2) * scale
    img = np.full((side, side), 255, dtype=np.uint8)
    for y in range(n):
        for x in range(n):
            if matrix[y][x]:
                y0 = (y + quiet) * scale
                x0 = (x + quiet) * scale
                img[y0:y0 + scale, x0:x0 + scale] = 0
    return img


det = cv2.QRCodeDetector()

# ---- CONTROL: prove the HARNESS works before blaming the encoder ----------
# Render the reference encoder's matrix through the SAME render() and the SAME
# decoder. If this fails, the fault is in this file and every verdict below is
# noise. Debugging the wrong component is the failure this project keeps
# paying for, and a control is the cheapest possible defence against it.
try:
    import qrcode
    from qrcode.constants import ERROR_CORRECT_M
    _q = qrcode.QRCode(error_correction=ERROR_CORRECT_M, border=0)
    _q.add_data("HELLO")
    _q.make(fit=True)
    _ref = [[1 if c else 0 for c in row] for row in _q.get_matrix()]
    _d, _, _ = det.detectAndDecode(render(_ref))
    if _d != "HELLO":
        print("CONTROL FAILED: the reference encoder's own matrix does not "
              "decode through this harness. The harness is wrong, not qr.js.")
        sys.exit(2)
    print("  control  reference matrix decodes through this harness — "
          "verdicts below are about qr.js")
except ImportError:
    print("  control  SKIPPED (python-qrcode not installed) — a failure below "
          "cannot be attributed to qr.js with confidence")

bad = 0
for text in CASES:
    got, err = mine(text)
    if got is None:
        print(f"  ERROR    {text[:42]:42} {err}")
        bad += 1
        continue
    img = render(got)
    try:
        data, pts, _ = det.detectAndDecode(img)
    except cv2.error as e:                                  # noqa: PERF203
        data, pts = "", None
    if not data:
        print(f"  UNREADABLE {text[:40]:40} size {len(got)} — a decoder cannot "
              f"find or read it")
        bad += 1
    elif data != text:
        print(f"  WRONG    {text[:42]:42} decoded {data[:42]!r}")
        bad += 1
    else:
        print(f"  ok       {text[:42]:42} size {len(got)}, decodes exactly")

print()
if bad:
    print(f"QR ENCODER IS WRONG for {bad} of {len(CASES)} inputs")
    sys.exit(1)
print(f"QR encoder round-trips through a decoder on all {len(CASES)} inputs")


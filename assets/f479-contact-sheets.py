#!/usr/bin/env python3
"""Generate the final numbered contact sheets for F479's corrected icons."""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT.parent / "birding"


def load(path: Path):
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def gallery_module():
    path = ROOT / "assets" / "icon-galleries.py"
    spec = importlib.util.spec_from_file_location("icon_galleries", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--out",
        type=Path,
        default=Path.home() / "Downloads" / "BirdChaser-F479-updated-icons",
    )
    args = parser.parse_args()

    gallery = gallery_module()
    taxonomy = {
        row["speciesCode"]: row
        for row in load(PRIVATE / ".cache" / "taxonomy-en.json")
    }
    numbers = load(ROOT / "assets" / "icon-review-numbers.json")
    corrected = load(ROOT / "assets" / "f479-crops.json")["cases"]
    codes = set(corrected)
    codes.add("blksco2")
    rows = [
        {
            **taxonomy[code],
            "reviewNumber": int(numbers[code]),
        }
        for code in codes
    ]
    rows.sort(key=lambda row: row["reviewNumber"])

    args.out.mkdir(parents=True, exist_ok=True)
    pages = []
    total_pages = (len(rows) + gallery.PER_PAGE - 1) // gallery.PER_PAGE
    for page_number, start in enumerate(
            range(0, len(rows), gallery.PER_PAGE), 1):
        page_rows = rows[start:start + gallery.PER_PAGE]
        filename = gallery.render_page(
            "F479 updated ABA", page_rows, page_number, total_pages, args.out)
        pages.append((filename, page_rows))
    gallery.write_index("F479 updated ABA", pages, args.out)
    print(f"{len(rows)} corrected icons, {len(pages)} pages, "
          f"{args.out / 'index.html'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

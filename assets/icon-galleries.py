#!/usr/bin/env python3
"""Generate stable, numbered, paginated bird-icon contact-sheet galleries."""
from __future__ import annotations

import argparse
import html
import json
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT.parent / "birding"
TAXONOMY = PRIVATE / ".cache" / "taxonomy-en.json"
COVERAGE = ROOT / "assets" / "icon-coverage.json"
NUMBERS = ROOT / "assets" / "icon-review-numbers.json"
ICONS = ROOT / "www" / "assets" / "birds"

PER_PAGE = 100
COLS = 10
CELL_W = 230
CELL_H = 235
ICON_SIZE = 168
HEADER_H = 74
PAD = 12


def load(path: Path):
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def review_numbers(species_rows: list[dict]) -> dict[str, int]:
    existing = load(NUMBERS) if NUMBERS.exists() else {}
    numbers = {str(code): int(number)
               for code, number in existing.items()}
    next_number = max(numbers.values(), default=0) + 1
    ordered = sorted(
        species_rows,
        key=lambda row: (float(row.get("taxonOrder") or 0),
                         row["speciesCode"]),
    )
    for row in ordered:
        code = row["speciesCode"]
        if code not in numbers:
            numbers[code] = next_number
            next_number += 1
    with NUMBERS.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(numbers, handle, sort_keys=True, separators=(",", ":"))
        handle.write("\n")
    return numbers


def font(size: int, bold: bool = False):
    windows = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
    name = "arialbd.ttf" if bold else "arial.ttf"
    try:
        return ImageFont.truetype(str(windows / name), size)
    except OSError:
        return ImageFont.load_default()


def fit_text(draw: ImageDraw.ImageDraw, text: str, max_width: int,
             start_size: int = 17):
    for size in range(start_size, 9, -1):
        selected = font(size, bold=True)
        if draw.textbbox((0, 0), text, font=selected)[2] <= max_width:
            return selected
    return font(9, bold=True)


def render_page(scope: str, rows: list[dict], page_number: int,
                total_pages: int, out: Path) -> str:
    width = COLS * CELL_W
    row_count = (len(rows) + COLS - 1) // COLS
    height = HEADER_H + row_count * CELL_H
    canvas = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(canvas)
    first = rows[0]["reviewNumber"]
    last = rows[-1]["reviewNumber"]
    title = (
        f"{scope.upper()} bird icons - page {page_number}/{total_pages} - "
        f"review #{first:05d}-#{last:05d}"
    )
    draw.text((PAD, 12), title, fill="black", font=font(24, bold=True))
    draw.text(
        (PAD, 43),
        "Every tile prints the stable worldwide review number, common name, "
        "and eBird species code.",
        fill=(60, 60, 60),
        font=font(15),
    )
    for index, row in enumerate(rows):
        col, line = index % COLS, index // COLS
        x, y = col * CELL_W, HEADER_H + line * CELL_H
        draw.rectangle(
            (x, y, x + CELL_W - 1, y + CELL_H - 1),
            outline=(190, 190, 190),
        )
        image_path = next(
            (ICONS / f"{row['speciesCode']}{ext}"
             for ext in (".jpg", ".png")
             if (ICONS / f"{row['speciesCode']}{ext}").exists()),
            None,
        )
        if image_path:
            with Image.open(image_path) as image:
                image = image.convert("RGB")
                image.thumbnail((ICON_SIZE, ICON_SIZE), Image.Resampling.LANCZOS)
                ix = x + (CELL_W - image.width) // 2
                iy = y + 7 + (ICON_SIZE - image.height) // 2
                canvas.paste(image, (ix, iy))
        label_y = y + ICON_SIZE + 13
        number = f"#{row['reviewNumber']:05d}"
        draw.text((x + PAD, label_y), number, fill=(0, 0, 0),
                  font=font(16, bold=True))
        common = row["comName"]
        common_font = fit_text(draw, common, CELL_W - PAD * 2)
        draw.text((x + PAD, label_y + 23), common, fill=(0, 0, 0),
                  font=common_font)
        draw.text((x + PAD, label_y + 44), row["speciesCode"],
                  fill=(0, 85, 140), font=font(15))
    filename = f"{page_number:03d}-{first:05d}-{last:05d}.jpg"
    canvas.save(out / filename, format="JPEG", quality=86, optimize=True)
    return filename


def write_index(scope: str, pages: list[tuple[str, list[dict]]],
                out: Path) -> None:
    cards = []
    for filename, rows in pages:
        cards.append(
            "<figure>"
            f'<a href="{html.escape(filename)}">'
            f'<img src="{html.escape(filename)}" alt="{html.escape(scope)} '
            f'icons {rows[0]["reviewNumber"]} through '
            f'{rows[-1]["reviewNumber"]}"></a>'
            f"<figcaption>{html.escape(filename)}</figcaption>"
            "</figure>"
        )
    document = f"""<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(scope.title())} bird icon contact sheets</title>
<style>
body {{ font: 16px Arial, sans-serif; margin: 24px; color: #111; }}
.pages {{ display: grid; grid-template-columns: repeat(auto-fit,minmax(320px,1fr)); gap: 20px; }}
figure {{ margin: 0; border: 1px solid #999; padding: 10px; }}
img {{ display: block; width: 100%; height: auto; }}
figcaption {{ margin-top: 8px; font-weight: 700; }}
</style>
<h1>{html.escape(scope.title())} bird icon contact sheets</h1>
<p>{sum(len(rows) for _, rows in pages):,} species. Review numbers are global
and stable across the Washington, ABA, and worldwide galleries.</p>
<div class="pages">{''.join(cards)}</div>
"""
    (out / "index.html").write_text(document, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--out", type=Path,
        default=ROOT / "mockups" / "icon-galleries",
    )
    args = parser.parse_args()
    taxonomy_rows = load(TAXONOMY)
    species_rows = [
        row for row in taxonomy_rows if row.get("category") == "species"
    ]
    by_code = {row["speciesCode"]: row for row in species_rows}
    numbers = review_numbers(species_rows)
    coverage = load(COVERAGE)
    args.out.mkdir(parents=True, exist_ok=True)

    for scope in ("washington", "aba", "worldwide"):
        codes = coverage["scopes"][scope]["speciesCodes"]
        rows = [{
            **by_code[code],
            "reviewNumber": numbers[code],
        } for code in codes if any(
            (ICONS / f"{code}{extension}").exists()
            for extension in (".jpg", ".png")
        )]
        rows.sort(key=lambda row: row["reviewNumber"])
        scope_out = args.out / scope
        scope_out.mkdir(parents=True, exist_ok=True)
        total_pages = (len(rows) + PER_PAGE - 1) // PER_PAGE
        pages = []
        for page_index, start in enumerate(
                range(0, len(rows), PER_PAGE), 1):
            page_rows = rows[start:start + PER_PAGE]
            filename = render_page(
                scope, page_rows, page_index, total_pages, scope_out)
            pages.append((filename, page_rows))
        write_index(scope, pages, scope_out)
        print(f"{scope}: {len(rows)} icons, {len(pages)} pages, "
              f"{scope_out / 'index.html'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

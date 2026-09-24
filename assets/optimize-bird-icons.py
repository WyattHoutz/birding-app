#!/usr/bin/env python3
"""Create app-sized bird-image derivatives without touching source artwork."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from PIL import Image

MAX_EDGE = 240
JPEG_QUALITY = 80
MAX_BYTES = 200 * 1024
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def optimize(source: Path, destination: Path) -> dict:
    original_bytes = source.stat().st_size
    with Image.open(source) as opened:
        opened.load()
        original_size = opened.size
        if max(original_size) <= MAX_EDGE and original_bytes <= MAX_BYTES:
            shutil.copy2(source, destination)
            return {
                "file": source.name,
                "source_size": list(original_size),
                "output_size": list(original_size),
                "source_bytes": original_bytes,
                "output_bytes": original_bytes,
                "copied": True,
            }

        image = opened.copy()
        image.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
        if source.suffix.lower() == ".png":
            image.save(destination, format="PNG", optimize=True)
        else:
            image.convert("RGB").save(
                destination,
                format="JPEG",
                quality=JPEG_QUALITY,
                optimize=True,
                progressive=True,
            )

    output_bytes = destination.stat().st_size
    if output_bytes > MAX_BYTES:
        destination.unlink(missing_ok=True)
        raise ValueError(
            f"{source.name} is {output_bytes} bytes after optimization; "
            f"limit is {MAX_BYTES}"
        )
    return {
        "file": source.name,
        "source_size": list(original_size),
        "output_size": list(image.size),
        "source_bytes": original_bytes,
        "output_bytes": output_bytes,
        "copied": False,
    }


def build(source_dir: Path, output_dir: Path, report_path: Path | None) -> list[dict]:
    if source_dir.resolve() == output_dir.resolve():
        raise ValueError("source and output directories must differ")
    output_dir.mkdir(parents=True, exist_ok=True)
    results = []
    for source in sorted(source_dir.iterdir()):
        destination = output_dir / source.name
        if source.suffix.lower() not in IMAGE_EXTENSIONS:
            if source.is_file():
                shutil.copy2(source, destination)
            continue
        results.append(optimize(source, destination))
    if report_path:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
    return results


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    results = build(args.source, args.output, args.report)
    source_bytes = sum(item["source_bytes"] for item in results)
    output_bytes = sum(item["output_bytes"] for item in results)
    changed = sum(not item["copied"] for item in results)
    print(
        f"{len(results)} images: {changed} optimized; "
        f"{source_bytes / 1048576:.2f} MiB -> {output_bytes / 1048576:.2f} MiB"
    )


if __name__ == "__main__":
    main()

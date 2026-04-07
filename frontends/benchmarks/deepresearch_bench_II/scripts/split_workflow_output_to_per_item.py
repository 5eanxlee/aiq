#!/usr/bin/env python3
"""Split workflow_output.json into one Markdown report per dataset item.

NAT eval writes workflow_output.json with only the workflow fields. This script
merges `idx` and `id` from the original benchmark dataset and writes each item
to `output_dir/reports/idx-<idx>.md` by default. Use `--keep-all-fields` to
write JSON records instead.
"""

import argparse
import json
import re
import sys
from pathlib import Path


def load_dataset_id_to_idx(dataset_path: Path) -> dict:
    """Load JSONL dataset and return mapping from item id to {idx, id}."""
    out = {}
    with open(dataset_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            key = row.get("id")
            if key is not None:
                out[str(key)] = {"idx": row.get("idx"), "id": key}
    return out


def sanitize_filename(id_val) -> str:
    """Turn an id into a safe filename."""
    s = str(id_val).strip()
    s = re.sub(r"[^\w\-.]", "_", s)
    return s or "unknown"


def _default_dataset_path() -> Path:
    return Path(__file__).resolve().parent.parent / "data" / "tasks_and_rubrics.jsonl"


def main():
    parser = argparse.ArgumentParser(
        description="Split workflow_output.json into one file per item."
    )
    parser.add_argument("--input", required=True, type=Path, help="Path to workflow_output.json")
    parser.add_argument(
        "--output-dir",
        required=True,
        type=Path,
        help="Base output directory; reports are written to <output-dir>/reports/",
    )
    parser.add_argument(
        "--dataset",
        type=Path,
        default=_default_dataset_path(),
        help="Path to original dataset JSONL for merging idx/id",
    )
    parser.add_argument(
        "--keep-all-fields",
        action="store_true",
        help="Write the full record as JSON instead of Markdown report text",
    )

    args = parser.parse_args()

    if not args.input.exists():
        print(f"Error: Input file not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    with open(args.input, encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, list):
        print("Error: workflow_output.json should be a JSON array", file=sys.stderr)
        sys.exit(1)

    id_to_meta = {}
    if args.dataset and args.dataset.exists():
        id_to_meta = load_dataset_id_to_idx(args.dataset)

    reports_dir = args.output_dir / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)

    written = 0
    for record in data:
        id_val = record.get("id", written)
        meta = id_to_meta.get(str(id_val), {})
        idx_val = record.get("idx") if record.get("idx") is not None else meta.get("idx")
        if idx_val is not None:
            record["idx"] = idx_val
        if meta.get("id") is not None and record.get("id") is None:
            record["id"] = meta["id"]

        if idx_val is not None:
            name = str(idx_val)
        else:
            name = sanitize_filename(id_val)

        if args.keep_all_fields:
            out_path = reports_dir / f"{name}.json"
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(record, f, ensure_ascii=False, indent=2, default=str)
        else:
            out_path = reports_dir / f"idx-{name}.md"
            content = record.get("generated_answer")
            if content is None:
                content = ""
            elif not isinstance(content, str):
                content = str(content)
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(content)
        written += 1

    print(f"Wrote {written} item(s) to {reports_dir}")


if __name__ == "__main__":
    main()

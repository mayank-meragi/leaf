"""``python -m leaf_backend.sync --data-dir ../leaf-data`` fetches holdings for every scheme Leaf has matched."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .holdings import sync


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--data-dir", type=Path, required=True, help="checkout of your Leaf data repo")
    p.add_argument("--force", action="store_true", help="refetch even if the file is recent")
    p.add_argument("--delay", type=float, default=1.0, help="seconds between schemes")
    a = p.parse_args(argv)

    r = sync(a.data_dir, force=a.force, delay=a.delay)
    print(f"written {len(r.written)}, unchanged {len(r.unchanged)}, skipped (recent) {len(r.skipped)}, failed {len(r.failed)}")
    for code, why in r.failed.items():
        print(f"  FAILED {code}: {why}", file=sys.stderr)
    # Fail the run when nothing worked, so a changed source shows up as a red workflow, not silent staleness.
    return 1 if r.failed and not (r.written or r.unchanged or r.skipped) else 0


if __name__ == "__main__":
    raise SystemExit(main())

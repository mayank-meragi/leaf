"""Fund holdings and expense ratios, fetched monthly and committed to the data repo as ``holdings/<amfi code>.json``.

The browser can't call the source directly (no CORS), so this runs server-side in a GitHub Action.
It reads the AMFI codes Leaf already resolved into ``nav/codes.json``; nothing else is needed.

The source is Groww's public scheme endpoint. It's undocumented, so treat every field as optional and
fail loudly when its shape changes rather than writing guesses.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

SEARCH = "https://groww.in/v1/api/search/v1/entity?app=false&entity_type=scheme&page=0&size=10&q={q}"
SCHEME = "https://groww.in/v1/api/data/mf/web/v2/scheme/search/{slug}"
USER_AGENT = "leaf-personal-finance/1.0 (+personal use; monthly)"

# A holdings file younger than this isn't refetched: funds disclose once a month.
FRESH_DAYS = 20
# Below this name similarity, a Regular plan won't be paired with a Direct plan's holdings.
MIN_SIMILARITY = 0.75

GetJSON = Callable[[str], dict]


def get_json(url: str, retries: int = 3, timeout: int = 30) -> dict:
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as res:
                return json.load(res)
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504):
                raise
            last = e
        except urllib.error.URLError as e:
            last = e
        time.sleep(2**attempt)
    raise RuntimeError(f"giving up on {url}: {last}")


# ---- Matching a scheme to a Groww page ----

_DROP = {"direct", "regular", "growth", "plan", "option", "idcw", "directonline", "scheme", "the", "of", "and", "mutual"}
_NOISE = {"plan", "option", "scheme", "the", "of", "and", "fund", "mutual"}


_COMPOUND = re.compile(r"\b(mid|small|large|multi|flexi)[\s-]+cap\b")


def tokens(name: str) -> list[str]:
    """Lower-case words; "Mid Cap" and "Midcap" are the same word, as AMFI spells it both ways."""
    name = re.sub(r"\(formerly[^)]*\)", " ", name.lower())
    name = _COMPOUND.sub(r"\1cap", name).replace("&", " and ")
    return [w for w in re.sub(r"[^a-z0-9]+", " ", name).split() if w]


def query_variants(name: str) -> list[str]:
    """The full name without plan words, then progressively fewer leading words (funds get renamed)."""
    words = [w for w in tokens(name) if w not in _DROP]
    if not words:
        return [name]
    base = [" ".join(words[:n]) for n in range(len(words), min(3, len(words)) - 1, -1)][:4]
    split = lambda q: re.sub(r"\b(mid|small|large|multi|flexi)cap\b", r"\1 cap", q)  # noqa: E731
    return list(dict.fromkeys(v for q in base for v in (q, split(q))))


def similarity(a: str, b: str) -> float:
    x = {w for w in tokens(a) if w not in _NOISE and w not in _DROP}
    y = {w for w in tokens(b) if w not in _NOISE and w not in _DROP}
    return len(x & y) / max(1, max(len(x), len(y)))


@dataclass
class Match:
    slug: str
    #: True when Groww's own scheme code equals ours. False means we paired a Regular plan with its Direct twin by name.
    exact: bool
    title: str = ""


def find_scheme(code: int, name: str, http: GetJSON = get_json) -> Match | None:
    seen: dict[str, dict] = {}
    for q in query_variants(name):
        for entry in http(SEARCH.format(q=urllib.parse.quote(q))).get("content", []):
            if entry.get("entity_type", "Scheme") == "Scheme" and entry.get("search_id"):
                seen.setdefault(entry["search_id"], entry)
        for entry in seen.values():
            if str(entry.get("scheme_code")) == str(code):
                return Match(entry["search_id"], True, entry.get("title", ""))
    # Groww only lists Direct plans. A Direct plan we couldn't find by code is a miss, but a Regular plan
    # holds its Direct twin's portfolio, so pair it by name if the match is close.
    if re.search(r"direct", name, re.I):
        return None
    best = max(seen.values(), key=lambda e: similarity(name, e.get("title", "")), default=None)
    if best and similarity(name, best.get("title", "")) >= MIN_SIMILARITY:
        return Match(best["search_id"], False, best.get("title", ""))
    return None


# ---- Normalising the response ----


def _num(x) -> float | None:
    try:
        v = float(x)
        return v if v == v else None
    except (TypeError, ValueError):
        return None


def _ist_date(stamp: str | None) -> str | None:
    """Groww sends IST midnight as UTC ('2026-08-30T18:30:00.000Z' is 31 Aug)."""
    if not stamp:
        return None
    try:
        t = dt.datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        return None
    return (t + dt.timedelta(hours=5, minutes=30)).date().isoformat()


def normalize(raw: dict, code: int, name: str, match: Match, today: str) -> dict:
    rows = raw.get("holdings")
    if not isinstance(rows, list):
        raise ValueError("response has no holdings list: the source's shape may have changed")
    holdings = []
    for r in rows:
        w = _num(r.get("corpus_per"))
        if not r.get("company_name") or w is None:
            continue
        holdings.append(
            {
                "id": r.get("stock_search_id") or re.sub(r"[^a-z0-9]+", "-", r["company_name"].lower()).strip("-"),
                "name": r["company_name"],
                "sector": r.get("sector_name"),
                "type": (r.get("nature_name") or r.get("instrument_name") or "").upper(),
                "weight": round(w, 4),
            }
        )
    holdings.sort(key=lambda h: -h["weight"])
    dates = sorted({d for d in (_ist_date(r.get("portfolio_date")) for r in rows) if d})
    return {
        "code": code,
        "name": name,
        "fetched": today,
        "source": "groww",
        "portfolioDate": dates[-1] if dates else None,
        "category": raw.get("category"),
        "subCategory": raw.get("sub_category"),
        "benchmark": raw.get("benchmark_name"),
        # Only a Direct plan's own page reports its expense ratio; a Regular plan's isn't available.
        "expenseRatio": _num(raw.get("expense_ratio")) if match.exact else None,
        "aumCr": _num(raw.get("aum")),
        "turnover": _num(raw.get("portfolio_turnover")),
        "holdingsFrom": None if match.exact else {"scheme": raw.get("scheme_name") or match.title, "note": "Regular plan: holdings are those of its Direct twin"},
        "holdings": holdings,
    }


def fetch_holdings(code: int, name: str, http: GetJSON = get_json, today: str | None = None) -> dict:
    """The holdings document for one scheme. Raises LookupError/ValueError/RuntimeError with a readable reason."""
    match = find_scheme(code, name, http)
    if not match:
        raise LookupError(f"no page found for {name!r}")
    doc = normalize(http(SCHEME.format(slug=match.slug)), code, name, match, today or dt.date.today().isoformat())
    if not doc["holdings"]:
        raise ValueError("no holdings in response")
    return doc


# ---- Syncing the data repo ----


@dataclass
class Report:
    written: list[int] = field(default_factory=list)
    unchanged: list[int] = field(default_factory=list)
    skipped: list[int] = field(default_factory=list)
    failed: dict[int, str] = field(default_factory=dict)


def _same(a: dict, b: dict) -> bool:
    strip = lambda d: {k: v for k, v in d.items() if k != "fetched"}  # noqa: E731
    return strip(a) == strip(b)


def sync(
    data_dir: Path,
    http: GetJSON = get_json,
    today: str | None = None,
    force: bool = False,
    delay: float = 1.0,
) -> Report:
    today = today or dt.date.today().isoformat()
    codes_file = data_dir / "nav" / "codes.json"
    if not codes_file.exists():
        raise SystemExit("nav/codes.json not found in the data repo. Open Leaf, go to Investments > Performance and Load NAV history first.")
    entries = json.loads(codes_file.read_text())
    wanted: dict[int, str] = {}
    for e in entries.values():
        wanted.setdefault(int(e["code"]), e.get("name", ""))

    out_dir = data_dir / "holdings"
    out_dir.mkdir(exist_ok=True)
    report = Report()
    first = True
    for code, name in sorted(wanted.items()):
        path = out_dir / f"{code}.json"
        old = json.loads(path.read_text()) if path.exists() else None
        if old and not force and (dt.date.fromisoformat(today) - dt.date.fromisoformat(old.get("fetched", "1970-01-01"))).days < FRESH_DAYS:
            report.skipped.append(code)
            continue
        if not first:
            time.sleep(delay)  # be polite: a handful of requests a month
        first = False
        try:
            doc = fetch_holdings(code, name, http, today)
        except Exception as e:  # one bad scheme shouldn't stop the rest
            report.failed[code] = f"{type(e).__name__}: {e}"
            continue
        if old and _same(old, doc):
            # Content hasn't changed: leave the file (and git history) alone.
            report.unchanged.append(code)
            continue
        path.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")
        report.written.append(code)
    return report

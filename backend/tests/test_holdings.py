import json
import tempfile
import unittest
from pathlib import Path

from leaf_backend import holdings as h

RAW = {
    "scheme_name": "Alpha Flexi Cap Direct Growth",
    "expense_ratio": "0.69",
    "aum": 1234.5,
    "category": "Equity",
    "sub_category": "Flexi Cap",
    "benchmark_name": "NIFTY 500",
    "portfolio_turnover": 30.0,
    "holdings": [
        {"company_name": "Small Co", "stock_search_id": "small-co", "sector_name": "Auto", "nature_name": "EQUITY", "corpus_per": 2.5, "portfolio_date": "2026-08-30T18:30:00.000Z"},
        {"company_name": "Big Bank", "stock_search_id": "big-bank", "sector_name": "Financial", "nature_name": "EQUITY", "corpus_per": 7.25, "portfolio_date": "2026-08-30T18:30:00.000Z"},
        {"company_name": "T-Bill", "stock_search_id": None, "sector_name": None, "nature_name": "GOVERNMENT SECURITIES", "corpus_per": 1.0, "portfolio_date": "2026-08-30T18:30:00.000Z"},
        {"company_name": None, "corpus_per": 3},  # junk row
        {"company_name": "No Weight", "corpus_per": None},
    ],
}


class FakeHttp:
    """Serves a tiny catalogue: Direct plans are searchable by code, Regular plans aren't."""

    def __init__(self, catalogue: dict[str, tuple[str, str]]):
        self.catalogue = catalogue  # slug -> (scheme_code, title)
        self.calls: list[str] = []

    def __call__(self, url: str) -> dict:
        self.calls.append(url)
        if "/search?" in url or "entity?" in url:
            return {"content": [{"entity_type": "Scheme", "search_id": s, "scheme_code": c, "title": t} for s, (c, t) in self.catalogue.items()]}
        slug = url.rsplit("/", 1)[1]
        if slug not in self.catalogue:
            raise AssertionError(f"unexpected fetch {slug}")
        return RAW


CATALOGUE = {"alpha-flexi-cap-direct-growth": ("111", "Alpha Flexi Cap Fund")}


class QueryTests(unittest.TestCase):
    def test_variants_drop_plan_words_and_shorten(self):
        v = h.query_variants("HDFC Mid-Cap Opportunities Fund - Direct Plan - Growth Option")
        self.assertEqual(v[0], "hdfc midcap opportunities fund")
        self.assertIn("hdfc mid cap opportunities fund", v)  # AMFI and Groww disagree on the spelling

    def test_compound_words_are_one_word(self):
        self.assertEqual(h.tokens("Axis Mid Cap Fund"), h.tokens("Axis Midcap Fund"))
        self.assertGreater(h.similarity("Axis Mid Cap Fund - Direct Growth", "Axis Midcap Fund"), 0.9)

    def test_similarity(self):
        self.assertGreater(h.similarity("Alpha Flexi Cap Fund - Regular Plan", "Alpha Flexi Cap Fund"), 0.9)
        self.assertLess(h.similarity("Alpha Flexi Cap Fund", "Beta Small Cap Fund"), 0.5)


class MatchTests(unittest.TestCase):
    def test_direct_plan_matches_by_code(self):
        m = h.find_scheme(111, "Alpha Flexi Cap Fund - Direct Plan - Growth", FakeHttp(CATALOGUE))
        self.assertEqual((m.slug, m.exact), ("alpha-flexi-cap-direct-growth", True))

    def test_regular_plan_pairs_with_direct_twin_by_name(self):
        m = h.find_scheme(999, "Alpha Flexi Cap Fund - Regular Plan - Growth", FakeHttp(CATALOGUE))
        self.assertEqual((m.slug, m.exact), ("alpha-flexi-cap-direct-growth", False))

    def test_unknown_direct_plan_is_a_miss_not_a_guess(self):
        self.assertIsNone(h.find_scheme(999, "Alpha Flexi Cap Fund - Direct Plan - Growth", FakeHttp(CATALOGUE)))

    def test_distant_name_is_not_paired(self):
        self.assertIsNone(h.find_scheme(999, "Zeta Gilt Fund - Regular Plan - Growth", FakeHttp(CATALOGUE)))


class NormalizeTests(unittest.TestCase):
    def test_shapes_the_document(self):
        d = h.normalize(RAW, 111, "Alpha", h.Match("s", True), "2026-10-01")
        self.assertEqual([x["name"] for x in d["holdings"]], ["Big Bank", "Small Co", "T-Bill"])  # junk dropped, heaviest first
        self.assertEqual(d["holdings"][0], {"id": "big-bank", "name": "Big Bank", "sector": "Financial", "type": "EQUITY", "weight": 7.25})
        self.assertEqual(d["holdings"][2]["id"], "t-bill")  # slug derived when the source has none
        self.assertEqual(d["portfolioDate"], "2026-08-31")  # IST midnight arrives as 18:30 UTC the day before
        self.assertEqual((d["expenseRatio"], d["aumCr"], d["holdingsFrom"]), (0.69, 1234.5, None))

    def test_regular_plan_gets_no_expense_ratio(self):
        d = h.normalize(RAW, 999, "Alpha Regular", h.Match("s", False, "Alpha"), "2026-10-01")
        self.assertIsNone(d["expenseRatio"])
        self.assertIn("Direct twin", d["holdingsFrom"]["note"])

    def test_a_changed_shape_raises_instead_of_writing_garbage(self):
        with self.assertRaises(ValueError):
            h.normalize({"holdings": None}, 1, "x", h.Match("s", True), "2026-10-01")


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        (self.dir / "nav").mkdir()
        codes = {
            "alpha flexi cap fund": {"code": 111, "name": "Alpha Flexi Cap Fund - Direct Plan - Growth", "verified": True},
            "alpha flexi cap fund regular": {"code": 111, "name": "dup of the same code", "verified": True},
            "ghost": {"code": 404, "name": "Ghost Direct Plan Growth", "verified": True},
        }
        (self.dir / "nav" / "codes.json").write_text(json.dumps(codes))

    def tearDown(self):
        self.tmp.cleanup()

    def run_sync(self, today, **kw):
        return h.sync(self.dir, FakeHttp(CATALOGUE), today=today, delay=0, **kw)

    def test_writes_once_per_code_and_survives_a_failure(self):
        r = self.run_sync("2026-10-01")
        self.assertEqual((r.written, list(r.failed)), ([111], [404]))
        self.assertTrue((self.dir / "holdings" / "111.json").exists())

    def test_recent_files_are_skipped_and_unchanged_content_isnt_rewritten(self):
        self.run_sync("2026-10-01")
        path = self.dir / "holdings" / "111.json"
        before = path.read_text()
        self.assertEqual(self.run_sync("2026-10-10").skipped, [111])  # under 20 days old
        r = self.run_sync("2026-11-05")  # old enough to refetch, same data
        self.assertEqual((r.unchanged, r.written), ([111], []))
        self.assertEqual(path.read_text(), before)  # `fetched` untouched, so no git diff
        self.assertEqual(self.run_sync("2026-10-10", force=True).unchanged, [111])

    def test_missing_codes_file_explains_what_to_do(self):
        (self.dir / "nav" / "codes.json").unlink()
        with self.assertRaises(SystemExit) as cm:
            self.run_sync("2026-10-01")
        self.assertIn("Load NAV history", str(cm.exception))


if __name__ == "__main__":
    unittest.main()

import { describe, expect, it } from "vitest";
import type { Goal, MFTransaction, MFTxnType } from "@/types";
import type { SchemeGroup } from "./capitalGains";
import { futureValue, monthsUntil, projectGoal, requiredMonthly } from "./goals";
import { costs, lookThrough, monthsOld, overlapMatrix, overlaps, pairOverlap, type FundHoldings, type FundInput } from "./holdings";
import { navOn, parseSeries, queryVariants, resolveScheme, type NavApi, type NavSeries } from "./nav";
import { compareBenchmark, hasFullHistory, monthEnds, openingUnits, valueHistory } from "./performance";
import { planMix, planTypeOf } from "./planType";
import type { SchemeSummary } from "./portfolio";
import { rebalance } from "./rebalance";

const series = (code: number, name: string, data: [string, number][], isins: string[] = []): NavSeries => ({ code, name, isins, fetched: "2026-01-01", data });

describe("nav", () => {
  it("parses mfapi's newest-first dd-mm-yyyy rows into ascending ISO pairs", () => {
    const s = parseSeries(1, { meta: { scheme_name: "X", isin_growth: "INF1" }, data: [{ date: "03-01-2024", nav: "12.5" }, { date: "02-01-2024", nav: "12" }, { date: "bad", nav: "1" }] });
    expect(s.data).toEqual([["2024-01-02", 12], ["2024-01-03", 12.5]]);
    expect(s.isins).toEqual(["INF1"]);
  });
  it("looks up the latest NAV on or before a date", () => {
    const s = series(1, "X", [["2024-01-02", 10], ["2024-01-05", 11]]);
    expect(navOn(s, "2024-01-01")).toBeUndefined();
    expect(navOn(s, "2024-01-04")).toBe(10);
    expect(navOn(s, "2024-02-01")).toBe(11);
  });
  it("drops plan and option words and shortens progressively", () => {
    const v = queryVariants("HDFC Mid-Cap Opportunities Fund - Direct Plan - Growth Option");
    expect(v[0]).toBe("hdfc midcap opportunities fund");
    expect(v).toContain("hdfc mid cap opportunities fund"); // AMFI sometimes spells it as two words
    expect(queryVariants("UTI Nifty 50 Index Fund - Direct Plan - Growth").at(-1)!.split(" ").length).toBeGreaterThanOrEqual(3);
  });
});

describe("resolveScheme against AMFI's inconsistent names", () => {
  // Real cases: the statement says "Mid Cap", AMFI says "Midcap"; AMFI lists a Direct plan as just "HSBC Small Cap Fund";
  // and four AMFI entries share one name, so only prices can tell them apart.
  const mk = (code: number, name: string, nav: number) => series(code, name, [["2024-01-01", nav], ["2024-02-01", nav * 1.1]]);
  const cat = [
    mk(1, "Axis Large & Mid Cap Fund - Direct Plan - Growth Option", 30),
    mk(2, "Axis Midcap Fund - Direct Plan - Growth Option", 90),
    mk(3, "HSBC Small Cap Equity Fund - Growth", 12),
    mk(4, "HSBC Small Cap Fund", 40),
    mk(5, "Motilal Oswal Multi Cap Fund", 11),
    mk(6, "Motilal Oswal Multi Cap Fund", 15),
    mk(7, "Motilal Oswal Multi Cap Fund", 17),
  ];
  const api: NavApi = {
    search: async (q) => {
      const words = q.split(" ");
      return cat.filter((s) => words.every((w) => s.name.toLowerCase().includes(w))).map((s) => ({ schemeCode: s.code, schemeName: s.name }));
    },
    series: async (c) => cat.find((s) => s.code === c)!,
  };
  it("finds Midcap from Mid Cap", async () => {
    expect((await resolveScheme({ name: "Axis Mid Cap Fund - Direct Growth", advisor: "DIRECT", anchors: [{ date: "2024-02-01", nav: 99 }] }, api))?.series.code).toBe(2);
  });
  it("accepts a bare AMFI name, since the price confirms it", async () => {
    expect((await resolveScheme({ name: "HSBC Small Cap Fund - Direct Growth (Formerly known as L&T Emerging Businesses Fund Direct Growth)", advisor: "DIRECTONLINE", anchors: [{ date: "2024-01-01", nav: 40 }] }, api))?.series.code).toBe(4);
  });
  it("tells identically named entries apart by price", async () => {
    expect((await resolveScheme({ name: "Motilal Oswal Multi Cap Fund - Direct Plan Growth", anchors: [{ date: "2024-02-01", nav: 16.5 }] }, api))?.series.code).toBe(6);
  });
});

describe("resolveScheme", () => {
  const catalogue: Record<number, NavSeries> = {
    1: series(1, "Alpha Flexi Cap Fund - Regular Plan - Growth", [["2024-01-01", 50], ["2024-02-01", 55]]),
    2: series(2, "Alpha Flexi Cap Fund - Direct Plan - Growth", [["2024-01-01", 60], ["2024-02-01", 66]], ["INF000A01"]),
    3: series(3, "Alpha Flexi Cap Fund - Direct Plan - IDCW", [["2024-01-01", 60], ["2024-02-01", 66]]),
  };
  const api: NavApi = {
    search: async () => Object.values(catalogue).map((s) => ({ schemeCode: s.code, schemeName: s.name })),
    series: async (c) => catalogue[c],
  };
  it("picks the Direct Growth plan whose NAVs match the statement", async () => {
    const r = await resolveScheme({ name: "Alpha Flexi Cap Fund - Direct Plan - Growth", anchors: [{ date: "2024-02-01", nav: 66 }] }, api);
    expect(r).toMatchObject({ verified: true, series: { code: 2 } });
  });
  it("accepts an ISIN match without price anchors", async () => {
    const r = await resolveScheme({ name: "Alpha Flexi Cap Fund Direct", isin: "INF000A01", anchors: [] }, api);
    expect(r?.series.code).toBe(2);
  });
  it("won't guess when prices disagree", async () => {
    expect(await resolveScheme({ name: "Alpha Flexi Cap Fund - Direct Plan - Growth", anchors: [{ date: "2024-02-01", nav: 999 }] }, api)).toBeNull();
  });
});

const tx = (type: MFTxnType, date: string, amount: number, units: number): MFTransaction => ({ date, description: type, amount, units, nav: Math.abs(amount / units), balance: null, type });

const group = (name: string, txns: MFTransaction[], close: number, value: number, opening = 0): SchemeGroup => ({ name, amc: "T", opening, close, value, asOf: "2024-04-15", txns });

describe("performance", () => {
  it("lists month-ends then the end date", () => {
    expect(monthEnds("2024-01-10", "2024-03-15")).toEqual(["2024-01-31", "2024-02-29", "2024-03-15"]);
    expect(monthEnds("2024-01-10", "2024-01-31")).toEqual(["2024-01-31"]);
  });
  it("infers opening units the transactions don't explain", () => {
    const g = group("A", [tx("PURCHASE", "2024-01-05", 100, 10)], 25, 0);
    expect(openingUnits(g)).toBe(15);
    expect(hasFullHistory(g)).toBe(false);
  });
  const nav = series(9, "A", [["2024-01-01", 10], ["2024-02-01", 12], ["2024-03-01", 15], ["2024-04-01", 20]]);
  it("values units at each month-end and tracks net invested", () => {
    const g = group("A", [tx("PURCHASE", "2024-01-05", 100, 10), tx("PURCHASE", "2024-02-10", 120, 10)], 20, 400);
    const h = valueHistory([g], () => nav, "2024-04-15");
    expect(h.points.map((p) => [p.date, p.value, p.invested])).toEqual([
      ["2024-01-31", 100, 100],
      ["2024-02-29", 240, 220],
      ["2024-03-31", 300, 220],
      ["2024-04-15", 400, 220],
    ]);
  });
  it("reports schemes without NAV data rather than guessing", () => {
    const h = valueHistory([group("A", [tx("PURCHASE", "2024-01-05", 100, 10)], 10, 0)], () => undefined, "2024-04-15");
    expect(h).toEqual({ points: [], missing: ["A"] });
  });
  it("compares the same cashflows with a benchmark", () => {
    const g = group("A", [tx("PURCHASE", "2024-01-05", 100, 10)], 10, 200);
    const bench = series(7, "Index", [["2024-01-01", 100], ["2024-04-15", 150]]);
    const c = compareBenchmark([g], bench, () => nav, "2024-04-15")!;
    expect(c.mineValue).toBe(200);
    expect(c.benchValue).toBeCloseTo(150, 6); // 100 / 100 units × 150
    expect(c.mine!).toBeGreaterThan(c.bench!);
    expect(c.benchStartsAfter).toBeUndefined();
    expect(c.curve.at(-1)).toMatchObject({ date: "2024-04-15" });
  });
  it("flags money that went in before the benchmark existed and skips partial histories", () => {
    const full = group("A", [tx("PURCHASE", "2024-01-05", 100, 10)], 10, 200);
    const partial = group("B", [tx("PURCHASE", "2024-01-05", 100, 10)], 30, 300);
    const c = compareBenchmark([full, partial], series(7, "Index", [["2024-03-01", 100]]), () => nav, "2024-04-15")!;
    expect(c.benchStartsAfter).toBe("2024-03-01");
    expect(c.excluded).toEqual(["B"]);
  });
});

const scheme = (name: string, assetClass: SchemeSummary["assetClass"], value: number, advisor?: string): SchemeSummary => ({
  name, amc: "T", folios: ["1"], assetClass, units: 1, value, cost: value, xirr: null, fullHistory: true, transactions: [], asOf: "2024-04-15", advisor,
});

describe("rebalance", () => {
  const schemes = [scheme("E", "Equity", 800), scheme("D", "Debt", 200)];
  it("shows drift and the buy/sell to reach target", () => {
    const rows = rebalance(schemes, { Equity: 60, Debt: 40 });
    expect(rows.find((r) => r.cls === "Equity")).toMatchObject({ share: 0.8, drift: expect.closeTo(20, 6), toTarget: -200 });
    expect(rows.find((r) => r.cls === "Debt")).toMatchObject({ toTarget: 200 });
  });
  it("sends new money to the underweight class first", () => {
    const rows = rebalance(schemes, { Equity: 60, Debt: 40 }, 200); // total 1200 → debt target 480, shortfall 280 > 200
    expect(rows.find((r) => r.cls === "Debt")!.newMoney).toBeCloseTo(200, 6);
    expect(rows.find((r) => r.cls === "Equity")!.newMoney).toBe(0);
  });
  it("spreads new money by target once nothing is short", () => {
    const rows = rebalance(schemes, { Equity: 60, Debt: 40 }, 1000);
    const total = rows.reduce((s, r) => s + r.newMoney, 0);
    expect(total).toBeCloseTo(1000, 6);
    expect(rows.find((r) => r.cls === "Equity")!.newMoney).toBeCloseTo(0.6 * 2000 - 800, 6);
  });
});

describe("planType", () => {
  it("trusts the advisor field, then the name", () => {
    expect(planTypeOf({ name: "X Fund - Growth", advisor: "DIRECT" })).toBe("Direct");
    expect(planTypeOf({ name: "X Fund - Growth", advisor: "ARN-12345" })).toBe("Regular");
    expect(planTypeOf({ name: "X Fund - Direct Plan - Growth" })).toBe("Direct");
    expect(planTypeOf({ name: "X Fund" })).toBe("Unknown");
  });
  it("sums value by plan and the typical commission range", () => {
    const m = planMix([scheme("A", "Equity", 1000, "ARN-1"), scheme("B", "Equity", 500, "DIRECT")]);
    expect(m.by).toMatchObject({ Regular: 1000, Direct: 500 });
    expect([m.dragLow, m.dragHigh]).toEqual([5, 10]);
  });
});

describe("goals", () => {
  it("counts whole months", () => {
    expect(monthsUntil("2026-12-15", "2026-10-01")).toBe(2);
    expect(monthsUntil("2026-12-15", "2026-10-20")).toBe(1);
    expect(monthsUntil("2020-01-01", "2026-10-01")).toBe(0);
  });
  it("projects growth and solves for the monthly amount", () => {
    expect(futureValue(100, 0, 0.12, 12)).toBeCloseTo(112, 6);
    expect(futureValue(0, 100, 0, 10)).toBe(1000);
    const need = requiredMonthly(0, 100_000, 0.1, 60);
    expect(futureValue(0, need, 0.1, 60)).toBeCloseTo(100_000, 4);
    expect(requiredMonthly(200_000, 100_000, 0.1, 60)).toBe(0);
  });
  const goal: Goal = { id: "g", name: "House", target: 100_000, date: "2027-10-01", schemes: ["A", "Gone"], returnPct: 0 };
  it("uses SIPs on the linked schemes unless a monthly amount is set", () => {
    const plans = [{ scheme: "A", monthly: 5000, active: true }, { scheme: "B", monthly: 9999, active: true }] as never;
    const p = projectGoal(goal, [scheme("A", "Equity", 40_000)], plans, "2026-10-01");
    expect(p).toMatchObject({ current: 40_000, monthly: 5000, fromSips: true, months: 12, projected: 100_000, onTrack: true, missing: ["Gone"] });
    expect(projectGoal({ ...goal, monthly: 1000 }, [scheme("A", "Equity", 40_000)], plans, "2026-10-01")).toMatchObject({ monthly: 1000, fromSips: false, onTrack: false });
  });
});


const fund = (code: number, rows: [string, number, string?][], er: number | null = 0.5): FundHoldings => ({
  code, name: `F${code}`, fetched: "2026-10-01", portfolioDate: "2026-08-31", expenseRatio: er,
  holdings: rows.map(([id, weight, type]) => ({ id, name: id.toUpperCase(), sector: id === "hdfc" || id === "icici" ? "Financial" : "Tech", type: type ?? "EQUITY", weight })),
});

describe("fund overlap", () => {
  const a = fund(1, [["hdfc", 10], ["icici", 5], ["infy", 4], ["tbill", 3, "GOVERNMENT SECURITIES"]]);
  const b = fund(2, [["hdfc", 6], ["infy", 8], ["tbill", 20, "GOVERNMENT SECURITIES"]]);
  it("sums the smaller weight over shared stocks and ignores non-equity", () => {
    const o = pairOverlap(a, b);
    expect(o.overlap).toBe(6 + 4); // hdfc min(10,6) + infy min(4,8); the T-bill isn't a stock
    expect(o.shared.map((s) => s.id)).toEqual(["hdfc", "infy"]);
  });
  it("is symmetric, and 100 for identical portfolios", () => {
    expect(pairOverlap(b, a).overlap).toBe(pairOverlap(a, b).overlap);
    expect(pairOverlap(a, a).overlap).toBe(10 + 5 + 4);
  });
  it("ranks pairs and skips funds with no equity or nothing in common", () => {
    const debt = fund(3, [["tbill", 90, "GOVERNMENT SECURITIES"]]);
    const c = fund(4, [["zzz", 50]]);
    const ranked = overlaps([{ name: "A", value: 1, fund: a }, { name: "B", value: 1, fund: b }, { name: "D", value: 1, fund: debt }, { name: "C", value: 1, fund: c }]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({ a: "A", b: "B", overlap: 10 });
  });
});

describe("overlap matrix", () => {
  const a = fund(1, [["hdfc", 10], ["infy", 4]]);
  const b = fund(2, [["hdfc", 6], ["infy", 8]]);
  const c = fund(3, [["zzz", 50]]);
  it("weights each pair's overlap by the money in both funds", () => {
    const m = overlapMatrix([{ name: "A", value: 100, fund: a }, { name: "B", value: 100, fund: b }, { name: "C", value: 10, fund: c }]);
    expect(m.cells[0][1]).toBe(10); // hdfc 6 + infy 4
    expect(m.cells[1][0]).toBe(10);
    expect(m.cells[0][2]).toBe(0);
    expect(m.cells[0][0]).toBe(100);
    // pairs: A-B (100*100, 10%), A-C (100*10, 0%), B-C (100*10, 0%)
    expect(m.weighted).toBeCloseTo((10_000 * 10) / 12_000, 6);
    expect(m.top).toMatchObject({ a: "A", b: "B", overlap: 10 });
  });
  it("has no portfolio figure with a single equity fund", () => {
    const m = overlapMatrix([{ name: "A", value: 100, fund: a }]);
    expect(m.weighted).toBeNull();
    expect(m.top).toBeNull();
  });
});

describe("effective stocks", () => {
  it("is the stock count when holdings are equal, and lower when one dominates", () => {
    const even = lookThrough([{ name: "A", value: 100, fund: fund(1, [["a", 10], ["b", 10], ["c", 10], ["d", 10]]) }], 100);
    expect(even.effectiveStocks).toBeCloseTo(4);
    expect(even.positions).toBe(4);
    const skew = lookThrough([{ name: "A", value: 100, fund: fund(1, [["a", 70], ["b", 10], ["c", 10], ["d", 10]]) }], 100);
    expect(skew.effectiveStocks!).toBeLessThan(2);
  });
  it("counts a stock held in two funds as one stock but two positions", () => {
    const t = lookThrough([{ name: "A", value: 100, fund: fund(1, [["a", 50]]) }, { name: "B", value: 100, fund: fund(2, [["a", 50]]) }], 200);
    expect(t.positions).toBe(2);
    expect(t.stocks).toHaveLength(1);
    expect(t.effectiveStocks).toBeCloseTo(1);
  });
});

describe("look-through", () => {
  const inputs: FundInput[] = [
    { name: "A", value: 100_000, fund: fund(1, [["hdfc", 10], ["infy", 5]]) },
    { name: "B", value: 300_000, fund: fund(2, [["hdfc", 5], ["tcs", 2]]) },
  ];
  it("scales each fund's weights by what you hold and merges the same stock", () => {
    const t = lookThrough(inputs, 500_000);
    const hdfc = t.stocks.find((s) => s.id === "hdfc")!;
    expect(hdfc.amount).toBe(10_000 + 15_000);
    expect(hdfc.share).toBe(0.05);
    expect(hdfc.funds).toEqual([{ name: "B", amount: 15_000 }, { name: "A", amount: 10_000 }]);
    expect(t.stocks.map((s) => s.id)).toEqual(["hdfc", "tcs", "infy"]);
    expect(t.equityAmount).toBe(25_000 + 6_000 + 5_000);
    expect(t.coverage).toBe(0.8); // 400k of 500k sits in funds we have holdings for
    expect(t.sectors).toEqual([
      { sector: "Financial", amount: 25_000, share: 0.05 },
      { sector: "Tech", amount: 11_000, share: 0.022 },
    ]);
  });
});

describe("costs", () => {
  it("weights by value and leaves out funds with no published ratio", () => {
    const c = costs([
      { name: "A", value: 100_000, fund: fund(1, [], 1) },
      { name: "B", value: 300_000, fund: fund(2, [], 0.5) },
      { name: "Reg", value: 100_000, fund: fund(3, [], null) },
    ], 500_000);
    expect(c.annual).toBe(1000 + 1500);
    expect(c.weighted).toBeCloseTo(0.625, 6);
    expect(c.coverage).toBe(0.8);
    expect(c.rows.map((r) => r.name)).toEqual(["B", "A", "Reg"]);
  });
  it("counts months since a disclosure", () => {
    expect(monthsOld("2026-08-31", "2026-10-01")).toBe(2);
  });
});

describe("resolveScheme keeps searching past misleading hits", () => {
  // The compact spelling returns plausible-looking wrong funds; only the split spelling finds the real one.
  const real = series(10, "Axis Small Cap Fund - Direct Plan - Growth", [["2024-01-01", 80], ["2024-02-01", 88]]);
  const decoys = [11, 12, 13].map((c) => series(c, `Axis Smallcap Thing ${c} - Direct Plan - Growth`, [["2024-01-01", 5], ["2024-02-01", 6]]));
  const api: NavApi = {
    search: async (q) => (q.includes("smallcap") ? decoys : q.includes("small cap") ? [real] : []).map((s) => ({ schemeCode: s.code, schemeName: s.name })),
    series: async (c) => [real, ...decoys].find((s) => s.code === c)!,
  };
  it("tries the other spelling instead of stopping at three hits", async () => {
    const r = await resolveScheme({ name: "Axis Small Cap Fund Direct Growth", advisor: "DIRECT", anchors: [{ date: "2024-02-01", nav: 88 }] }, api);
    expect(r?.series.code).toBe(10);
  });
});

import { ndjson, planSync, serializeHoldings, settle } from "./helper";

describe("holdings sync planning", () => {
  const doc = (code: number, fetched: string, w = 5): FundHoldings => ({ ...fund(code, [["hdfc", w]]), fetched });
  const existing = new Map([[1, doc(1, "2026-09-25")], [2, doc(2, "2026-08-01")]]);
  const targets = [{ code: 1, name: "A" }, { code: 2, name: "B" }, { code: 3, name: "C" }, { code: 1, name: "A again" }];

  it("skips recently fetched files and de-duplicates shared codes", () => {
    expect(planSync(targets, existing, "2026-10-01")).toEqual({ fetch: [{ code: 2, name: "B" }, { code: 3, name: "C" }], fresh: [1] });
    expect(planSync(targets, existing, "2026-10-01", true).fetch.map((t) => t.code)).toEqual([1, 2, 3]);
  });
  it("only writes what actually changed, and reports failures", () => {
    const out = settle(
      [
        { code: 1, doc: doc(1, "2026-10-01") }, // same portfolio, newer date: not a change
        { code: 2, doc: doc(2, "2026-10-01", 6) }, // weight moved
        { code: 3, doc: doc(3, "2026-10-01") }, // new
        { code: 4, error: "LookupError: no page" },
      ],
      existing,
    );
    expect(out.unchanged).toEqual([1]);
    expect(out.changed.map((d) => d.code)).toEqual([2, 3]);
    expect(out.failed).toEqual({ 4: "LookupError: no page" });
  });
  it("writes the same bytes the Python CLI does", () => {
    expect(serializeHoldings(doc(1, "2026-10-01"))).toBe(JSON.stringify(doc(1, "2026-10-01"), null, 1) + "\n");
  });
});

describe("ndjson", () => {
  const stream = (chunks: string[]) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const x of chunks) c.enqueue(new TextEncoder().encode(x));
        c.close();
      },
    });
  it("reassembles lines split across chunks, including multibyte text", async () => {
    const out: unknown[] = [];
    for await (const v of ndjson(stream(['{"a":1}\n{"b"', ':"₹ré"}\n', '{"c":3}']))) out.push(v);
    expect(out).toEqual([{ a: 1 }, { b: "₹ré" }, { c: 3 }]);
  });
});

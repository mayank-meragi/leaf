import { describe, expect, it } from "vitest";
import type { Goal, MFTransaction, MFTxnType } from "@/types";
import type { SchemeGroup } from "./capitalGains";
import { futureValue, monthsUntil, projectGoal, requiredMonthly } from "./goals";
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
    expect(queryVariants("HDFC Mid-Cap Opportunities Fund - Direct Plan - Growth Option")[0]).toBe("hdfc mid cap opportunities fund");
    expect(queryVariants("UTI Nifty 50 Index Fund - Direct Plan - Growth").at(-1)!.split(" ").length).toBeGreaterThanOrEqual(3);
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
    const plans = [{ scheme: "A", amount: 5000, cadence: "Monthly", active: true }, { scheme: "B", amount: 9999, cadence: "Monthly", active: true }] as never;
    const p = projectGoal(goal, [scheme("A", "Equity", 40_000)], plans, "2026-10-01");
    expect(p).toMatchObject({ current: 40_000, monthly: 5000, fromSips: true, months: 12, projected: 100_000, onTrack: true, missing: ["Gone"] });
    expect(projectGoal({ ...goal, monthly: 1000 }, [scheme("A", "Equity", 40_000)], plans, "2026-10-01")).toMatchObject({ monthly: 1000, fromSips: false, onTrack: false });
  });
});

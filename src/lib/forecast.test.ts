import { describe, expect, it } from "vitest";
import type { Transaction } from "@/types";
import { EMPTY_CONFIG, type LeafData } from "./db";
import { BUCKETS, baselineFrom, defaultAssumptions, describeLevers, goalOdds, impacts, newEvent, NO_LEVERS, randomGrowth, rng, sameLevers, simulate, withDefaults, project, type Assumptions, type Baseline, type Bucket, type Levers } from "./forecast";

const zero = () => Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>;
const base = (over: Partial<Baseline> = {}): Baseline => ({ start: zero(), liabilities: 0, income: 0, expenses: 0, emi: 0, sip: 0, epf: 0, nps: 0, notes: [], ...over });
const flat = (over: Partial<Assumptions> = {}): Assumptions => ({
  age: 30,
  retireAge: 31,
  returns: zero(),
  incomeGrowth: 0,
  inflation: 0,
  ...over,
});
const TODAY = "2026-06-15";

describe("project", () => {
  it("leaves net worth alone when nothing grows or flows", () => {
    const f = project(base({ start: { ...zero(), equity: 500_000 }, liabilities: 100_000 }), flat(), NO_LEVERS, TODAY);
    expect(f.atRetirement.netWorth).toBe(400_000);
    expect(f.points).toHaveLength(13);
  });

  it("compounds a bucket at its annual rate", () => {
    const f = project(base({ start: { ...zero(), equity: 100_000 } }), flat({ returns: { ...zero(), equity: 0.12 } }), NO_LEVERS, TODAY);
    expect(f.atRetirement.buckets.equity).toBeCloseTo(112_000, 0);
  });

  it("moves a SIP from cash to equity without changing net worth at zero return", () => {
    const f = project(base({ income: 100_000, expenses: 50_000, sip: 10_000 }), flat(), NO_LEVERS, TODAY);
    expect(f.atRetirement.buckets.equity).toBe(120_000);
    expect(f.atRetirement.buckets.cash).toBe(12 * 40_000);
  });

  it("keeps EPF contributions out of the bank account", () => {
    const f = project(base({ income: 80_000, expenses: 50_000, epf: 10_000 }), flat(), NO_LEVERS, TODAY);
    expect(f.atRetirement.buckets.epf).toBe(120_000);
    expect(f.atRetirement.buckets.cash).toBe(12 * 30_000);
  });

  it("pays loans down by the EMI, no further than the balance", () => {
    const f = project(base({ liabilities: 25_000, emi: 10_000 }), flat(), NO_LEVERS, TODAY);
    expect(f.atRetirement.liabilities).toBe(0);
  });

  it("grows income and spending year by year", () => {
    const a = flat({ retireAge: 32, incomeGrowth: 0.1, inflation: 0.1 });
    const f = project(base({ income: 100_000, expenses: 60_000 }), a, NO_LEVERS, TODAY);
    expect(f.atRetirement.buckets.cash).toBeCloseTo(12 * 40_000 + 12 * 44_000, 0);
  });

  it("shows today's rupees below the nominal figure when there is inflation", () => {
    const f = project(base({ start: { ...zero(), cash: 1_000_000 } }), flat({ retireAge: 40, inflation: 0.06 }), NO_LEVERS, TODAY);
    expect(f.atRetirement.real).toBeCloseTo(1_000_000 / 1.06 ** 10, 0);
    expect(f.points[0].real).toBe(f.points[0].netWorth);
  });

  it("applies the levers", () => {
    const b = base({ income: 100_000, expenses: 60_000, sip: 10_000 });
    const a = flat({ retireAge: 40, returns: { ...zero(), equity: 0.12 } });
    const plain = project(b, a, NO_LEVERS, TODAY).atRetirement.netWorth;
    expect(project(b, a, { ...NO_LEVERS, sipDelta: 5_000 }, TODAY).atRetirement.netWorth).toBeGreaterThan(plain);
    expect(project(b, a, { ...NO_LEVERS, expenseCut: 0.1 }, TODAY).atRetirement.netWorth).toBeGreaterThan(plain);
    expect(project(b, a, { ...NO_LEVERS, sipStepUp: 0.1 }, TODAY).atRetirement.netWorth).toBeGreaterThan(plain);
    expect(project(b, a, { ...NO_LEVERS, surplusToEquity: 1 }, TODAY).atRetirement.netWorth).toBeGreaterThan(plain);
    expect(project(b, a, { ...NO_LEVERS, sipDelta: -999_999 }, TODAY).atRetirement.buckets.equity).toBe(0);
  });

  it("applies a one-off in its month and flags when cash runs out", () => {
    const f = project(base({ start: { ...zero(), cash: 100_000 } }), flat({ retireAge: 35 }), { ...NO_LEVERS, oneOffs: [{ inYears: 2, amount: -150_000 }] }, TODAY);
    expect(f.atRetirement.buckets.cash).toBe(-50_000);
    expect(f.cashRunsOutOn).toBe("2028-07");
    expect(project(base(), flat(), NO_LEVERS, TODAY).cashRunsOutOn).toBeUndefined();
  });

  it("reports what the corpus sustains at a 4% withdrawal", () => {
    const f = project(base({ start: { ...zero(), cash: 12_000_000 } }), flat(), NO_LEVERS, TODAY);
    expect(f.sustainableMonthly).toBe(40_000);
  });
});

const empty: LeafData = {
  config: EMPTY_CONFIG,
  transactions: [],
  statements: [],
  cardStatements: [],
  cardPayments: [],
  wealthAccounts: [],
  wealthSnapshots: [],
  wealthFlows: [],
  payslips: [],
  taxDocs: [],
  policies: [],
  stockStatements: [],
};
const txn = (id: string, date: string, amount: number, category: string, direction: "debit" | "credit" = "debit"): Transaction => ({
  id,
  date,
  amount,
  currency: "INR",
  direction,
  description: id,
  category,
  source: { account: "a", messageId: id, parser: "gemini@2" },
});

describe("baselineFrom", () => {
  it("takes spending from the median of recent full months and leaves out transfers, investing and EMIs", () => {
    const txns = ["2026-03", "2026-04", "2026-05"].flatMap((m, i) => [
      txn(`f${i}`, `${m}-05`, 20_000 + i * 1000, "Food & Dining"),
      txn(`t${i}`, `${m}-06`, 90_000, "Transfers"),
      txn(`i${i}`, `${m}-07`, 10_000, "Investments"),
      txn(`e${i}`, `${m}-08`, 15_000, "EMI & Loans"),
    ]);
    // The current month is partial and ignored.
    txns.push(txn("now", "2026-06-02", 999_999, "Shopping"));
    const b = baselineFrom({ ...empty, transactions: txns }, TODAY);
    expect(b.expenses).toBe(21_000);
    expect(b.emi).toBe(15_000);
  });

  it("falls back to nothing, not NaN, with no data, and defaults the assumptions", () => {
    const b = baselineFrom(empty, TODAY);
    expect(b).toMatchObject({ income: 0, expenses: 0, sip: 0, epf: 0, nps: 0, liabilities: 0 });
    const a = defaultAssumptions(b);
    expect(a.returns.equity).toBe(0.11);
    expect(defaultAssumptions({ ...b, equityXirr: 0.4 }).returns.equity).toBe(0.15);
  });

  it("takes income and EPF from payslips", () => {
    const slip = (month: string, net: number) => ({ month, employer: "X", gross: net * 1.3, net, tds: 0, pfEmployee: 5000, pfEmployer: 5000, source: { kind: "upload" as const, fileName: "f" } });
    const b = baselineFrom({ ...empty, payslips: [slip("2026-03", 90_000), slip("2026-04", 100_000), slip("2026-05", 100_000)] }, TODAY);
    expect(b.income).toBe(100_000);
    expect(b.epf).toBe(10_000);
  });
});

describe("describeLevers", () => {
  it("sums up what changes", () => {
    expect(describeLevers(NO_LEVERS)).toBe("No changes");
    expect(describeLevers({ ...NO_LEVERS, sipDelta: 5000, expenseCut: 0.1, oneOffs: [{ inYears: 5, amount: -1_000_000 }] })).toBe("SIPs +₹5,000/mo, spending −10%, −₹10,00,000 in 5y");
    expect(describeLevers({ ...NO_LEVERS, sipDelta: -2000, sipStepUp: 0.1, surplusToEquity: 0.5 })).toBe("SIPs −₹2,000/mo, SIPs up 10% a year, 50% of surplus invested");
  });
  it("tells equal levers apart from different ones", () => {
    expect(sameLevers(NO_LEVERS, { ...NO_LEVERS, oneOffs: [] })).toBe(true);
    expect(sameLevers(NO_LEVERS, { ...NO_LEVERS, sipDelta: 1 })).toBe(false);
  });
});

describe("simulate", () => {
  const b = base({ start: { ...zero(), equity: 1_000_000 }, income: 100_000, expenses: 60_000, sip: 20_000 });
  const a = flat({ retireAge: 50, inflation: 0.05, returns: { ...zero(), equity: 0.11 } });

  it("draws the same range for the same inputs", () => {
    expect(simulate(b, a, NO_LEVERS, TODAY, { runs: 200 }).final).toEqual(simulate(b, a, NO_LEVERS, TODAY, { runs: 200 }).final);
  });

  it("collapses onto the forecast when there are no swings", () => {
    const sim = simulate(b, a, NO_LEVERS, TODAY, { runs: 50, equityVol: 0 });
    const f = project(b, a, NO_LEVERS, TODAY);
    expect(sim.final.p10).toBeCloseTo(f.atRetirement.real, 0);
    expect(sim.final.p90).toBeCloseTo(f.atRetirement.real, 0);
    expect(sim.bands.at(-1)!.date).toBe(f.atRetirement.date);
    expect(sim.chanceAtLeast(f.atRetirement.real - 1)).toBe(1);
    expect(sim.chanceAtLeast(f.atRetirement.real + 1)).toBe(0);
  });

  it("widens with the swings and keeps the average on the assumed return", () => {
    const sim = simulate(b, a, NO_LEVERS, TODAY, { runs: 1500 });
    const f = project(b, a, NO_LEVERS, TODAY).atRetirement.real;
    expect(sim.final.p10).toBeLessThan(sim.final.p50);
    expect(sim.final.p50).toBeLessThan(sim.final.p90);
    // Lopsided: the median sits below the straight-line figure, which is nearer the mean.
    expect(sim.final.p50).toBeLessThan(f);
    expect(sim.final.p90).toBeGreaterThan(f);
    expect(simulate(b, a, NO_LEVERS, TODAY, { runs: 600, equityVol: 0.3 }).final.p10).toBeLessThan(sim.final.p10);
  });

  it("gives falling odds as the target rises, and counts runs where cash runs out", () => {
    const sim = simulate(b, a, NO_LEVERS, TODAY, { runs: 500 });
    expect(sim.chanceAtLeast(-1e12)).toBe(1);
    expect(sim.chanceAtLeast(sim.final.p10)).toBeGreaterThan(sim.chanceAtLeast(sim.final.p90));
    // Pay keeps up with prices here, so the bank balance stays positive.
    expect(simulate(b, { ...a, incomeGrowth: 0.05 }, NO_LEVERS, TODAY, { runs: 200 }).cashOutChance).toBe(0);
    const broke = simulate(base({ expenses: 10_000 }), flat({ retireAge: 35 }), NO_LEVERS, TODAY, { runs: 20 });
    expect(broke.cashOutChance).toBe(1);
  });
});

describe("rng and growth", () => {
  it("makes roughly standard normal draws", () => {
    const n = rng(7);
    const xs = Array.from({ length: 20_000 }, n);
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(sd).toBeGreaterThan(0.97);
    expect(sd).toBeLessThan(1.03);
  });
  it("grows at the assumed rate when there is no volatility", () => {
    expect(randomGrowth(0.12, 0, 1.7)).toBeCloseTo(1.12 ** (1 / 12) - 1, 10);
  });
});

describe("goalOdds", () => {
  const g = { current: 100_000, monthly: 10_000, months: 60, annualReturn: 0.1, target: 0 };
  it("is certain at the ends and falls as the target rises", () => {
    expect(goalOdds({ ...g, target: 0 })).toBe(1);
    expect(goalOdds({ ...g, target: 1e12 })).toBe(0);
    const lo = goalOdds({ ...g, target: 700_000 });
    const hi = goalOdds({ ...g, target: 1_100_000 });
    expect(lo).toBeGreaterThan(0.8);
    expect(hi).toBeLessThan(0.5);
  });
  it("matches the straight-line answer without swings", () => {
    expect(goalOdds({ ...g, target: 800_000 }, 0)).toBe(1);
    expect(goalOdds({ ...g, target: 1_000_000 }, 0)).toBe(0);
  });
  it("handles a target date that has passed", () => {
    expect(goalOdds({ ...g, months: 0, target: 90_000 })).toBe(1);
    expect(goalOdds({ ...g, months: 0, target: 110_000 })).toBe(0);
  });
});

describe("life events", () => {
  const ev = (...events: Levers["events"]) => ({ ...NO_LEVERS, events });
  it("buying a house turns cash into property and a loan, repaid over its term", () => {
    const house = { kind: "house" as const, inYears: 1, price: 1_000_000, downPct: 0.2, rate: 0, years: 5 };
    const f = project(base(), flat({ retireAge: 36 }), ev(house), TODAY);
    const atBuy = f.points[13];
    expect(atBuy.buckets.property).toBe(1_000_000);
    expect(atBuy.liabilities).toBeGreaterThan(0);
    expect(f.atRetirement.buckets.property).toBe(1_000_000);
    expect(f.atRetirement.liabilities).toBeCloseTo(0, 6);
    // With no interest and no growth, it costs exactly the price, which is now an asset: net worth is unchanged.
    expect(f.atRetirement.netWorth).toBeCloseTo(0, 6);
  });
  it("charges interest on the loan", () => {
    const house = { kind: "house" as const, inYears: 0, price: 1_000_000, downPct: 0, rate: 0.1, years: 10 };
    const f = project(base(), flat({ retireAge: 40 }), ev(house), TODAY);
    expect(f.atRetirement.liabilities).toBeCloseTo(0, 3);
    // Interest paid over a 10% 10-year loan is about 59% of the amount borrowed.
    expect(f.atRetirement.netWorth).toBeLessThan(-500_000);
    expect(f.atRetirement.netWorth).toBeGreaterThan(-700_000);
  });
  it("keeps your existing EMIs from paying off the new loan", () => {
    const house = { kind: "house" as const, inYears: 0, price: 1_000_000, downPct: 0, rate: 0, years: 10 };
    const f = project(base({ emi: 100_000 }), flat({ retireAge: 31 }), ev(house), TODAY);
    expect(f.atRetirement.liabilities).toBeCloseTo(1_000_000 - 12 * (1_000_000 / 120), 3);
  });
  it("a child adds spending for its years, growing with prices", () => {
    const f = project(base({ income: 100_000 }), flat({ retireAge: 32, inflation: 0.1 }), ev({ kind: "child", inYears: 1, monthly: 10_000, years: 1 }), TODAY);
    expect(f.atRetirement.buckets.cash).toBeCloseTo(24 * 100_000 - 12 * 10_000 * 1.1, 4);
  });
  it("a career break stops pay and EPF for its months only", () => {
    const f = project(base({ income: 100_000, epf: 10_000 }), flat({ retireAge: 32 }), ev({ kind: "break", inYears: 0.5, months: 6 }), TODAY);
    expect(f.atRetirement.buckets.cash).toBe(18 * 100_000);
    expect(f.atRetirement.buckets.epf).toBe(18 * 10_000);
  });
  it("a raise lifts pay from its month", () => {
    const f = project(base({ income: 100_000 }), flat({ retireAge: 32 }), ev({ kind: "raise", inYears: 1, pct: 0.5 }), TODAY);
    expect(f.atRetirement.buckets.cash).toBe(12 * 100_000 + 12 * 150_000);
  });
  it("fills in levers saved before events existed", () => {
    const old = { sipDelta: 100, sipStepUp: 0, expenseCut: 0, surplusToEquity: 0, oneOffs: [] };
    expect(withDefaults(old).events).toEqual([]);
    expect(sameLevers(old, { ...old, events: [] })).toBe(true);
    expect(project(base({ income: 1 }), flat(), old as unknown as Levers, TODAY).atRetirement.netWorth).toBe(12);
    expect(describeLevers({ ...NO_LEVERS, events: [newEvent("house"), newEvent("break")] })).toBe("house ₹1,00,00,000 in 3y, 6-month break in 2y");
  });
});

describe("impacts", () => {
  const b = base({ start: { ...zero(), equity: 500_000 }, income: 150_000, expenses: 70_000, sip: 20_000 });
  const a = flat({ retireAge: 50, inflation: 0.06, incomeGrowth: 0.05, returns: { ...zero(), equity: 0.11 } });
  const rows = impacts(b, a, NO_LEVERS, TODAY);

  it("ranks changes by size and signs them right", () => {
    for (let i = 1; i < rows.length; i++) expect(Math.abs(rows[i - 1].delta)).toBeGreaterThanOrEqual(Math.abs(rows[i].delta));
    const by = (label: string) => rows.find((r) => r.label === label)!;
    expect(by("Invest ₹5,000 more a month").delta).toBeGreaterThan(0);
    expect(by("Retire 2 years later").delta).toBeGreaterThan(0);
    expect(by("Retire 2 years earlier").delta).toBeLessThan(0);
    expect(by("Equity returns 1 point lower").delta).toBeLessThan(0);
    expect(by("Inflation 1 point higher").delta).toBeLessThan(0);
  });
  it("offers levers you can apply for your own choices, not for the world", () => {
    expect(rows.find((r) => r.label === "Invest ₹5,000 more a month")!.levers!.sipDelta).toBe(5000);
    expect(rows.find((r) => r.label === "Retire 2 years later")!.levers).toBeUndefined();
  });
  it("leaves out changes already made", () => {
    const labels = impacts(b, a, { ...NO_LEVERS, surplusToEquity: 1 }, TODAY).map((r) => r.label);
    expect(labels).not.toContain("Invest half of what's left over");
  });
});

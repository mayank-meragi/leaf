import { describe, expect, it } from "vitest";
import type { Transaction, WealthAccount, WealthSnapshot } from "@/types";
import { EMPTY_CONFIG, type LeafData } from "./db";
import { netWorthHistory } from "./networthHistory";

const data = (over: Partial<LeafData>): LeafData =>
  ({ config: EMPTY_CONFIG, transactions: [], statements: [], cardStatements: [], cardPayments: [], wealthAccounts: [], wealthSnapshots: [], wealthFlows: [], payslips: [], taxDocs: [], policies: [], stockStatements: [], ...over }) as LeafData;

const src = { kind: "manual" } as const;
const epf: WealthAccount = { id: "epf1", kind: "epf", name: "EPF" };
const loan: WealthAccount = { id: "loan1", kind: "loan", name: "Loan" };
const snap = (account: string, date: string, value: number): WealthSnapshot => ({ account, date, value, source: src });
const txn = (date: string, balanceAfter: number): Transaction => ({
  id: date, date, amount: 1, currency: "INR", direction: "debit", description: "x", instrument: "HDFC A/c ••1234", balanceAfter,
  source: { account: "a", messageId: date, parser: "gemini@2" },
});

describe("netWorthHistory", () => {
  it("steps wealth accounts at each snapshot and subtracts liabilities", () => {
    const h = netWorthHistory(
      data({ wealthAccounts: [epf, loan], wealthSnapshots: [snap("epf1", "2026-05-31", 100_000), snap("epf1", "2026-08-31", 120_000), snap("loan1", "2026-06-30", 40_000)] }),
      null,
      "2026-10-02",
    );
    const byDate = Object.fromEntries(h.points.map((p) => [p.date, p.netWorth]));
    expect(byDate["2026-05-31"]).toBe(100_000);
    expect(byDate["2026-06-30"]).toBe(60_000);
    expect(byDate["2026-07-31"]).toBe(60_000);
    expect(byDate["2026-08-31"]).toBe(80_000);
    expect(h.points.at(-1)).toMatchObject({ date: "2026-10-02", netWorth: 80_000 });
    expect(h.trackedFrom).toMatchObject({ EPF: "2026-05-31", Loan: "2026-06-30" });
  });

  it("carries a bank balance forward from the last stated one", () => {
    const h = netWorthHistory(data({ transactions: [txn("2026-07-10", 50_000), txn("2026-09-05", 70_000)] }), null, "2026-10-02");
    const bank = (d: string) => h.points.find((p) => p.date === d)?.assets["Bank accounts"];
    expect(bank("2026-07-31")).toBe(50_000);
    expect(bank("2026-08-31")).toBe(50_000);
    expect(bank("2026-09-30")).toBe(70_000);
  });

  it("adds mutual fund values by month, and ends at today's net worth", () => {
    const mf = [{ date: "2026-08-31", value: 1000, invested: 900 }, { date: "2026-09-30", value: 1200, invested: 900 }, { date: "2026-10-02", value: 1300, invested: 900 }];
    const h = netWorthHistory(data({ wealthAccounts: [epf], wealthSnapshots: [snap("epf1", "2026-08-01", 500)] }), mf, "2026-10-02");
    expect(h.points.slice(0, 2).map((p) => p.assets["Mutual funds"])).toEqual([1000, 1200]);
    expect(h.points.map((p) => p.date)).toEqual(["2026-08-31", "2026-09-30", "2026-10-02"]);
    expect(h.points.find((p) => p.date === "2026-09-30")!.netWorth).toBe(1700);
  });

  it("is empty with no data", () => {
    expect(netWorthHistory(data({}), null, "2026-10-02")).toEqual({ points: [], trackedFrom: {} });
  });
});

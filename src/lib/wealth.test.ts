import { describe, expect, it } from "vitest";
import type { WealthAccount, WealthFlow, WealthSnapshot } from "@/types";
import { accountValue, financialYear, matchAccount, netWorth, wealthLines } from "./wealth";

const manual = { kind: "manual" } as const;
const snap = (account: string, date: string, value: number): WealthSnapshot => ({ account, date, value, source: manual });
const flow = (account: string, date: string, amount: number, kind: WealthFlow["kind"] = "contribution"): WealthFlow => ({ account, date, amount, kind, source: manual });

describe("accountValue", () => {
  it("adds contributions after the latest snapshot only", () => {
    const v = accountValue("nps", [snap("nps", "2026-08-31", 100000), snap("nps", "2026-07-31", 90000)], [flow("nps", "2026-08-15", 2000), flow("nps", "2026-09-01", 2500)], "2026-10-01");
    expect(v).toEqual({ value: 102500, asOf: "2026-08-31", flowsSince: 2500, stale: false });
  });
  it("falls back to flows alone and flags stale values", () => {
    expect(accountValue("nps", [], [flow("nps", "2026-09-01", 2000), flow("nps", "2026-09-05", 500, "withdrawal")], "2026-10-01")).toMatchObject({ value: 1500, asOf: "2026-09-05" });
    expect(accountValue("epf", [snap("epf", "2026-03-31", 500000)], [], "2026-10-01").stale).toBe(true);
    expect(accountValue("none", [], [], "2026-10-01")).toMatchObject({ value: 0, stale: true });
  });
});

describe("netWorth", () => {
  const accounts: WealthAccount[] = [
    { id: "epf", kind: "epf", name: "EPF", institution: "EPFO", ref: "UAN ••4321" },
    { id: "loan", kind: "loan", name: "Home loan", institution: "HDFC Bank" },
  ];
  it("subtracts liabilities and drops empty lines", () => {
    const lines = wealthLines(accounts, [snap("epf", "2026-09-30", 500000), snap("loan", "2026-09-30", 200000)], [], "2026-10-01");
    const nw = netWorth({ assets: [...lines.assets, { key: "mf", label: "Mutual funds", group: "Mutual funds", value: 1000000 }, { key: "x", label: "Empty", group: "Other", value: 0 }], liabilities: lines.liabilities });
    expect(nw.total).toBe(1300000);
    expect(nw.assets.map((a) => a.key)).toEqual(["mf", "epf"]);
    expect(nw.liabilities.map((a) => a.key)).toEqual(["loan"]);
  });

  it("matches documents to accounts by reference, then institution", () => {
    expect(matchAccount(accounts, "epf", undefined, "XXXXXXXX4321")?.id).toBe("epf");
    expect(matchAccount(accounts, "loan", "HDFC")?.id).toBe("loan");
    expect(matchAccount(accounts, "epf", undefined, "9999")).toBeUndefined();
    expect(matchAccount(accounts, "ppf", "SBI")).toBeUndefined();
  });
});

it("financialYear", () => {
  expect(financialYear("2026-05-10")).toBe("2026-27");
  expect(financialYear("2026-03-31")).toBe("2025-26");
});

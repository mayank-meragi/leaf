import { describe, expect, it } from "vitest";
import type { CASStatement, MFTransaction, MFTxnType } from "@/types";
import { capitalGains } from "./capitalGains";
import { pnl } from "./pnl";
import { sips } from "./sips";

const tx = (type: MFTxnType, date: string, amount: number, units = amount / 10): MFTransaction => ({
  date,
  description: type,
  amount,
  units: type === "REVERSAL" || type === "REDEMPTION" ? -Math.abs(units) : units,
  nav: 10,
  balance: null,
  type,
});

const stmt = (to: string, schemes: Record<string, MFTransaction[]>, close = 0): CASStatement => ({
  statementPeriod: { from: "2024-01-01", to },
  investor: { pan: "ABCDE1234F" },
  folios: Object.entries(schemes).map(([name, txns], i) => ({
    folio: String(i),
    amc: "Test MF",
    schemes: [{ name, open: 0, close: close || txns.reduce((s, t) => s + (t.units ?? 0), 0), transactions: txns }],
  })),
  source: { kind: "upload", fileName: "t.pdf" },
  parsedAt: "",
});

const sip = (date: string, amount = 1000) => tx("PURCHASE_SIP", date, amount);

describe("sips", () => {
  it("finds an active monthly SIP with its step-up and next date", () => {
    const s = sips([stmt("2025-06-15", { "Alpha Flexi Cap Fund": [sip("2025-01-05"), sip("2025-02-05"), sip("2025-03-05", 1500), sip("2025-04-05", 1500), sip("2025-05-05", 1500), sip("2025-06-05", 1500)] })]);
    expect(s.plans).toHaveLength(1);
    expect(s.plans[0]).toMatchObject({ cadence: "Monthly", day: 5, count: 6, invested: 8000, amount: 1500, active: true, next: "2025-07-05", missed: [] });
    expect(s.plans[0].stepUps).toEqual([{ date: "2025-03-05", from: 1000, to: 1500 }]);
    expect(s.monthlyOutflow).toBe(1500);
  });

  it("reports skipped months and treats a long silence as stopped", () => {
    const s = sips([stmt("2025-12-31", { "Beta Mid Cap Fund": [sip("2025-01-05"), sip("2025-02-05"), sip("2025-04-05"), sip("2025-05-05")] })]);
    expect(s.plans[0]).toMatchObject({ missed: ["2025-03"], active: false });
    expect(s.monthlyOutflow).toBe(0);
  });

  it("reports a bounced instalment instead of counting it", () => {
    const s = sips([
      stmt("2025-04-20", {
        "Gamma Small Cap Fund": [sip("2025-01-05"), sip("2025-02-05"), tx("REVERSAL", "2025-02-07", -1000), sip("2025-03-05"), sip("2025-04-05")],
      }),
    ]);
    expect(s.plans[0].count).toBe(3);
    expect(s.plans[0].bounced).toEqual([{ date: "2025-02-05", amount: 1000 }]);
    expect(s.plans[0].missed).toEqual([]);
  });

  it("ignores one-off purchases", () => {
    expect(sips([stmt("2025-04-20", { "Delta Fund": [tx("PURCHASE", "2025-01-05", 5000), sip("2025-02-05")] })]).plans).toEqual([]);
  });
});

describe("pnl", () => {
  it("sums realised gains and dividends, including for exited schemes", () => {
    const st = stmt("2025-12-31", {
      "Zeta Flexi Cap Fund": [tx("PURCHASE", "2024-01-05", 1000), tx("REDEMPTION", "2025-02-05", -1500, 100)],
      "Eta Mid Cap Fund": [tx("PURCHASE", "2024-01-05", 1000), { ...tx("DIVIDEND_PAYOUT", "2025-01-01", 40), units: null }],
    });
    const p = pnl([st], capitalGains([st]));
    expect(p.realised).toBe(500);
    expect(p.dividends).toBe(40);
  });
});

import { describe, expect, it } from "vitest";
import type { CASStatement, MFTransaction } from "@/types";
import { dividendSummary, financialYear } from "./dividends";
import { rebalance } from "./rebalance";
import { summarize } from "./portfolio";

const txn = (date: string, type: MFTransaction["type"], amount: number): MFTransaction => ({ date, description: "", amount, units: null, nav: null, balance: null, type });

const statement = (txns: MFTransaction[]): CASStatement =>
  ({
    source: "cams",
    investor: { name: "T", pan: "AAAAA0000A" },
    statementPeriod: { from: "2024-01-01", to: "2026-09-30" },
    folios: [{ folio: "1", amc: "AMC", schemes: [{ name: "Alpha Fund - IDCW", open: 0, close: 10, valuation: { date: "2026-09-30", nav: 10, value: 100 }, transactions: txns }] }],
  }) as unknown as CASStatement;

describe("financialYear", () => {
  it("rolls over in April", () => {
    expect(financialYear("2026-03-31")).toBe("FY 2025-26");
    expect(financialYear("2026-04-01")).toBe("FY 2026-27");
    expect(financialYear("2099-12-01")).toBe("FY 2099-00");
  });
});

describe("dividendSummary", () => {
  const s = dividendSummary([statement([txn("2025-03-10", "DIVIDEND_PAYOUT", 50), txn("2025-06-10", "DIVIDEND_REINVEST", 30), txn("2026-02-10", "DIVIDEND_PAYOUT", 20), txn("2026-02-11", "PURCHASE", 999)])]);

  it("splits payout from reinvested and ignores other transactions", () => {
    expect(s.total).toBe(100);
    expect(s.payout).toBe(70);
    expect(s.reinvested).toBe(30);
  });

  it("groups by financial year, newest first", () => {
    expect(s.byYear.map((y) => [y.fy, y.total])).toEqual([["FY 2025-26", 50], ["FY 2024-25", 50]]);
  });

  it("groups by scheme", () => {
    expect(s.byScheme).toEqual([{ scheme: "Alpha Fund - IDCW", total: 100, count: 3, last: "2026-02-10" }]);
  });
});

describe("rebalance with extra holdings", () => {
  it("counts directly held stocks towards equity", () => {
    const schemes = summarize([statement([])]).schemes;
    const mfOnly = rebalance(schemes, { Equity: 50, Debt: 50 });
    const withStocks = rebalance(schemes, { Equity: 50, Debt: 50 }, 0, { Equity: 100 });
    const eq = (rows: typeof mfOnly) => rows.find((r) => r.cls === "Equity")!;
    expect(eq(withStocks).value).toBe(eq(mfOnly).value + 100);
    expect(withStocks.reduce((a, r) => a + r.share, 0)).toBeCloseTo(1);
  });
});

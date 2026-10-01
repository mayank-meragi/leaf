import { describe, expect, it } from "vitest";
import type { CASStatement, MFTransaction } from "@/types";
import { capitalGains, summarizeFY, gainYears } from "./capitalGains";
import { pnl } from "./pnl";
import { flowOf, summarize } from "./portfolio";
import { rebalance } from "./rebalance";
import type { SchemeSummary } from "./portfolio";
import { xirr } from "./xirr";

// Deterministic PRNG so a failure is reproducible.
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** A random but self-consistent history: every redemption is covered by units held, NAVs wander. */
function history(seed: number, name: string) {
  const r = rng(seed);
  const txns: MFTransaction[] = [];
  let units = 0;
  let nav = 20 + r() * 80;
  let day = Date.parse("2019-04-01");
  for (let i = 0; i < 60; i++) {
    day += (5 + Math.floor(r() * 45)) * 86_400_000;
    nav *= 1 + (r() - 0.45) * 0.08;
    const date = new Date(day).toISOString().slice(0, 10);
    const roll = r();
    if (roll < 0.62 || units < 1) {
      const amount = Math.round(1000 + r() * 20000);
      const u = Math.round((amount / nav) * 1000) / 1000;
      txns.push({ date, description: "", amount, units: u, nav, balance: null, type: roll < 0.3 ? "PURCHASE_SIP" : "PURCHASE" });
      units += u;
    } else if (roll < 0.92) {
      const u = Math.round(units * (0.1 + r() * 0.8) * 1000) / 1000;
      txns.push({ date, description: "", amount: -Math.round(u * nav * 100) / 100, units: -u, nav, balance: null, type: r() < 0.2 ? "SWITCH_OUT" : "REDEMPTION" });
      units -= u;
    } else {
      txns.push({ date, description: "", amount: Math.round(r() * 500), units: null, nav: null, balance: null, type: "DIVIDEND_PAYOUT" });
    }
  }
  const close = Math.round(units * 1000) / 1000;
  const value = Math.round(close * nav * 100) / 100;
  const stmt: CASStatement = {
    statementPeriod: { from: "2019-01-01", to: "2026-09-30" },
    investor: { pan: "ABCDE1234F" },
    folios: [{ folio: "1", amc: "T", schemes: [{ name, open: 0, close, valuation: { date: "2026-09-30", nav, value }, transactions: txns }] }],
    source: { kind: "upload", fileName: "x" },
    parsedAt: "",
  };
  return { stmt, txns, close, value };
}

describe("accounting identities hold for any history", () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    for (const name of ["Alpha Flexi Cap Fund", "Beta Liquid Fund"]) {
      it(`seed ${seed}, ${name}`, () => {
        const { stmt, txns, close, value } = history(seed, name);
        const cg = capitalGains([stmt]);
        const p = pnl([stmt], cg);

        // Every unit sold is matched to a lot; none left over, none invented.
        const sold = txns.filter((t) => t.type === "REDEMPTION" || t.type === "SWITCH_OUT").reduce((s, t) => s + Math.abs(t.units!), 0);
        expect(cg.unmatched).toEqual([]);
        expect(cg.lots.reduce((s, l) => s + l.units, 0)).toBeCloseTo(sold, 4);
        expect(cg.open.reduce((s, l) => s + l.units, 0)).toBeCloseTo(close, 4);

        // Profit three ways: realised + unrealised + dividends equals value plus net cashflow.
        const openCost = cg.open.reduce((s, l) => s + l.cost, 0);
        const profit = p.realised + (value - openCost) + p.dividends;
        const cashflow = value + txns.reduce((s, t) => s + flowOf(t), 0);
        expect(profit).toBeCloseTo(cashflow, 4);

        // Proceeds less cost is the gain, lot by lot; and the FY summaries add back up.
        for (const l of cg.lots) expect(l.proceeds - l.cost).toBeCloseTo(l.gain, 6);
        const byFy = gainYears(cg).map((y) => summarizeFY(cg, y));
        const bucketed = byFy.reduce((s, x) => s + x.equityShort + x.equityLong + x.otherShort + x.otherLong, 0);
        expect(bucketed).toBeCloseTo(p.realised, 4);
        for (const x of byFy) {
          expect(x.equityTax).toBeGreaterThanOrEqual(0);
          expect(x.equityLongTaxable).toBeGreaterThanOrEqual(0);
        }

        // XIRR really is the rate that zeroes the NPV of the flows.
        const flows = [...txns.map((t) => ({ date: t.date, amount: flowOf(t) })), { date: "2026-09-30", amount: value }];
        const rate = xirr(flows);
        if (rate != null) {
          const t0 = Date.parse(flows[0].date);
          const npv = flows.reduce((s, f) => s + f.amount / (1 + rate) ** ((Date.parse(f.date) - t0) / 86_400_000 / 365), 0);
          expect(Math.abs(npv)).toBeLessThan(1e-3);
        }
        const sum = summarize([stmt]);
        if (close > 0.01) expect(sum.schemes[0].value).toBeCloseTo(value, 2);
      });
    }
  }
});

describe("rebalance conserves money", () => {
  const scheme = (assetClass: SchemeSummary["assetClass"], value: number): SchemeSummary => ({
    name: assetClass, amc: "T", folios: ["1"], assetClass, units: 1, value, cost: value, xirr: null, fullHistory: true, transactions: [], asOf: "",
  });
  it("buys and sells net to zero; new money is fully allocated", () => {
    const r = rng(42);
    for (let i = 0; i < 200; i++) {
      const schemes = (["Equity", "Debt", "Hybrid", "Gold & Silver"] as const).map((c) => scheme(c, Math.round(r() * 1e6)));
      const w = [r(), r(), r(), r()];
      const sum = w.reduce((a, b) => a + b, 0);
      const targets = { Equity: (w[0] / sum) * 100, Debt: (w[1] / sum) * 100, Hybrid: (w[2] / sum) * 100, "Gold & Silver": (w[3] / sum) * 100 };
      const money = Math.round(r() * 5e5);
      const rows = rebalance(schemes, targets, money);
      expect(rows.reduce((s, x) => s + x.toTarget, 0)).toBeCloseTo(0, 4);
      expect(rows.reduce((s, x) => s + x.newMoney, 0)).toBeCloseTo(money, 4);
      for (const x of rows) expect(x.newMoney).toBeGreaterThanOrEqual(0);
    }
  });
});

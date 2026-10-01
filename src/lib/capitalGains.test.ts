import { describe, expect, it } from "vitest";
import type { CASStatement, MFTransaction, MFTxnType } from "@/types";
import { addMonths, capitalGains, summarizeFY, termOf } from "./capitalGains";

const tx = (type: MFTxnType, date: string, amount: number, units: number): MFTransaction => ({
  date,
  description: type,
  amount,
  units,
  nav: Math.abs(amount / units),
  balance: null,
  type,
});

function statement(name: string, open: number, close: number, txns: MFTransaction[]): CASStatement {
  return {
    statementPeriod: { from: "2020-01-01", to: "2026-03-31" },
    investor: { pan: "ABCDE1234F" },
    folios: [{ folio: "1", amc: "Test MF", schemes: [{ name, open, close, transactions: txns }] }],
    source: { kind: "upload", fileName: "t.pdf" },
    parsedAt: "",
  };
}

describe("holding periods", () => {
  it("clamps month ends and needs strictly more than the threshold", () => {
    expect(addMonths("2023-01-31", 1)).toBe("2023-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(termOf("equity", "2023-06-10", "2024-06-10")).toBe("short");
    expect(termOf("equity", "2023-06-10", "2024-06-11")).toBe("long");
  });
  it("uses 36 months for old debt sold before the July 2024 change, 24 after, never for new debt", () => {
    expect(termOf("other", "2021-01-01", "2023-06-01")).toBe("short");
    expect(termOf("other", "2020-01-01", "2024-07-01")).toBe("long");
    expect(termOf("other", "2022-01-01", "2024-08-01")).toBe("long");
    expect(termOf("slab", "2023-04-01", "2030-01-01")).toBe("short");
  });
});

describe("capitalGains", () => {
  it("matches FIFO across lots and splits cost proportionally", () => {
    const cg = capitalGains([
      statement("Alpha Flexi Cap Fund", 0, 5, [
        tx("PURCHASE", "2022-01-10", 1000, 10),
        tx("PURCHASE_SIP", "2023-06-10", 1500, 10),
        tx("REDEMPTION", "2024-09-10", -2500, -15), // 10 from lot 1 (long), 5 from lot 2 (long)
      ]),
    ]);
    expect(cg.lots).toHaveLength(2);
    expect(cg.lots[0]).toMatchObject({ units: 10, cost: 1000, term: "long", regime: "equity", fy: "2024-25" });
    expect(cg.lots[0].proceeds).toBeCloseTo(1666.667, 2);
    expect(cg.lots[1]).toMatchObject({ units: 5, cost: 750, term: "long" });
    expect(cg.lots[0].gain + cg.lots[1].gain).toBeCloseTo(1666.667 + 833.333 - 1750, 2);
    expect(cg.unmatched).toEqual([]);
  });

  it("reports sales of units from before the statement as unmatched, not as gains", () => {
    const cg = capitalGains([statement("Beta Mid Cap Fund", 0, 5, [tx("PURCHASE", "2024-01-01", 100, 5), tx("REDEMPTION", "2024-08-01", -300, -10)])]);
    // 5 held now but transactions net to -5, so 10 units predate the statement: the whole sale comes out of them.
    expect(cg.lots).toEqual([]);
    expect(cg.unmatched).toHaveLength(1);
    expect(cg.unmatched[0]).toMatchObject({ units: 10, proceeds: 300 });
  });

  it("treats a bounced SIP as never bought", () => {
    const cg = capitalGains([
      statement("Gamma Flexi Cap Fund", 0, 0, [
        tx("PURCHASE_SIP", "2024-01-05", 500, 5),
        tx("PURCHASE", "2024-01-06", 1000, 10),
        tx("REVERSAL", "2024-01-07", -500, -5),
        tx("REDEMPTION", "2024-02-01", -1100, -10),
      ]),
    ]);
    expect(cg.lots.reduce((s, l) => s + l.units, 0)).toBeCloseTo(10, 6);
    expect(cg.unmatched).toEqual([]);
  });

  it("treats switch-out as a sale and switch-in as a purchase", () => {
    const cg = capitalGains([
      statement("Delta Small Cap Fund", 0, 0, [tx("PURCHASE", "2024-01-01", 1000, 10), tx("SWITCH_OUT", "2024-03-01", -1200, -10)]),
      ]);
    expect(cg.lots[0]).toMatchObject({ gain: 200, term: "short" });
  });

  it("taxes new debt at slab and never as long term", () => {
    const cg = capitalGains([statement("Epsilon Liquid Fund", 0, 0, [tx("PURCHASE", "2023-05-01", 1000, 10), tx("REDEMPTION", "2026-01-01", -1500, -10)])]);
    expect(cg.lots[0]).toMatchObject({ regime: "slab", term: "short" });
    expect(summarizeFY(cg, "2025-26")).toMatchObject({ otherShort: 500, equityTax: 0 });
  });

  it("applies the LTCG exemption and current rates to an FY summary", () => {
    const cg = capitalGains([
      statement("Zeta Flexi Cap Fund", 0, 0, [
        tx("PURCHASE", "2022-01-01", 500_000, 100),
        tx("REDEMPTION", "2025-06-01", -800_000, -100), // LTCG 3,00,000
        tx("PURCHASE", "2025-01-01", 100_000, 10),
        tx("REDEMPTION", "2025-09-01", -110_000, -10), // STCG 10,000
      ]),
    ]);
    const s = summarizeFY(cg, "2025-26");
    expect(s).toMatchObject({ equityLong: 300_000, equityShort: 10_000, exemption: 125_000, equityLongTaxable: 175_000 });
    expect(s.equityTax).toBeCloseTo(175_000 * 0.125 + 10_000 * 0.2, 2);
  });

  it("lets a short-term loss offset long-term gains", () => {
    const cg = capitalGains([
      statement("Eta Flexi Cap Fund", 0, 0, [
        tx("PURCHASE", "2022-01-01", 500_000, 100),
        tx("REDEMPTION", "2025-06-01", -700_000, -100), // LTCG 2,00,000
        tx("PURCHASE", "2025-01-01", 100_000, 10),
        tx("REDEMPTION", "2025-09-01", -50_000, -10), // STCL 50,000
      ]),
    ]);
    const s = summarizeFY(cg, "2025-26");
    expect(s.equityLongTaxable).toBe(25_000); // 200k - 50k - 125k
    expect(s.equityTax).toBeCloseTo(25_000 * 0.125, 2);
  });

  it("flags pre-2018 equity units for grandfathering", () => {
    const cg = capitalGains([statement("Theta Large Cap Fund", 0, 0, [tx("PURCHASE", "2016-01-01", 1000, 10), tx("REDEMPTION", "2025-01-01", -5000, -10)])]);
    expect(cg.lots[0].grandfathering).toBe(true);
    expect(summarizeFY(cg, "2024-25").grandfatheringLots).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import type { CASStatement, MFTransaction } from "@/types";
import { assetClassOf, breakdown, equityStyleOf, latestStatements, summarize } from "./portfolio";
import { xirr } from "./xirr";

describe("xirr", () => {
  it("matches simple annual growth", () => {
    expect(xirr([{ date: "2021-01-01", amount: -1000 }, { date: "2022-01-01", amount: 1100 }])!).toBeCloseTo(0.1, 6);
  });
  it("handles monthly SIPs (reference 0.156552, from scipy brentq)", () => {
    const flows = Array.from({ length: 12 }, (_, i) => ({ date: `2024-${String(i + 1).padStart(2, "0")}-01`, amount: -1000 }));
    flows.push({ date: "2025-01-01", amount: 13000 });
    expect(xirr(flows)!).toBeCloseTo(0.156552, 5);
  });
  it("handles losses and needs both signs", () => {
    expect(xirr([{ date: "2021-01-01", amount: -1000 }, { date: "2022-01-01", amount: 800 }])!).toBeCloseTo(-0.2, 6);
    expect(xirr([{ date: "2021-01-01", amount: -1000 }])).toBeNull();
  });
});

describe("classification", () => {
  it("asset class prefers the source's label, with name fallbacks", () => {
    expect(assetClassOf("ICICI Prudential Commodities Fund", "EQUITY")).toBe("Equity");
    expect(assetClassOf("HDFC Liquid Fund - Direct Growth")).toBe("Debt");
    expect(assetClassOf("ICICI Prudential Equity & Debt Fund Balanced Advantage")).toBe("Hybrid");
    expect(assetClassOf("Nippon India Gold Savings Fund", "OTHER")).toBe("Gold & Silver");
    expect(assetClassOf("Parag Parikh Flexi Cap Fund")).toBe("Equity");
  });
  it("equity style from the scheme name, ignoring former names", () => {
    expect(equityStyleOf("Mirae Asset Large and Midcap Fund (formerly Mirae Asset Emerging Bluechip Fund)")).toBe("Large & Mid Cap");
    expect(equityStyleOf("SBI Small Cap Fund Direct Growth (formerly SBI Small & Midcap Fund)")).toBe("Small Cap");
    expect(equityStyleOf("HDFC Mid Cap Fund - Direct Plan - Growth")).toBe("Mid Cap");
    expect(equityStyleOf("Aditya Birla Sun Life Large Cap Fund -Growth")).toBe("Large Cap");
    expect(equityStyleOf("SBI Contra Fund - Direct Plan - Growth")).toBe("Flexi & Multi Cap");
    expect(equityStyleOf("Aditya Birla Sun Life Digital India Fund")).toBe("Sectoral & Thematic");
    expect(equityStyleOf("UTI Nifty 50 Index Fund")).toBe("Index");
    expect(equityStyleOf("Axis ELSS Tax Saver Fund")).toBe("ELSS");
  });
});

const buy = (date: string, amount: number, units: number): MFTransaction => ({ date, description: "SIP", amount, units, nav: amount / units, balance: null, type: "PURCHASE_SIP" });

function statement(schemes: { name: string; folio: string; open?: number; units: number; value: number; cost: number; txns: MFTransaction[] }[]): CASStatement {
  return {
    statementPeriod: { from: "2021-01-01", to: "2022-01-01" },
    investor: { pan: "ABCDE1234F" },
    folios: schemes.map((s) => ({
      folio: s.folio,
      amc: "Test MF",
      schemes: [{ name: s.name, open: s.open ?? 0, close: s.units, valuation: { date: "2022-01-01", nav: s.value / s.units, value: s.value, cost: s.cost }, transactions: s.txns }],
    })),
    source: { kind: "upload", fileName: "t.pdf" },
    parsedAt: "",
  };
}

describe("summarize", () => {
  it("merges folios of the same scheme and computes XIRR when history is complete", () => {
    const p = summarize([
      statement([
        { name: "Alpha Flexi Cap Fund", folio: "1", units: 10, value: 550, cost: 500, txns: [buy("2021-01-01", 500, 10)] },
        { name: "Alpha Flexi Cap Fund ", folio: "2", units: 10, value: 550, cost: 500, txns: [buy("2021-01-01", 500, 10)] },
      ]),
    ]);
    expect(p.schemes).toHaveLength(1);
    expect(p.schemes[0]).toMatchObject({ folios: ["1", "2"], units: 20, value: 1100, cost: 1000, fullHistory: true, assetClass: "Equity", equityStyle: "Flexi & Multi Cap" });
    expect(p.schemes[0].xirr!).toBeCloseTo(0.1, 6);
    expect(p.xirr!).toBeCloseTo(0.1, 6);
    expect(p.xirrCoverage).toBe(1);
  });

  it("refuses XIRR when the statement starts mid-way through the holding", () => {
    const p = summarize([
      statement([
        // 5 units held before the statement began: history is incomplete.
        { name: "Beta Mid Cap Fund", folio: "3", open: 5, units: 15, value: 3000, cost: 1500, txns: [buy("2021-06-01", 1000, 10)] },
        // No opening balance recorded, but transactions don't explain all units (MF Central-style partial window).
        { name: "Gamma Small Cap Fund", folio: "4", units: 30, value: 3000, cost: 2000, txns: [buy("2021-06-01", 1000, 10)] },
        { name: "Delta Liquid Fund", folio: "5", units: 10, value: 1050, cost: 1000, txns: [buy("2021-01-01", 1000, 10)] },
      ]),
    ]);
    const by = Object.fromEntries(p.schemes.map((s) => [s.name, s]));
    expect(by["Beta Mid Cap Fund"]).toMatchObject({ fullHistory: false, xirr: null });
    expect(by["Gamma Small Cap Fund"]).toMatchObject({ fullHistory: false, xirr: null });
    expect(by["Delta Liquid Fund"].xirr!).toBeCloseTo(0.05, 6);
    expect(p.xirr!).toBeCloseTo(0.05, 6);
    expect(p.xirrCoverage).toBeCloseTo(1050 / 7050, 6);
  });

  it("breaks down value by a key", () => {
    const p = summarize([
      statement([
        { name: "Alpha Small Cap Fund", folio: "1", units: 1, value: 300, cost: 1, txns: [] },
        { name: "Beta Liquid Fund", folio: "2", units: 1, value: 100, cost: 1, txns: [] },
      ]),
    ]);
    expect(breakdown(p.schemes, (s) => s.assetClass)).toEqual([
      { key: "Equity", value: 300, share: 0.75 },
      { key: "Debt", value: 100, share: 0.25 },
    ]);
  });
});

describe("latestStatements", () => {
  const st = (from: string, to: string, name: string): CASStatement => ({
    statementPeriod: { from, to },
    investor: { pan: "ABCDE1234F" },
    folios: [{ folio: "1", amc: "Test MF", schemes: [] }],
    source: { kind: "upload", fileName: name },
    parsedAt: "",
  });

  it("prefers the longest history among statements of about the same date", () => {
    const short = st("2023-01-01", "2026-10-01", "mfcentral.xlsx");
    const full = st("2016-01-01", "2026-09-30", "cas.pdf");
    expect(latestStatements([short, full])).toEqual([full]);
  });

  it("still prefers a clearly newer statement", () => {
    const old = st("2016-01-01", "2026-06-30", "old.pdf");
    const recent = st("2023-01-01", "2026-09-30", "recent.xlsx");
    expect(latestStatements([old, recent])).toEqual([recent]);
  });
});

it("ignores documents that aren't a full consolidated statement", () => {
  const full = statement([{ name: "Alpha Flexi Cap Fund", folio: "1", units: 10, value: 1100, cost: 1000, txns: [] }]);
  const confirmation = { ...full, statementPeriod: { from: "", to: "" }, investor: {} };
  expect(latestStatements([full, confirmation])).toEqual([full]);
  expect(summarize([full, confirmation]).value).toBe(1100);
});

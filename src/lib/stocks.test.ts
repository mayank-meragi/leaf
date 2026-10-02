import { describe, expect, it } from "vitest";
import type { StockStatement } from "@/types";
import type { LeafData } from "./db";
import { PATHS, STOCKS_PATH } from "./db";
import { applyStockStatement, csvRows, parseHoldings, stockHistory, stocksOverview } from "./stocks";

const empty = { config: { version: 1, accounts: [] }, transactions: [], statements: [], cardStatements: [], cardPayments: [], wealthAccounts: [], wealthSnapshots: [], wealthFlows: [], payslips: [], taxDocs: [], policies: [], stockStatements: [] } as LeafData;

const sheet = [
  { rows: [
    ["Name", "Test User"],
    ["Unique Client Code", "1234567890"],
    ["Holdings statement for stocks as on 01-10-2026"],
    ["Summary"],
    [],
    ["Stock Name", "ISIN", "Quantity", "Average buy price", "Buy value", "Closing price", "Closing value", "Unrealised P&L"],
    ["ALPHA LTD", "INE000A01001", 10, 100, 1000, 150, 1500, 500],
    ["BETA LTD", "INE000B01002", 5, 200, 1000, 150, 750, -250],
    [],
  ] },
];

describe("parseHoldings", () => {
  it("reads the table, the as-on date and the client code", () => {
    const p = parseHoldings(sheet);
    expect(p.asOf).toBe("2026-10-01");
    expect(p.client).toBe("1234567890");
    expect(p.holdings).toEqual([
      { name: "ALPHA LTD", isin: "INE000A01001", qty: 10, avgPrice: 100, invested: 1000, price: 150, value: 1500 },
      { name: "BETA LTD", isin: "INE000B01002", qty: 5, avgPrice: 200, invested: 1000, price: 150, value: 750 },
    ]);
  });

  it("derives cost and value from price columns, and reads CSV", () => {
    const csv = 'Scrip,Qty,Avg price,LTP\n"GAMMA, INC",4,50,60\n';
    const p = parseHoldings([{ rows: csvRows(csv) }]);
    expect(p.holdings[0]).toMatchObject({ name: "GAMMA, INC", qty: 4, invested: 200, value: 240, price: 60 });
  });

  it("rejects files with no holdings table", () => {
    expect(() => parseHoldings([{ rows: [["a", "b"], [1, 2]] }])).toThrow(/holdings table/);
  });
});

describe("applyStockStatement", () => {
  const p = parseHoldings(sheet);

  it("saves the statement and the account's balance, and replaces a re-upload of the same date", () => {
    const first = applyStockStatement(p, empty, "h.xlsx", "2026-10-02");
    const data = { ...empty, stockStatements: first.files[STOCKS_PATH] as StockStatement[], wealthAccounts: first.files[PATHS.wealthAccounts] as LeafData["wealthAccounts"], wealthSnapshots: first.files[PATHS.wealthSnapshots] as LeafData["wealthSnapshots"] };
    expect(data.wealthAccounts).toMatchObject([{ kind: "stocks", name: "Stocks ••7890" }]);
    expect(data.wealthSnapshots).toMatchObject([{ date: "2026-10-01", value: 2250 }]);
    const again = applyStockStatement(p, data, "h2.xlsx", "2026-10-02");
    expect(again.files[STOCKS_PATH]).toHaveLength(1);
    expect(again.files[PATHS.wealthAccounts]).toHaveLength(1);
    expect(again.files[PATHS.wealthSnapshots]).toHaveLength(1);
  });

  it("adopts an existing stocks account that has no reference rather than adding a second", () => {
    const old = { id: "stocks-old", kind: "stocks" as const, name: "Stocks" };
    const r = applyStockStatement(p, { ...empty, wealthAccounts: [old] }, "h.xlsx", "2026-10-02");
    expect(r.files[PATHS.wealthAccounts]).toMatchObject([{ id: "stocks-old", ref: "••7890" }]);
  });
});

describe("stocksOverview", () => {
  const h = (name: string, qty: number, invested: number, value: number) => ({ name, isin: name, qty, avgPrice: invested / qty, invested, price: value / qty, value });
  const st = (asOf: string, holdings: ReturnType<typeof h>[]): StockStatement => ({ asOf, account: "a", holdings, source: { kind: "manual" } });

  it("totals, weights and sorts the latest statement", () => {
    const o = stocksOverview([st("2026-10-01", [h("A", 10, 1000, 1500), h("B", 5, 1000, 750)])], "2026-10-02")!;
    expect(o).toMatchObject({ value: 2250, invested: 2000, pnl: 250 });
    expect(o.holdings.map((x) => x.name)).toEqual(["A", "B"]);
    expect(o.holdings[0].weight).toBeCloseTo(1500 / 2250);
    expect(o.stale).toBe(false);
  });

  it("reports what changed since the previous statement, and a stock's history", () => {
    const old = st("2026-08-01", [h("A", 10, 1000, 1100), h("B", 5, 1000, 900)]);
    const now = st("2026-10-01", [h("A", 12, 1300, 1800), h("C", 1, 100, 120)]);
    const o = stocksOverview([now, old], "2026-10-02")!;
    expect(o.changes).toMatchObject({ since: "2026-08-01", added: [{ name: "C" }], removed: [{ name: "B" }], changed: [{ from: 10, to: 12 }] });
    expect(o.history.map((x) => x.value)).toEqual([2000, 1920]);
    expect(stockHistory([now, old], "A").map((x) => x.qty)).toEqual([10, 12]);
  });

  it("flags an old statement", () => {
    expect(stocksOverview([st("2026-01-01", [h("A", 1, 1, 1)])], "2026-10-02")!.stale).toBe(true);
  });
});

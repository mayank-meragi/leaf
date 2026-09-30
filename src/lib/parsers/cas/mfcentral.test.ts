import { describe, expect, it } from "vitest";
import { isMFCentralWorkbook, parseMFCentral, type SheetRows } from "./mfcentral";

// Synthetic workbook in MF Central's layout (all cells are text, as in the real export).
const header = [
  ["Name", "TEST INVESTOR"],
  ["Mobile Number", "+910000000000"],
  ["Email", "investor@example.com"],
  ["PAN", "ABCDE1234F"],
  [" ", " "],
  ["From Date", "01-Jan-2023"],
  ["To Date", "01-Oct-2026 "],
  [],
];

const sheets: SheetRows[] = [
  {
    name: "Portfolio Details",
    rows: [
      ...header,
      ["Total Investments", "Current Portfolio Value", "Profit/Loss"],
      ["30000", "39000", "9000"],
      [],
      ["Scheme Name", "AMC Name", "Category", "Folio No.", "Invested Value", "Current Value", "Returns", "Units"],
      ["Alpha Flexi Cap Fund - Direct Growth ", "Alpha Mutual Fund", "EQUITY", "111", "20000", "26000.00", "6000", "100.000"],
      ["Alpha Flexi Cap Fund - Direct Growth ", "Alpha Mutual Fund", "EQUITY", "222", "10000", "13000.00", "3000", "50.000"],
      ["Beta Old Fund", "Beta Mutual Fund", "Equity", "333", "0", "0.00", "0", "0.000"],
    ],
  },
  {
    name: "Transaction Details",
    rows: [
      ...header,
      ["Scheme Name", "Transaction Description", "Date", "NAV", "Units", "Amount"],
      ["Alpha Flexi Cap Fund - Direct Growth ", "Sys. Investment (12)", "05-JAN-2024", "200.00", "25.000", "4999.75"],
      ["Alpha Flexi Cap Fund - Direct Growth ", "Purchase - Systematic84/ER04: Insufficient Balance - Instalment No 18", "01-APR-2024", "171.3184", "-29.184", "-4999.75"],
      ["Alpha Flexi Cap Fund - Direct Growth ", "Registration of Nominee", "02-APR-2023", "0", "0", "0"],
      ["Alpha Flexi Cap Fund - Direct Growth ", "Redemption", "10-MAY-2025", "250.00", "-4.000", "-1000.00"],
      ["Beta Old Fund", "Refund Rejected", "09-JAN-2023", "0", "0.000", "2500.00"],
    ],
  },
];

describe("parseMFCentral", () => {
  const st = parseMFCentral(sheets, { kind: "upload", fileName: "cas.xlsx" });

  it("detects the workbook", () => {
    expect(isMFCentralWorkbook(sheets)).toBe(true);
    expect(isMFCentralWorkbook([{ name: "Sheet1", rows: [] }])).toBe(false);
  });

  it("reads investor and period", () => {
    expect(st.statementPeriod).toEqual({ from: "2023-01-01", to: "2026-10-01" });
    expect(st.investor).toEqual({ name: "TEST INVESTOR", email: "investor@example.com", pan: "ABCDE1234F" });
    expect(st.format).toBe("mfcentral-xlsx");
  });

  it("builds one folio per folio number with valuation and derived NAV", () => {
    expect(st.folios.map((f) => [f.folio, f.amc, f.pan])).toEqual([
      ["111", "Alpha Mutual Fund", "ABCDE1234F"],
      ["222", "Alpha Mutual Fund", "ABCDE1234F"],
      ["333", "Beta Mutual Fund", "ABCDE1234F"],
    ]);
    expect(st.folios[0].schemes[0]).toMatchObject({
      name: "Alpha Flexi Cap Fund - Direct Growth",
      assetClass: "EQUITY",
      close: 100,
      valuation: { date: "2026-10-01", nav: 260, value: 26000, cost: 20000 },
      transactions: [],
    });
    expect(st.folios[2].schemes[0].assetClass).toBe("EQUITY");
  });

  it("keeps transactions per scheme, skipping non-financial events", () => {
    const alpha = st.schemeTransactions!.find((s) => s.scheme === "Alpha Flexi Cap Fund - Direct Growth")!;
    expect(alpha.amc).toBe("Alpha Mutual Fund");
    expect(alpha.transactions.map((t) => [t.date, t.type])).toEqual([
      ["2024-01-05", "PURCHASE_SIP"],
      ["2024-04-01", "REVERSAL"],
      ["2025-05-10", "REDEMPTION"],
    ]);
    expect(st.schemeTransactions!.find((s) => s.scheme === "Beta Old Fund")!.transactions[0]).toMatchObject({ type: "MISC", amount: 2500, units: null, nav: null });
  });
});

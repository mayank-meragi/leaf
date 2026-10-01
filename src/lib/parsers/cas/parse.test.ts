import { describe, expect, it } from "vitest";
import { classify, joinHeader, num, parseCAS } from "./parse";

// Synthetic text in the shape pdfToLines produces from a CAMS detailed CAS.
const SAMPLE = `
Consolidated Account Statement
01-Apr-2024 To 30-Sep-2026
Email Id: investor@example.com
HDFC Mutual Fund
Folio No: 12345678 / 90   PAN: ABCDE1234F   KYC: OK  PAN: OK
B123-HDFC Flexi Cap Fund - Direct Plan - Growth - ISIN: INF179K01UT0(Advisor: DIRECT)  Registrar : CAMS
Opening Unit Balance: 100.123
01-Apr-2024  Purchase - Systematic Investment - Instalment 1/120  5,000.00  3.456  1,446.7800  103.579
01-Apr-2024  *** Stamp Duty ***  0.25
15-Jan-2025  Redemption  (2,000.00)  (1.234)  1,620.5000  102.345
Closing Unit Balance: 102.345  NAV on 30-Sep-2026: INR 1,900.1234  Total Cost Value: 150,000.00  Market Value on 30-Sep-2026: INR 194,468.00
Parag Parikh Mutual Fund
Folio No: 9988776   PAN: ABCDE1234F
PP001-Parag Parikh Flexi Cap Fund - Direct Plan
Growth - ISIN: INF879O01027(Advisor: DIRECT)  Registrar : KFINTECH
Opening Unit Balance: 0.000
10-May-2025  Switch In - From Liquid Fund  10,000.00  120.000  83.3333  120.000
Closing Unit Balance: 120.000
NAV on 30-Sep-2026: INR 90.0000
Total Cost Value: 10,000.00
Market Value on 30-Sep-2026: INR 10,800.00
`.split("\n");

describe("parseCAS", () => {
  const stmt = parseCAS(SAMPLE, { kind: "upload", fileName: "cas.pdf" });

  it("reads statement metadata", () => {
    expect(stmt.statementPeriod).toEqual({ from: "2024-04-01", to: "2026-09-30" });
    expect(stmt.investor.email).toBe("investor@example.com");
  });

  it("splits folios by AMC", () => {
    expect(stmt.folios.map((f) => [f.amc, f.folio, f.pan])).toEqual([
      ["HDFC Mutual Fund", "12345678/90", "ABCDE1234F"],
      ["Parag Parikh Mutual Fund", "9988776", "ABCDE1234F"],
    ]);
  });

  it("parses scheme headers, including wrapped ones", () => {
    const [hdfc] = stmt.folios[0].schemes;
    expect(hdfc).toMatchObject({
      name: "HDFC Flexi Cap Fund - Direct Plan - Growth",
      isin: "INF179K01UT0",
      advisor: "DIRECT",
      rta: "CAMS",
      rtaCode: "B123",
      open: 100.123,
      close: 102.345,
    });
    const [ppfas] = stmt.folios[1].schemes;
    expect(ppfas.name).toBe("Parag Parikh Flexi Cap Fund - Direct Plan Growth");
    expect(ppfas.isin).toBe("INF879O01027");
    expect(ppfas.rta).toBe("KFINTECH");
  });

  it("parses transactions with signs and types", () => {
    const txns = stmt.folios[0].schemes[0].transactions;
    expect(txns).toHaveLength(3);
    expect(txns[0]).toMatchObject({ date: "2024-04-01", amount: 5000, units: 3.456, nav: 1446.78, balance: 103.579, type: "PURCHASE_SIP" });
    expect(txns[1]).toMatchObject({ amount: 0.25, units: null, type: "STAMP_DUTY", description: "Stamp Duty" });
    expect(txns[2]).toMatchObject({ amount: -2000, units: -1.234, type: "REDEMPTION" });
    expect(stmt.folios[1].schemes[0].transactions[0].type).toBe("SWITCH_IN");
  });

  it("captures valuation whether on one line or several", () => {
    expect(stmt.folios[0].schemes[0].valuation).toEqual({ date: "2026-09-30", nav: 1900.1234, value: 194468, cost: 150000 });
    expect(stmt.folios[1].schemes[0].valuation).toEqual({ date: "2026-09-30", nav: 90, value: 10800, cost: 10000 });
  });
});

describe("helpers", () => {
  it("num handles commas and parentheses", () => {
    expect(num("1,234.50")).toBe(1234.5);
    expect(num("(2,000.00)")).toBe(-2000);
    expect(num("-3.1")).toBe(-3.1);
  });
  it("classify", () => {
    expect(classify("IDCW Reinvestment", 1, 10)).toBe("DIVIDEND_REINVEST");
    expect(classify("Switch Out - To Liquid", -5, -500)).toBe("SWITCH_OUT");
    expect(classify("Purchase", 5, 500)).toBe("PURCHASE");
    // A bounced SIP is a reversal, never a sale. Real wording from a CAMS statement: "Rejection", not "Rejected".
    expect(classify("Systematic Investment Rejection (1/36)", -53.163, -2000)).toBe("REVERSAL");
    expect(classify("Systematic Investment Rejected - Insufficient Balance", -53.163, -2000)).toBe("REVERSAL");
  });
});

describe("wrapped scheme headers (layout from real CAMS PDFs)", () => {
  const lines = `
Consolidated Account Statement
01-Jan-2016 To 30-Sep-2026
Alpha Mutual Fund
Folio No: 111 / 0  PAN: ABCDE1234F  KYC: OK PAN: OK
TEST INVESTOR
A1Z-Alpha Large Cap Fund -Growth-Direct Plan(formerly known as Alpha Frontline Fund) (Non-Demat) -  Registrar : CAMS
ISIN: INF209K01YY7(Advisor: DIRECT)
Nominee 1:  SOMEONE  Nominee 2:  Nominee 3:
Opening Unit Balance: 0.000
09-Aug-2021  Purchase SIP - Instalment 1/61 - via Internet  2,999.85  22.610  132.68  22.610
Closing Unit Balance: 22.610  NAV on 30-Sep-2026: INR 150.00  Total Cost Value: 2,999.85  Market Value on 30-Sep-2026: INR 3,391.50
Beta Mutual Fund
Folio No: 222 / 11  PAN: ABCDE1234F  KYC: OK PAN: OK
OLEBDG-Beta Small Cap Fund - Direct Growth (Formerly known as Beta Emerging Fund) (Non-Demat) - ISIN: INF917K  Registrar : CAMS
01QA1(Advisor: DIRECTONLINE)
Nominee 1:  SOMEONE  Nominee 2:  Nominee 3:
Opening Unit Balance: 0.000
02-Apr-2018  Purchase - via Internet  5,000.00  177.873  28.1100  177.873
Closing Unit Balance: 177.873
`.split("\n");
  const st = parseCAS(lines, { kind: "upload", fileName: "x.pdf" });

  it("keeps one scheme per header, with the right name, ISIN and advisor", () => {
    const schemes = st.folios.flatMap((f) => f.schemes);
    expect(schemes.map((s) => [s.name, s.isin, s.advisor, s.rta, s.close])).toEqual([
      ["Alpha Large Cap Fund -Growth-Direct Plan(formerly known as Alpha Frontline Fund)", "INF209K01YY7", "DIRECT", "CAMS", 22.61],
      ["Beta Small Cap Fund - Direct Growth (Formerly known as Beta Emerging Fund)", "INF917K01QA1", "DIRECTONLINE", "CAMS", 177.873],
    ]);
    expect(st.investor.pan).toBe("ABCDE1234F");
  });

  it("joinHeader glues a split ISIN and keeps the registrar", () => {
    expect(joinHeader(["X - ISIN: INF917K  Registrar : CAMS", "01QA1(Advisor: D)"])).toBe("X - ISIN: INF917K01QA1(Advisor: D)  Registrar : CAMS");
  });
});

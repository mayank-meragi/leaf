import { describe, expect, it } from "vitest";
import type { LeafData } from "./db";
import { buildExport, bundleText, csv, type ExportExtras } from "./export";
import type { CASStatement } from "@/types";
import { crc32, zip } from "./zip";

const data: LeafData = {
  config: { version: 1, accounts: [{ email: "someone@example.com" }], casPassword: "SECRETPASS", geminiKey: "SECRETKEY" },
  transactions: [
    { id: "a:1", date: "2026-09-01", amount: 1200, currency: "INR", direction: "debit", description: "Cafe, \"Corner\"", instrument: "HDFC Card ••1234", category: "Food", source: { account: "someone@example.com", messageId: "1", parser: "x" } },
    { id: "a:2", date: "2025-01-01", amount: 50, currency: "INR", direction: "credit", description: "Old", source: { account: "someone@example.com", messageId: "2", parser: "x" } },
  ],
  statements: [], cardStatements: [], cardPayments: [],
  wealthAccounts: [{ id: "nps-1", kind: "nps", name: "NPS", ref: "PRAN ••9999" }],
  wealthSnapshots: [], wealthFlows: [], payslips: [],
  taxDocs: [],
  policies: [{ insurer: "Acme", type: "health", policyRef: "POL123", insured: "Jane Doe", source: { kind: "manual" } }],
};
const run = (o: Partial<Parameters<typeof buildExport>[1]> = {}) => buildExport(data, { redact: true, today: "2026-10-01", ...o });
const text = (files: ReturnType<typeof run>) => bundleText(files);

describe("buildExport", () => {
  it("never includes secrets or the Gmail address", () => {
    const out = text(run({ redact: false }));
    for (const s of ["SECRETPASS", "SECRETKEY", "someone@example.com"]) expect(out).not.toContain(s);
  });

  it("filters transactions by date and escapes CSV", () => {
    const tx = run({ from: "2026-01-01" }).find((f) => f.name === "transactions.csv")!.content;
    expect(tx).toContain('"Cafe, ""Corner"""');
    expect(tx).not.toContain("Old");
  });

  it("redacts account refs and insured name only when asked", () => {
    expect(text(run())).not.toMatch(/PRAN ••9999|POL123|Jane Doe/);
    expect(text(run({ redact: false }))).toMatch(/PRAN ••9999.*|POL123/s);
  });

  it("puts a README first and summarises by month", () => {
    const files = run();
    expect(files[0].name).toBe("README.md");
    expect(files.find((f) => f.name === "monthly_summary.csv")!.content).toContain("2026-09,debit,Food,1200,1");
  });
});

describe("csv / zip", () => {
  it("quotes only when needed", () => expect(csv(["a"], [["x,y"], [null], [1.5]])).toBe('a\n"x,y"\n\n1.5\n'));
  it("crc32 matches the known check value", () => expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926));
  it("writes a well-formed archive", () => {
    const z = zip([{ name: "a.txt", content: "hi" }]);
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint32(z.length - 22, true)).toBe(0x06054b50);
    expect(v.getUint16(z.length - 22 + 10, true)).toBe(1);
  });
});

describe("buildExport: fund analysis", () => {
  const scheme = (name: string, value: number) => ({
    name, assetClass: "EQUITY", open: 0, close: 10,
    valuation: { date: "2026-09-30", nav: value / 10, value, cost: value / 2 },
    transactions: [{ date: "2026-01-05", description: "Buy", amount: value / 2, units: 10, nav: value / 20, balance: 10, type: "PURCHASE" as const }],
  });
  const stmt: CASStatement = {
    statementPeriod: { from: "2026-01-01", to: "2026-09-30" },
    investor: {},
    folios: [{ folio: "FOLIO777", amc: "Test AMC", schemes: [scheme("Alpha Fund Direct Growth", 1000), scheme("Beta Fund Direct Growth", 3000)] }],
    source: { kind: "upload", fileName: "x.pdf" },
    parsedAt: "2026-10-01",
  };
  const fund = (code: number, name: string, weights: number[]) => ({
    code, name, fetched: "2026-09-30", portfolioDate: "2026-08-31", expenseRatio: 0.5,
    holdings: weights.map((weight, i) => ({ id: `S${i}`, name: `Stock ${i}`, sector: "Tech", type: "EQUITY", weight })),
  });
  const extras: ExportExtras = {
    codes: { "alpha fund direct growth": { code: 1, name: "Alpha", verified: true }, "beta fund direct growth": { code: 2, name: "Beta", verified: true } },
    holdings: new Map([[1, fund(1, "Alpha", [10, 5])], [2, fund(2, "Beta", [8, 20])]]),
    navs: new Map(),
  };
  const withStmt = { ...data, statements: [stmt] };
  const get = (files: ReturnType<typeof buildExport>, n: string) => files.find((f) => f.name === n)?.content;

  it("adds overlap, look-through and fund costs when portfolios are available", () => {
    const files = buildExport(withStmt, { redact: true, today: "2026-10-01" }, extras);
    expect(get(files, "fund_overlap.csv")).toContain("Beta Fund Direct Growth,Alpha Fund Direct Growth,13,2,");
    expect(get(files, "fund_info.csv")).toContain("Alpha Fund Direct Growth,1000,");
    // Stock 0: 10% of 1000 + 8% of 3000 = 340
    expect(get(files, "stock_exposure.csv")).toContain("Stock 0,Tech,340,");
    expect(files[0].content).toContain("fund_overlap.csv");
  });

  it("leaves fund analysis out without portfolios, and keeps folios out when redacting", () => {
    const files = buildExport(withStmt, { redact: true, today: "2026-10-01" });
    expect(get(files, "fund_overlap.csv")).toBeUndefined();
    expect(bundleText(files)).not.toContain("FOLIO777");
    expect(bundleText(buildExport(withStmt, { redact: false, today: "2026-10-01" }))).toContain("FOLIO777");
  });
});

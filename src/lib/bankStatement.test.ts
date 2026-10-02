import { describe, expect, it } from "vitest";
import type { Transaction } from "@/types";
import type { StatementExtraction } from "./ai/bankStatement";
import { applyStatement, mergeDuplicates, statementDuplicates, withoutStatementDuplicates } from "./bankStatement";
import { EMPTY_CONFIG, type LeafData } from "./db";
import { sourceStatus } from "./instruments";

const data = (transactions: Transaction[] = []): LeafData =>
  ({ config: EMPTY_CONFIG, transactions, statements: [], cardStatements: [], cardPayments: [], wealthAccounts: [], wealthSnapshots: [], wealthFlows: [], payslips: [], taxDocs: [], policies: [], stockStatements: [] }) as LeafData;

const row = (date: string, amount: number, direction: "debit" | "credit", balance: number, description = "X") => ({
  date, amount, direction, description, hasBalance: true, balance, category: "Other",
});

const stmt = (transactions: StatementExtraction["transactions"], over: Partial<StatementExtraction> = {}): StatementExtraction => ({
  isStatement: true, bank: "HDFC", accountType: "bank_account", accountLast4: "1234", periodFrom: "", periodTo: "",
  closingBalance: 0, hasClosingBalance: false, transactions, ...over,
});

const alert = (over: Partial<Transaction>): Transaction => ({
  id: "me@x.com:1", date: "2026-09-02", amount: 500, currency: "INR", direction: "debit", description: "Swiggy",
  instrument: "HDFC Bank ••1234", category: "Food & Dining", source: { account: "me@x.com", messageId: "1", parser: "gemini@2" }, ...over,
});

describe("applyStatement", () => {
  it("turns rows into transactions on the account, keeping order and balances", () => {
    const r = applyStatement(stmt([row("2026-09-01", 1000, "debit", 9000), row("2026-09-03", 2000, "credit", 11000)]), data(), "hdfc.pdf");
    const all = Object.values(r.files).flat() as Transaction[];
    expect(all).toHaveLength(2);
    expect(all.every((t) => t.instrument === "HDFC A/c ••1234" && t.instrumentKind === "bank_account")).toBe(true);
    expect(r.description).toContain("2 new transactions");
  });

  it("makes the latest balance the available balance", () => {
    const r = applyStatement(stmt([row("2026-09-03", 2000, "credit", 11000), row("2026-09-01", 1000, "debit", 9000)]), data(), "hdfc.pdf");
    const all = Object.values(r.files).flat() as Transaction[];
    expect(sourceStatus("hdfc-1234", all, [], [], "2026-10-02").balance?.amount).toBe(11000);
  });

  it("uses the closing balance when the last row prints none", () => {
    const rows = [row("2026-09-01", 1000, "debit", 9000), { ...row("2026-09-02", 100, "debit", 0), hasBalance: false }];
    const r = applyStatement(stmt(rows, { hasClosingBalance: true, closingBalance: 8900 }), data(), "f.pdf");
    expect(sourceStatus("hdfc-1234", Object.values(r.files).flat() as Transaction[], [], [], "2026-10-02").balance?.amount).toBe(8900);
  });

  it("is idempotent for the same or an overlapping statement", () => {
    const first = applyStatement(stmt([row("2026-09-01", 1000, "debit", 9000), row("2026-09-01", 1000, "debit", 8000)]), data(), "a.pdf");
    const stored = Object.values(first.files).flat() as Transaction[];
    expect(stored).toHaveLength(2);
    const again = applyStatement(stmt([row("2026-09-01", 1000, "debit", 9000), row("2026-09-01", 1000, "debit", 8000), row("2026-09-05", 50, "debit", 7950)]), data(stored), "b.pdf");
    expect(again.added).toBe(1);
  });

  it("doesn't double count a transaction an alert already reported, and lends it the balance", () => {
    const a = alert({});
    const r = applyStatement(stmt([row("2026-09-02", 500, "debit", 9500, "SWIGGY BANGALORE")]), data([a]), "f.pdf");
    expect(r.added).toBe(0);
    const out = Object.values(r.files).flat() as Transaction[];
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: a.id, balanceAfter: 9500, category: "Food & Dining" });
  });

  it("rejects non-statements and missing account details", () => {
    expect(() => applyStatement(stmt([], { isStatement: false }), data(), "f")).toThrow(/bank or card statement/);
    expect(() => applyStatement(stmt([row("2026-09-01", 1, "debit", 1)], { accountLast4: "" }), data(), "f")).toThrow(/account number/);
  });
});

describe("withoutStatementDuplicates", () => {
  it("drops a new alert that a statement row already covers, once per row", () => {
    const r = applyStatement(stmt([row("2026-09-02", 500, "debit", 9500)]), data(), "f.pdf");
    const stored = Object.values(r.files).flat() as Transaction[];
    const out = withoutStatementDuplicates([alert({}), alert({ id: "me@x.com:2" })], stored);
    expect(out.map((t) => t.id)).toEqual(["me@x.com:2"]);
  });
});

describe("chunkStatement", () => {
  it("keeps short statements whole and repeats the header on later chunks", async () => {
    const { chunkStatement } = await import("./ai/bankStatement");
    expect(chunkStatement("a\nb")).toEqual(["a\nb"]);
    const text = ["HDFC BANK ••1234", ...Array.from({ length: 50 }, (_, i) => `row ${i}`)].join("\n");
    const chunks = chunkStatement(text, 100, 16);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1]).toContain("HDFC BANK ••1234");
    expect(chunks.join("")).toContain("row 49");
  });
});

describe("salary counted by the payroll email and the bank statement", () => {
  const payroll = alert({ id: "me@x.com:p", date: "2026-09-02", amount: 300000, direction: "credit", description: "Salary", category: "Salary", instrument: undefined, source: { account: "me@x.com", messageId: "p", parser: "payroll", receivedAt: "2026-09-01T10:00:00.000Z" } });

  it("is one transaction when a statement lands after the payroll email, and takes on the account and balance", () => {
    const r = applyStatement(stmt([row("2026-09-02", 300000, "credit", 350000, "SALARY RAZORPAYX")]), data([payroll]), "f.pdf");
    expect(r.added).toBe(0);
    const out = Object.values(r.files).flat() as Transaction[];
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: payroll.id, category: "Salary", instrument: "HDFC A/c ••1234", balanceAfter: 350000 });
  });

  it("repairs a statement imported before this was handled", () => {
    const rowTxn = (Object.values(applyStatement(stmt([row("2026-09-03", 300000, "credit", 350000)]), data(), "f.pdf").files).flat() as Transaction[])[0];
    const all = [payroll, rowTxn, alert({ id: "x", date: "2026-09-03", amount: 99, direction: "debit" })];
    const pairs = statementDuplicates(all);
    expect(pairs).toHaveLength(1);
    const files = mergeDuplicates(all, pairs);
    const sep = files["transactions/2026-09.json"];
    expect(sep.map((t) => t.id).sort()).toEqual(["me@x.com:p", "x"]);
    expect(sep.find((t) => t.id === payroll.id)).toMatchObject({ instrument: "HDFC A/c ••1234", balanceAfter: 350000 });
  });

  it("doesn't merge two debits that merely look alike across an unnamed account", () => {
    const noAccount = alert({ instrument: undefined, amount: 500, date: "2026-09-02" });
    const r = applyStatement(stmt([row("2026-09-02", 500, "debit", 9500)]), data([noAccount]), "f.pdf");
    expect(r.added).toBe(1);
  });
});

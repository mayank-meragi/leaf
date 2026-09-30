import { describe, expect, it } from "vitest";
import type { LeafConfig, Transaction } from "@/types";
import { corroborate, instruments, mergeCardPayments, mergeCardStatements, parseInstrument, paymentFor, resolveCard, sourceStatus, withInstrumentMeta } from "./instruments";

const cfg: LeafConfig = { version: 1, accounts: [] };
let n = 0;
const t = (instrument: string | undefined, extra: Partial<Transaction> = {}): Transaction => ({
  id: String(++n), date: "2026-09-01", amount: 1, currency: "INR", direction: "debit", description: "x", instrument,
  source: { account: "a", messageId: String(n), parser: "gemini" }, ...extra,
});

describe("parseInstrument", () => {
  it("normalises the variants the model produces", () => {
    const keys = ["SBI Card ••1111", "SBI Credit Card ••1111"].map((s) => parseInstrument(s)?.key);
    expect(new Set(keys)).toEqual(new Set(["sbi-1111"]));
    expect(new Set(["HDFC Bank A/c ••2222", "HDFC A/c ••2222", "HDFC Bank ••2222"].map((s) => parseInstrument(s)?.key))).toEqual(new Set(["hdfc-2222"]));
    expect(parseInstrument("Card XX1234")?.last4).toBe("1234");
    expect(parseInstrument("ICICI A/c XXXXXX654321")?.last4).toBe("4321");
    expect(parseInstrument(undefined)).toBeNull();
    expect(parseInstrument("UPI")).toBeNull();
  });

  it("reads kind hints", () => {
    expect(parseInstrument("SBI Card ••1111")?.hint).toBe("credit_card"); // SBI Card is SBI's credit card brand
    expect(parseInstrument("HDFC Bank Credit Card ••5555")?.hint).toBe("credit_card");
    expect(parseInstrument("Axis Bank Card ••4444")?.hint).toBe("card");
    expect(parseInstrument("Axis Bank A/c ••3333")?.hint).toBe("bank_account");
  });
});

describe("instruments", () => {
  const txns = [
    t("HDFC Card ••5555"), t("HDFC Bank Credit Card ••5555"), t("HDFC Bank Card ••5555"),
    t("HDFC Bank A/c ••2222"), t("HDFC Bank ••2222"),
    t("Axis Bank Card ••4444"),
    t("Axis Bank ••3333"), // bare: defaults to account
    t(undefined),
  ];

  it("merges variants and infers the most specific kind", () => {
    const list = instruments(txns, cfg);
    expect(list.map((i) => [i.key, i.kind, i.count, i.label])).toEqual([
      ["hdfc-5555", "credit_card", 3, "HDFC Credit card ••5555"],
      ["hdfc-2222", "bank_account", 2, "HDFC Bank account ••2222"],
      ["axis-3333", "bank_account", 1, "Axis Bank account ••3333"],
      ["axis-4444", "card", 1, "Axis Card ••4444"],
    ]);
  });

  it("uses the model's explicit kind and the user's overrides", () => {
    const withKind = instruments([t("Axis Bank Card ••4444", { instrumentKind: "debit_card" })], cfg);
    expect(withKind[0].kind).toBe("debit_card");

    const config = withInstrumentMeta(cfg, "axis-4444", { kind: "credit_card", name: "Axis Ace" });
    const [ace] = instruments([t("Axis Bank Card ••4444")], config);
    expect(ace).toMatchObject({ kind: "credit_card", label: "Axis Ace", nickname: "Axis Ace" });

    // Clearing every field removes the entry.
    expect(withInstrumentMeta(config, "axis-4444", { kind: undefined, name: "" }).instruments).toEqual([]);
  });
});

describe("sourceStatus", () => {
  const stmt = { card: "axis-4444", statementDate: "2026-09-12", totalDue: 10500.5, minDue: 210, dueDate: "2026-10-02", source: { account: "a", messageId: "s" } };
  const card = (date: string, amount: number, direction: "debit" | "credit" = "debit") => t("Axis Bank Card ••4444", { date, amount, direction });

  it("sums unbilled spends after the statement date, net of refunds", () => {
    const txns = [card("2026-09-10", 500), card("2026-09-12", 100), card("2026-09-13", 1000), card("2026-09-20", 200, "credit")];
    expect(sourceStatus("axis-4444", txns, [stmt], [], "2026-09-25").unbilled).toEqual({ amount: 800, since: "2026-09-12" });
  });

  it("marks the bill paid by a matching payment from a bank account", () => {
    const txns = [t("HDFC Bank A/c ••2222", { date: "2026-09-30", amount: 10500.5, description: "CRED Club" })];
    expect(sourceStatus("axis-4444", txns, [stmt], [], "2026-10-01").bill).toMatchObject({ state: "paid", paidOn: "2026-09-30" });
    expect(sourceStatus("axis-4444", [], [stmt], [], "2026-10-01").bill?.state).toBe("due");
    expect(sourceStatus("axis-4444", [], [stmt], [], "2026-10-05").bill?.state).toBe("overdue");
  });

  it("reports the latest balance by email time, not just date", () => {
    const acct = (receivedAt: string, balanceAfter: number) =>
      t("HDFC Bank A/c ••2222", { date: receivedAt.slice(0, 10), balanceAfter, source: { account: "a", messageId: receivedAt, parser: "gemini@2", receivedAt } });
    const txns = [acct("2026-09-30T09:00:00Z", 5000), acct("2026-09-30T18:00:00Z", 4200), acct("2026-09-29T10:00:00Z", 9000), t("HDFC Bank A/c ••2222")];
    expect(sourceStatus("hdfc-2222", txns, [], [], "2026-10-01").balance).toEqual({ amount: 4200, asOf: "2026-09-30", reportedOn: "2026-09-30", adjusted: 0 });
  });
});

describe("resolveCard", () => {
  const cards = [{ key: "axis-4444", last4: "4444" }, { key: "axis-1234", last4: "1234" }, { key: "hdfc-5555", last4: "5555" }];
  it("matches partial masks against known cards of that issuer", () => {
    expect(resolveCard({ issuer: "Axis", last4: "44" }, cards)).toBe("axis-4444");
    expect(resolveCard({ issuer: "Axis Bank", last4: "XX4444" }, cards)).toBe("axis-4444");
    expect(resolveCard({ issuer: "HDFC", last4: "" }, cards)).toBe("hdfc-5555");
  });
  it("refuses to guess between cards", () => {
    expect(resolveCard({ issuer: "Axis", last4: "" }, cards)).toBeNull();
    expect(resolveCard({ issuer: "SBI", last4: "53" }, cards)).toBeNull();
    expect(resolveCard({ issuer: "SBI", last4: "1111" }, cards)).toBe("sbi-1111");
  });
});

describe("card payments", () => {
  const stmt = { card: "federal-7777", statementDate: "2026-09-20", totalDue: 8200.25, minDue: 460, dueDate: "2026-10-08", source: { account: "a", messageId: "s1" } };
  const receipt = (amount: number, date = "2026-09-30") => ({ card: "federal-7777", amount, date, via: "CRED", source: { account: "a", messageId: `r${amount}` } });
  const credDebit = t("HDFC Bank A/c ••2222", { date: "2026-09-30", amount: 8200.25, description: "CRED Club", category: "Transfers" });

  it("links a bank debit to the card it paid", () => {
    expect(paymentFor(credDebit, [receipt(8200.25)])?.card).toBe("federal-7777");
    expect(paymentFor({ ...credDebit, amount: 500 }, [receipt(8200.25)])).toBeUndefined();
  });

  it("marks bills paid or partly paid from receipts", () => {
    expect(sourceStatus("federal-7777", [], [stmt], [receipt(8200.25)], "2026-10-01").bill).toMatchObject({ state: "paid", paid: 8200.25, paidOn: "2026-09-30" });
    expect(sourceStatus("federal-7777", [], [stmt], [receipt(5000)], "2026-10-01").bill).toMatchObject({ state: "partial", paid: 5000 });
  });

  it("doesn't let a bill payment credit on the card reduce unbilled spends, or count twice", () => {
    const card = (extra: Partial<Transaction>) => t("Federal ••7777", { date: "2026-09-30", ...extra });
    const txns = [card({ amount: 700 }), card({ amount: 8200.25, direction: "credit", category: "Transfers" }), card({ amount: 100, direction: "credit", category: "Refunds" })];
    const st = sourceStatus("federal-7777", txns, [stmt], [receipt(8200.25)], "2026-10-01");
    expect(st.unbilled?.amount).toBe(600);
    expect(st.bill?.paid).toBe(8200.25);
  });

  it("lists cards known only from bills and payments", () => {
    const list = instruments([], cfg, [{ card: stmt.card, date: stmt.statementDate }]);
    expect(list).toMatchObject([{ key: "federal-7777", kind: "credit_card", issuerLabel: "Federal", count: 0, lastUsed: "2026-09-20" }]);
  });

  it("merges the bank's statement email with CRED's bill notice", () => {
    const bank = { ...stmt, statementDate: "2026-09-22", minDue: undefined, source: { account: "a", messageId: "bank" } };
    const merged = mergeCardStatements([bank], [stmt]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ statementDate: "2026-09-20", minDue: 460 });
    expect(mergeCardPayments([receipt(8200.25)], [{ ...receipt(8200.25, "2026-10-01"), via: "OneCard" }])).toHaveLength(1);
  });
});

describe("corroborate", () => {
  const records = [{ card: "federal-7777", amount: 8200.25, date: "2026-09-25" }];
  it("assigns a digit-less statement only when a known card's bill matches it", () => {
    expect(corroborate("Federal Bank", 8200.25, "2026-09-28", records)).toBe("federal-7777"); // OneCard's own statement email
    expect(corroborate("Federal Bank", 0, "2026-09-25", records)).toBeNull(); // Scapia: a different card, don't guess
    expect(corroborate("Axis", 8200.25, "2026-09-25", records)).toBeNull();
  });
});

it("rolls a stated balance forward through later alerts that don't state one", () => {
  const acct = (date: string, extra: Partial<Transaction>) =>
    t("HDFC Bank A/c ••2222", { date, source: { account: "a", messageId: date + (extra.amount ?? 0), parser: "gemini@2", receivedAt: `${date}T10:00:00Z` }, ...extra });
  const txns = [acct("2026-09-06", { amount: 100, balanceAfter: 250000 }), acct("2026-09-10", { amount: 5000 }), acct("2026-09-20", { amount: 20000, direction: "credit" })];
  expect(sourceStatus("hdfc-2222", txns, [], [], "2026-10-01").balance).toEqual({ amount: 265000, asOf: "2026-09-20", reportedOn: "2026-09-06", adjusted: 2 });
});

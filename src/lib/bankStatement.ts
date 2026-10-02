// Turns an extracted bank / card statement into transactions. They go through the same pipeline as
// email alerts, so spending, balances and net worth pick them up with no special cases. Where an alert
// already reported a transaction the statement lists, the alert is kept (it carries any category edit).

import type { Transaction } from "@/types";
import type { StatementExtraction } from "./ai/bankStatement";
import { applyRules } from "./categories";
import type { LeafData } from "./db";
import { monthShards } from "./db";
import { instrumentKey, KIND_LABEL, parseInstrument } from "./instruments";

export const STATEMENT_PARSER = "statement";

const isoDay = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
const dayDiff = (a: string, b: string) => Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000));

/**
 * The email alert (or statement row) for the same money movement as `t`, skipping ones already `claimed`.
 * Both on the same account and within a day. A credit that names no account on one side (the payroll "salary
 * credited" email, some bank alerts) also matches, and a payroll email can precede the credit by a few days.
 */
export function findSameTransaction(t: Transaction, candidates: Transaction[], claimed: Set<string>): Transaction | undefined {
  const key = instrumentKey(t);
  return candidates.find((c) => {
    if (claimed.has(c.id) || c.id === t.id || c.direction !== t.direction || Math.abs(c.amount - t.amount) > 0.5) return false;
    const other = instrumentKey(c);
    if (key && other) return key === other && dayDiff(c.date, t.date) <= 1;
    const payroll = c.source.parser === "payroll" || t.source.parser === "payroll";
    return t.direction === "credit" && dayDiff(c.date, t.date) <= (payroll ? 3 : 1);
  });
}

/** `alert` with the account details a matching statement row knows (and its balance), so the balance counts for the account. */
function enriched(alert: Transaction, row: Transaction): Transaction {
  return {
    ...alert,
    instrument: alert.instrument ?? row.instrument,
    instrumentKind: alert.instrumentKind ?? row.instrumentKind,
    balanceAfter: alert.balanceAfter ?? row.balanceAfter,
    // An alert that named no account is ordered by the row, so later rows of that day still count after it.
    source: alert.instrument ? alert.source : { ...alert.source, receivedAt: row.source.receivedAt },
  };
}

export interface DuplicatePair {
  /** The email-sourced transaction, with the account details and balance the statement row had. */
  keep: Transaction;
  /** The statement row it duplicates. */
  drop: Transaction;
}

/** Statement rows that an email-sourced transaction already records (e.g. salary: the payroll email and the bank credit). */
export function statementDuplicates(transactions: Transaction[]): DuplicatePair[] {
  const rows = transactions.filter((t) => t.source.parser === STATEMENT_PARSER);
  const alerts = transactions.filter((t) => t.source.parser !== STATEMENT_PARSER);
  const claimed = new Set<string>();
  const pairs: DuplicatePair[] = [];
  for (const drop of rows) {
    const alert = findSameTransaction(drop, alerts, claimed);
    if (!alert) continue;
    claimed.add(alert.id);
    pairs.push({ keep: enriched(alert, drop), drop });
  }
  return pairs;
}

/** Month files with each pair folded into one transaction. */
export function mergeDuplicates(transactions: Transaction[], pairs: DuplicatePair[]): Record<string, Transaction[]> {
  const drop = new Set(pairs.map((p) => p.drop.id));
  const keep = new Map(pairs.map((p) => [p.keep.id, p.keep]));
  const months = new Set(pairs.flatMap((p) => [p.keep.date.slice(0, 7), p.drop.date.slice(0, 7)]));
  const files: Record<string, Transaction[]> = {};
  for (const m of months) {
    files[`transactions/${m}.json`] = transactions.filter((t) => t.date.startsWith(m) && !drop.has(t.id)).map((t) => keep.get(t.id) ?? t);
  }
  return files;
}

/** Drops new alerts that a statement already covers. */
export function withoutStatementDuplicates(incoming: Transaction[], existing: Transaction[]): Transaction[] {
  const rows = existing.filter((t) => t.source.parser === STATEMENT_PARSER);
  if (!rows.length) return incoming;
  const claimed = new Set<string>();
  return incoming.filter((t) => {
    const hit = findSameTransaction(t, rows, claimed);
    if (hit) claimed.add(hit.id);
    return !hit;
  });
}

export interface StatementImport {
  files: Record<string, unknown>;
  description: string;
  added: number;
}

/** Works out what a statement adds. Pure: returns the files to write. */
export function applyStatement(x: StatementExtraction, data: LeafData, fileName: string): StatementImport {
  if (!x.isStatement) throw new Error("This doesn't look like a bank or card statement");
  const last4 = x.accountLast4.replace(/\D/g, "").slice(-4);
  if (last4.length < 3) throw new Error("Couldn't find the account number in this statement");
  if (!x.bank.trim()) throw new Error("Couldn't tell which bank this statement is from");

  const instrument = `${x.bank.trim()} ${x.accountType === "credit_card" ? "Credit Card" : "A/c"} ••${last4}`;
  const key = parseInstrument(instrument)?.key;
  if (!key) throw new Error("Couldn't identify the account");
  const kind = x.accountType === "credit_card" ? "credit_card" : "bank_account";

  let rows = x.transactions.filter((r) => isoDay(r.date) && r.amount > 0);
  if (!rows.length) throw new Error("No transactions found in this statement");
  // Statements usually run oldest first; some run newest first. Balances only make sense in time order.
  if (rows[0].date > rows[rows.length - 1].date) rows = [...rows].reverse();
  const last = rows[rows.length - 1];
  if (x.accountType === "bank_account" && x.hasClosingBalance && !last.hasBalance) rows[rows.length - 1] = { ...last, hasBalance: true, balance: x.closingBalance };

  const existingById = new Set(data.transactions.map((t) => t.id));
  const alerts = data.transactions.filter((t) => t.source.parser !== STATEMENT_PARSER);
  const claimed = new Set<string>();
  const updated: Transaction[] = [];
  const incoming: Transaction[] = [];
  const seen = new Map<string, number>();
  const perDay = new Map<string, number>();
  let duplicates = 0;

  for (const r of rows) {
    const withBalance = x.accountType === "bank_account" && r.hasBalance;
    const base = `stmt:${key}:${r.date}:${r.direction[0]}:${r.amount}:${withBalance ? r.balance : ""}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    // Rows keep their printed order within a day, ahead of that day's email alerts.
    const seq = perDay.get(r.date) ?? 0;
    perDay.set(r.date, seq + 1);
    const t: Transaction = {
      id: `${base}:${n}`,
      date: r.date,
      amount: r.amount,
      currency: "INR",
      direction: r.direction,
      description: r.description || "Unknown",
      instrument,
      instrumentKind: kind,
      balanceAfter: withBalance ? r.balance : undefined,
      category: r.category,
      source: { account: "upload", messageId: fileName, parser: STATEMENT_PARSER, receivedAt: `${r.date}T00:00:00.${String(Math.min(seq, 999)).padStart(3, "0")}Z` },
    };
    if (existingById.has(t.id)) {
      duplicates++;
      continue;
    }
    const alert = findSameTransaction(t, alerts, claimed);
    if (alert) {
      claimed.add(alert.id);
      duplicates++;
      if ((alert.balanceAfter == null && t.balanceAfter != null) || !alert.instrument) updated.push(enriched(alert, t));
      continue;
    }
    incoming.push(t);
  }

  const added = applyRules(data.config, incoming);
  const label = `${x.bank.trim()} ${KIND_LABEL[kind].toLowerCase()} ••${last4}`;
  const span = `${rows[0].date} to ${rows[rows.length - 1].date}`;
  const bits = [
    `${added.length} new transaction${added.length === 1 ? "" : "s"}`,
    duplicates && `${duplicates} already tracked`,
    x.accountType === "bank_account" && x.hasClosingBalance && `closing balance ₹${x.closingBalance.toLocaleString("en-IN")}`,
  ].filter(Boolean);
  return {
    files: monthShards(data.transactions, added, updated),
    description: `${label}, ${span}: ${bits.join(", ")}`,
    added: added.length,
  };
}

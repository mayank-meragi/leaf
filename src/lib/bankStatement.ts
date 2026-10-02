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

/** The email alert (or statement row) for the same money movement as `t`, skipping ones already `claimed`. */
export function findSameTransaction(t: Transaction, candidates: Transaction[], claimed: Set<string>): Transaction | undefined {
  const key = instrumentKey(t);
  if (!key) return undefined;
  return candidates.find(
    (c) =>
      !claimed.has(c.id) &&
      c.direction === t.direction &&
      Math.abs(c.amount - t.amount) <= 0.5 &&
      dayDiff(c.date, t.date) <= 1 &&
      instrumentKey(c) === key,
  );
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
      if (alert.balanceAfter == null && t.balanceAfter != null) updated.push({ ...alert, balanceAfter: t.balanceAfter });
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

// Payment sources: cards, bank accounts, wallets.
// The model writes the instrument as free text ("SBI Card ••1111", "SBI Credit Card ••1111",
// "HDFC A/c ••2222", "HDFC Bank ••2222"), so identity is issuer + last digits, and the kind is
// inferred from the wording unless the user has set it.

import type { CardPayment, CardStatement, InstrumentKind, InstrumentMeta, LeafConfig, Transaction } from "@/types";

const ISSUERS: [id: string, label: string, pattern: RegExp][] = [
  ["hdfc", "HDFC", /\bhdfc\b/i],
  ["sbi", "SBI", /\bsbi\b|state bank/i],
  ["icici", "ICICI", /\bicici\b/i],
  ["axis", "Axis", /\baxis\b/i],
  ["kotak", "Kotak", /\bkotak\b/i],
  ["idfc", "IDFC First", /\bidfc\b/i],
  ["yes", "Yes Bank", /\byes bank\b/i],
  ["indusind", "IndusInd", /\bindusind\b/i],
  ["amex", "Amex", /\bamex\b|american express/i],
  ["au", "AU", /\bau (small finance )?bank\b/i],
  ["rbl", "RBL", /\brbl\b/i],
  ["federal", "Federal", /\bfederal\b/i],
  ["bob", "Bank of Baroda", /bank of baroda|\bbob\b/i],
  ["pnb", "PNB", /\bpnb\b|punjab national/i],
  ["canara", "Canara", /\bcanara\b/i],
  ["onecard", "OneCard", /\bone ?card\b/i],
];

export const KIND_LABEL: Record<InstrumentKind, string> = {
  credit_card: "Credit card",
  debit_card: "Debit card",
  card: "Card",
  bank_account: "Bank account",
  wallet: "Wallet",
  other: "Other",
};

/** Display order for grouped lists. */
export const KIND_ORDER: InstrumentKind[] = ["credit_card", "bank_account", "debit_card", "card", "wallet", "other"];

export interface ParsedInstrument {
  key: string;
  issuer: string;
  issuerLabel: string;
  last4: string;
  hint?: InstrumentKind;
}

export function parseInstrument(text: string | undefined): ParsedInstrument | null {
  if (!text) return null;
  const digits = text.match(/(?:••|•|x{2,}|\*{2,}|ending(?: with)?|no\.?)\s*(\d{3,6})\b/i)?.[1] ?? text.match(/(\d{4})\s*$/)?.[1];
  if (!digits) return null;
  const last4 = digits.slice(-4);
  const known = ISSUERS.find(([, , re]) => re.test(text));
  const [issuer, issuerLabel] = known ?? [text.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, "") || "unknown", text.split(/\s+/)[0]];

  let hint: InstrumentKind | undefined;
  if (/credit card/i.test(text) || /\bsbi card\b|\bamex\b|american express/i.test(text)) hint = "credit_card";
  else if (/debit card/i.test(text)) hint = "debit_card";
  else if (/\bcard\b/i.test(text)) hint = "card";
  else if (/a\/c|\baccount\b|\bacct\b/i.test(text)) hint = "bank_account";
  else if (/wallet|paytm|amazon pay|phonepe/i.test(text)) hint = "wallet";

  return { key: `${issuer}-${last4}`, issuer, issuerLabel, last4, hint };
}

export const instrumentKey = (t: Pick<Transaction, "instrument">) => parseInstrument(t.instrument)?.key ?? null;

export interface Instrument {
  key: string;
  issuerLabel: string;
  last4: string;
  kind: InstrumentKind;
  /** User's nickname, if set. */
  nickname?: string;
  /** What to show: nickname, or e.g. "SBI Credit card ••1111". */
  label: string;
  count: number;
  /** Latest transaction, bill or payment date. */
  lastUsed: string;
}

/**
 * Most specific kind wins: credit/debit beat plain "card", and a card beats "bank account"
 * (card alerts sometimes mention the linked account, never the other way round).
 */
function inferKind(votes: Map<InstrumentKind, number>): InstrumentKind {
  const n = (k: InstrumentKind) => votes.get(k) ?? 0;
  if (n("credit_card") || n("debit_card")) return n("credit_card") >= n("debit_card") ? "credit_card" : "debit_card";
  if (n("card")) return "card";
  if (n("bank_account")) return "bank_account";
  if (n("wallet")) return "wallet";
  // A bare "HDFC Bank ••2222" with nothing else to go on is almost always an account.
  return "bank_account";
}

/** A bill or payment, reduced to what `instruments` needs. */
export interface CardRecord {
  card: string;
  date: string;
}

export const cardRecords = (statements: CardStatement[], payments: CardPayment[]): CardRecord[] => [
  ...statements.map((s) => ({ card: s.card, date: s.statementDate })),
  ...payments.map((p) => ({ card: p.card, date: p.date })),
];

/**
 * Every payment source seen in transactions, plus cards known only from bills or payments
 * (e.g. cards whose issuer doesn't email per-transaction alerts).
 */
export function instruments(
  txns: Transaction[],
  config: LeafConfig,
  cardRecords: CardRecord[] = [],
): Instrument[] {
  const acc = new Map<string, { p: ParsedInstrument; votes: Map<InstrumentKind, number>; count: number; lastUsed: string }>();
  for (const t of txns) {
    const p = parseInstrument(t.instrument);
    if (!p) continue;
    const a = acc.get(p.key) ?? { p, votes: new Map(), count: 0, lastUsed: "" };
    acc.set(p.key, a);
    a.count++;
    if (t.date > a.lastUsed) a.lastUsed = t.date;
    for (const k of [t.instrumentKind, p.hint]) if (k) a.votes.set(k, (a.votes.get(k) ?? 0) + 1);
  }
  for (const { card, date } of cardRecords) {
    let a = acc.get(card);
    if (!a) {
      const [issuer, last4] = card.split("-");
      const label = ISSUERS.find(([id]) => id === issuer)?.[1] ?? issuer.charAt(0).toUpperCase() + issuer.slice(1);
      a = { p: { key: card, issuer, issuerLabel: label, last4 }, votes: new Map(), count: 0, lastUsed: "" };
      acc.set(card, a);
    }
    a.votes.set("credit_card", (a.votes.get("credit_card") ?? 0) + 1);
    if (date > a.lastUsed) a.lastUsed = date;
  }
  const meta = new Map((config.instruments ?? []).map((m) => [m.key, m]));
  return [...acc.values()]
    .map(({ p, votes, count, lastUsed }) => {
      const m = meta.get(p.key);
      const kind = m?.kind ?? inferKind(votes);
      return {
        key: p.key,
        issuerLabel: p.issuerLabel,
        last4: p.last4,
        kind,
        nickname: m?.name,
        label: m?.name || `${p.issuerLabel} ${KIND_LABEL[kind]} ••${p.last4}`,
        count,
        lastUsed,
      };
    })
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.count - a.count);
}

/** Returns config with `key`'s metadata replaced (empty fields dropped). */
export function withInstrumentMeta(config: LeafConfig, key: string, patch: Omit<InstrumentMeta, "key">): LeafConfig {
  const current = config.instruments?.find((m) => m.key === key) ?? { key };
  const next: InstrumentMeta = { ...current, ...patch };
  if (!next.name) delete next.name;
  if (!next.kind) delete next.kind;
  const rest = (config.instruments ?? []).filter((m) => m.key !== key);
  return { ...config, instruments: Object.keys(next).length > 1 ? [...rest, next] : rest };
}

// ---- Balances and bills ----

export interface SourceStatus {
  /**
   * Available balance (account) or available limit (card): the latest one an alert reported, moved forward by
   * every transaction since. `reportedOn` is when an alert last stated it; `adjusted` counts the transactions applied.
   */
  balance?: { amount: number; asOf: string; reportedOn: string; adjusted: number };
  /** Credit cards with a known statement: spends minus refunds since the statement date. */
  unbilled?: { amount: number; since: string };
  bill?: CardStatement & { paid: number; paidOn?: string; state: "paid" | "partial" | "due" | "overdue" };
}

const order = (t: Transaction) => t.source.receivedAt ?? `${t.date}T23:59:59`;
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Credits on a card that are bill payments (the model files those under Transfers), not refunds. */
const isCardPaymentCredit = (t: Transaction) => t.direction === "credit" && t.category === "Transfers";

const samePayment = (a: { amount: number; date: string }, b: { amount: number; date: string }) =>
  Math.abs(a.amount - b.amount) <= 1 && Math.abs(daysBetween(a.date, b.date)) <= 3;

/** The card payment a bank debit paid for, if any (e.g. "CRED Club −₹8,200.25" → Federal ••7777). */
export function paymentFor(t: Transaction, payments: CardPayment[]): CardPayment | undefined {
  if (t.direction !== "debit") return undefined;
  const key = instrumentKey(t);
  return payments.find((p) => p.card !== key && Math.abs(p.amount - t.amount) <= 0.5 && daysBetween(t.date, p.date) >= -1 && daysBetween(t.date, p.date) <= 3);
}

export function sourceStatus(key: string, all: Transaction[], cardStatements: CardStatement[], payments: CardPayment[], today: string): SourceStatus {
  const mine = all.filter((t) => instrumentKey(t) === key);
  const status: SourceStatus = {};

  const withBalance = mine.filter((t) => t.balanceAfter != null).sort((a, b) => order(b).localeCompare(order(a)))[0];
  if (withBalance) {
    // Many alerts (e.g. HDFC UPI) never state a balance; roll the last stated one forward so it stays current.
    const after = mine.filter((t) => order(t) > order(withBalance));
    const amount = after.reduce((b, t) => b + (t.direction === "credit" ? t.amount : -t.amount), withBalance.balanceAfter!);
    const asOf = [withBalance, ...after].map((t) => t.date).sort().at(-1)!;
    status.balance = { amount, asOf, reportedOn: withBalance.date, adjusted: after.length };
  }

  const stmt = cardStatements.filter((s) => s.card === key).sort((a, b) => b.statementDate.localeCompare(a.statementDate))[0];
  if (stmt) {
    const since = mine.filter((t) => t.date > stmt.statementDate && !isCardPaymentCredit(t));
    status.unbilled = {
      amount: since.reduce((s, t) => s + (t.direction === "debit" ? t.amount : -t.amount), 0),
      since: stmt.statementDate,
    };

    // Payments toward this bill: receipts (CRED, issuer emails), plus payment credits on the card
    // that no receipt already accounts for.
    const receipts = payments.filter((p) => p.card === key && p.date >= stmt.statementDate);
    const credits = mine
      .filter((t) => isCardPaymentCredit(t) && t.date >= stmt.statementDate && !receipts.some((p) => samePayment(p, t)))
      .map((t) => ({ amount: t.amount, date: t.date }));
    let paidList = [...receipts, ...credits];
    if (!paidList.length) {
      // No receipt at all: fall back to an exact-amount debit from a bank account before the due date.
      const until = addDays(stmt.dueDate ?? addDays(stmt.statementDate, 25), 7);
      const debit = all.find(
        (t) => t.direction === "debit" && instrumentKey(t) !== key && Math.abs(t.amount - stmt.totalDue) <= 1 && t.date >= stmt.statementDate && t.date <= until,
      );
      if (debit) paidList = [{ amount: debit.amount, date: debit.date }];
    }
    const paid = paidList.reduce((s, p) => s + p.amount, 0);
    const paidOn = paidList.map((p) => p.date).sort().at(-1);
    const state =
      stmt.totalDue <= 0 || paid >= stmt.totalDue - 1 ? "paid" : paid > 0 ? "partial" : stmt.dueDate && stmt.dueDate < today ? "overdue" : "due";
    status.bill = { ...stmt, paid, paidOn, state };
  }
  return status;
}

/**
 * Adds statements, merging duplicates: the bank's statement email and CRED's "new bill" notice describe the
 * same bill. The earlier date wins (CRED states the generation date; the bank's email arrives after it).
 */
export function mergeCardStatements(existing: CardStatement[], incoming: CardStatement[]): CardStatement[] {
  const out = [...existing];
  for (const s of incoming) {
    const i = out.findIndex((o) => o.card === s.card && Math.abs(o.totalDue - s.totalDue) <= 1 && Math.abs(daysBetween(o.statementDate, s.statementDate)) <= 7);
    if (i < 0) out.push(s);
    else {
      const o = out[i];
      out[i] = { ...o, statementDate: s.statementDate < o.statementDate ? s.statementDate : o.statementDate, dueDate: o.dueDate ?? s.dueDate, minDue: o.minDue ?? s.minDue };
    }
  }
  return out.sort((a, b) => b.statementDate.localeCompare(a.statementDate));
}

/** Adds payments, dropping duplicates (a CRED receipt and the issuer's "payment received" for one payment). */
export function mergeCardPayments(existing: CardPayment[], incoming: CardPayment[]): CardPayment[] {
  const out = [...existing];
  for (const p of incoming) if (!out.some((o) => o.card === p.card && samePayment(o, p))) out.push(p);
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Card key for a statement. Issuers mask differently ("XX4444", "XX44"), so match whatever digits are
 * shown against the issuer's known cards; with no digits, the issuer's only card.
 */
export function resolveCard(x: { issuer: string; last4: string }, cards: { key: string; last4: string }[]): string | null {
  const issuer = parseInstrument(`${x.issuer} ••0000`)?.key.split("-")[0];
  const digits = x.last4.replace(/\D/g, "");
  const same = cards.filter((c) => c.key.startsWith(`${issuer}-`) && c.last4.endsWith(digits));
  if (same.length === 1) return same[0].key;
  // A full 4 digits identifies the card even before any alert for it has been seen.
  if (digits.length >= 4 && !same.length) return `${issuer}-${digits.slice(-4)}`;
  return null;
}

/**
 * For bill/payment emails that show no card digits: the card of a record from a known card with the same
 * issuer, amount and date (e.g. OneCard's statement email ↔ CRED's bill for Federal ••7777).
 * Returns null rather than guess when nothing corroborates it: an issuer can have several cards.
 */
export function corroborate(
  issuer: string,
  amount: number,
  date: string,
  records: { card: string; amount: number; date: string }[],
): string | null {
  const prefix = `${parseInstrument(`${issuer} ••0000`)?.key.split("-")[0]}-`;
  const hit = records.find((r) => r.card.startsWith(prefix) && Math.abs(r.amount - amount) <= 1 && Math.abs(daysBetween(r.date, date)) <= 10);
  return hit?.card ?? null;
}

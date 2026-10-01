import type { LeafData } from "./db";
import { cardRecords, instrumentKey, instruments, sourceStatus } from "./instruments";

/** The current month, unless nothing has landed in it yet (the 1st, or before the first sync of the month). */
export function activeMonth(transactions: LeafData["transactions"], today: string): string {
  const current = today.slice(0, 7);
  const months = transactions.filter((t) => t.currency === "INR").map((t) => t.date.slice(0, 7));
  return months.includes(current) ? current : (months.sort().at(-1) ?? current);
}

/** Every recently used card and account with its money in and out for `month`, plus its bill or balance. */
export function sourcesWithStatus(data: LeafData, month: string, today: string) {
  const flows = new Map<string, { out: number; in: number }>();
  for (const t of data.transactions) {
    if (!t.date.startsWith(month) || t.currency !== "INR") continue;
    const key = instrumentKey(t);
    if (!key) continue;
    const f = flows.get(key) ?? { out: 0, in: 0 };
    flows.set(key, f);
    if (t.direction === "debit") f.out += t.amount;
    else f.in += t.amount;
  }
  // Cards and accounts with nothing in the last two months (old or closed ones) stay out of the way.
  const recent = new Date(Date.parse(today) - 60 * 86_400_000).toISOString().slice(0, 10);
  return instruments(data.transactions, data.config, cardRecords(data.cardStatements, data.cardPayments))
    .filter((i) => i.lastUsed >= recent)
    .map((i) => ({
      ...i,
      ...(flows.get(i.key) ?? { out: 0, in: 0 }),
      ...sourceStatus(i.key, data.transactions, data.cardStatements, data.cardPayments, today),
    }));
}

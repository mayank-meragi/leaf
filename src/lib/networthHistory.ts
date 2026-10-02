// Net worth at each month-end, rebuilt from what Leaf already holds: mutual fund units × NAV, the running balance
// in bank alerts and statements, the latest passbook / statement balance for everything else, and card dues from
// bills. The last point is today's figure, so the line ends where the Net worth page does.

import type { LeafData } from "./db";
import { cardRecords, instruments, sourceStatus } from "./instruments";
import { cardDue, computeNetWorth } from "./networth";
import { monthEnds, type ValuePoint } from "./performance";
import { accountValue, WEALTH_KINDS } from "./wealth";

export interface HistoryPoint {
  date: string;
  assets: Record<string, number>;
  liabilities: Record<string, number>;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

export interface NetWorthHistory {
  points: HistoryPoint[];
  /** First date each group had a value. Earlier points leave it out because it wasn't tracked yet, not because it was zero. */
  trackedFrom: Record<string, string>;
}

const sum = (r: Record<string, number>) => Object.values(r).reduce((s, v) => s + v, 0);
const add = (r: Record<string, number>, k: string, v: number) => {
  if (Math.abs(v) >= 1) r[k] = (r[k] ?? 0) + v;
};

/** Every date any data starts from, as a YYYY-MM-DD (or undefined if there is none). */
function earliest(data: LeafData, mf: ValuePoint[]): string | undefined {
  const dates = [
    mf[0]?.date,
    ...data.wealthSnapshots.map((s) => s.date),
    ...data.wealthFlows.map((f) => f.date),
    ...data.transactions.filter((t) => t.balanceAfter != null).map((t) => t.date),
  ].filter((d): d is string => !!d);
  return dates.sort()[0];
}

/**
 * `mfValues` are month-end mutual fund values (from `valueHistory`), or null when NAVs aren't available.
 * Months are month-ends from the first data to last month, then `today`.
 */
export function netWorthHistory(data: LeafData, mfValues: ValuePoint[] | null, today: string): NetWorthHistory {
  const mf = mfValues ?? [];
  const start = earliest(data, mf);
  if (!start) return { points: [], trackedFrom: {} };

  const bankKeys = instruments(data.transactions, data.config, cardRecords(data.cardStatements, data.cardPayments));
  const banks = bankKeys.filter((s) => s.kind === "bank_account");
  const cards = bankKeys.filter((s) => s.kind === "credit_card" || s.kind === "card");
  const mfAt = (date: string) => [...mf].reverse().find((p) => p.date <= date)?.value ?? 0;

  const at = (date: string): HistoryPoint => {
    const assets: Record<string, number> = {};
    const liabilities: Record<string, number> = {};
    add(assets, "Mutual funds", mfAt(date));

    const txns = data.transactions.filter((t) => t.date <= date);
    for (const b of banks) add(assets, "Bank accounts", sourceStatus(b.key, txns, [], [], date).balance?.amount ?? 0);
    const stmts = data.cardStatements.filter((s) => s.statementDate <= date);
    const pays = data.cardPayments.filter((p) => p.date <= date);
    for (const c of cards) add(liabilities, "Credit cards", cardDue(sourceStatus(c.key, txns, stmts, pays, date)).amount);

    const snaps = data.wealthSnapshots.filter((s) => s.date <= date);
    const flows = data.wealthFlows.filter((f) => f.date <= date);
    for (const a of data.wealthAccounts) {
      const v = accountValue(a.id, snaps, flows, date).value;
      const kind = WEALTH_KINDS[a.kind];
      add(kind.liability ? liabilities : assets, kind.label, v);
    }
    return { date, assets, liabilities, totalAssets: sum(assets), totalLiabilities: sum(liabilities), netWorth: sum(assets) - sum(liabilities) };
  };

  // Month-ends strictly before today, then today as the live figure.
  const past = monthEnds(start, today).filter((d) => d < today);
  const points = past.map(at);
  const now = computeNetWorth(data, today);
  const assets: Record<string, number> = {};
  const liabilities: Record<string, number> = {};
  for (const l of now.assets) add(assets, l.group, l.value);
  for (const l of now.liabilities) add(liabilities, l.group, l.value);
  points.push({ date: today, assets, liabilities, totalAssets: sum(assets), totalLiabilities: sum(liabilities), netWorth: now.total });

  const trackedFrom: Record<string, string> = {};
  for (const p of points) for (const g of [...Object.keys(p.assets), ...Object.keys(p.liabilities)]) trackedFrom[g] ??= p.date;
  return { points, trackedFrom };
}


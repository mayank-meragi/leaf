import type { CASStatement } from "@/types";
import { groupSchemes } from "./capitalGains";

export interface DividendEvent {
  date: string;
  scheme: string;
  amount: number;
  /** Bought more units with it instead of paying it out. */
  reinvested: boolean;
}

export interface DividendYear {
  /** Indian financial year, e.g. "FY 2025-26". */
  fy: string;
  total: number;
  payout: number;
  reinvested: number;
}

export interface DividendScheme {
  scheme: string;
  total: number;
  count: number;
  last: string;
}

export interface DividendSummary {
  total: number;
  payout: number;
  reinvested: number;
  events: DividendEvent[];
  byYear: DividendYear[];
  byScheme: DividendScheme[];
  /** Total by calendar month ("2026-03"), oldest first. */
  byMonth: { month: string; total: number }[];
}

/** "FY 2025-26" for a date between April 2025 and March 2026. */
export function financialYear(date: string) {
  const y = Number(date.slice(0, 4));
  const start = Number(date.slice(5, 7)) >= 4 ? y : y - 1;
  return `FY ${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Every dividend credited on a mutual fund, paid out or reinvested, newest first. */
export function dividendEvents(statements: CASStatement[]): DividendEvent[] {
  const out: DividendEvent[] = [];
  for (const g of groupSchemes(statements))
    for (const t of g.txns) {
      if (t.type !== "DIVIDEND_PAYOUT" && t.type !== "DIVIDEND_REINVEST") continue;
      const amount = Math.abs(t.amount ?? 0);
      if (amount > 0) out.push({ date: t.date, scheme: g.name, amount, reinvested: t.type === "DIVIDEND_REINVEST" });
    }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export function dividendSummary(statements: CASStatement[]): DividendSummary {
  const events = dividendEvents(statements);
  const years = new Map<string, DividendYear>();
  const schemes = new Map<string, DividendScheme>();
  const months = new Map<string, number>();
  let payout = 0;
  let reinvested = 0;

  for (const e of events) {
    const fy = financialYear(e.date);
    const y = years.get(fy) ?? { fy, total: 0, payout: 0, reinvested: 0 };
    y.total += e.amount;
    y[e.reinvested ? "reinvested" : "payout"] += e.amount;
    years.set(fy, y);

    const s = schemes.get(e.scheme) ?? { scheme: e.scheme, total: 0, count: 0, last: "" };
    s.total += e.amount;
    s.count += 1;
    if (e.date > s.last) s.last = e.date;
    schemes.set(e.scheme, s);

    months.set(e.date.slice(0, 7), (months.get(e.date.slice(0, 7)) ?? 0) + e.amount);
    if (e.reinvested) reinvested += e.amount;
    else payout += e.amount;
  }

  return {
    total: payout + reinvested,
    payout,
    reinvested,
    events,
    byYear: [...years.values()].sort((a, b) => b.fy.localeCompare(a.fy)),
    byScheme: [...schemes.values()].sort((a, b) => b.total - a.total),
    byMonth: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, total]) => ({ month, total })),
  };
}

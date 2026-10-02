// EPF across employers: one UAN, a separate passbook (account) per employer. This rolls them into one picture.

import type { WealthAccount, WealthFlow, WealthSnapshot } from "@/types";
import { accountValue, type AccountValue } from "./wealth";

export interface EpfAccount extends AccountValue {
  account: WealthAccount;
  /** Share of the combined balance, 0–1. */
  share: number;
  /** Saved balances, newest first. */
  history: WealthSnapshot[];
  /** Employee / employer split from the latest passbook that has one. */
  breakdown?: NonNullable<WealthSnapshot["breakdown"]>;
}

export interface EpfOverview {
  total: number;
  /** The oldest of the accounts' dates: the combined figure is only as fresh as this. */
  asOf?: string;
  stale: boolean;
  accounts: EpfAccount[];
  /** Combined balance on each date a passbook was saved (every account at its latest balance by then). */
  history: { date: string; value: number }[];
}

export function epfOverview(accounts: WealthAccount[], snapshots: WealthSnapshot[], flows: WealthFlow[], today: string): EpfOverview {
  const epf = accounts.filter((a) => a.kind === "epf");
  const values = epf.map((account) => {
    const history = snapshots.filter((s) => s.account === account.id).sort((a, b) => b.date.localeCompare(a.date));
    const latestSplit = history.find((s) => s.breakdown)?.breakdown;
    return { account, ...accountValue(account.id, snapshots, flows, today), history, breakdown: latestSplit };
  });
  const total = values.reduce((s, v) => s + v.value, 0);
  const dates = values.map((v) => v.asOf).filter((d): d is string => !!d);

  const ids = new Set(epf.map((a) => a.id));
  const days = [...new Set(snapshots.filter((s) => ids.has(s.account)).map((s) => s.date))].sort();
  const history = days.map((date) => ({
    date,
    value: values.reduce((sum, v) => sum + (v.history.find((s) => s.date <= date)?.value ?? 0), 0),
  }));

  return {
    total,
    asOf: dates.sort()[0],
    stale: values.some((v) => v.stale),
    accounts: values.map((v) => ({ ...v, share: total ? v.value / total : 0 })).sort((a, b) => b.value - a.value),
    history,
  };
}

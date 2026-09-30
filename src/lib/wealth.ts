// Net worth: mutual funds (CAS) + bank balances (alerts) + everything tracked as a WealthAccount,
// minus card dues and loans.

import type { WealthAccount, WealthFlow, WealthKind, WealthSnapshot } from "@/types";

export const WEALTH_KINDS: Record<WealthKind, { label: string; liability?: boolean }> = {
  epf: { label: "EPF" },
  ppf: { label: "PPF" },
  nps: { label: "NPS" },
  fd: { label: "Fixed deposit" },
  stocks: { label: "Stocks" },
  gold: { label: "Gold" },
  property: { label: "Property" },
  other_asset: { label: "Other asset" },
  loan: { label: "Loan", liability: true },
  other_liability: { label: "Other liability", liability: true },
};

/** Values older than this are flagged so a stale passbook doesn't pass for current. */
export const STALE_DAYS = 100;

export interface AccountValue {
  value: number;
  /** Date of the snapshot the value is based on. */
  asOf?: string;
  /** Contributions / withdrawals added since that snapshot. */
  flowsSince: number;
  stale: boolean;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/**
 * Latest snapshot plus money moved in or out after it. Growth between statements (interest, NAV) isn't
 * modelled; the next statement corrects it. With no snapshot at all, the flows alone are the best guess.
 */
export function accountValue(id: string, snapshots: WealthSnapshot[], flows: WealthFlow[], today: string): AccountValue {
  const snap = snapshots.filter((s) => s.account === id).sort((a, b) => b.date.localeCompare(a.date))[0];
  const since = flows.filter((f) => f.account === id && (!snap || f.date > snap.date));
  const flowsSince = since.reduce((s, f) => s + (f.kind === "contribution" ? f.amount : -f.amount), 0);
  const asOf = snap?.date ?? since.map((f) => f.date).sort().at(-1);
  return { value: (snap?.value ?? 0) + flowsSince, asOf, flowsSince, stale: !asOf || daysBetween(asOf, today) > STALE_DAYS };
}

export interface NetWorthLine {
  key: string;
  label: string;
  group: string;
  value: number;
  asOf?: string;
  stale?: boolean;
  note?: string;
}

export interface NetWorth {
  assets: NetWorthLine[];
  liabilities: NetWorthLine[];
  total: number;
}

export function netWorth(parts: { assets: NetWorthLine[]; liabilities: NetWorthLine[] }): NetWorth {
  const sum = (l: NetWorthLine[]) => l.reduce((s, x) => s + x.value, 0);
  const nonZero = (l: NetWorthLine[]) => l.filter((x) => Math.abs(x.value) >= 1).sort((a, b) => b.value - a.value);
  return { assets: nonZero(parts.assets), liabilities: nonZero(parts.liabilities), total: sum(parts.assets) - sum(parts.liabilities) };
}

/** Lines for tracked accounts, split into assets and liabilities by kind. */
export function wealthLines(accounts: WealthAccount[], snapshots: WealthSnapshot[], flows: WealthFlow[], today: string) {
  const assets: NetWorthLine[] = [];
  const liabilities: NetWorthLine[] = [];
  for (const a of accounts) {
    const v = accountValue(a.id, snapshots, flows, today);
    const line: NetWorthLine = {
      key: a.id,
      label: a.name,
      group: WEALTH_KINDS[a.kind].label,
      value: v.value,
      asOf: v.asOf,
      stale: v.stale,
      note: v.flowsSince && v.asOf ? "includes contributions since the last statement" : undefined,
    };
    (WEALTH_KINDS[a.kind].liability ? liabilities : assets).push(line);
  }
  return { assets, liabilities };
}

const norm = (s?: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The existing account a document belongs to: same kind, and the same reference (last digits of
 * account / PRAN / UAN) or, failing that, the same institution when it's the only one of its kind there.
 */
export function matchAccount(accounts: WealthAccount[], kind: WealthKind, institution?: string, ref?: string): WealthAccount | undefined {
  const same = accounts.filter((a) => a.kind === kind);
  const digits = (ref ?? "").replace(/\D/g, "");
  if (digits.length >= 3) {
    const tail = digits.slice(-4);
    const byRef = same.find((a) => (a.ref ?? "").replace(/\D/g, "").slice(-4) === tail);
    if (byRef) return byRef;
  }
  const byInst = same.filter((a) => institution && norm(a.institution) && (norm(a.institution).includes(norm(institution)) || norm(institution).includes(norm(a.institution))));
  if (byInst.length === 1) return byInst[0];
  return same.length === 1 && !digits ? same[0] : undefined;
}

export const newAccountId = (kind: WealthKind) => `${kind}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Indian financial year for a date: 2026-05-10 → "2026-27". */
export function financialYear(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

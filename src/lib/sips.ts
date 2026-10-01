import type { CASStatement, MFTransaction } from "@/types";
import { addMonths } from "./capitalGains";
import { latestStatements, schemeKey } from "./portfolio";

export type Cadence = "Monthly" | "Quarterly" | "Irregular";

/**
 * One SIP, or a few that share a folio and due day: a run of instalments in one folio that land on about the same
 * day of the month. A fund usually has several (different folios, or several SIPs in one folio on different days),
 * so reading a fund as a single stream gets the cadence, status and amount wrong.
 */
export interface SipStream {
  folio: string;
  /** Day of the month the instalment is due; holiday shifts of a few days still count as this day. */
  day: number;
  cadence: Cadence;
  /** Most recent instalment. */
  amount: number;
  /** What it typically puts in per month: the median over its last months, so one skipped month doesn't distort it. */
  monthly: number;
  /** Instalments it typically makes when it runs (more than one when several SIPs share a folio and day). */
  perMonth: number;
  count: number;
  invested: number;
  first: string;
  last: string;
  /** Expected date of the next instalment (active monthly streams only). */
  next?: string;
  active: boolean;
  /** Only tracked when the stream is a single SIP; several interleaved SIPs would look like constant step-ups. */
  stepUps: { date: string; from: number; to: number }[];
  /** One entry (YYYY-MM) per instalment that should have landed and didn't, for monthly streams. */
  missed: string[];
  bounced: { date: string; amount: number }[];
}

/** Everything running in one scheme. */
export interface SipPlan {
  scheme: string;
  amc: string;
  streams: SipStream[];
  /** Any stream still running. */
  active: boolean;
  /** What the running streams put in per month. */
  monthly: number;
  /** Instalments a month the running streams make. */
  sips: number;
  count: number;
  invested: number;
  first: string;
  last: string;
  next?: string;
  stepUps: SipStream["stepUps"];
  missed: string[];
  bounced: SipStream["bounced"];
}

export interface SipSummary {
  plans: SipPlan[];
  active: SipPlan[];
  /** Instalments a month that running SIPs make, across all schemes. */
  activeSips: number;
  /** Running SIPs, normalised to a month. */
  monthlyOutflow: number;
  asOf?: string;
}

const days = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const amountOf = (t: MFTransaction) => Math.abs(t.amount ?? 0);
/** Most common value; a tie goes to the smaller one. */
const mode = (xs: number[]) => {
  const c = new Map<number, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 1;
};

// An instalment due on a weekend or holiday is processed on the next business day, a few days late.
const MAX_SHIFT = 4;
// How many of a stream's latest months define what it "typically" does.
const TYPICAL_MONTHS = 3;
const RECENT_MONTHS = 6;

const ym = (iso: string) => iso.slice(0, 7);
const dom = (iso: string) => Number(iso.slice(8, 10));
const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
const monthsBetween = (from: string, to: string) => {
  const out: string[] = [];
  for (let m = ym(from); m <= ym(to); m = ym(addMonths(`${m}-01`, 1))) out.push(m);
  return out;
};

interface Instalment {
  date: string;
  amount: number;
  bounced: boolean;
}

/**
 * Splits a folio's instalments into SIPs by day of month. A SIP is due on a fixed day and only ever runs late, so the
 * earliest day in a cluster is its due day, and instalments up to a few days after it are that SIP on a holiday.
 */
export function splitByDay(items: Instalment[]): Instalment[][] {
  const peaks: number[] = [];
  const peakOf = new Map<number, number>();
  for (const d of [...new Set(items.map((i) => dom(i.date)))].sort((a, b) => a - b)) {
    const near = peaks.find((p) => (d - p + 31) % 31 <= MAX_SHIFT);
    if (near == null) peaks.push(d);
    peakOf.set(d, near ?? d);
  }
  const groups = new Map<number, Instalment[]>();
  for (const i of items) {
    const p = peakOf.get(dom(i.date))!;
    groups.set(p, [...(groups.get(p) ?? []), i]);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g.sort((a, b) => a.date.localeCompare(b.date)));
}

interface FolioScheme {
  name: string;
  amc: string;
  folio: string;
  txns: MFTransaction[];
}

/** Every scheme in every folio of the freshest statements (MF Central's folio-less rows go under folio ""). */
function folioSchemes(statements: CASStatement[]): FolioScheme[] {
  const out = new Map<string, FolioScheme>();
  const add = (name: string, amc: string, folio: string, txns: MFTransaction[]) => {
    const k = `${schemeKey(name)}|${folio}`;
    const e = out.get(k) ?? { name: name.trim(), amc, folio, txns: [] };
    e.txns.push(...txns);
    out.set(k, e);
  };
  for (const s of latestStatements(statements)) {
    for (const f of s.folios) for (const sc of f.schemes) add(sc.name, f.amc, f.folio, sc.transactions);
    for (const st of s.schemeTransactions ?? []) add(st.scheme, st.amc ?? "", "", st.transactions);
  }
  return [...out.values()];
}

function buildStream(folio: string, items: Instalment[], asOf: string | undefined): SipStream | null {
  const live = items.filter((i) => !i.bounced);
  const bounced = items.filter((i) => i.bounced).map((i) => ({ date: i.date, amount: i.amount }));
  if (live.length + bounced.length < 2 || !live.length) return null;

  // Month by month: what landed (bounced instalments count as landing, they're reported separately).
  const perMonthTotals = new Map<string, { sum: number; count: number }>();
  for (const i of items) {
    const e = perMonthTotals.get(ym(i.date)) ?? { sum: 0, count: 0 };
    if (!i.bounced) e.sum += i.amount;
    e.count += 1;
    perMonthTotals.set(ym(i.date), e);
  }
  const present = [...perMonthTotals.keys()].sort();
  const recent = present.slice(-RECENT_MONTHS).map((m) => perMonthTotals.get(m)!);

  // How often it runs: the most common gap between months it ran in, so one skipped month doesn't change it.
  const gapMonths = present.slice(1).map((m, k) => monthIndex(m) - monthIndex(present[k]));
  const every = gapMonths.length ? mode(gapMonths) : 1;
  const cadence: Cadence = every === 1 ? "Monthly" : every === 3 ? "Quarterly" : "Irregular";

  const last = live.at(-1)!.date;
  const first = items[0].date;
  const active = asOf != null && days(last, asOf) <= every * 30.44 + 15;

  const perMonth = Math.max(1, median(recent.map((r) => r.count)));
  const monthly = median(recent.map((r) => r.sum)) / every;

  const stepUps: SipStream["stepUps"] = [];
  if (perMonth === 1) {
    live.forEach((i, k) => {
      if (k > 0 && Math.abs(i.amount - live[k - 1].amount) >= 1) stepUps.push({ date: i.date, from: live[k - 1].amount, to: i.amount });
    });
  }

  // Instalments missing against what the stream was doing in the months just before: a SIP that started later isn't
  // faulted for months before it existed, and one that stopped is only briefly counted as short.
  const missed: string[] = [];
  if (cadence === "Monthly") {
    const counts: number[] = [];
    for (const m of monthsBetween(first, last)) {
      const got = perMonthTotals.get(m)?.count ?? 0;
      const expected = counts.length ? median(counts.slice(-TYPICAL_MONTHS)) : 0;
      for (let k = got; k < expected; k++) missed.push(m);
      if (got > 0 || counts.length) counts.push(got);
    }
  }

  return {
    folio,
    day: median(live.map((i) => dom(i.date))),
    cadence,
    amount: live.at(-1)!.amount,
    monthly,
    perMonth,
    count: live.length,
    invested: live.reduce((s, i) => s + i.amount, 0),
    first,
    last,
    next: active && cadence === "Monthly" ? addMonths(last, 1) : undefined,
    active,
    stepUps,
    missed,
    bounced,
  };
}

/** SIPs found in the statements, grouped by scheme. */
export function sips(statements: CASStatement[]): SipSummary {
  const asOf = latestStatements(statements).map((s) => s.statementPeriod.to).sort().at(-1);
  const byScheme = new Map<string, { name: string; amc: string; streams: SipStream[] }>();

  for (const fs of folioSchemes(statements)) {
    const buys = fs.txns.filter((t) => t.type === "PURCHASE_SIP").sort((a, b) => a.date.localeCompare(b.date));
    if (!buys.length) continue;
    // An instalment that bounced is listed and then reversed: it never happened, but tell the user.
    const items: Instalment[] = buys.map((t) => ({ date: t.date, amount: amountOf(t), bounced: false }));
    for (const r of fs.txns.filter((t) => t.type === "REVERSAL").sort((a, b) => a.date.localeCompare(b.date))) {
      for (let i = items.length - 1; i >= 0; i--) {
        if (!items[i].bounced && items[i].date <= r.date && days(items[i].date, r.date) <= 10 && Math.abs(items[i].amount - amountOf(r)) < 1) {
          items[i].bounced = true;
          break;
        }
      }
    }
    for (const group of splitByDay(items)) {
      const stream = buildStream(fs.folio, group, asOf);
      if (!stream) continue;
      const e = byScheme.get(schemeKey(fs.name)) ?? { name: fs.name, amc: fs.amc, streams: [] };
      e.streams.push(stream);
      byScheme.set(schemeKey(fs.name), e);
    }
  }

  const plans: SipPlan[] = [...byScheme.values()].map(({ name, amc, streams }) => {
    streams.sort((a, b) => Number(b.active) - Number(a.active) || b.monthly - a.monthly || a.day - b.day);
    const running = streams.filter((s) => s.active);
    return {
      scheme: name,
      amc,
      streams,
      active: running.length > 0,
      monthly: running.reduce((s, x) => s + x.monthly, 0),
      sips: running.reduce((s, x) => s + x.perMonth, 0),
      count: streams.reduce((s, x) => s + x.count, 0),
      invested: streams.reduce((s, x) => s + x.invested, 0),
      first: streams.map((x) => x.first).sort()[0],
      last: streams.map((x) => x.last).sort().at(-1)!,
      next: running.map((x) => x.next).filter((d): d is string => !!d).sort()[0],
      stepUps: streams.flatMap((x) => x.stepUps).sort((a, b) => a.date.localeCompare(b.date)),
      missed: streams.flatMap((x) => x.missed),
      bounced: streams.flatMap((x) => x.bounced),
    };
  });

  plans.sort((a, b) => Number(b.active) - Number(a.active) || b.monthly - a.monthly || b.invested - a.invested);
  const active = plans.filter((p) => p.active);
  return {
    plans,
    active,
    activeSips: active.reduce((s, p) => s + p.sips, 0),
    monthlyOutflow: active.reduce((s, p) => s + p.monthly, 0),
    asOf,
  };
}

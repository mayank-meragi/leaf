import type { MFTransaction } from "@/types";
import { addMonths, type SchemeGroup } from "./capitalGains";
import { navOn, type NavSeries } from "./nav";
import { flowOf, schemeKey } from "./portfolio";
import { xirr, type Flow } from "./xirr";

export type NavLookup = (g: SchemeGroup) => NavSeries | undefined;

const isDividend = (t: MFTransaction) => t.type === "DIVIDEND_PAYOUT" || t.type === "DIVIDEND_REINVEST";

/** Units held before the statement, inferred from what's held now and what the transactions explain. */
export const openingUnits = (g: SchemeGroup) => Math.max(g.opening, g.close - g.txns.reduce((s, t) => s + (t.units ?? 0), 0), 0);

/** Nothing held before the statement began and the transactions explain every unit: XIRR-safe. */
export function hasFullHistory(g: SchemeGroup) {
  const net = g.txns.reduce((s, t) => s + (t.units ?? 0), 0);
  return Math.abs(g.opening) < 0.001 && Math.abs(g.opening + net - g.close) <= Math.max(0.01, g.close * 0.001);
}

/** Month-ends from `from` to `to`, then `to` itself. */
export function monthEnds(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addMonths(`${m}-01`, 1).slice(0, 7)) {
    const end = addMonths(`${m}-01`, 1);
    const last = new Date(Date.parse(`${end}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    if (last >= from && last < to) out.push(last);
  }
  out.push(to);
  return out;
}

const byDate = (a: MFTransaction, b: MFTransaction) => a.date.localeCompare(b.date);

export interface ValuePoint {
  date: string;
  value: number;
  /** Cash put in net of cash taken out (dividends excluded), for transactions the statements show. */
  invested: number;
}

export interface ValueHistory {
  points: ValuePoint[];
  /** Schemes with no NAV series, left out of `points`. */
  missing: string[];
}

/** Units × NAV at each month-end, summed over schemes. */
export function valueHistory(groups: SchemeGroup[], navOf: NavLookup, asOf: string): ValueHistory {
  const usable: { g: SchemeGroup; nav: NavSeries; txns: MFTransaction[] }[] = [];
  const missing: string[] = [];
  for (const g of groups) {
    const nav = navOf(g);
    if (!nav) missing.push(g.name);
    else if (g.txns.length || g.close > 0) usable.push({ g, nav, txns: [...g.txns].sort(byDate) });
  }
  const starts = usable.map((u) => u.txns[0]?.date).filter((d): d is string => !!d).sort();
  if (!starts.length) return { points: [], missing };

  const dates = monthEnds(starts[0], asOf);
  const state = usable.map((u) => ({ ...u, i: 0, units: openingUnits(u.g), invested: 0 }));
  const points = dates.map((date) => {
    let value = 0;
    let invested = 0;
    for (const s of state) {
      while (s.i < s.txns.length && s.txns[s.i].date <= date) {
        const t = s.txns[s.i++];
        s.units += t.units ?? 0;
        if (!isDividend(t)) s.invested -= flowOf(t);
      }
      invested += s.invested;
      if (s.units > 1e-6) value += s.units * (navOn(s.nav, date) ?? s.nav.data[0]?.[1] ?? 0);
    }
    return { date, value, invested };
  });
  return { points, missing };
}

export interface BenchmarkComparison {
  /** Annualised return of your cashflows. */
  mine: number | null;
  /** The same cashflows put into the benchmark. */
  bench: number | null;
  mineValue: number;
  benchValue: number;
  invested: number;
  from: string;
  schemes: string[];
  /** Schemes left out because their history starts mid-way. */
  excluded: string[];
  /** Set when your money went in before the benchmark existed. */
  benchStartsAfter?: string;
  curve: { date: string; mine: number; bench: number }[];
}

/**
 * What the same purchases would be worth had each one gone into the benchmark instead.
 * Only schemes with full history can be compared, as for XIRR.
 */
export function compareBenchmark(groups: SchemeGroup[], bench: NavSeries, navOf: NavLookup, asOf: string): BenchmarkComparison | null {
  const full = groups.filter((g) => hasFullHistory(g) && g.txns.length);
  const excluded = groups.filter((g) => !hasFullHistory(g) && g.close > 1e-4).map((g) => g.name);
  if (!full.length) return null;

  const flows: Flow[] = full.flatMap((g) => g.txns.map((t) => ({ date: t.date, amount: flowOf(t) }))).filter((f) => f.amount !== 0).sort((a, b) => a.date.localeCompare(b.date));
  if (!flows.length) return null;
  const from = flows[0].date;
  const mineValue = full.reduce((s, g) => s + g.value, 0);
  const benchNav = (d: string) => navOn(bench, d) ?? bench.data[0]?.[1] ?? 1;

  let units = 0;
  for (const f of flows) units -= f.amount / benchNav(f.date);
  const benchValue = units * benchNav(asOf);

  const mineFlows = [...flows, { date: asOf, amount: mineValue }];
  const benchFlows = [...flows, { date: asOf, amount: benchValue }];

  // Month-end curve of both, from the same flows.
  const hist = valueHistory(full, navOf, asOf);
  let bu = 0;
  let k = 0;
  const curve = hist.points.map((p) => {
    for (; k < flows.length && flows[k].date <= p.date; k++) bu -= flows[k].amount / benchNav(flows[k].date);
    return { date: p.date, mine: p.value, bench: bu * benchNav(p.date) };
  });

  return {
    mine: xirr(mineFlows),
    bench: benchValue > 0 ? xirr(benchFlows) : null,
    mineValue,
    benchValue,
    invested: -flows.filter((f) => f.amount < 0).reduce((s, f) => s + f.amount, 0),
    from,
    schemes: full.map((g) => g.name),
    excluded,
    benchStartsAfter: bench.data[0] && from < bench.data[0][0] ? bench.data[0][0] : undefined,
    curve,
  };
}

export const groupKey = (g: SchemeGroup) => schemeKey(g.name);

import { navOn, type NavSeries } from "./nav";
import { monthEnds, type ValuePoint } from "./performance";

/** Assumed risk-free rate for Sharpe, Sortino and alpha: roughly a 1-year T-bill / liquid fund. */
export const RISK_FREE = 0.065;
/** Fewest monthly returns worth quoting ratios from. */
export const MIN_MONTHS = 12;

export interface NavPoint {
  date: string;
  nav: number;
}

/** Month-end NAVs from the series' first full month to `asOf`. */
export function monthlyNavs(series: NavSeries, asOf: string): NavPoint[] {
  const first = series.data[0]?.[0];
  if (!first) return [];
  return monthEnds(first, asOf).flatMap((date) => {
    const nav = navOn(series, date);
    return nav == null ? [] : [{ date, nav }];
  });
}

const returnsOf = (v: number[]) => v.slice(1).map((x, i) => x / v[i] - 1);
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
const stdev = (x: number[]) => {
  const m = mean(x);
  return Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1));
};

export interface Rolling {
  years: number;
  /** Number of windows. */
  n: number;
  median: number;
  worst: number;
  best: number;
  /** Share of windows with a positive return. */
  positive: number;
  /** Share of windows that beat the benchmark over the same dates; null without a benchmark. */
  beat: number | null;
}

/** Annualised return over every `years`-long window that ends at a month-end. */
export function rollingReturns(navs: NavPoint[], years: number, bench?: NavSeries): Rolling | null {
  const w = years * 12;
  if (navs.length <= w) return null;
  const rets: number[] = [];
  let beat = 0;
  let compared = 0;
  for (let i = w; i < navs.length; i++) {
    const a = navs[i].nav / navs[i - w].nav;
    rets.push(a ** (1 / years) - 1);
    const b0 = bench && navOn(bench, navs[i - w].date);
    const b1 = bench && navOn(bench, navs[i].date);
    if (b0 && b1) {
      compared++;
      if (a > b1 / b0) beat++;
    }
  }
  const sorted = [...rets].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return {
    years,
    n: rets.length,
    median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    worst: sorted[0],
    best: sorted.at(-1)!,
    positive: rets.filter((r) => r > 0).length / rets.length,
    beat: compared ? beat / compared : null,
  };
}

export interface Drawdown {
  /** Negative fraction, e.g. -0.32. */
  depth: number;
  peak: string;
  trough: string;
  /** Whether the value later got back to the peak. */
  recovered: boolean;
}

/** Worst fall from a high to a later low. */
export function maxDrawdown(points: { date: string; v: number }[]): Drawdown | null {
  if (points.length < 2) return null;
  let top = points[0];
  let worst: Drawdown = { depth: 0, peak: points[0].date, trough: points[0].date, recovered: true };
  let worstPeak = points[0].v;
  for (const p of points) {
    if (p.v > top.v) top = p;
    const d = p.v / top.v - 1;
    if (d < worst.depth) {
      worst = { depth: d, peak: top.date, trough: p.date, recovered: false };
      worstPeak = top.v;
    }
  }
  if (worst.depth < 0) worst.recovered = points.some((p) => p.date > worst.trough && p.v >= worstPeak);
  return worst;
}

export interface RiskStats {
  months: number;
  /** Annualised standard deviation of monthly returns. */
  volatility: number;
  sharpe: number | null;
  sortino: number | null;
  /** Null without a benchmark. */
  beta: number | null;
  /** Jensen's alpha, annualised. */
  alpha: number | null;
}

/** Ratios from aligned monthly returns of a fund and (optionally) its benchmark. */
export function riskStats(fund: number[], bench: number[] | null, rf = RISK_FREE): RiskStats | null {
  const n = fund.length;
  if (n < MIN_MONTHS) return null;
  const rfm = (1 + rf) ** (1 / 12) - 1;
  const excess = fund.map((r) => r - rfm);
  const sd = stdev(fund);
  const down = Math.sqrt(excess.reduce((s, e) => s + Math.min(0, e) ** 2, 0) / n);

  let beta: number | null = null;
  let alpha: number | null = null;
  if (bench && bench.length === n) {
    const mb = mean(bench);
    const mf = mean(fund);
    const varB = bench.reduce((s, b) => s + (b - mb) ** 2, 0) / (n - 1);
    if (varB > 0) {
      beta = fund.reduce((s, r, i) => s + (r - mf) * (bench[i] - mb), 0) / (n - 1) / varB;
      alpha = 12 * (mean(excess) - beta * (mb - rfm));
    }
  }
  return {
    months: n,
    volatility: sd * Math.sqrt(12),
    sharpe: sd > 0 ? (mean(excess) / sd) * Math.sqrt(12) : null,
    sortino: down > 0 ? (mean(excess) / down) * Math.sqrt(12) : null,
    beta,
    alpha,
  };
}

/** The last `months` NAV points and the benchmark's returns over the same dates. */
export function alignedReturns(navs: NavPoint[], bench: NavSeries | undefined, months: number) {
  const tail = navs.slice(-(months + 1));
  const fund = returnsOf(tail.map((p) => p.nav));
  const b = bench ? tail.map((p) => navOn(bench, p.date)) : [];
  const benchReturns = bench && b.every((x): x is number => x != null && x > 0) ? returnsOf(b) : null;
  return { dates: tail.slice(1).map((p) => p.date), fund, bench: benchReturns };
}

/** Monthly returns of a portfolio with cashflows (modified Dietz: flows count as mid-month). Flow-free months are plain returns. */
export function portfolioReturns(points: ValuePoint[]): { from: string; date: string; r: number }[] {
  const out: { from: string; date: string; r: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const flow = points[i].invested - prev.invested;
    const base = prev.value + flow / 2;
    if (prev.value < 1 || base <= 0) continue;
    out.push({ from: prev.date, date: points[i].date, r: (points[i].value - prev.value - flow) / base });
  }
  return out;
}

/** Value index (100 at `start`) built from portfolio returns, for drawdown. */
export function indexOf(start: string, rets: { date: string; r: number }[]): { date: string; v: number }[] {
  let v = 100;
  return [{ date: start, v }, ...rets.map((x) => ({ date: x.date, v: (v *= 1 + x.r) }))];
}

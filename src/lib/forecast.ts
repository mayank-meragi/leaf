// Net worth forecast: where today's net worth, income, spending and investing lead by retirement.
// `baselineFrom` reads the starting point from Leaf's data; `project` runs it forward month by month.
// Returns are pre-tax. Surplus cash that isn't invested stays in cash, earning bank interest.

import type { LeafData } from "./db";
import { addMonths } from "./capitalGains";
import { isSalaryCredit, payMonthOf } from "./income";
import { computeNetWorth } from "./networth";
import { summarize } from "./portfolio";
import { sips } from "./sips";

export const BUCKETS = ["equity", "epf", "nps", "debt", "cash", "gold", "property", "other"] as const;
export type Bucket = (typeof BUCKETS)[number];

export const BUCKET_LABELS: Record<Bucket, string> = {
  equity: "Mutual funds & stocks",
  epf: "EPF & PPF",
  nps: "NPS",
  debt: "Fixed deposits",
  cash: "Cash & bank",
  gold: "Gold",
  property: "Property",
  other: "Other assets",
};

/** Long-run annual return assumed per bucket, pre-tax. */
export const DEFAULT_RETURNS: Record<Bucket, number> = { equity: 0.11, epf: 0.0815, nps: 0.09, debt: 0.07, cash: 0.03, gold: 0.08, property: 0.06, other: 0.05 };

const GROUP_BUCKET: Record<string, Bucket> = {
  "Mutual funds": "equity",
  Stocks: "equity",
  EPF: "epf",
  PPF: "epf",
  NPS: "nps",
  "Fixed deposit": "debt",
  "Bank accounts": "cash",
  Gold: "gold",
  Property: "property",
};

/** Where today stands, all per month except `start`. */
export interface Baseline {
  start: Record<Bucket, number>;
  /** Loans and card dues. */
  liabilities: number;
  /** Take-home pay. */
  income: number;
  /** Everyday spending, excluding loan EMIs, transfers and investing. */
  expenses: number;
  /** EMIs, which pay the loans down. */
  emi: number;
  /** Mutual fund SIPs. */
  sip: number;
  /** EPF contributions (employee + employer); these never pass through the bank account. */
  epf: number;
  nps: number;
  /** Realised mutual fund XIRR, if known. */
  equityXirr?: number;
  /** What the figures above are based on, for display. */
  notes: string[];
}

export interface OneOff {
  /** Years from now. */
  inYears: number;
  /** Positive is money in, negative is money out. */
  amount: number;
}

export interface Assumptions {
  age: number;
  retireAge: number;
  returns: Record<Bucket, number>;
  /** Annual rise in take-home pay while working. */
  incomeGrowth: number;
  inflation: number;
}

/** Things that happen to your life, not just your savings. Years are from today. */
export type LifeEvent =
  /** Buy a home: the price becomes property, part paid now, the rest a loan repaid in equal instalments. */
  | { kind: "house"; inYears: number; price: number; downPct: number; rate: number; years: number }
  /** Extra monthly spending, in today's rupees, for some years. */
  | { kind: "child"; inYears: number; monthly: number; years: number }
  /** No pay (and no EPF) for some months. */
  | { kind: "break"; inYears: number; months: number }
  /** A permanent rise in take-home pay. */
  | { kind: "raise"; inYears: number; pct: number };

export const EVENT_LABELS: Record<LifeEvent["kind"], string> = { house: "Buy a house", child: "Have a child", break: "Career break", raise: "Raise or new job" };

export const newEvent = (kind: LifeEvent["kind"]): LifeEvent =>
  kind === "house"
    ? { kind, inYears: 3, price: 10_000_000, downPct: 0.2, rate: 0.085, years: 20 }
    : kind === "child"
      ? { kind, inYears: 2, monthly: 25_000, years: 18 }
      : kind === "break"
        ? { kind, inYears: 2, months: 6 }
        : { kind, inYears: 3, pct: 0.3 };

/** What you'd change; all zero/empty means "carry on as now". */
export interface Levers {
  /** Added to the monthly SIP (negative to cut). */
  sipDelta: number;
  /** Yearly increase of the SIP. */
  sipStepUp: number;
  /** Share of everyday spending cut (0–1). */
  expenseCut: number;
  /** Share of what's left each month that goes into equity rather than sitting in cash (0–1). */
  surplusToEquity: number;
  oneOffs: OneOff[];
  events: LifeEvent[];
}

export const NO_LEVERS: Levers = { sipDelta: 0, sipStepUp: 0, expenseCut: 0, surplusToEquity: 0, oneOffs: [], events: [] };

/** Levers saved before a field existed get its "no change" value. */
export const withDefaults = (l: Partial<Levers>): Levers => ({ ...NO_LEVERS, ...l });

/** One line summing up what a set of levers changes, e.g. "SIPs +₹5,000, spending −10%". */
export function describeLevers(l: Levers): string {
  const rupees = (n: number) => `₹${Math.abs(n).toLocaleString("en-IN")}`;
  const parts = [
    l.sipDelta && `SIPs ${l.sipDelta > 0 ? "+" : "−"}${rupees(l.sipDelta)}/mo`,
    l.sipStepUp && `SIPs up ${Math.round(l.sipStepUp * 100)}% a year`,
    l.expenseCut && `spending −${Math.round(l.expenseCut * 100)}%`,
    l.surplusToEquity && `${Math.round(l.surplusToEquity * 100)}% of surplus invested`,
    ...l.oneOffs.map((o) => `${o.amount >= 0 ? "+" : "−"}${rupees(o.amount)} in ${o.inYears}y`),
    ...(l.events ?? []).map((e) =>
      e.kind === "house"
        ? `house ₹${e.price.toLocaleString("en-IN")} in ${e.inYears}y`
        : e.kind === "child"
          ? `child in ${e.inYears}y (₹${e.monthly.toLocaleString("en-IN")}/mo)`
          : e.kind === "break"
            ? `${e.months}-month break in ${e.inYears}y`
            : `+${Math.round(e.pct * 100)}% pay in ${e.inYears}y`,
    ),
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "No changes";
}

export const sameLevers = (a: Partial<Levers>, b: Partial<Levers>) => JSON.stringify(withDefaults(a)) === JSON.stringify(withDefaults(b));

export interface ForecastPoint {
  date: string;
  age: number;
  buckets: Record<Bucket, number>;
  liabilities: number;
  /** In the rupees of that date. */
  netWorth: number;
  /** In today's rupees. */
  real: number;
}

export interface Forecast {
  points: ForecastPoint[];
  /** The last point, at retirement. */
  atRetirement: ForecastPoint;
  /** Month the bank balance first goes below zero, if it does. */
  cashRunsOutOn?: string;
  /** Monthly spending, in today's rupees, that the retirement corpus would sustain at a 4% yearly withdrawal. */
  sustainableMonthly: number;
}

const zero = (): Record<Bucket, number> => Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>;
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
const RECENT = 6;

/** The last full months that have any transactions, oldest first. */
function recentMonths(data: LeafData, today: string): string[] {
  const current = today.slice(0, 7);
  return [...new Set(data.transactions.map((t) => t.date.slice(0, 7)))].filter((m) => m < current).sort().slice(-RECENT);
}

export function baselineFrom(data: LeafData, today: string): Baseline {
  const notes: string[] = [];
  const nw = computeNetWorth(data, today);
  const start = zero();
  for (const l of nw.assets) start[GROUP_BUCKET[l.group] ?? "other"] += l.value;
  const liabilities = nw.liabilities.reduce((s, l) => s + l.value, 0);

  const months = recentMonths(data, today);
  const inr = data.transactions.filter((t) => t.currency === "INR" && months.includes(t.date.slice(0, 7)));
  const monthly = (pick: (t: (typeof inr)[number]) => boolean) => median(months.map((m) => inr.filter((t) => t.date.startsWith(m) && pick(t)).reduce((s, t) => s + t.amount, 0)));
  const spend = (t: (typeof inr)[number]) => t.direction === "debit" && !["Transfers", "Investments", "EMI & Loans"].includes(t.category ?? "");
  const expenses = monthly(spend);
  const emi = monthly((t) => t.direction === "debit" && t.category === "EMI & Loans");
  if (months.length) notes.push(`Spending is the median of your last ${months.length} full months`);
  else notes.push("No full month of transactions yet, so spending starts at zero: enter it yourself");

  // Take-home from payslips; otherwise salary credits grouped by the month they pay for.
  const slips = [...data.payslips].sort((a, b) => b.month.localeCompare(a.month)).slice(0, RECENT);
  let income = median(slips.map((p) => p.net));
  if (slips.length) notes.push(`Take-home is the median of your last ${slips.length} payslips`);
  else {
    const byMonth = new Map<string, number>();
    for (const t of data.transactions.filter(isSalaryCredit)) byMonth.set(payMonthOf(t, data.payslips), (byMonth.get(payMonthOf(t, data.payslips)) ?? 0) + t.amount);
    const recent = [...byMonth].sort((a, b) => b[0].localeCompare(a[0])).slice(0, RECENT);
    income = median(recent.map(([, v]) => v));
    if (recent.length) notes.push(`Take-home is the median of your last ${recent.length} salary credits`);
  }

  const epf = slips[0] ? slips[0].pfEmployee + slips[0].pfEmployer : 0;

  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10);
  const npsIds = new Set(data.wealthAccounts.filter((a) => a.kind === "nps").map((a) => a.id));
  const nps = data.wealthFlows.filter((f) => npsIds.has(f.account) && f.kind === "contribution" && f.date >= since).reduce((s, f) => s + f.amount, 0) / 12;

  const plan = sips(data.statements);
  return { start, liabilities, income, expenses, emi, sip: plan.monthlyOutflow, epf, nps, equityXirr: summarize(data.statements).xirr ?? undefined, notes };
}

/** Equity return to start from: your realised XIRR pulled halfway to the default so a good (or bad) run doesn't set the next 20 years. */
export function defaultAssumptions(base: Baseline): Assumptions {
  const equity = base.equityXirr == null ? DEFAULT_RETURNS.equity : Math.min(0.15, Math.max(0.06, (base.equityXirr + DEFAULT_RETURNS.equity) / 2));
  return { age: 30, retireAge: 55, returns: { ...DEFAULT_RETURNS, equity: Math.round(equity * 1000) / 1000 }, incomeGrowth: 0.07, inflation: 0.06 };
}

const monthly = (annual: number) => Math.pow(1 + annual, 1 / 12) - 1;

type Rates = Record<Bucket, number>;

/**
 * Steps today's position forward month by month, calling `onMonth` after month `m` (0 is today, before any step).
 * `ratesAt(m)` gives each bucket's growth for month m; the forecast uses fixed rates, the simulation random ones.
 */
function run(base: Baseline, a: Assumptions, lv: Levers, today: string, ratesAt: (m: number) => Rates, onMonth: (m: number, b: Rates, debt: number, dateAt: (m: number) => string) => void) {
  const total = Math.max(1, Math.round((a.retireAge - a.age) * 12));
  const b = { ...base.start };
  let debt = base.liabilities;
  /** Loans taken for events in this forecast; kept apart so your existing EMIs don't pay them off. */
  let eventDebt = 0;
  const events = lv.events ?? [];
  const at = (inYears: number) => Math.floor(inYears * 12);
  const raises = events.flatMap((e) => (e.kind === "raise" ? [{ from: at(e.inYears), pct: e.pct }] : []));
  const breaks = events.flatMap((e) => (e.kind === "break" ? [{ from: at(e.inYears), to: at(e.inYears) + Math.round(e.months) }] : []));
  const children = events.flatMap((e) => (e.kind === "child" ? [{ from: at(e.inYears), to: at(e.inYears) + Math.round(e.years * 12), monthly: e.monthly }] : []));
  const houses = events.flatMap((e) => {
    if (e.kind !== "house") return [];
    const loan = e.price * (1 - e.downPct);
    const n = Math.max(1, Math.round(e.years * 12));
    const r = e.rate / 12;
    return [{ from: at(e.inYears), price: e.price, loan, n, r, emi: r === 0 ? loan / n : (loan * r) / (1 - Math.pow(1 + r, -n)), balance: 0 }];
  });
  const baseDate = `${today.slice(0, 7)}-01`;
  const dateAt = (m: number) => addMonths(baseDate, m).slice(0, 7);
  onMonth(0, b, debt + eventDebt, dateAt);
  for (let m = 0; m < total; m++) {
    const y = Math.floor(m / 12);
    const incomeScale = Math.pow(1 + a.incomeGrowth, y);
    const raise = raises.reduce((x, e) => (m >= e.from ? x * (1 + e.pct) : x), 1);
    const paid = breaks.some((e) => m >= e.from && m < e.to) ? 0 : 1;
    const income = base.income * incomeScale * raise * paid;
    const inflate = Math.pow(1 + a.inflation, y);
    const expenses = base.expenses * (1 - lv.expenseCut) * inflate;
    const childCost = children.reduce((x, e) => (m >= e.from && m < e.to ? x + e.monthly * inflate : x), 0);
    const sip = Math.max(0, base.sip + lv.sipDelta) * Math.pow(1 + lv.sipStepUp, y);
    const nps = base.nps * incomeScale;
    const epf = base.epf * incomeScale * raise * paid;
    const emi = Math.min(base.emi, debt);

    const rates = ratesAt(m);
    for (const k of BUCKETS) b[k] *= 1 + rates[k];
    debt -= emi;
    b.equity += sip;
    b.nps += nps;
    b.epf += epf;
    // Home loans: the instalment is interest plus principal; only the principal pays the loan down.
    let housePay = 0;
    for (const h of houses) {
      if (m === h.from) {
        b.property += h.price;
        b.cash += h.loan - h.price;
        h.balance = h.loan;
        eventDebt += h.loan;
      }
      if (m >= h.from && m < h.from + h.n && h.balance > 0) {
        const principal = Math.min(h.balance, h.emi - h.balance * h.r);
        housePay += h.emi;
        h.balance -= principal;
        eventDebt -= principal;
      }
    }
    const surplus = income - expenses - childCost - sip - nps - emi - housePay;
    const invested = surplus > 0 ? surplus * lv.surplusToEquity : 0;
    b.equity += invested;
    b.cash += surplus - invested;
    for (const o of lv.oneOffs) if (Math.floor(o.inYears * 12) === m) b.cash += o.amount;
    onMonth(m + 1, b, debt + eventDebt, dateAt);
  }
  return total;
}

const netOf = (b: Rates, debt: number) => BUCKETS.reduce((s, k) => s + b[k], 0) - debt;

export function project(base: Baseline, a: Assumptions, lv: Levers, today: string): Forecast {
  const fixed = Object.fromEntries(BUCKETS.map((k) => [k, monthly(a.returns[k])])) as Rates;
  const points: ForecastPoint[] = [];
  let cashRunsOutOn: string | undefined;
  run(base, a, lv, today, () => fixed, (m, b, debt, dateAt) => {
    const nominal = netOf(b, debt);
    points.push({ date: m === 0 ? today : `${dateAt(m)}-01`, age: a.age + m / 12, buckets: { ...b }, liabilities: debt, netWorth: nominal, real: nominal / Math.pow(1 + a.inflation, m / 12) });
    if (b.cash < 0 && !cashRunsOutOn) cashRunsOutOn = dateAt(m);
  });
  const atRetirement = points.at(-1)!;
  return { points, atRetirement, cashRunsOutOn, sustainableMonthly: (Math.max(0, atRetirement.real) * 0.04) / 12 };
}

// ── Market swings ────────────────────────────────────────────────────────────────────────────────────────────

/** Yearly volatility assumed per bucket other than equity, whose volatility you can set. */
export const OTHER_VOL: Omit<Record<Bucket, number>, "equity"> = { epf: 0, nps: 0.08, debt: 0.02, cash: 0, gold: 0.15, property: 0.08, other: 0.1 };
export const DEFAULT_EQUITY_VOL = 0.16;
/** How much of NPS's moves follow the equity market. */
const NPS_MARKET_LOADING = 0.8;
const NPS_OWN = Math.sqrt(1 - NPS_MARKET_LOADING ** 2);

/** Small, fast, seedable generator, so the same inputs always draw the same range. */
export function rng(seed: number) {
  let t = seed >>> 0;
  let spare: number | null = null;
  const uniform = () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return (((x ^ (x >>> 14)) >>> 0) / 4294967296) || 1e-12;
  };
  // Box–Muller makes two draws at a time.
  return () => {
    if (spare != null) {
      const z = spare;
      spare = null;
      return z;
    }
    const radius = Math.sqrt(-2 * Math.log(uniform()));
    const angle = 2 * Math.PI * uniform();
    spare = radius * Math.sin(angle);
    return radius * Math.cos(angle);
  };
}

/** One month's growth for a yearly return and volatility, such that the average yearly return stays what you assumed. */
export function randomGrowth(annual: number, vol: number, z: number): number {
  const sd = vol / Math.sqrt(12);
  return Math.exp(Math.log(1 + annual) / 12 - (sd * sd) / 2 + sd * z) - 1;
}

export interface Band {
  date: string;
  /** Net worth in future rupees. */
  nominal: { p10: number; p50: number; p90: number };
  /** In today's rupees. */
  real: { p10: number; p50: number; p90: number };
}

export interface Simulation {
  bands: Band[];
  /** Share of runs (0–1) ending at or above `target` today's rupees. */
  chanceAtLeast: (target: number) => number;
  /** Share of runs in which the bank balance goes below zero at some point. */
  cashOutChance: number;
  /** Net worth at retirement, in today's rupees, by percentile. */
  final: { p10: number; p50: number; p90: number };
  runs: number;
}

const quantile = (sorted: ArrayLike<number>, q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

/** Runs the forecast `runs` times with random markets and reports the spread. */
export function simulate(base: Baseline, a: Assumptions, lv: Levers, today: string, opts: { equityVol?: number; runs?: number; seed?: number } = {}): Simulation {
  const runs = opts.runs ?? 1000;
  const equityVol = opts.equityVol ?? DEFAULT_EQUITY_VOL;
  const normal = rng(opts.seed ?? 1);
  const vol: Record<Bucket, number> = { ...OTHER_VOL, equity: equityVol };
  // Per bucket: what a month grows by with no shock (and so for a bucket that doesn't swing), and the swing's size.
  const sd = Object.fromEntries(BUCKETS.map((k) => [k, vol[k] / Math.sqrt(12)])) as Rates;
  const drift = Object.fromEntries(BUCKETS.map((k) => [k, Math.log(1 + a.returns[k]) / 12 - (sd[k] * sd[k]) / 2])) as Rates;
  const swings = BUCKETS.filter((k) => vol[k] > 0);
  const steady = Object.fromEntries(BUCKETS.map((k) => [k, monthly(a.returns[k])])) as Rates;
  const rates: Rates = { ...steady };
  const total = Math.max(1, Math.round((a.retireAge - a.age) * 12));
  const STRIDE = 3;
  const recordAt = (m: number) => m % STRIDE === 0 || m === total;
  const samples = new Map<number, Float64Array>();
  const dates = new Map<number, string>();
  for (let m = 0; m <= total; m++) if (recordAt(m)) samples.set(m, new Float64Array(runs));
  let cashOut = 0;

  for (let r = 0; r < runs; r++) {
    let out = false;
    run(
      base,
      a,
      lv,
      today,
      () => {
        const market = normal();
        for (const k of swings) {
          const z = k === "equity" ? market : k === "nps" ? NPS_MARKET_LOADING * market + NPS_OWN * normal() : normal();
          rates[k] = Math.exp(drift[k] + sd[k] * z) - 1;
        }
        return rates;
      },
      (m, b, debt, dateAt) => {
        if (recordAt(m)) {
          samples.get(m)![r] = netOf(b, debt);
          if (r === 0) dates.set(m, m === 0 ? today : `${dateAt(m)}-01`);
        }
        if (b.cash < 0) out = true;
      },
    );
    if (out) cashOut++;
  }

  const deflator = (m: number) => Math.pow(1 + a.inflation, m / 12);
  const bands: Band[] = [];
  let finalReal: Float64Array = new Float64Array(0);
  for (const [m, xs] of samples) {
    xs.sort();
    const d = deflator(m);
    bands.push({
      date: dates.get(m)!,
      nominal: { p10: quantile(xs, 0.1), p50: quantile(xs, 0.5), p90: quantile(xs, 0.9) },
      real: { p10: quantile(xs, 0.1) / d, p50: quantile(xs, 0.5) / d, p90: quantile(xs, 0.9) / d },
    });
    if (m === total) finalReal = xs.map((v) => v / d);
  }
  const last = bands.at(-1)!;
  return {
    bands,
    chanceAtLeast: (target) => {
      let lo = 0;
      let hi = finalReal.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (finalReal[mid] < target) lo = mid + 1;
        else hi = mid;
      }
      return (finalReal.length - lo) / finalReal.length;
    },
    cashOutChance: cashOut / runs,
    final: last.real,
    runs,
  };
}

/** Chance that `current` plus `monthly` invested for `months` reaches `target` at the assumed return and volatility. */
export function goalOdds(g: { current: number; monthly: number; months: number; annualReturn: number; target: number }, vol = DEFAULT_EQUITY_VOL, runs = 1000, seed = 1): number {
  if (g.target <= 0) return 1;
  if (g.months <= 0) return g.current >= g.target ? 1 : 0;
  const normal = rng(seed);
  let hit = 0;
  for (let r = 0; r < runs; r++) {
    let v = g.current;
    for (let m = 0; m < g.months; m++) v = v * (1 + randomGrowth(g.annualReturn, vol, normal())) + g.monthly;
    if (v >= g.target) hit++;
  }
  return hit / runs;
}

// ── What moves the needle ────────────────────────────────────────────────────────────────────────────────────

export interface Impact {
  label: string;
  /** Change in net worth at retirement, in today's rupees, against the forecast as it stands. */
  delta: number;
  /** Set for changes you can apply to the levers; the rest are about the world, not your choices. */
  levers?: Levers;
}

/** How much each of a few typical changes would move net worth at retirement, biggest first. Changes that do nothing are left out. */
export function impacts(base: Baseline, a: Assumptions, lv: Levers, today: string): Impact[] {
  const now = project(base, a, lv, today).atRetirement.real;
  const lever = (label: string, next: Levers): Impact & { levers: Levers } => ({ label, delta: project(base, a, next, today).atRetirement.real - now, levers: next });
  const world = (label: string, change: Partial<Assumptions>): Impact => ({ label, delta: project(base, { ...a, ...change }, lv, today).atRetirement.real - now });
  const eq = (d: number) => ({ returns: { ...a.returns, equity: Math.max(0.01, a.returns.equity + d) } });
  const rows: Impact[] = [
    lever("Invest ₹5,000 more a month", { ...lv, sipDelta: lv.sipDelta + 5000 }),
    lever("Raise SIPs 5% more every year", { ...lv, sipStepUp: lv.sipStepUp + 0.05 }),
    lever("Cut spending by another 10%", { ...lv, expenseCut: Math.min(0.9, lv.expenseCut + 0.1) }),
    lever("Invest half of what's left over", { ...lv, surplusToEquity: Math.max(lv.surplusToEquity, 0.5) }),
    world("Retire 2 years later", { retireAge: a.retireAge + 2 }),
    world("Retire 2 years earlier", a.retireAge - 2 > a.age ? { retireAge: a.retireAge - 2 } : {}),
    world("Equity returns 1 point higher", eq(0.01)),
    world("Equity returns 1 point lower", eq(-0.01)),
    world("Pay rises 1 point faster each year", { incomeGrowth: a.incomeGrowth + 0.01 }),
    world("Inflation 1 point higher", { inflation: a.inflation + 0.01 }),
  ];
  return rows.filter((r) => Math.abs(r.delta) >= 1).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
}

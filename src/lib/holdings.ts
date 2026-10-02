import type { GitHubStore } from "./github/store";

/** What the monthly backend job writes to `holdings/<amfi code>.json` in the data repo. */
export interface StockHolding {
  id: string;
  name: string;
  sector: string | null;
  /** "EQUITY", or a debt/cash instrument type. */
  type: string;
  /** Percent of the fund's corpus. */
  weight: number;
}

export interface FundHoldings {
  code: number;
  name: string;
  fetched: string;
  /** Date of the fund's monthly disclosure. */
  portfolioDate: string | null;
  /** Percent a year; null for Regular plans, whose own ratio isn't published by the source. */
  expenseRatio: number | null;
  aumCr?: number | null;
  category?: string | null;
  subCategory?: string | null;
  /** Set when the holdings are a Direct twin's, standing in for a Regular plan. */
  holdingsFrom?: { scheme: string; note: string } | null;
  holdings: StockHolding[];
}

export const holdingsPath = (code: number) => `holdings/${code}.json`;

export async function loadHoldings(store: GitHubStore, codes: number[]): Promise<Map<number, FundHoldings>> {
  const out = new Map<number, FundHoldings>();
  await Promise.all([...new Set(codes)].map(async (code) => {
    const f = await store.readJSON<FundHoldings>(holdingsPath(code));
    if (f) out.set(code, f);
  }));
  return out;
}

/** A fund you hold, with its portfolio. */
export interface FundInput {
  name: string;
  /** Your rupee value in it. */
  value: number;
  fund: FundHoldings;
}

const equityOf = (f: FundHoldings) => f.holdings.filter((h) => h.type === "EQUITY");

// ---- Overlap between two funds ----

export interface SharedStock {
  id: string;
  name: string;
  /** Weight in each fund, percent. */
  a: number;
  b: number;
}

export interface PairOverlap {
  a: string;
  b: string;
  /** Sum over shared stocks of the smaller weight, in percent: how much of the smaller position the other fund already covers. */
  overlap: number;
  shared: SharedStock[];
}

export function pairOverlap(a: FundHoldings, b: FundHoldings): { overlap: number; shared: SharedStock[] } {
  const wb = new Map(equityOf(b).map((h) => [h.id, h]));
  const shared: SharedStock[] = [];
  for (const h of equityOf(a)) {
    const other = wb.get(h.id);
    if (other) shared.push({ id: h.id, name: h.name, a: h.weight, b: other.weight });
  }
  shared.sort((x, y) => Math.min(y.a, y.b) - Math.min(x.a, x.b));
  return { overlap: shared.reduce((s, x) => s + Math.min(x.a, x.b), 0), shared };
}

/** Every pair of equity-holding funds, most overlapping first. */
export function overlaps(funds: FundInput[]): PairOverlap[] {
  const eq = funds.filter((f) => equityOf(f.fund).length > 0);
  const out: PairOverlap[] = [];
  for (let i = 0; i < eq.length; i++)
    for (let j = i + 1; j < eq.length; j++) {
      const { overlap, shared } = pairOverlap(eq[i].fund, eq[j].fund);
      if (shared.length) out.push({ a: eq[i].name, b: eq[j].name, overlap, shared });
    }
  return out.sort((x, y) => y.overlap - x.overlap);
}

export interface OverlapMatrix {
  names: string[];
  /** Weighted overlap in percent between each pair of funds; the diagonal is 100. */
  cells: number[][];
  /** Allocation-weighted average over all pairs: big positions count more. Null with fewer than two equity funds. */
  weighted: number | null;
  /** The most overlapping pair, if any two funds share a stock. */
  top: PairOverlap | null;
}

/** Overlap between every pair of equity funds, and one number for the whole portfolio. */
export function overlapMatrix(funds: FundInput[]): OverlapMatrix {
  const eq = funds.filter((f) => equityOf(f.fund).length > 0);
  const cells = eq.map(() => eq.map(() => 100));
  let num = 0;
  let den = 0;
  for (let i = 0; i < eq.length; i++)
    for (let j = i + 1; j < eq.length; j++) {
      const { overlap } = pairOverlap(eq[i].fund, eq[j].fund);
      cells[i][j] = cells[j][i] = overlap;
      const w = eq[i].value * eq[j].value;
      num += w * overlap;
      den += w;
    }
  return { names: eq.map((f) => f.name), cells, weighted: den > 0 ? num / den : null, top: overlaps(eq)[0] ?? null };
}

/** The matrix cut down to funds that overlap at least `min` percent with some other fund; null if fewer than two qualify. */
export function focusMatrix(m: OverlapMatrix, min = 20): OverlapMatrix | null {
  const keep = m.names.flatMap((_, i) => (m.cells[i].some((o, j) => j !== i && o >= min) ? [i] : []));
  if (keep.length < 2) return null;
  return { ...m, names: keep.map((i) => m.names[i]), cells: keep.map((i) => keep.map((j) => m.cells[i][j])) };
}

// ---- Look-through: what you own underneath the funds ----

export interface StockExposure {
  id: string;
  name: string;
  sector: string | null;
  /** Rupees, summed over funds. */
  amount: number;
  /** Share of the whole mutual fund portfolio. */
  share: number;
  funds: { name: string; amount: number }[];
}

export interface LookThrough {
  stocks: StockExposure[];
  sectors: { sector: string; amount: number; share: number }[];
  /** Rupees of the portfolio that sit in listed stocks we could see. */
  equityAmount: number;
  /** Share of the portfolio the top ten stocks make up. */
  top10Share: number;
  /** Value held in funds whose portfolio is known, over total value. */
  coverage: number;
  /** Equity positions summed over funds, counting a stock once per fund that holds it. */
  positions: number;
  /** How many equally sized stocks would be as concentrated as this: 1 / Σ(weight²). Null with no equity. */
  effectiveStocks: number | null;
}

export function lookThrough(funds: FundInput[], total: number): LookThrough {
  const stocks = new Map<string, StockExposure>();
  const sectors = new Map<string, number>();
  let covered = 0;
  let positions = 0;
  for (const { name, value, fund } of funds) {
    covered += value;
    for (const h of equityOf(fund)) {
      positions++;
      const amount = (value * h.weight) / 100;
      const s = stocks.get(h.id) ?? { id: h.id, name: h.name, sector: h.sector, amount: 0, share: 0, funds: [] };
      s.amount += amount;
      s.funds.push({ name, amount });
      stocks.set(h.id, s);
      const sec = h.sector || "Other";
      sectors.set(sec, (sectors.get(sec) ?? 0) + amount);
    }
  }
  const div = total || 1;
  const list = [...stocks.values()].map((s) => ({ ...s, share: s.amount / div, funds: s.funds.sort((a, b) => b.amount - a.amount) })).sort((a, b) => b.amount - a.amount);
  const equityAmount = list.reduce((s, x) => s + x.amount, 0);
  return {
    stocks: list,
    sectors: [...sectors].map(([sector, amount]) => ({ sector, amount, share: amount / div })).sort((a, b) => b.amount - a.amount),
    equityAmount,
    top10Share: list.slice(0, 10).reduce((s, x) => s + x.amount, 0) / div,
    coverage: total ? covered / total : 0,
    positions,
    effectiveStocks: equityAmount > 0 ? 1 / list.reduce((s, x) => s + (x.amount / equityAmount) ** 2, 0) : null,
  };
}

// ---- Cost ----

export interface CostSummary {
  /** Percent a year across funds that report one, weighted by value. */
  weighted: number | null;
  /** Rupees a year across those funds. */
  annual: number;
  /** Value of funds with a known ratio over total value. */
  coverage: number;
  rows: { name: string; value: number; ratio: number | null; annual: number | null }[];
}

export function costs(funds: FundInput[], total: number): CostSummary {
  const rows = funds.map((f) => ({
    name: f.name,
    value: f.value,
    ratio: f.fund.expenseRatio,
    annual: f.fund.expenseRatio == null ? null : (f.value * f.fund.expenseRatio) / 100,
  }));
  const known = rows.filter((r) => r.annual != null);
  const knownValue = known.reduce((s, r) => s + r.value, 0);
  const annual = known.reduce((s, r) => s + r.annual!, 0);
  return {
    weighted: knownValue ? (annual / knownValue) * 100 : null,
    annual,
    coverage: total ? knownValue / total : 0,
    rows: rows.sort((a, b) => (b.annual ?? -1) - (a.annual ?? -1)),
  };
}

/** Whole months from `date` to `today`. */
export function monthsOld(date: string, today = new Date().toISOString().slice(0, 10)) {
  const [y1, m1] = date.split("-").map(Number);
  const [y2, m2] = today.split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

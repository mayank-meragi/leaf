import type { GitHubStore } from "./github/store";

/**
 * NAV history from mfapi.in (a free mirror of AMFI's data that allows browser requests).
 * Series are cached in the data repo under `nav/`, so they're fetched once and committed,
 * not requested on every visit.
 */

export interface NavSeries {
  code: number;
  name: string;
  /** ISINs the scheme is listed under (growth, and dividend reinvestment). */
  isins: string[];
  /** When this copy was fetched. */
  fetched: string;
  /** Ascending [YYYY-MM-DD, NAV]. */
  data: [string, number][];
}

export interface CodeEntry {
  code: number;
  name: string;
  /** True when a price or ISIN from your statement matched the series, not just the name. */
  verified: boolean;
}
export type CodeMap = Record<string, CodeEntry>;

export const CODES_PATH = "nav/codes.json";
export const navPath = (code: number) => `nav/${code}.json`;

/** Index funds offered as benchmarks. All Direct Growth plans. */
export const BENCHMARKS = [
  { code: 120716, label: "Nifty 50" },
  { code: 143341, label: "Nifty Next 50" },
  { code: 153089, label: "Nifty Midcap 150" },
] as const;
export const DEFAULT_BENCHMARK = BENCHMARKS[0].code;

// ---- Reading mfapi.in ----

const API = "https://api.mfapi.in/mf";

interface RawSeries {
  meta?: { scheme_name?: string; isin_growth?: string | null; isin_div_reinvestment?: string | null };
  data?: { date: string; nav: string }[];
}

export function parseSeries(code: number, raw: RawSeries, fetched = new Date().toISOString().slice(0, 10)): NavSeries {
  const data: [string, number][] = [];
  for (const r of raw.data ?? []) {
    const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(r.date);
    const nav = Number(r.nav);
    if (m && nav > 0) data.push([`${m[3]}-${m[2]}-${m[1]}`, nav]);
  }
  data.sort((a, b) => a[0].localeCompare(b[0]));
  return {
    code,
    name: raw.meta?.scheme_name ?? String(code),
    isins: [raw.meta?.isin_growth, raw.meta?.isin_div_reinvestment].filter((x): x is string => !!x),
    fetched,
    data,
  };
}

export interface NavApi {
  search(q: string): Promise<{ schemeCode: number; schemeName: string }[]>;
  series(code: number): Promise<NavSeries>;
}

export const mfapi: NavApi = {
  async search(q) {
    const res = await fetch(`${API}/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error(`NAV search failed (${res.status})`);
    return res.json();
  },
  async series(code) {
    const res = await fetch(`${API}/${code}`);
    if (!res.ok) throw new Error(`NAV fetch failed for ${code} (${res.status})`);
    return parseSeries(code, await res.json());
  },
};

/** Latest NAV on or before `date`; undefined if the series starts later. */
export function navOn(series: NavSeries, date: string): number | undefined {
  const d = series.data;
  let lo = 0;
  let hi = d.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (d[mid][0] <= date) (best = mid), (lo = mid + 1);
    else hi = mid - 1;
  }
  return best < 0 ? undefined : d[best][1];
}

// ---- Matching a statement's scheme to an AMFI code ----

const STOP = new Set(["plan", "option", "scheme", "the", "of", "and", "fund", "mutual"]);
const tokens = (name: string) =>
  name
    .toLowerCase()
    .replace(/\(formerly[^)]*\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

const wantsDirect = (name: string, advisor?: string) => (/direct/i.test(name) || /direct/i.test(advisor ?? "") ? true : /regular/i.test(name) || /ARN/i.test(advisor ?? "") ? false : undefined);
const isGrowth = (name: string) => !/idcw|dividend|payout|bonus|reinvest/i.test(name);

/** Queries to try, most specific first: the full name, then progressively fewer leading words. */
export function queryVariants(name: string): string[] {
  const words = tokens(name).filter((w) => !["direct", "regular", "growth", "plan", "option", "idcw"].includes(w));
  const out: string[] = [];
  for (let n = words.length; n >= Math.min(3, words.length) && out.length < 4; n--) out.push(words.slice(0, n).join(" "));
  return [...new Set(out)];
}

/** Share of the scheme's words the candidate also has. */
function similarity(a: string, b: string) {
  const x = new Set(tokens(a).filter((w) => !STOP.has(w)));
  const y = new Set(tokens(b).filter((w) => !STOP.has(w)));
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / Math.max(1, Math.max(x.size, y.size));
}

export interface SchemeQuery {
  name: string;
  isin?: string;
  advisor?: string;
  /** Prices the statement reported, to confirm a match against. */
  anchors: { date: string; nav: number }[];
}

const MAX_CANDIDATES = 5;

/** Finds the series for a scheme, confirming it by ISIN or by matching NAVs from the statement. */
export async function resolveScheme(q: SchemeQuery, api: NavApi = mfapi): Promise<{ series: NavSeries; verified: boolean } | null> {
  const direct = wantsDirect(q.name, q.advisor);
  const growth = isGrowth(q.name);
  const seen = new Map<number, string>();
  for (const query of queryVariants(q.name)) {
    for (const c of await api.search(query)) seen.set(c.schemeCode, c.schemeName);
    if (seen.size >= 3) break;
  }
  const ranked = [...seen]
    .filter(([, n]) => (direct === undefined || /direct/i.test(n) === direct) && isGrowth(n) === growth)
    .map(([code, n]) => ({ code, score: similarity(q.name, n) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES);

  let best: { series: NavSeries; hits: number; score: number } | null = null;
  for (const c of ranked) {
    const series = await api.series(c.code);
    if (q.isin && series.isins.includes(q.isin)) return { series, verified: true };
    const hits = q.anchors.filter((a) => {
      const nav = navOn(series, a.date);
      return nav != null && Math.abs(nav - a.nav) / a.nav < 0.001;
    }).length;
    if (!best || hits > best.hits || (hits === best.hits && c.score > best.score)) best = { series, hits, score: c.score };
    if (hits >= 2) break;
  }
  if (!best) return null;
  if (best.hits > 0) return { series: best.series, verified: true };
  // Nothing to confirm it by: take a close name match, but say so.
  return q.anchors.length === 0 && best.score >= 0.7 ? { series: best.series, verified: false } : null;
}

// ---- Cache in the data repo ----

export interface NavCache {
  codes: CodeMap;
  series: Map<number, NavSeries>;
}

export async function loadNavCache(store: GitHubStore, extraCodes: number[] = []): Promise<NavCache> {
  const codes = (await store.readJSON<CodeMap>(CODES_PATH)) ?? {};
  const wanted = new Set([...Object.values(codes).map((c) => c.code), ...extraCodes]);
  const series = new Map<number, NavSeries>();
  await Promise.all([...wanted].map(async (code) => {
    const s = await store.readJSON<NavSeries>(navPath(code));
    if (s) series.set(code, s);
  }));
  return { codes, series };
}

/** One commit with every changed file. Compact JSON: a series is thousands of pairs. */
export async function saveNavCache(store: GitHubStore, codes: CodeMap, changed: NavSeries[], message: string) {
  const files: Record<string, string> = { [CODES_PATH]: JSON.stringify(codes, null, 2) + "\n" };
  for (const s of changed) files[navPath(s.code)] = JSON.stringify(s);
  await store.commit(files, message);
}

import type { CASStatement, MFScheme, MFTransaction } from "@/types";
import { xirr, type Flow } from "./xirr";

export interface Holding {
  scheme: MFScheme;
  amc: string;
  folio: string;
  value: number;
  cost: number;
}

// Statements ending within this many days of each other are treated as equally fresh.
const FRESHNESS_WINDOW_DAYS = 7;

/**
 * One statement per PAN (a detailed CAS already covers every folio under that PAN).
 * Among statements that are about equally recent, the one with the longest history wins,
 * since XIRR needs every transaction and a day's newer NAV matters far less.
 */
/** A real consolidated statement states its period; per-folio confirmations and misparses don't. */
export const isCompleteStatement = (s: CASStatement) => Boolean(s.statementPeriod.from && s.statementPeriod.to && s.folios.length);

export function latestStatements(statements: CASStatement[]): CASStatement[] {
  const byPan = new Map<string, CASStatement[]>();
  for (const s of statements.filter(isCompleteStatement)) {
    const pan = s.investor.pan ?? s.folios.find((f) => f.pan)?.pan ?? s.investor.email ?? "unknown";
    byPan.set(pan, [...(byPan.get(pan) ?? []), s]);
  }
  return [...byPan.values()].map((list) => {
    const newest = list.map((s) => Date.parse(s.statementPeriod.to) || 0).reduce((a, b) => Math.max(a, b), 0);
    const fresh = list.filter((s) => newest - (Date.parse(s.statementPeriod.to) || 0) <= FRESHNESS_WINDOW_DAYS * 86_400_000);
    return fresh.sort(
      (a, b) => (a.statementPeriod.from || "9999").localeCompare(b.statementPeriod.from || "9999") || b.statementPeriod.to.localeCompare(a.statementPeriod.to),
    )[0];
  });
}

/** Current holdings (one per scheme per folio) with units left. */
export function holdings(statements: CASStatement[]): Holding[] {
  return latestStatements(statements)
    .flatMap((s) =>
      s.folios.flatMap((f) =>
        f.schemes
          .filter((sc) => (sc.close ?? 0) > 0.0001)
          .map((sc) => ({ scheme: sc, amc: f.amc, folio: f.folio, value: sc.valuation?.value ?? 0, cost: sc.valuation?.cost ?? 0 })),
      ),
    )
    .sort((a, b) => b.value - a.value);
}

// ---- Classification ----

export const ASSET_CLASSES = ["Equity", "Debt", "Hybrid", "Gold & Silver", "Other"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export const EQUITY_STYLES = [
  "Large Cap", "Large & Mid Cap", "Mid Cap", "Small Cap", "Flexi & Multi Cap",
  "Sectoral & Thematic", "Index", "ELSS", "Other Equity",
] as const;
export type EquityStyle = (typeof EQUITY_STYLES)[number];

const baseName = (name: string) => name.toLowerCase().replace(/\(formerly[^)]*\)/g, " ");

export function assetClassOf(name: string, reported?: string): AssetClass {
  const n = baseName(name);
  // Gold/silver funds are often reported as "OTHER"/"FOF"; the name is the better signal for them.
  if (/\bgold\b|\bsilver\b|precious metal/.test(n)) return "Gold & Silver";
  const r = reported?.toLowerCase() ?? "";
  if (r.includes("equity") || r.includes("elss")) return "Equity";
  if (r.includes("debt") || r.includes("liquid")) return "Debt";
  if (r.includes("hybrid")) return "Hybrid";
  if (/hybrid|balanced|equity (&|and) debt|arbitrage|multi[- ]?asset|equity savings|dynamic asset|asset allocat|retirement|children/.test(n)) return "Hybrid";
  if (/liquid|overnight|money market|gilt|\bdebt\b|bond|income|duration|credit risk|banking (&|and) psu|corporate|treasury|floater|fixed maturity|\bfmp\b|savings fund/.test(n))
    return "Debt";
  return "Equity";
}

export function equityStyleOf(name: string): EquityStyle {
  const n = baseName(name);
  if (/large (&|and) ?mid ?cap|large ?& ?midcap/.test(n)) return "Large & Mid Cap";
  if (/elss|tax ?sav/.test(n)) return "ELSS";
  if (/\bindex\b|nifty|sensex|\betf\b/.test(n)) return "Index";
  if (/small ?cap/.test(n)) return "Small Cap";
  if (/mid ?cap/.test(n)) return "Mid Cap";
  if (/large ?cap|bluechip|top ?100/.test(n)) return "Large Cap";
  if (/flexi|multi ?cap|focused|contra|value|dividend yield/.test(n)) return "Flexi & Multi Cap";
  if (/pharma|health|digital|technolog|\btech\b|banking|financial|infra|consumption|commodit|energy|\bpsu\b|manufactur|\bauto\b|\bmnc\b|\besg\b|thematic|sector|innovation|business cycle|opportunit/.test(n))
    return "Sectoral & Thematic";
  return "Other Equity";
}

// ---- Per-scheme summary and XIRR ----

export interface SchemeSummary {
  name: string;
  amc: string;
  folios: string[];
  assetClass: AssetClass;
  equityStyle?: EquityStyle;
  units: number;
  nav?: number;
  value: number;
  cost: number;
  xirr: number | null;
  /** False when the statement starts after the first purchase, so XIRR can't be computed honestly. */
  fullHistory: boolean;
}

export interface PortfolioSummary {
  schemes: SchemeSummary[];
  value: number;
  cost: number;
  asOf?: string;
  /** Portfolio XIRR over schemes with full history (including fully redeemed ones). */
  xirr: number | null;
  /** Share of current value the XIRR covers (1 = everything). */
  xirrCoverage: number;
  /** Earliest statement start date among the statements used. */
  historyFrom?: string;
}

const schemeKey = (name: string) => name.toLowerCase().replace(/\s+/g, " ").trim();

/** Cashflows from the investor's point of view: purchases negative, money back positive. */
export function flowOf(t: MFTransaction): number {
  const amount = t.amount ?? 0;
  switch (t.type) {
    case "DIVIDEND_PAYOUT":
      return Math.abs(amount);
    case "DIVIDEND_REINVEST": // paid out and bought back: no cash moved
    case "MISC": // e.g. refunds of purchases the statement never listed
      return 0;
    default:
      // Purchases/stamp duty are positive amounts (money in → outflow); redemptions and reversals are negative.
      return -amount;
  }
}

interface Group {
  name: string;
  amc: string;
  folios: Set<string>;
  reported?: string;
  units: number;
  opening: number;
  value: number;
  cost: number;
  navs: number[];
  txns: MFTransaction[];
  asOf: string;
}

export function summarize(statements: CASStatement[]): PortfolioSummary {
  const used = latestStatements(statements);
  const groups = new Map<string, Group>();
  const group = (name: string, amc: string, asOf: string) => {
    const k = schemeKey(name);
    let g = groups.get(k);
    if (!g) {
      g = { name: name.trim(), amc, folios: new Set(), units: 0, opening: 0, value: 0, cost: 0, navs: [], txns: [], asOf };
      groups.set(k, g);
    }
    if (asOf > g.asOf) g.asOf = asOf;
    return g;
  };

  for (const s of used) {
    const asOf = s.statementPeriod.to;
    for (const f of s.folios) {
      for (const sc of f.schemes) {
        const g = group(sc.name, f.amc, sc.valuation?.date || asOf);
        g.folios.add(f.folio);
        g.reported ??= sc.assetClass;
        g.units += sc.close ?? 0;
        g.opening += sc.open ?? 0;
        g.value += sc.valuation?.value ?? 0;
        g.cost += sc.valuation?.cost ?? 0;
        if (sc.valuation?.nav) g.navs.push(sc.valuation.nav);
        g.txns.push(...sc.transactions);
      }
    }
    for (const st of s.schemeTransactions ?? []) group(st.scheme, st.amc ?? "", asOf).txns.push(...st.transactions);
  }

  const schemes: SchemeSummary[] = [];
  const portfolioFlows: Flow[] = [];
  let covered = 0;

  for (const g of groups.values()) {
    const txnUnits = g.txns.reduce((s, t) => s + (t.units ?? 0), 0);
    // Full history: nothing held before the statement began, and the transactions explain every unit held now.
    const fullHistory = Math.abs(g.opening) < 0.001 && Math.abs(g.opening + txnUnits - g.units) <= Math.max(0.01, g.units * 0.001);
    const flows: Flow[] = g.txns.map((t) => ({ date: t.date, amount: flowOf(t) }));
    if (g.value > 0) flows.push({ date: g.asOf, amount: g.value });
    const rate = fullHistory ? xirr(flows) : null;
    if (fullHistory) {
      portfolioFlows.push(...flows);
      covered += g.value;
    }
    if (g.units <= 0.0001) continue; // fully redeemed: counts toward XIRR, not holdings

    const assetClass = assetClassOf(g.name, g.reported);
    schemes.push({
      name: g.name,
      amc: g.amc,
      folios: [...g.folios],
      assetClass,
      equityStyle: assetClass === "Equity" ? equityStyleOf(g.name) : undefined,
      units: g.units,
      nav: g.navs[0],
      value: g.value,
      cost: g.cost,
      xirr: rate,
      fullHistory,
    });
  }

  schemes.sort((a, b) => b.value - a.value);
  const value = schemes.reduce((s, x) => s + x.value, 0);
  return {
    schemes,
    value,
    cost: schemes.reduce((s, x) => s + x.cost, 0),
    asOf: used.map((s) => s.statementPeriod.to).sort().at(-1),
    xirr: covered > 0 ? xirr(portfolioFlows) : null,
    xirrCoverage: value > 0 ? covered / value : 0,
    historyFrom: used.map((s) => s.statementPeriod.from).filter(Boolean).sort()[0],
  };
}

export interface Slice<K extends string = string> {
  key: K;
  value: number;
  share: number;
}

/** Sums `value` by `keyOf`, largest first, with each slice's share of the total. */
export function breakdown<K extends string>(schemes: SchemeSummary[], keyOf: (s: SchemeSummary) => K | undefined): Slice<K>[] {
  const sums = new Map<K, number>();
  for (const s of schemes) {
    const k = keyOf(s);
    if (k) sums.set(k, (sums.get(k) ?? 0) + s.value);
  }
  const total = [...sums.values()].reduce((a, b) => a + b, 0) || 1;
  return [...sums.entries()].map(([key, value]) => ({ key, value, share: value / total })).sort((a, b) => b.value - a.value);
}

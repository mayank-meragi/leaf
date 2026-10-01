import type { CASStatement, MFTransaction } from "@/types";
import { assetClassOf, latestStatements, schemeKey } from "./portfolio";
import { financialYear } from "./wealth";

/**
 * Realised capital gains from CAS transactions, matched first-in-first-out per scheme
 * (the method the Income Tax Act prescribes for units of a mutual fund).
 *
 * Simplifications, all surfaced in the UI rather than hidden:
 * - Tax regime comes from the scheme's asset class. Hybrids are treated as equity-oriented.
 * - Indexation (pre-July-2024 sales of debt funds) and the 31-Jan-2018 grandfathering NAV aren't applied.
 * - Units bought before the statement begins have no known cost, so their sales are reported as "unmatched".
 */

export type Regime =
  /** Equity-oriented: long term after 12 months. */
  | "equity"
  /** Debt/gold bought before 1 Apr 2023: long term after 24 months (36 for sales before 23 Jul 2024). */
  | "other"
  /** Debt bought on/after 1 Apr 2023: always short term, taxed at slab rate. */
  | "slab";

export interface GainLot {
  scheme: string;
  amc: string;
  buyDate: string;
  sellDate: string;
  units: number;
  cost: number;
  proceeds: number;
  gain: number;
  days: number;
  term: "short" | "long";
  regime: Regime;
  fy: string;
  /** Equity units bought before 1 Feb 2018: cost should be stepped up to the 31-Jan-2018 NAV. */
  grandfathering: boolean;
}

export interface UnmatchedSale {
  scheme: string;
  sellDate: string;
  units: number;
  proceeds: number;
  fy: string;
}

/** Units still held, with the cost they were bought at. */
export interface OpenLot {
  scheme: string;
  buyDate: string;
  units: number;
  cost: number;
  regime: Regime;
}

export interface CapitalGains {
  lots: GainLot[];
  open: OpenLot[];
  unmatched: UnmatchedSale[];
}

export const RATE_CHANGE_DATE = "2024-07-23";
const SPECIFIED_MF_DATE = "2023-04-01";
const GRANDFATHER_BUY_BEFORE = "2018-02-01";
const GRANDFATHER_SELL_FROM = "2018-04-01";
const DAY = 86_400_000;

const epochDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY;

/** `iso` plus `n` months, clamped to the end of the target month (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}

export function regimeOf(assetClass: ReturnType<typeof assetClassOf>, buyDate: string): Regime {
  if (assetClass === "Equity" || assetClass === "Hybrid") return "equity";
  if (assetClass === "Debt" && buyDate >= SPECIFIED_MF_DATE) return "slab";
  return "other";
}

/** Held for more than the threshold months ⇒ long term. */
export function termOf(regime: Regime, buyDate: string, sellDate: string): "short" | "long" {
  if (regime === "slab") return "short";
  const months = regime === "equity" ? 12 : sellDate < RATE_CHANGE_DATE ? 36 : 24;
  return sellDate > addMonths(buyDate, months) ? "long" : "short";
}

interface Lot {
  date: string | null; // null: bought before the statement began, cost unknown
  units: number;
  cost: number;
}

const EPS = 1e-6;

const unitsOf = (t: MFTransaction) => Math.abs(t.units ?? 0);
const amountOf = (t: MFTransaction) => (t.amount != null ? Math.abs(t.amount) : t.units != null && t.nav != null ? Math.abs(t.units * t.nav) : 0);

// Purchases settle before redemptions on the same day.
const ORDER: Partial<Record<MFTransaction["type"], number>> = { REDEMPTION: 2, SWITCH_OUT: 2, REVERSAL: 1 };

function match(name: string, amc: string, reported: string | undefined, opening: number, txns: MFTransaction[], out: CapitalGains) {
  const assetClass = assetClassOf(name, reported);
  const lots: Lot[] = opening > EPS ? [{ date: null, units: opening, cost: 0 }] : [];
  const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date) || (ORDER[a.type] ?? 0) - (ORDER[b.type] ?? 0));

  for (const t of sorted) {
    const units = unitsOf(t);
    if (units < EPS && t.type !== "STAMP_DUTY") continue;
    switch (t.type) {
      case "PURCHASE":
      case "PURCHASE_SIP":
      case "SWITCH_IN":
      case "DIVIDEND_REINVEST":
        lots.push({ date: t.date, units, cost: amountOf(t) });
        break;
      case "STAMP_DUTY": {
        // Stamp duty is part of what a purchase cost (CAMS folds it into the cost value too). It sits on its own row
        // right after the purchase, with no units: add it to the lot bought that day.
        const lot = [...lots].reverse().find((l) => l.date === t.date);
        if (lot) lot.cost += amountOf(t);
        break;
      }
      case "REVERSAL": {
        // A bounced purchase: take the units back out of the most recent lots.
        let left = units;
        while (left > EPS && lots.length) {
          const last = lots[lots.length - 1];
          const take = Math.min(left, last.units);
          last.cost -= (last.cost * take) / last.units;
          last.units -= take;
          left -= take;
          if (last.units <= EPS) lots.pop();
        }
        break;
      }
      case "REDEMPTION":
      case "SWITCH_OUT": {
        const proceeds = amountOf(t);
        let left = units;
        while (left > EPS && lots.length) {
          const lot = lots[0];
          const take = Math.min(left, lot.units);
          const share = take / units;
          if (lot.date == null) {
            out.unmatched.push({ scheme: name, sellDate: t.date, units: take, proceeds: proceeds * share, fy: financialYear(t.date) });
          } else {
            const cost = (lot.cost * take) / lot.units;
            const regime = regimeOf(assetClass, lot.date);
            out.lots.push({
              scheme: name,
              amc,
              buyDate: lot.date,
              sellDate: t.date,
              units: take,
              cost,
              proceeds: proceeds * share,
              gain: proceeds * share - cost,
              days: epochDay(t.date) - epochDay(lot.date),
              term: termOf(regime, lot.date, t.date),
              regime,
              fy: financialYear(t.date),
              grandfathering: regime === "equity" && lot.date < GRANDFATHER_BUY_BEFORE && t.date >= GRANDFATHER_SELL_FROM,
            });
          }
          lot.cost -= (lot.cost * take) / lot.units;
          lot.units -= take;
          left -= take;
          if (lot.units <= EPS) lots.shift();
        }
        // More sold than we know of: the rest came from units the statements never showed being bought.
        if (left > EPS) out.unmatched.push({ scheme: name, sellDate: t.date, units: left, proceeds: proceeds * (left / units), fy: financialYear(t.date) });
        break;
      }
    }
  }
  for (const l of lots) if (l.date) out.open.push({ scheme: name, buyDate: l.date, units: l.units, cost: l.cost, regime: regimeOf(assetClass, l.date) });
}

export interface SchemeGroup {
  name: string;
  amc: string;
  reported?: string;
  isin?: string;
  advisor?: string;
  opening: number;
  close: number;
  /** Statement valuation (sum over folios) and its date. */
  value: number;
  asOf: string;
  /** NAV the statement valued the scheme at, as a price anchor. */
  nav?: number;
  txns: MFTransaction[];
}

/** One group per scheme (folios merged) across the freshest statement per PAN. */
export function groupSchemes(statements: CASStatement[]): SchemeGroup[] {
  const groups = new Map<string, SchemeGroup>();
  const group = (name: string, amc: string) => {
    const k = schemeKey(name);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { name: name.trim(), amc, opening: 0, close: 0, value: 0, asOf: "", txns: [] }));
    return g;
  };

  for (const s of latestStatements(statements)) {
    for (const f of s.folios)
      for (const sc of f.schemes) {
        const g = group(sc.name, f.amc);
        g.reported ??= sc.assetClass;
        g.isin ??= sc.isin;
        g.advisor ??= sc.advisor;
        g.opening += sc.open ?? 0;
        g.close += sc.close ?? 0;
        g.value += sc.valuation?.value ?? 0;
        const at = sc.valuation?.date || s.statementPeriod.to;
        if (at > g.asOf) g.asOf = at;
        if (sc.valuation?.nav) g.nav ??= sc.valuation.nav;
        g.txns.push(...sc.transactions);
      }
    for (const st of s.schemeTransactions ?? []) group(st.scheme, st.amc ?? "").txns.push(...st.transactions);
  }
  return [...groups.values()];
}

export function capitalGains(statements: CASStatement[]): CapitalGains {
  const out: CapitalGains = { lots: [], open: [], unmatched: [] };
  for (const g of groupSchemes(statements)) {
    const net = g.txns.reduce((s, t) => s + (t.units ?? 0), 0);
    // Units held now that the transactions don't explain were bought before the window (MF Central often omits the opening balance).
    const opening = Math.max(g.opening, g.close - net, 0);
    match(g.name, g.amc, g.reported, opening, g.txns, out);
  }
  out.lots.sort((a, b) => a.sellDate.localeCompare(b.sellDate) || a.scheme.localeCompare(b.scheme) || a.buyDate.localeCompare(b.buyDate));
  return out;
}

/** First day a lot counts as long term, or null if it never does (debt bought after Apr 2023). */
export function longTermFrom(regime: Regime, buyDate: string): string | null {
  if (regime === "slab") return null;
  const d = new Date(`${addMonths(buyDate, regime === "equity" ? 12 : 24)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ---- Per-FY summary ----

export interface FYSummary {
  fy: string;
  equityShort: number;
  equityLong: number;
  otherShort: number; // debt/gold held short, plus post-Apr-2023 debt (slab)
  otherLong: number;
  /** Equity LTCG left after set-off and the annual exemption. */
  equityLongTaxable: number;
  exemption: number;
  /** Estimate for equity gains only; everything else depends on your slab or needs indexation. */
  equityTax: number;
  proceeds: number;
  cost: number;
  grandfatheringLots: number;
  unmatched: number;
}

export const ltcgExemption = (fy: string) => (Number(fy.slice(0, 4)) >= 2024 ? 125_000 : 100_000);
export const equityRates = (sellDate: string) => (sellDate < RATE_CHANGE_DATE ? { short: 0.15, long: 0.1 } : { short: 0.2, long: 0.125 });

const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);

export function summarizeFY(cg: CapitalGains, fy: string): FYSummary {
  const lots = cg.lots.filter((l) => l.fy === fy);
  const eq = lots.filter((l) => l.regime === "equity");
  const gain = (xs: GainLot[], term: GainLot["term"]) => sum(xs.filter((l) => l.term === term), (l) => l.gain);
  const equityShort = gain(eq, "short");
  const equityLong = gain(eq, "long");
  const other = lots.filter((l) => l.regime !== "equity");

  // Short-term losses offset long-term gains too; long-term losses only offset long-term gains.
  const stcgTaxable = Math.max(0, equityShort);
  const ltcgNet = Math.max(0, equityLong + Math.min(0, equityShort));
  const exemption = ltcgExemption(fy);
  const equityLongTaxable = Math.max(0, ltcgNet - exemption);

  // The rates changed on 23 Jul 2024, so a year can straddle them: weight each by the gains made under it.
  const weighted = (xs: GainLot[], pick: (r: ReturnType<typeof equityRates>) => number) => {
    const pos = xs.filter((l) => l.gain > 0);
    const total = sum(pos, (l) => l.gain);
    return total ? sum(pos, (l) => l.gain * pick(equityRates(l.sellDate))) / total : pick(equityRates(`${fy.slice(0, 4)}-12-31`));
  };
  const equityTax =
    stcgTaxable * weighted(eq.filter((l) => l.term === "short"), (r) => r.short) +
    equityLongTaxable * weighted(eq.filter((l) => l.term === "long"), (r) => r.long);

  return {
    fy,
    equityShort,
    equityLong,
    otherShort: gain(other, "short"),
    otherLong: gain(other, "long"),
    equityLongTaxable,
    exemption,
    equityTax,
    proceeds: sum(lots, (l) => l.proceeds),
    cost: sum(lots, (l) => l.cost),
    grandfatheringLots: lots.filter((l) => l.grandfathering).length,
    unmatched: sum(cg.unmatched.filter((u) => u.fy === fy), (u) => u.proceeds),
  };
}

/** Every FY with a sale, newest first. */
export const gainYears = (cg: CapitalGains) => [...new Set([...cg.lots.map((l) => l.fy), ...cg.unmatched.map((u) => u.fy)])].sort().reverse();

const TERM_LABEL: Record<Regime, string> = { equity: "Equity", other: "Debt/Gold", slab: "Debt (slab)" };

/** CSV of one FY's lots, for the Schedule CG worksheet. */
export function gainsCSV(cg: CapitalGains, fy: string): string {
  const q = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;
  const rows = cg.lots
    .filter((l) => l.fy === fy)
    .map((l) =>
      [l.scheme, TERM_LABEL[l.regime], l.buyDate, l.sellDate, l.units.toFixed(3), l.cost.toFixed(2), l.proceeds.toFixed(2), l.gain.toFixed(2), l.term === "long" ? "Long" : "Short", l.days]
        .map(q)
        .join(","),
    );
  return [["Scheme", "Type", "Buy date", "Sell date", "Units", "Cost", "Proceeds", "Gain", "Term", "Days held"].map(q).join(","), ...rows].join("\n");
}

// Stocks: a broker's holdings statement (Groww, Zerodha, …) read straight from its XLSX/CSV, no model needed.
// A statement lists what you hold, its cost and its closing value; there are no purchase dates, so no XIRR.

import type { DocSource, StockHolding, StockStatement } from "@/types";
import type { LeafData } from "./db";
import { PATHS, STOCKS_PATH } from "./db";
import { matchAccount, newAccountId, STALE_DAYS } from "./wealth";

type Cell = unknown;

export interface ParsedHoldings {
  asOf?: string;
  client?: string;
  holdings: StockHolding[];
}

const text = (c: Cell) => (c == null ? "" : c instanceof Date ? c.toISOString().slice(0, 10) : String(c)).trim();
const num = (c: Cell) => {
  if (typeof c === "number") return c;
  const n = Number(text(c).replace(/[₹,\s]/g, ""));
  return text(c) && Number.isFinite(n) ? n : null;
};
const key = (c: Cell) => text(c).toLowerCase().replace(/\s+/g, " ");

// Header wording differs by broker; each field lists the spellings seen.
const COLUMNS = {
  name: /^(stock|scrip|security|instrument|symbol|company)( name)?$/,
  isin: /^isin( code)?$/,
  qty: /^(quantity|qty|net qty|quantity available|total quantity)$/,
  avg: /^(average|avg)\.? (buy |cost )?(price|cost)$|^average price$/,
  invested: /^(buy value|invested( value)?|total cost|cost value|investment|invested amount)$/,
  price: /^((closing|current|last|market) price|ltp|cmp)$/,
  value: /^((closing|current|market|present) value)$/,
} as const;

/** Reads the holdings table out of a workbook's rows, with the date and client code from the lines above it. */
export function parseHoldings(sheets: { rows: Cell[][] }[]): ParsedHoldings {
  for (const { rows } of sheets) {
    const at = rows.findIndex((r) => r.some((c) => COLUMNS.name.test(key(c))) && r.some((c) => COLUMNS.qty.test(key(c))));
    if (at < 0) continue;
    const col = Object.fromEntries(
      Object.entries(COLUMNS).map(([field, re]) => [field, rows[at].findIndex((c) => re.test(key(c)))]),
    ) as Record<keyof typeof COLUMNS, number>;
    if (col.avg < 0 && col.invested < 0) continue;
    if (col.price < 0 && col.value < 0) continue;

    const holdings: StockHolding[] = [];
    for (const r of rows.slice(at + 1)) {
      const name = text(r[col.name]);
      const qty = num(r[col.qty]);
      if (!name || qty == null || qty <= 0) continue;
      const avg = col.avg >= 0 ? num(r[col.avg]) : null;
      const cost = col.invested >= 0 ? num(r[col.invested]) : null;
      const price = col.price >= 0 ? num(r[col.price]) : null;
      const val = col.value >= 0 ? num(r[col.value]) : null;
      const invested = cost ?? (avg != null ? avg * qty : null);
      const value = val ?? (price != null ? price * qty : null);
      if (invested == null || value == null) continue;
      holdings.push({
        name,
        isin: col.isin >= 0 ? text(r[col.isin]) || undefined : undefined,
        qty,
        avgPrice: avg ?? invested / qty,
        invested,
        price: price ?? value / qty,
        value,
      });
    }
    if (!holdings.length) continue;

    const head = rows.slice(0, at);
    const flat = head.flatMap((r) => r.map(text)).join("\n");
    const d = /as (?:on|of|at)\s+(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})/i.exec(flat);
    const clientRow = head.find((r) => /client (code|id)/i.test(text(r[0])));
    return {
      asOf: d ? `${d[3]}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}` : undefined,
      client: clientRow ? text(clientRow[1]) || undefined : undefined,
      holdings,
    };
  }
  throw new Error("Couldn't find a holdings table (stock name, quantity, buy and closing value) in this file");
}

/** Minimal CSV reader (quoted fields, commas, newlines in quotes), enough for a broker export. */
export function csvRows(textIn: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < textIn.length; i++) {
    const ch = textIn[i];
    if (quoted) {
      if (ch === '"' && textIn[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") (row.push(cur), (cur = ""));
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && textIn[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      rows.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur || row.length) rows.push([...row, cur]);
  return rows;
}

export interface StockImport {
  files: Record<string, unknown>;
  description: string;
}

/** Saves a statement (replacing one for the same account and date) and keeps the account's net worth balance in step. */
export function applyStockStatement(p: ParsedHoldings, data: LeafData, fileName: string, today: string): StockImport {
  const asOf = p.asOf ?? today;
  const total = p.holdings.reduce((s, h) => s + h.value, 0);
  const cost = p.holdings.reduce((s, h) => s + h.invested, 0);
  const tail = (p.client ?? "").replace(/\D/g, "").slice(-4);

  const stocks = data.wealthAccounts.filter((a) => a.kind === "stocks");
  // The same account as an earlier statement or document; failing that, an old stocks account that never had a reference.
  let account = matchAccount(data.wealthAccounts, "stocks", undefined, p.client) ?? (stocks.length === 1 && !stocks[0].ref ? stocks[0] : undefined);
  const accounts = [...data.wealthAccounts];
  if (!account) {
    account = { id: newAccountId("stocks"), kind: "stocks", name: tail ? `Stocks ••${tail}` : "Stocks", ref: tail ? `••${tail}` : undefined };
    accounts.push(account);
  } else if (!account.ref && tail) {
    account = { ...account, ref: `••${tail}` };
    accounts.splice(accounts.findIndex((a) => a.id === account!.id), 1, account);
  }

  const source: DocSource = { kind: "upload", fileName };
  const statement: StockStatement = { asOf, account: account.id, client: p.client, holdings: p.holdings, source };
  const statements = [...data.stockStatements.filter((s) => !(s.account === account!.id && s.asOf === asOf)), statement].sort((a, b) => b.asOf.localeCompare(a.asOf));
  const snapshots = [...data.wealthSnapshots.filter((s) => !(s.account === account!.id && s.date === asOf)), { account: account.id, date: asOf, value: total, source }];

  const gain = total - cost;
  return {
    files: { [STOCKS_PATH]: statements, [PATHS.wealthAccounts]: accounts, [PATHS.wealthSnapshots]: snapshots },
    description: `${p.holdings.length} holdings as of ${asOf}: value ₹${Math.round(total).toLocaleString("en-IN")}, invested ₹${Math.round(cost).toLocaleString("en-IN")} (${gain >= 0 ? "+" : "−"}₹${Math.abs(Math.round(gain)).toLocaleString("en-IN")})`,
  };
}

// ---- The view's numbers ----

export interface Holding extends StockHolding {
  id: string;
  pnl: number;
  /** Return on cost, as a fraction. */
  pnlPct: number;
  /** Share of the portfolio's value, 0–1. */
  weight: number;
}

export interface StockChanges {
  since: string;
  added: Holding[];
  removed: StockHolding[];
  changed: { holding: Holding; from: number; to: number }[];
}

export interface StocksOverview {
  asOf: string;
  stale: boolean;
  value: number;
  invested: number;
  pnl: number;
  pnlPct: number;
  holdings: Holding[];
  history: { date: string; value: number; invested: number }[];
  changes?: StockChanges;
}

const idOf = (h: StockHolding) => h.isin || h.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Every account at its latest statement on or before `date`, holdings of the same stock added together. */
function holdingsAt(statements: StockStatement[], date: string): StockHolding[] {
  const latest = new Map<string, StockStatement>();
  for (const s of statements) if (s.asOf <= date && (latest.get(s.account)?.asOf ?? "") < s.asOf) latest.set(s.account, s);
  const byId = new Map<string, StockHolding>();
  for (const h of [...latest.values()].flatMap((s) => s.holdings)) {
    const o = byId.get(idOf(h));
    if (!o) byId.set(idOf(h), { ...h });
    else {
      const qty = o.qty + h.qty;
      const invested = o.invested + h.invested;
      byId.set(idOf(h), { ...o, qty, invested, value: o.value + h.value, avgPrice: invested / qty, price: h.price });
    }
  }
  return [...byId.values()];
}

export function stocksOverview(statements: StockStatement[], today: string): StocksOverview | null {
  if (!statements.length) return null;
  const dates = [...new Set(statements.map((s) => s.asOf))].sort();
  const latestDate = dates.at(-1)!;
  const total = (hs: StockHolding[]) => ({ value: hs.reduce((s, h) => s + h.value, 0), invested: hs.reduce((s, h) => s + h.invested, 0) });

  const raw = holdingsAt(statements, latestDate);
  const { value, invested } = total(raw);
  const withStats = (h: StockHolding): Holding => ({ ...h, id: idOf(h), pnl: h.value - h.invested, pnlPct: h.invested ? (h.value - h.invested) / h.invested : 0, weight: value ? h.value / value : 0 });
  const holdings = raw.map(withStats).sort((a, b) => b.value - a.value);

  // The combined figure is only as fresh as the oldest account in it.
  const perAccount = new Map<string, string>();
  for (const s of statements) if ((perAccount.get(s.account) ?? "") < s.asOf) perAccount.set(s.account, s.asOf);
  const asOf = [...perAccount.values()].sort()[0];

  let changes: StockChanges | undefined;
  if (dates.length > 1) {
    const since = dates.at(-2)!;
    const before = new Map(holdingsAt(statements, since).map((h) => [idOf(h), h]));
    const now = new Map(holdings.map((h) => [h.id, h]));
    changes = {
      since,
      added: holdings.filter((h) => !before.has(h.id)),
      removed: [...before.values()].filter((h) => !now.has(idOf(h))),
      changed: holdings.flatMap((h) => (before.has(h.id) && before.get(h.id)!.qty !== h.qty ? [{ holding: h, from: before.get(h.id)!.qty, to: h.qty }] : [])),
    };
  }

  return {
    asOf,
    stale: Date.parse(today) - Date.parse(asOf) > STALE_DAYS * 86_400_000,
    value,
    invested,
    pnl: value - invested,
    pnlPct: invested ? (value - invested) / invested : 0,
    holdings,
    history: dates.map((date) => ({ date, ...total(holdingsAt(statements, date)) })),
    changes,
  };
}

/** One stock across every saved statement, oldest first. */
export function stockHistory(statements: StockStatement[], id: string) {
  return [...new Set(statements.map((s) => s.asOf))]
    .sort()
    .flatMap((date) => {
      const h = holdingsAt(statements, date).find((x) => idOf(x) === id);
      return h ? [{ date, qty: h.qty, avgPrice: h.avgPrice, price: h.price, value: h.value }] : [];
    });
}



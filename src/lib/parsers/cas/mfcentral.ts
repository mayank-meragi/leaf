// Parses MF Central's "CAS detailed report" XLSX (covers both CAMS and KFintech funds).
//
//   Sheet "Portfolio Details": key/value header (Name, Email, PAN, From Date, To Date), a totals block,
//     then rows of: Scheme Name | AMC Name | Category | Folio No. | Invested Value | Current Value | Returns | Units
//   Sheet "Transaction Details": same header, then rows of:
//     Scheme Name | Transaction Description | Date | NAV | Units | Amount
//
// Every cell is text. Transactions carry no folio, so they're kept per scheme (see `schemeTransactions`).

import type { CASStatement, MFFolio, MFTransaction } from "@/types";
import { classify, isoDate, num } from "./parse";

export type Cell = string | number | boolean | Date | null | unknown;
export interface SheetRows {
  name: string;
  rows: Cell[][];
}

const text = (c: Cell) => (c == null ? "" : String(c).replace(/\s+/g, " ").trim());
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

function sheet(sheets: SheetRows[], name: string) {
  return sheets.find((s) => norm(s.name) === norm(name));
}

/** Header keys above the table ("PAN" → "ABCDE1234F"). */
function headerInfo(rows: Cell[][]) {
  const info: Record<string, string> = {};
  for (const r of rows.slice(0, 12)) {
    const k = norm(text(r[0]));
    if (k && text(r[1]) && !r.slice(2).some((c) => text(c))) info[k] = text(r[1]);
  }
  return info;
}

/** Rows below the header row whose first cell is `firstColumn`, as objects keyed by normalised column name. */
function table(rows: Cell[][], firstColumn: string): Record<string, string>[] {
  const start = rows.findIndex((r) => norm(text(r[0])) === norm(firstColumn));
  if (start < 0) return [];
  const cols = rows[start].map((c) => norm(text(c)));
  return rows
    .slice(start + 1)
    .filter((r) => text(r[0]))
    .map((r) => Object.fromEntries(cols.map((c, i) => [c, text(r[i])])));
}

export function isMFCentralWorkbook(sheets: SheetRows[]) {
  return Boolean(sheet(sheets, "Portfolio Details") && sheet(sheets, "Transaction Details"));
}

export function parseMFCentral(sheets: SheetRows[], source: CASStatement["source"]): CASStatement {
  const portfolio = sheet(sheets, "Portfolio Details");
  const txSheet = sheet(sheets, "Transaction Details");
  if (!portfolio || !txSheet) throw new Error("Not an MF Central CAS: expected 'Portfolio Details' and 'Transaction Details' sheets");

  const info = headerInfo(portfolio.rows);
  const to = info.todate ? isoDate(info.todate) : "";
  const pan = info.pan || undefined;

  const folios = new Map<string, MFFolio>();
  for (const r of table(portfolio.rows, "Scheme Name")) {
    const folioNo = r.foliono;
    if (!folioNo) continue;
    const folio = folios.get(folioNo) ?? { folio: folioNo, amc: r.amcname, pan, schemes: [] };
    folios.set(folioNo, folio);
    const units = num(r.units);
    const value = num(r.currentvalue) ?? 0;
    folio.schemes.push({
      name: r.schemename,
      assetClass: r.category?.toUpperCase() || undefined,
      open: null,
      close: units,
      // The export has no NAV column; value / units recovers it.
      valuation: { date: to, nav: units ? Math.round((value / units) * 10000) / 10000 : 0, value, cost: num(r.investedvalue) ?? undefined },
      transactions: [],
    });
  }

  const amcByScheme = new Map([...folios.values()].flatMap((f) => f.schemes.map((s) => [s.name, f.amc] as const)));
  const byScheme = new Map<string, MFTransaction[]>();
  for (const r of table(txSheet.rows, "Scheme Name")) {
    const amount = num(r.amount);
    const units = num(r.units);
    // Nominee / KYC / mandate / "SIPRegistered" events move no money.
    if (!amount && !units) continue;
    if (!/^\d{1,2}-[a-z]{3}-\d{4}$/i.test(r.date)) continue;
    const nav = num(r.nav);
    const list = byScheme.get(r.schemename) ?? [];
    byScheme.set(r.schemename, list);
    list.push({
      date: isoDate(r.date),
      description: r.transactiondescription,
      amount,
      // The export writes "0" where no units moved (e.g. refunds); that's "none", not zero units.
      units: units || null,
      nav: nav || null,
      balance: null,
      type: classify(r.transactiondescription, units, amount),
    });
  }

  return {
    statementPeriod: { from: info.fromdate ? isoDate(info.fromdate) : "", to },
    investor: { name: info.name, email: info.email, pan },
    folios: [...folios.values()],
    schemeTransactions: [...byScheme.entries()].map(([scheme, transactions]) => ({
      scheme,
      amc: amcByScheme.get(scheme),
      transactions: transactions.sort((a, b) => a.date.localeCompare(b.date)),
    })),
    source,
    format: "mfcentral-xlsx",
    parsedAt: new Date().toISOString(),
  };
}

/** Browser: reads an .xlsx File into sheets (the reader library is loaded on demand). */
export async function readWorkbook(file: File): Promise<SheetRows[]> {
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const sheets = await readXlsxFile(file);
  return sheets.map((s) => ({ name: s.sheet, rows: s.data as Cell[][] }));
}

// Parses the text of a CAMS / KFintech *detailed* Consolidated Account Statement.
// Layout (per folio, repeated):
//
//   HDFC Mutual Fund
//   Folio No: 12345678 / 90   PAN: ABCDE1234F   KYC: OK  PAN: OK
//   B123-HDFC Flexi Cap Fund - Direct Plan - Growth - ISIN: INF179K01UT0(Advisor: DIRECT)  Registrar : CAMS
//   Opening Unit Balance: 100.123
//   01-Apr-2024  Purchase - Systematic Investment  5,000.00  3.456  1,446.7800  103.579
//   01-Apr-2024  *** Stamp Duty ***  0.25
//   Closing Unit Balance: 103.579  NAV on 30-Sep-2026: INR 1,900.1234  Total Cost Value: 150,000.00  Market Value on 30-Sep-2026: INR 196,819.00

import type { CASStatement, MFFolio, MFScheme, MFTransaction, MFTxnType } from "@/types";

const DATE = String.raw`\d{2}-[A-Za-z]{3}-\d{4}`;
const NUM = String.raw`\(?-?[\d,]*\.?\d+\)?`;

const RE = {
  period: new RegExp(`(${DATE})\\s+To\\s+(${DATE})`, "i"),
  email: /Email\s*Id\s*:\s*(\S+@\S+)/i,
  amc: /^\s*([A-Za-z0-9&.'\- ]+?Mutual\s*Fund)\s*$/i,
  folio: /Folio\s*No\s*:\s*([\w/ -]+?)(?=\s{2,}|\s+PAN|\s+KYC|$)/i,
  pan: /PAN\s*:\s*([A-Z]{5}\d{4}[A-Z])/,
  schemeHint: /ISIN\s*:|Registrar\s*:|Advisor\s*:/i,
  isin: /ISIN\s*:\s*([A-Z]{2}[A-Z0-9]{9}\d)/i,
  advisor: /Advisor\s*:\s*([^)]+)\)/i,
  rta: /Registrar\s*:\s*(\w+)/i,
  opening: new RegExp(`Opening\\s+Unit\\s+Balance\\s*:\\s*(${NUM})`, "i"),
  closing: new RegExp(`Closing\\s+Unit\\s+Balance\\s*:\\s*(${NUM})`, "i"),
  nav: new RegExp(`NAV\\s+on\\s+(${DATE})\\s*:\\s*INR\\s*(${NUM})`, "i"),
  cost: new RegExp(`(?:Total\\s+)?Cost\\s+Value\\s*:\\s*(?:INR\\s*)?(${NUM})`, "i"),
  value: new RegExp(`(?:Market\\s+)?Value\\s+on\\s+(${DATE})\\s*:\\s*INR\\s*(${NUM})`, "i"),
  // date, description, amount, units, nav, balance
  txn: new RegExp(`^\\s*(${DATE})\\s+(.+?)\\s+(${NUM})\\s+(${NUM})\\s+(${NUM})\\s+(${NUM})\\s*$`),
  // date, description, amount — stamp duty / STT / TDS rows
  tax: new RegExp(`^\\s*(${DATE})\\s+(.+?)\\s+(${NUM})\\s*$`),
};

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

export function isoDate(d: string): string {
  const [dd, mon, yyyy] = d.trim().split("-");
  return `${yyyy}-${MONTHS[mon.toLowerCase()]}-${dd}`;
}

export function num(s: string | undefined): number | null {
  if (s == null) return null;
  const neg = s.includes("(") || s.startsWith("-");
  const n = Number(s.replace(/[(),\s-]/g, ""));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

export function classify(description: string, units: number | null, amount: number | null): MFTxnType {
  const d = description.toLowerCase();
  if (d.includes("stamp duty")) return "STAMP_DUTY";
  if (/\bstt\b|securities transaction tax/.test(d)) return "STT";
  if (/\btds\b/.test(d)) return "TDS";
  if (/idcw|dividend/.test(d)) {
    if (/reinvest/.test(d)) return "DIVIDEND_REINVEST";
    if (units == null || units === 0) return "DIVIDEND_PAYOUT";
  }
  if (/insufficient balance|rejected|reversal|reversed|bounced/.test(d) && ((units ?? 0) < 0 || (amount ?? 0) < 0)) return "REVERSAL";
  if (/switch/.test(d)) return (units ?? amount ?? 0) < 0 ? "SWITCH_OUT" : "SWITCH_IN";
  if ((units ?? 0) < 0 || /redemption|redeem/.test(d)) return "REDEMPTION";
  if (/systematic|\bi?sip\b|\bsys\.? ?invest/.test(d)) return "PURCHASE_SIP";
  if ((units ?? 0) > 0) return "PURCHASE";
  return "MISC";
}

/**
 * Joins a header that wraps over several lines. The PDF puts "Registrar : CAMS" at the end of the
 * first line (right-hand column) and can split the ISIN itself across lines ("INF917K" / "01QA1").
 */
export function joinHeader(parts: string[]): string {
  let rta = "";
  let text = "";
  for (const part of parts) {
    const p = part.replace(/\s*Registrar\s*:\s*(\w+)\s*/i, (_, r) => ((rta ||= r), " ")).trim();
    if (!p) continue;
    const isinSoFar = text.match(/ISIN\s*:\s*([A-Z0-9]*)$/i)?.[1];
    text += isinSoFar !== undefined && isinSoFar.length < 12 ? p : text ? ` ${p}` : p;
  }
  return rta ? `${text}  Registrar : ${rta}` : text;
}

function schemeFromHeader(header: string): MFScheme {
  // "B123-HDFC Flexi Cap Fund - Direct Plan - Growth - ISIN: ..." → strip the RTA code prefix and trailers.
  const code = header.match(/^\s*([A-Z0-9]{1,12})\s*-\s*/);
  let name = header
    .replace(/^\s*[A-Z0-9]{1,12}\s*-\s*/, "")
    .split(/\s*-?\s*ISIN\s*:|\(Advisor|\s+Registrar\s*:/i)[0]
    // Demat and non-demat holdings of a fund are the same scheme.
    .replace(/\s*\((non[- ]?)?demat\)/gi, "")
    .replace(/\s*-\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) name = header.trim();
  return {
    name,
    isin: header.match(RE.isin)?.[1],
    advisor: header.match(RE.advisor)?.[1]?.trim(),
    rta: header.match(RE.rta)?.[1],
    rtaCode: code?.[1],
    open: null,
    close: null,
    transactions: [],
  };
}

export function parseCAS(lines: string[], source: CASStatement["source"]): CASStatement {
  const stmt: CASStatement = {
    statementPeriod: { from: "", to: "" },
    investor: {},
    folios: [],
    source,
    format: "cas-pdf",
    parsedAt: new Date().toISOString(),
  };

  let amc = "";
  let folio: MFFolio | null = null;
  let scheme: MFScheme | null = null;
  // Scheme headers wrap across lines; buffer everything up to the opening balance.
  let headerBuf: string[] | null = null;
  // The last line nothing recognised: the first half of a header that wraps before its ISIN.
  let loose: string | null = null;

  const startScheme = (header: string) => {
    if (!folio) return;
    scheme = schemeFromHeader(header);
    folio.schemes.push(scheme);
  };
  const flushHeader = () => {
    if (headerBuf) startScheme(joinHeader(headerBuf));
    headerBuf = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/ /g, " ");

    if (!stmt.statementPeriod.from) {
      const p = line.match(RE.period);
      if (p) stmt.statementPeriod = { from: isoDate(p[1]), to: isoDate(p[2]) };
    }
    if (!stmt.investor.email) {
      const e = line.match(RE.email);
      if (e) stmt.investor.email = e[1];
    }

    const amcMatch = line.match(RE.amc);
    if (amcMatch && !RE.folio.test(line)) {
      flushHeader();
      amc = amcMatch[1].replace(/\s+/g, " ").trim();
      continue;
    }

    const f = line.match(RE.folio);
    if (f) {
      flushHeader();
      folio = { folio: f[1].replace(/\s+/g, "").trim(), amc, pan: line.match(RE.pan)?.[1], schemes: [] };
      stmt.investor.pan ??= folio.pan;
      stmt.folios.push(folio);
      scheme = null;
      continue;
    }

    if (headerBuf) {
      if (RE.opening.test(line) || RE.txn.test(line) || headerBuf.length >= 5) flushHeader();
      else {
        if (!/^\s*Nominee\s*1/i.test(line)) headerBuf.push(line.trim());
        continue;
      }
    } else if (folio && RE.schemeHint.test(line) && !RE.txn.test(line)) {
      const startsWithCode = /^\s*[A-Z0-9]{1,12}\s*-/.test(line);
      headerBuf = !startsWithCode && loose ? [loose, line.trim()] : [line.trim()];
      loose = null;
      continue;
    }

    const open = line.match(RE.opening);
    if (open && scheme) (scheme as MFScheme).open = num(open[1]);

    const t = line.match(RE.txn);
    if (t && scheme) {
      const amount = num(t[3]);
      const units = num(t[4]);
      (scheme as MFScheme).transactions.push({
        date: isoDate(t[1]),
        description: t[2].trim(),
        amount,
        units,
        nav: num(t[5]),
        balance: num(t[6]),
        type: classify(t[2], units, amount),
      });
      continue;
    }
    const tax = !t && line.match(RE.tax);
    if (tax && scheme && !RE.opening.test(line) && !RE.closing.test(line)) {
      const amount = num(tax[3]);
      const txn: MFTransaction = {
        date: isoDate(tax[1]),
        description: tax[2].replace(/\*/g, "").trim(),
        amount,
        units: null,
        nav: null,
        balance: null,
        type: classify(tax[2], null, amount),
      };
      (scheme as MFScheme).transactions.push(txn);
      continue;
    }

    let matched = Boolean(open);
    if (scheme) {
      const s = scheme as MFScheme;
      const close = line.match(RE.closing);
      if (close) s.close = num(close[1]);
      matched ||= Boolean(close);
      const nav = line.match(RE.nav);
      const value = line.match(RE.value);
      const cost = line.match(RE.cost);
      if (nav || value || cost) {
        matched = true;
        const on = (value ?? nav)?.[1];
        s.valuation = {
          date: on ? isoDate(on) : (s.valuation?.date ?? stmt.statementPeriod.to),
          nav: num(nav?.[2]) ?? s.valuation?.nav ?? 0,
          value: num(value?.[2]) ?? s.valuation?.value ?? 0,
          cost: num(cost?.[1]) ?? s.valuation?.cost,
        };
      }
    }
    loose = matched || !line.trim() ? null : line.trim();
  }
  flushHeader();
  return stmt;
}

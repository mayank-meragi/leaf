// Import path for documents that don't arrive by email: file → text (unlocking PDFs) → Gemini → records.

import type { DocKind, DocSource, InsurancePolicy, LeafConfig, Payslip, TaxDocument, WealthAccount, WealthKind, WealthSnapshot } from "@/types";
import type { DocExtraction, DocInput } from "./ai/documents";
import type { LeafData } from "./db";
import { PATHS } from "./db";
import { employerKey } from "./payroll";
import { financialYear, matchAccount, newAccountId } from "./wealth";

export class NeedsPasswordError extends Error {}

const toBase64 = (bytes: Uint8Array) => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/** Every password Leaf knows, tried in turn (the user rarely knows which one a document uses). */
export function knownPasswords(config: LeafConfig): string[] {
  return [...new Set([config.casPassword, ...Object.values(config.passwords ?? {})].filter((p): p is string => !!p))];
}

/**
 * Turns a file into something Gemini can read. Text PDFs become text (after trying passwords);
 * scanned PDFs and images go inline. Throws NeedsPasswordError if no known password opens it.
 */
export async function loadDocument(file: File, passwords: string[]): Promise<{ input: DocInput; password?: string }> {
  return loadBytes(new Uint8Array(await file.arrayBuffer()), file.name, file.type, passwords, file);
}

export async function loadBytes(
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
  passwords: string[],
  file?: File,
): Promise<{ input: DocInput; password?: string }> {
  const name = fileName.toLowerCase();

  if (name.endsWith(".pdf") || mimeType === "application/pdf") {
    const { pdfToLines, WrongPasswordError } = await import("./parsers/cas/pdf");
    for (const password of [undefined, ...passwords]) {
      try {
        const lines = await pdfToLines(bytes, password);
        const text = lines.join("\n");
        // A scanned PDF has (almost) no text layer; let the model look at the pages instead.
        if (text.replace(/\s/g, "").length < 80) {
          if (password) throw new Error("This PDF is scanned and password-protected; save an unlocked copy and upload that.");
          return { input: { inline: { mimeType: "application/pdf", data: toBase64(bytes) } } };
        }
        return { input: { text }, password };
      } catch (e) {
        if (!(e instanceof WrongPasswordError)) throw e;
      }
    }
    throw new NeedsPasswordError(`${fileName} is password-protected`);
  }
  if (name.endsWith(".xlsx")) {
    const { readWorkbook } = await import("./parsers/cas/mfcentral");
    const sheets = await readWorkbook(file ?? new File([bytes.slice()], fileName));
    const text = sheets.map((s) => `## ${s.name}\n${s.rows.map((r) => r.map((c) => (c == null ? "" : String(c))).join("\t")).join("\n")}`).join("\n\n");
    return { input: { text } };
  }
  if (/\.(csv|txt)$/.test(name)) return { input: { text: new TextDecoder().decode(bytes) } };
  if (mimeType.startsWith("image/")) return { input: { inline: { mimeType, data: toBase64(bytes) } } };
  throw new Error(`Can't read ${fileName}: upload a PDF, image, XLSX or CSV`);
}

const WEALTH_KIND_OF: Partial<Record<DocKind, WealthKind>> = {
  epf_passbook: "epf",
  ppf_statement: "ppf",
  nps_statement: "nps",
  fd_receipt: "fd",
  demat_statement: "stocks",
  loan_statement: "loan",
};

const DEFAULT_NAME: Record<WealthKind, string> = {
  epf: "EPF", ppf: "PPF", nps: "NPS", fd: "Fixed deposit", stocks: "Stocks", gold: "Gold",
  property: "Property", other_asset: "Asset", loan: "Loan", other_liability: "Liability",
};

const iso = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
const masked = (ref: string) => {
  const d = ref.replace(/\D/g, "");
  return d.length >= 4 ? `••${d.slice(-4)}` : ref.trim() || undefined;
};

export interface DocumentChange {
  /** Files to commit (whole-file replacements of the affected collections). */
  files: Record<string, unknown>;
  /** What will happen, for the confirmation step. */
  description: string;
}

/** Works out where an extracted document goes. Pure: returns the files to write. */
export function applyDocument(x: DocExtraction, data: LeafData, source: DocSource, today: string): DocumentChange {
  const wealthKind = WEALTH_KIND_OF[x.kind as DocKind];

  if (wealthKind) {
    if (!(x.balance > 0)) throw new Error("Couldn't find a balance in this document");
    const ref = masked(x.reference);
    let account = matchAccount(data.wealthAccounts, wealthKind, x.institution, x.reference);
    const accounts = [...data.wealthAccounts];
    if (!account) {
      account = { id: newAccountId(wealthKind), kind: wealthKind, name: [x.institution, DEFAULT_NAME[wealthKind]].filter(Boolean).join(" "), institution: x.institution || undefined, ref };
      accounts.push(account);
    }
    const date = iso(x.asOfDate) ?? today;
    const snapshot: WealthSnapshot = { account: account.id, date, value: x.balance, source };
    const snapshots = [...data.wealthSnapshots.filter((s) => !(s.account === account!.id && s.date === date)), snapshot];
    return {
      files: { [PATHS.wealthAccounts]: accounts, [PATHS.wealthSnapshots]: snapshots },
      description: `${accounts.length > data.wealthAccounts.length ? "New account" : "Update"}: ${account.name} = ₹${x.balance.toLocaleString("en-IN")} as of ${date}`,
    };
  }

  if (x.kind === "payslip") {
    const month = /^\d{4}-\d{2}$/.test(x.payMonth) ? x.payMonth : today.slice(0, 7);
    const slip: Payslip = { month, employer: x.institution, gross: x.gross, net: x.net, tds: x.tds, pfEmployee: x.pfEmployee, pfEmployer: x.pfEmployer, source };
    const payslips = mergePayslips(data.payslips, [slip]);
    return { files: { [PATHS.payslips]: payslips }, description: `Payslip ${month} from ${x.institution}: gross ₹${x.gross.toLocaleString("en-IN")}, TDS ₹${x.tds.toLocaleString("en-IN")}` };
  }

  if (x.kind === "form16") {
    const fy = /^\d{4}-\d{2}$/.test(x.financialYear) ? x.financialYear : financialYear(iso(x.asOfDate) ?? today);
    const doc: TaxDocument = { fy, kind: "form16", employer: x.institution || undefined, grossSalary: x.gross || undefined, taxableIncome: x.taxableIncome || undefined, tds: x.tds || undefined, source };
    const taxDocs = [...data.taxDocs.filter((d) => !(d.kind === "form16" && d.fy === fy && d.employer === doc.employer)), doc];
    return { files: { [PATHS.taxDocs]: taxDocs }, description: `Form 16 for FY ${fy} from ${x.institution}: TDS ₹${x.tds.toLocaleString("en-IN")}` };
  }

  if (x.kind === "insurance_policy") {
    const policy: InsurancePolicy = {
      insurer: x.institution,
      type: x.policyType || "other",
      policyRef: masked(x.reference),
      cover: x.cover || undefined,
      premium: x.premium || undefined,
      renewalDate: iso(x.renewalDate),
      insured: x.insured || undefined,
      source,
    };
    const same = (p: InsurancePolicy) => p.insurer === policy.insurer && (p.policyRef ?? "") === (policy.policyRef ?? "");
    const policies = [...data.policies.filter((p) => !same(p)), policy];
    return { files: { [PATHS.policies]: policies }, description: `${x.institution} ${policy.type.replace("_", " ")} policy${policy.cover ? `, cover ₹${policy.cover.toLocaleString("en-IN")}` : ""}${policy.renewalDate ? `, renews ${policy.renewalDate}` : ""}` };
  }

  throw new Error("This doesn't look like a document Leaf tracks (passbook, statement, payslip, Form 16, policy, loan)");
}

/** Adds payslips, replacing any for the same month and employer (names vary between documents). */
export function mergePayslips(existing: Payslip[], incoming: Payslip[]): Payslip[] {
  const key = (p: Payslip) => `${p.month}|${employerKey(p.employer)}`;
  const byKey = new Map(existing.map((p) => [key(p), p]));
  for (const p of incoming) byKey.set(key(p), p);
  return [...byKey.values()].sort((a, b) => b.month.localeCompare(a.month));
}

/** Turns a payslip / Form 16 extraction into a record (or null if it's neither). */
export function payrollRecord(x: DocExtraction, source: DocSource, today: string): { payslip?: Payslip; taxDoc?: TaxDocument } | null {
  if (x.kind === "payslip") {
    const month = /^\d{4}-\d{2}$/.test(x.payMonth) ? x.payMonth : today.slice(0, 7);
    return { payslip: { month, employer: x.institution, gross: x.gross, net: x.net, tds: x.tds, pfEmployee: x.pfEmployee, pfEmployer: x.pfEmployer, source } };
  }
  if (x.kind === "form16") {
    const fy = /^\d{4}-\d{2}$/.test(x.financialYear) ? x.financialYear : financialYear(iso(x.asOfDate) ?? today);
    return { taxDoc: { fy, kind: "form16", employer: x.institution || undefined, grossSalary: x.gross || undefined, taxableIncome: x.taxableIncome || undefined, tds: x.tds || undefined, source } };
  }
  return null;
}

/** Records a manual balance for an account (creating it if needed). */
export function manualBalance(data: LeafData, account: WealthAccount, value: number, date: string): Record<string, unknown> {
  const accounts = data.wealthAccounts.some((a) => a.id === account.id) ? data.wealthAccounts : [...data.wealthAccounts, account];
  const snapshots = [...data.wealthSnapshots.filter((s) => !(s.account === account.id && s.date === date)), { account: account.id, date, value, source: { kind: "manual" as const } }];
  return { [PATHS.wealthAccounts]: accounts, [PATHS.wealthSnapshots]: snapshots };
}

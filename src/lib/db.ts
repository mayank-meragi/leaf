// Repo layout:
//   config.json                 LeafConfig (connected Gmail accounts, CAS password, sync cursors)
//   transactions/YYYY-MM.json   Transaction[] for that month, newest first
//   mf/<to-date>--<id>.json     one parsed CAS statement per file
//   cards/statements.json       CardStatement[] (credit card bills: amount due, due date)
//   cards/payments.json         CardPayment[] (bill payments, e.g. CRED receipts)
//   wealth/accounts.json        WealthAccount[] (EPF, PPF, NPS, FD, stocks, loans…)
//   wealth/snapshots.json       WealthSnapshot[] (a known value on a date)
//   wealth/flows.json           WealthFlow[] (contributions since the last snapshot)
//   income/payslips.json        Payslip[]
//   tax/documents.json          TaxDocument[] (Form 16, …)
//   insurance/policies.json     InsurancePolicy[]
//   stocks/statements.json      StockStatement[] (broker holdings statements)

import type {
  CardPayment,
  CardStatement,
  CASStatement,
  InsurancePolicy,
  LeafConfig,
  Payslip,
  StockStatement,
  TaxDocument,
  Transaction,
  WealthAccount,
  WealthFlow,
  WealthSnapshot,
} from "@/types";
import type { Recategorization } from "./categories";
import { GitHubStore } from "./github/store";
import type { Settings } from "./settings";

export const EMPTY_CONFIG: LeafConfig = { version: 1, accounts: [] };

export interface LeafData {
  config: LeafConfig;
  transactions: Transaction[];
  statements: CASStatement[];
  cardStatements: CardStatement[];
  cardPayments: CardPayment[];
  wealthAccounts: WealthAccount[];
  wealthSnapshots: WealthSnapshot[];
  wealthFlows: WealthFlow[];
  payslips: Payslip[];
  taxDocs: TaxDocument[];
  policies: InsurancePolicy[];
  stockStatements: StockStatement[];
}

export const PATHS = {
  wealthAccounts: "wealth/accounts.json",
  wealthSnapshots: "wealth/snapshots.json",
  wealthFlows: "wealth/flows.json",
  payslips: "income/payslips.json",
  taxDocs: "tax/documents.json",
  policies: "insurance/policies.json",
} as const;

export const STOCKS_PATH = "stocks/statements.json";
export const CARD_STATEMENTS_PATH = "cards/statements.json";
export const CARD_PAYMENTS_PATH = "cards/payments.json";

export function storeFor(s: Settings) {
  return new GitHubStore({ owner: s.owner, repo: s.repo, branch: s.branch || "main", token: s.githubToken });
}

export async function loadAll(store: GitHubStore): Promise<LeafData> {
  const [config, txnFiles, mfFiles, cardStatements, cardPayments, wealthAccounts, wealthSnapshots, wealthFlows, payslips, taxDocs, policies, stockStatements] = await Promise.all([
    store.readJSON<LeafConfig>("config.json"),
    store.list("transactions"),
    store.list("mf"),
    store.readJSON<CardStatement[]>(CARD_STATEMENTS_PATH),
    store.readJSON<CardPayment[]>(CARD_PAYMENTS_PATH),
    store.readJSON<WealthAccount[]>(PATHS.wealthAccounts),
    store.readJSON<WealthSnapshot[]>(PATHS.wealthSnapshots),
    store.readJSON<WealthFlow[]>(PATHS.wealthFlows),
    store.readJSON<Payslip[]>(PATHS.payslips),
    store.readJSON<TaxDocument[]>(PATHS.taxDocs),
    store.readJSON<InsurancePolicy[]>(PATHS.policies),
    store.readJSON<StockStatement[]>(STOCKS_PATH),
  ]);
  const [txns, statements] = await Promise.all([
    Promise.all(txnFiles.filter((f) => f.endsWith(".json")).map((f) => store.readJSON<Transaction[]>(`transactions/${f}`))),
    Promise.all(mfFiles.filter((f) => f.endsWith(".json")).map((f) => store.readJSON<CASStatement>(`mf/${f}`))),
  ]);
  return {
    config: config ?? EMPTY_CONFIG,
    transactions: txns.flatMap((t) => t ?? []).sort((a, b) => b.date.localeCompare(a.date)),
    statements: statements.filter((s): s is CASStatement => s != null).sort((a, b) => b.statementPeriod.to.localeCompare(a.statementPeriod.to)),
    cardStatements: (cardStatements ?? []).sort((a, b) => b.statementDate.localeCompare(a.statementDate)),
    cardPayments: (cardPayments ?? []).sort((a, b) => b.date.localeCompare(a.date)),
    wealthAccounts: wealthAccounts ?? [],
    wealthSnapshots: wealthSnapshots ?? [],
    wealthFlows: wealthFlows ?? [],
    payslips: payslips ?? [],
    taxDocs: taxDocs ?? [],
    policies: policies ?? [],
    stockStatements: stockStatements ?? [],
  };
}

/**
 * Files to write so that `incoming` is merged (by id) into the existing month shards.
 * `updated` replaces existing records outright (callers keep user edits themselves).
 */
export function monthShards(existing: Transaction[], incoming: Transaction[], updated: Transaction[] = []): Record<string, Transaction[]> {
  const touched = new Set([...incoming, ...updated].map((t) => t.date.slice(0, 7)));
  const byId = new Map(existing.filter((t) => touched.has(t.date.slice(0, 7))).map((t) => [t.id, t]));
  for (const t of updated) byId.set(t.id, t);
  // An existing record wins so user edits (category, note) survive a re-sync.
  for (const t of incoming) if (!byId.has(t.id)) byId.set(t.id, t);
  const files: Record<string, Transaction[]> = {};
  for (const t of byId.values()) (files[`transactions/${t.date.slice(0, 7)}.json`] ??= []).push(t);
  for (const list of Object.values(files)) list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return files;
}

export function statementPath(s: CASStatement): string {
  const id = s.source.kind === "gmail" ? s.source.messageId : s.source.fileName.replace(/[^\w.-]+/g, "_");
  return `mf/${s.statementPeriod.to || "undated"}--${id}.json`;
}

/** Commits a recategorisation: the updated config plus every month shard it touched. */
export async function saveRecategorization(store: GitHubStore, all: Transaction[], rec: Recategorization, message: string) {
  const byId = new Map(rec.changed.map((t) => [t.id, t]));
  const months = new Set(rec.changed.map((t) => t.date.slice(0, 7)));
  const files: Record<string, unknown> = { "config.json": rec.config };
  for (const month of months) {
    files[`transactions/${month}.json`] = all.filter((t) => t.date.startsWith(month)).map((t) => byId.get(t.id) ?? t);
  }
  await store.writeJSON(files, message);
}

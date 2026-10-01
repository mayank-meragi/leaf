// Shapes of everything Leaf persists in the data repo.

export type ISODate = string; // YYYY-MM-DD

export interface GmailAccount {
  email: string;
  label?: string;
  /** Gmail messages newer than this (unix seconds) have not been synced yet. */
  syncedUntil?: number;
}

export interface LeafConfig {
  version: 1;
  accounts: GmailAccount[];
  /** Google OAuth client ID (not a secret), so every device can sign in to Gmail. */
  googleClientId?: string;
  /** Opt-in copy of the Gemini key, so other devices (e.g. a phone) can sync without re-entering it. */
  geminiKey?: string;
  /** Password for CAS PDFs (CAMS/KFintech use the PAN in upper case). Stored in the private data repo. */
  casPassword?: string;
  /** Passwords for other protected documents, keyed by `DocKind` (e.g. NPS statements, payslips). */
  passwords?: Partial<Record<DocKind, string>>;
  /** User overrides for payment sources (type, nickname), keyed by `instrumentKey`. */
  instruments?: InstrumentMeta[];
  /** User-created categories, in addition to the built-in ones. */
  categories?: string[];
  /** Senders (domains or addresses) added via "Find senders", on top of the built-in bank list. */
  extraSenders?: { sender: string; addedAt: number }[];
  /** Gmail message ids of CAMS/KFintech PDFs that weren't a CAS, so sync doesn't re-read them. */
  skippedCasMessages?: string[];
  /** "Everything from/to this counterparty is X": applied to past transactions and every future sync. */
  categoryRules?: CategoryRule[];
  /** Target share of the mutual fund portfolio per asset class, in percent (sums to 100). */
  rebalanceTargets?: Record<string, number>;
  /** AMFI scheme code of the index fund used as the benchmark for mutual fund returns. */
  benchmark?: number;
  goals?: Goal[];
}

export interface Goal {
  id: string;
  name: string;
  target: number;
  /** When the money is needed. */
  date: ISODate;
  /** Names of the mutual fund schemes earmarked for it. */
  schemes: string[];
  /** Assumed annual return, in percent. */
  returnPct: number;
  /** Monthly amount going in; when unset, the SIPs found on the linked schemes are used. */
  monthly?: number;
}

export interface CategoryRule {
  /** Normalised counterparty (see `partyKey`). */
  party: string;
  direction: TxnDirection;
  category: string;
}

export type TxnDirection = "debit" | "credit";

/** "card" = a card whose alerts never say credit or debit. */
export type InstrumentKind = "credit_card" | "debit_card" | "card" | "bank_account" | "wallet" | "other";

export interface InstrumentMeta {
  /** `<issuer>-<last4>`, e.g. "hdfc-2222". */
  key: string;
  kind?: InstrumentKind;
  name?: string;
}

export interface Transaction {
  /** Stable id: `<gmail account>:<message id>` so re-syncs are idempotent. */
  id: string;
  date: ISODate;
  amount: number;
  currency: string;
  direction: TxnDirection;
  /** Merchant / payee / counterparty as best parsed from the alert. */
  description: string;
  /** Masked instrument as extracted, e.g. "HDFC Card ••1234". Free text; see `instrumentKey` for identity. */
  instrument?: string;
  /** What kind of instrument the alert says it is, when it says. */
  instrumentKind?: InstrumentKind;
  /**
   * Balance the alert reported after this transaction: available balance for a bank account,
   * available credit limit for a card.
   */
  balanceAfter?: number;
  /** `parser` is "gemini@2" once balance and instrument kind were extracted. `receivedAt` orders same-day alerts. */
  source: { account: string; messageId: string; parser: string; receivedAt?: string };
  category?: string;
  note?: string;
}

// ---- Mutual funds (CAS) ----

export type MFTxnType =
  | "PURCHASE"
  | "PURCHASE_SIP"
  | "REDEMPTION"
  | "SWITCH_IN"
  | "SWITCH_OUT"
  | "DIVIDEND_PAYOUT"
  | "DIVIDEND_REINVEST"
  | "STAMP_DUTY"
  | "STT"
  | "TDS"
  /** A purchase undone, e.g. SIP instalment bounced for insufficient balance. */
  | "REVERSAL"
  | "MISC";

export interface MFTransaction {
  date: ISODate;
  description: string;
  amount: number | null;
  units: number | null;
  nav: number | null;
  balance: number | null;
  type: MFTxnType;
}

export interface MFScheme {
  name: string;
  /** Asset class as the source reports it, e.g. "EQUITY". */
  assetClass?: string;
  isin?: string;
  amfi?: string;
  advisor?: string;
  rta?: string;
  rtaCode?: string;
  open: number | null;
  close: number | null;
  valuation?: { date: ISODate; nav: number; value: number; cost?: number };
  transactions: MFTransaction[];
}

export interface MFFolio {
  folio: string;
  amc: string;
  pan?: string;
  schemes: MFScheme[];
}

export interface CASStatement {
  statementPeriod: { from: ISODate; to: ISODate };
  investor: { name?: string; email?: string; pan?: string };
  folios: MFFolio[];
  /**
   * Transactions the source doesn't attribute to a folio (MF Central's XLSX lists them by scheme only,
   * and one scheme can sit in several folios). Folio schemes carry no transactions in that case.
   */
  schemeTransactions?: { scheme: string; amc?: string; transactions: MFTransaction[] }[];
  /** Where it came from — a Gmail message or a manual upload. */
  source: { kind: "gmail"; account: string; messageId: string } | { kind: "upload"; fileName: string };
  format?: "cas-pdf" | "mfcentral-xlsx";
  parsedAt: string;
}

// ---- Credit card statements ----

export interface CardStatement {
  /** `instrumentKey` of the card, e.g. "axis-4444". */
  card: string;
  /** Statement date; the email's date when the statement doesn't say. */
  statementDate: ISODate;
  totalDue: number;
  minDue?: number;
  dueDate?: ISODate;
  source: { account: string; messageId: string };
}

export interface CardPayment {
  /** `instrumentKey` of the card paid. */
  card: string;
  amount: number;
  date: ISODate;
  /** How it was paid, e.g. "CRED". */
  via?: string;
  /** UTR / order id when the receipt shows one. */
  reference?: string;
  source: { account: string; messageId: string };
}

// ---- Net worth: accounts outside mutual funds and bank alerts ----

export type WealthKind = "epf" | "ppf" | "nps" | "fd" | "stocks" | "gold" | "property" | "other_asset" | "loan" | "other_liability";

export interface WealthAccount {
  id: string;
  kind: WealthKind;
  name: string;
  institution?: string;
  /** Masked account / PRAN / UAN / policy reference, for matching future documents. */
  ref?: string;
}

/** A known value of an account on a date (a statement, passbook, or manual entry). */
export interface WealthSnapshot {
  account: string;
  date: ISODate;
  /** Always positive; liabilities are subtracted by kind. */
  value: number;
  source: DocSource;
}

/** Money moved into or out of an account after its last snapshot (e.g. an NPS contribution email). */
export interface WealthFlow {
  account: string;
  date: ISODate;
  amount: number;
  kind: "contribution" | "withdrawal";
  source: DocSource;
}

export type DocSource =
  | { kind: "gmail"; account: string; messageId: string }
  | { kind: "upload"; fileName: string }
  | { kind: "manual" };

// ---- Documents: what an imported file turned out to be ----

export type DocKind =
  | "epf_passbook"
  | "ppf_statement"
  | "nps_statement"
  | "fd_receipt"
  | "demat_statement"
  | "loan_statement"
  | "payslip"
  | "form16"
  | "insurance_policy";

export interface Payslip {
  month: string; // YYYY-MM
  employer: string;
  gross: number;
  net: number;
  tds: number;
  pfEmployee: number;
  pfEmployer: number;
  source: DocSource;
}

export interface TaxDocument {
  /** Financial year, e.g. "2025-26". */
  fy: string;
  kind: "form16" | "ais" | "itr" | "refund";
  employer?: string;
  grossSalary?: number;
  taxableIncome?: number;
  tds?: number;
  source: DocSource;
}

export interface InsurancePolicy {
  insurer: string;
  type: "health" | "term_life" | "life" | "motor" | "travel" | "home" | "other";
  policyRef?: string;
  cover?: number;
  premium?: number;
  /** When the premium is next due / the policy renews. */
  renewalDate?: ISODate;
  insured?: string;
  source: DocSource;
}

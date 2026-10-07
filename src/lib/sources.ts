// Which emails are worth sending to OpenAI. Kept deliberately broad: the model decides
// what is actually a transaction, this just keeps newsletters and chat out of the batch.

export const ALERT_SENDERS = [
  // Banks moved to *.bank.in in 2025; keep both.
  "hdfcbank.net", "hdfcbank.bank.in", "hdfcbank.com",
  "icicibank.com", "icici.bank.in",
  "alerts.sbi.co.in", "sbi.bank.in", "sbicard.com",
  "axisbank.com", "axis.bank.in",
  "kotak.com", "kotak.bank.in",
  "idfcfirstbank.com", "idfcfirst.bank.in",
  "yesbank.in", "yes.bank.in",
  "americanexpress.com",
  // Federal Bank co-branded cards: OneCard and Scapia.
  "getonecard.app", "federalbank.co.in", "federal.bank.in", "scapia.cards",
];

/** Marketing senders on the same domains as card alerts; skipping them saves OpenAI calls. */
const MARKETING_SENDERS = ["notify@getonecard.app", "offers.scapia.cards", "travel.scapia.cards", "offers.sbicard.com", "communications1@sbicard.com"];

/** `onlyExtra` searches just the given senders (used to backfill newly added ones). */
export function alertQuery(afterUnix?: number, extraSenders: string[] = [], onlyExtra = false): string {
  const from = (onlyExtra ? extraSenders : [...ALERT_SENDERS, ...extraSenders]).join(" OR ");
  return `from:(${from}) -from:(${MARKETING_SENDERS.join(" OR ")}) -subject:(OTP)${afterUnix ? ` after:${afterUnix}` : ""}`;
}

/**
 * Card bill events: statements and bill-payment receipts, from issuers and from CRED.
 * Kept separate from alerts because a payment receipt is the card-side view of a bank debit
 * Leaf already has, not a new transaction.
 */
export const CARD_EVENT_SENDERS = ["cred.club", "getonecard.app", "federalbank.co.in", "federal.bank.in"];

export function cardEventQuery(afterUnix: number): string {
  const issuers = [...ALERT_SENDERS, ...CARD_EVENT_SENDERS].join(" OR ");
  return (
    `after:${afterUnix} (` +
    `(from:(${issuers}) subject:statement "credit card") OR ` +
    `(from:(cred.club) subject:("bill payment" OR "new bill")) OR ` +
    `(from:(getonecard.app OR federalbank.co.in OR federal.bank.in) subject:(payment OR statement)))`
  );
}

// CAMS and KFintech both mail consolidated account statements as password-protected PDFs.
export function casQuery(afterUnix?: number): string {
  return `from:(camsonline.com OR kfintech.com OR karvy.com) has:attachment filename:pdf${afterUnix ? ` after:${afterUnix}` : ""}`;
}

/** NPS (Protean CRA): contribution credits and monthly transaction statements. */
export function npsQuery(afterUnix: number): string {
  return `from:(proteantech.in OR kfintech.com) (subject:"Contribution Credit" OR subject:"Transaction Statement") after:${afterUnix}`;
}

/**
 * Payroll providers' salary / payslip / Form 16 emails. Only noreply@razorpay.com (RazorpayX Payroll),
 * not all of razorpay.com: its merchant receipts would duplicate card and bank alerts.
 */
export const PAYROLL_SENDERS = ["noreply@razorpay.com", "kekamail.com", "darwinbox.in", "darwinbox.com", "greythr.com", "zohopayroll.com", "zoho.in"];

export function payrollQuery(afterUnix: number): string {
  return (
    `from:(${PAYROLL_SENDERS.join(" OR ")}) after:${afterUnix} ` +
    `(subject:(salary OR payslip OR "pay slip" OR "Cha-ching" OR "Form 16") OR "salary has been credited")`
  );
}

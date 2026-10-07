// The model turns raw alert emails into transactions. Emails are sent in batches so a sync of a few
// hundred alerts is a handful of calls, and the response is constrained to a JSON schema.

import { z } from "zod";
import type { ParsedEmail } from "@/lib/google/gmail";
import { DEFAULT_MODEL, generateJson } from "./llm";

export { DEFAULT_MODEL };

// Built per sync so user-created categories are offered to the model too.
function schema(categories: string[]) {
  return z.object({
    results: z.array(
      z.object({
        emailIndex: z.number().int().describe("Index of the email in the input list"),
        isTransaction: z
          .boolean()
          .describe("True only for a completed debit or credit. False for OTPs, offers, dues reminders, statements, failed or future-dated transactions."),
        date: z.string().describe("Transaction date as YYYY-MM-DD; fall back to the email date"),
        amount: z.number().describe("Positive amount in the transaction currency"),
        currency: z.string().describe("ISO 4217 code, e.g. INR"),
        direction: z.enum(["debit", "credit"]),
        description: z.string().describe("Merchant or counterparty name, cleaned up and human-readable (e.g. 'Swiggy', 'Rahul Sharma')"),
        instrument: z
          .string()
          .describe("Issuer and last 4 digits of the card or account the money moved through, as '<Bank> ••<last4>', e.g. 'HDFC ••1234'; empty if unknown"),
        instrumentKind: z
          .enum(["credit_card", "debit_card", "bank_account", "wallet", "unknown"])
          .describe("Only say credit_card or debit_card when the email says so. UPI and NEFT/IMPS move money from a bank_account."),
        category: z.enum(categories as [string, ...string[]]),
        hasBalance: z.boolean().describe("True only if the email states a balance or limit remaining after this transaction"),
        balance: z
          .number()
          .describe("Available balance (bank account) or available credit limit (card) after this transaction, as stated; 0 if hasBalance is false"),
      }),
    ),
  });
}

export type ExtractedTxn = z.infer<ReturnType<typeof schema>>["results"][number];

const CardEventSchema = z.object({
  results: z.array(
    z.object({
      emailIndex: z.number().int(),
      kind: z
        .enum(["statement", "payment", "other"])
        .describe("statement: a credit card bill/statement stating the amount due. payment: a confirmation that a card bill payment succeeded. other: anything else (reminders, offers)"),
      issuer: z.string().describe("Card issuer bank, e.g. 'Axis', 'HDFC', 'Federal Bank'"),
      cardDigits: z.string().describe("The unmasked card number digits shown (e.g. 'XXXX-6666' → '6666', 'XX44' → '44'), else empty"),
      statementDate: z
        .string()
        .describe("statement: the date the bill/statement was generated, YYYY-MM-DD (look for 'bill generated on', 'statement date', 'statement period … to <date>'); else empty"),
      totalDue: z.number().describe("statement: total amount due; else 0"),
      minDue: z.number().describe("statement: minimum amount due; else 0"),
      dueDate: z.string().describe("statement: payment due date, YYYY-MM-DD, else empty"),
      amountPaid: z.number().describe("payment: amount paid; else 0"),
      paidOn: z.string().describe("payment: payment date, YYYY-MM-DD, else empty"),
      via: z.string().describe("payment: app or channel used, e.g. 'CRED', 'NetBanking', else empty"),
      reference: z.string().describe("payment: UTR or order id if shown, else empty"),
    }),
  ),
});
export type ExtractedCardEvent = z.infer<typeof CardEventSchema>["results"][number];

const SYSTEM = `You extract financial transactions from Indian bank, credit card and UPI alert emails.
Return one result per input email, in any order, identified by emailIndex.
Transfers between the user's own accounts and credit-card bill payments are category "Transfers".
Do not invent data: if an email is not a completed transaction, set isTransaction=false and fill the other fields with best-effort placeholders.`;

const CARD_EVENT_SYSTEM = `You read Indian credit card emails from card issuers and bill-payment apps like CRED:
statements / "new bill generated" notices, and "bill payment successful" confirmations.
Read the email body, not attachments. Return one result per input email, identified by emailIndex.
Amounts are plain positive numbers ("10500.50 Dr" → 10500.5; "₹8,200.25" → 8200.25).
Due-date reminders and offers are kind "other".`;

// Alert bodies are short; anything past this is legal footer boilerplate.
const MAX_EMAIL_CHARS = 4000;
const BATCH_SIZE = 25;

export class Extractor {
  private schema: ReturnType<typeof schema>;

  constructor(
    private apiKey: string,
    categories: string[],
    private model = DEFAULT_MODEL,
  ) {
    this.schema = schema(categories);
  }

  private async run<S extends z.ZodType<{ results: { emailIndex: number }[] }>>(emails: ParsedEmail[], system: string, schema: S) {
    const input = emails
      .map(
        (e, i) =>
          `<email index="${i}" date="${e.date.toISOString().slice(0, 10)}">\nFrom: ${e.from}\nSubject: ${e.subject}\n\n${e.text.slice(0, MAX_EMAIL_CHARS)}\n</email>`,
      )
      .join("\n\n");

    const parsed = (await generateJson({ apiKey: this.apiKey, model: this.model, system, parts: [{ text: input }], schema })) as z.infer<S>;
    return parsed.results.filter((r) => r.emailIndex >= 0 && r.emailIndex < emails.length) as z.infer<S>["results"];
  }

  /** Card statements and bill-payment receipts. Keyed by Gmail message id; "other" is dropped. */
  async extractCardEvents(emails: ParsedEmail[]): Promise<Map<string, ExtractedCardEvent>> {
    const out = new Map<string, ExtractedCardEvent>();
    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const batch = emails.slice(i, i + BATCH_SIZE);
      for (const r of await this.run(batch, CARD_EVENT_SYSTEM, CardEventSchema)) {
        if (r.kind !== "other") out.set(batch[r.emailIndex].id, r);
      }
    }
    return out;
  }

  /** Returns extracted transactions keyed by Gmail message id (non-transactions are dropped). */
  async extract(emails: ParsedEmail[], onProgress?: (done: number) => void): Promise<Map<string, ExtractedTxn>> {
    const out = new Map<string, ExtractedTxn>();
    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const batch = emails.slice(i, i + BATCH_SIZE);
      for (const r of await this.run(batch, SYSTEM, this.schema)) {
        if (!r.isTransaction || r.amount <= 0) continue;
        out.set(batch[r.emailIndex].id, r);
      }
      onProgress?.(Math.min(i + BATCH_SIZE, emails.length));
    }
    return out;
  }
}

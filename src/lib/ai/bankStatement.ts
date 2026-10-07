// Reads a bank account (or credit card) statement into transactions. Long statements are read in
// chunks of lines so a year of rows doesn't overflow the model's output.

import { z } from "zod";
import type { DocInput } from "./documents";
import { DEFAULT_MODEL, generateJson, type Part } from "./llm";

function schema(categories: string[]) {
  return z.object({
    isStatement: z.boolean().describe("True only for a bank account or credit card statement listing transactions"),
    bank: z.string().describe("Issuing bank, e.g. 'HDFC', 'Axis'; empty if not shown"),
    accountType: z.enum(["bank_account", "credit_card"]),
    accountLast4: z.string().describe("Last 4 digits of the account / card number as shown; empty if not shown"),
    periodFrom: z.string().describe("Statement period start, YYYY-MM-DD; empty if not shown"),
    periodTo: z.string().describe("Statement period end, YYYY-MM-DD; empty if not shown"),
    closingBalance: z.number().describe("Closing balance of the statement as stated; 0 if not shown or not in this part"),
    hasClosingBalance: z.boolean(),
    transactions: z.array(
      z.object({
        date: z.string().describe("Transaction date, YYYY-MM-DD"),
        description: z.string().describe("Counterparty or merchant, cleaned up and human-readable (not the raw narration)"),
        amount: z.number().describe("Positive amount"),
        direction: z.enum(["debit", "credit"]).describe("debit = money out (withdrawal, purchase); credit = money in (deposit, refund, payment received)"),
        hasBalance: z.boolean().describe("True if the statement prints a running balance on this row"),
        balance: z.number().describe("Running balance after this row as printed; 0 if hasBalance is false"),
        category: z.enum(categories as [string, ...string[]]),
      }),
    ),
  });
}

export type StatementExtraction = z.infer<ReturnType<typeof schema>>;
export type StatementRow = StatementExtraction["transactions"][number];

const SYSTEM = `You read Indian bank account and credit card statements and extract every transaction row.
Amounts are plain positive numbers in rupees. Dates are YYYY-MM-DD (Indian statements print DD/MM/YY or DD-MM-YYYY: day first).
List rows in the order the statement prints them. Include every transaction in the text you are given; skip opening/closing balance lines, totals, page headers and footers.
Withdrawals / Dr are debits; deposits / Cr are credits. Own-account transfers and credit card bill payments are category "Transfers".
Don't invent data: leave a field empty/0 if the statement doesn't state it.`;

const CHUNK_CHARS = 14_000;
const HEADER_CHARS = 2_500;

/** Splits text on line boundaries; every chunk after the first repeats the header so the model knows the account. */
export function chunkStatement(text: string, size = CHUNK_CHARS, headerChars = HEADER_CHARS): string[] {
  if (text.length <= size) return [text];
  const header = text.slice(0, headerChars);
  const chunks: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur.length + line.length + 1 > size && cur) {
      chunks.push(cur);
      cur = "";
    }
    cur += `${line}\n`;
  }
  if (cur) chunks.push(cur);
  return chunks.map((c, i) => (i === 0 ? c : `[Statement header, for context only]\n${header}\n\n[Rows to extract start here]\n${c}`));
}

export class StatementReader {
  private schema: ReturnType<typeof schema>;

  constructor(
    private apiKey: string,
    categories: string[],
    private model = DEFAULT_MODEL,
  ) {
    this.schema = schema(categories);
  }

  private call(parts: Part[]): Promise<StatementExtraction> {
    return generateJson({ apiKey: this.apiKey, model: this.model, system: SYSTEM, parts, schema: this.schema });
  }

  async read(input: DocInput, fileName: string, onProgress?: (done: number, total: number) => void): Promise<StatementExtraction> {
    if (!("text" in input)) return this.call([{ inline: input.inline }, { text: `File: ${fileName}` }]);

    const chunks = chunkStatement(input.text);
    const parts: StatementExtraction[] = [];
    for (const [i, chunk] of chunks.entries()) {
      onProgress?.(i, chunks.length);
      parts.push(await this.call([{ text: `File: ${fileName}\n\n${chunk}` }]));
    }
    // Account details come from the first chunk; the closing balance from the last one that states it.
    const head = parts[0];
    const closing = [...parts].reverse().find((p) => p.hasClosingBalance);
    return {
      ...head,
      isStatement: parts.some((p) => p.isStatement),
      periodTo: parts.map((p) => p.periodTo).filter(Boolean).sort().at(-1) ?? "",
      closingBalance: closing?.closingBalance ?? 0,
      hasClosingBalance: !!closing,
      transactions: parts.flatMap((p) => p.transactions),
    };
  }
}

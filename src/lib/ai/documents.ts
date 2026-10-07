// Reads financial documents (passbooks, statements, payslips, Form 16, policies) into structured data.
// One schema covers every kind; fields that don't apply come back as ""/0 (sentinels keep the JSON
// schema simple and avoid nullable types).

import { z } from "zod";
import { DEFAULT_MODEL, generateJson, type Part } from "./llm";

export const DOC_KINDS = [
  "epf_passbook",
  "ppf_statement",
  "nps_statement",
  "fd_receipt",
  "demat_statement",
  "loan_statement",
  "payslip",
  "form16",
  "insurance_policy",
  "other",
] as const;

const DocSchema = z.object({
  kind: z.enum(DOC_KINDS).describe("What the document is. 'other' if it isn't one of these."),
  institution: z.string().describe("Issuer: bank, employer, insurer, EPFO, CRA (Protean/KFintech), broker…"),
  reference: z.string().describe("Account / UAN / PRAN / policy / loan number as shown (masked is fine). For EPF this is the UAN"),
  // epf
  memberId: z
    .string()
    .describe("epf_passbook: the Member ID / PF account number for this employer (e.g. 'MHBAN00123450000012345'), NOT the UAN, which is the same across employers; else empty"),
  employer: z.string().describe("epf_passbook: establishment (employer) name this passbook is for; else empty"),
  epfEmployeeShare: z.number().describe("epf_passbook: closing balance of the employee share (EPF); else 0"),
  epfEmployerShare: z.number().describe("epf_passbook: closing balance of the employer share (EPF); else 0"),
  epfPension: z.number().describe("epf_passbook: closing pension (EPS) balance if shown, which is NOT part of balance; else 0"),
  asOfDate: z.string().describe("Date the balance or document is as of, YYYY-MM-DD; else empty"),
  balance: z
    .number()
    .describe("Passbook/statement/FD/demat: total current value or balance. Loan: principal outstanding. Else 0"),
  // payslip
  payMonth: z.string().describe("payslip: pay period as YYYY-MM; else empty"),
  gross: z.number().describe("payslip: gross earnings for the month; form16: gross salary for the year; else 0"),
  net: z.number().describe("payslip: net pay; else 0"),
  tds: z.number().describe("payslip: income tax deducted this month; form16: total tax deducted for the year; else 0"),
  pfEmployee: z.number().describe("payslip: employee PF contribution this month; else 0"),
  pfEmployer: z.number().describe("payslip: employer PF contribution this month if shown; else 0"),
  // form16
  financialYear: z.string().describe("form16: financial year like '2025-26'; else empty"),
  taxableIncome: z.number().describe("form16: total taxable income; else 0"),
  // insurance
  policyType: z.enum(["health", "term_life", "life", "motor", "travel", "home", "other", ""]).describe("insurance_policy: type; else empty"),
  cover: z.number().describe("insurance_policy: sum insured / sum assured; else 0"),
  premium: z.number().describe("insurance_policy: premium amount; else 0"),
  renewalDate: z.string().describe("insurance_policy: renewal / next premium due date, YYYY-MM-DD; else empty"),
  insured: z.string().describe("insurance_policy: insured person(s); else empty"),
  // loan
  emi: z.number().describe("loan_statement: EMI amount; else 0"),
  summary: z.string().describe("One short line describing the document for the user to confirm"),
});

export type DocExtraction = z.infer<typeof DocSchema>;

const SYSTEM = `You read Indian personal-finance documents and extract the figures a net-worth and tax tracker needs.
Amounts are plain positive numbers in rupees. Dates are YYYY-MM-DD. Don't guess: leave a field empty/0 if the document doesn't state it.
For passbooks and statements, balance is the closing / current total (for EPF: employee + employer share, excluding pension).`;

export type DocInput = { text: string } | { inline: { mimeType: string; data: string } };

export class DocumentReader {
  constructor(
    private apiKey: string,
    private model = DEFAULT_MODEL,
  ) {
  }

  async read(input: DocInput, fileName: string): Promise<DocExtraction> {
    const parts: Part[] =
      "text" in input
        ? [{ text: `File: ${fileName}\n\n${input.text.slice(0, 120_000)}` }]
        : [{ inline: input.inline }, { text: `File: ${fileName}` }];
    return generateJson({ apiKey: this.apiKey, model: this.model, system: SYSTEM, parts, schema: DocSchema });
  }
}

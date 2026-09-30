// Payroll emails (RazorpayX Payroll and similar): "your salary has been credited" + payslip PDF.

/** "Your salary has been credited to your bank account. … Amount: Rs. 1,23,456." */
export function parseSalaryCredit(text: string): number | null {
  const t = text.replace(/\s+/g, " ");
  if (!/salary (?:has been |was )?credited/i.test(t)) return null;
  const m = t.match(/(?:amount|net pay|salary)[^.₹\d]{0,40}(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d+)?)/i) ?? t.match(/(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d+)?)/i);
  const amount = m ? Number(m[1].replace(/,/g, "")) : NaN;
  return amount > 0 ? amount : null;
}

/**
 * The pay month an email is about, when it says without opening the PDF: RazorpayX links
 * `…paySlip?…&pm=01%2F08%2F26` and names files `EMP01-User-01-08-26-….pdf` (DD-MM-YY → 2026-08).
 */
export function payMonthHint(text: string, fileNames: string[]): string | null {
  const m =
    text.match(/pm=\d{2}(?:%2F|\/)(\d{2})(?:%2F|\/)(\d{2})/i) ?? fileNames.map((f) => f.match(/-\d{2}-(\d{2})-(\d{2})-/)).find(Boolean) ?? null;
  return m ? `20${m[2]}-${m[1]}` : null;
}

/** Employer names vary between documents ("ACME PAYROLL SERVICES PVT LTD" / "Acme Payroll Services Private Limited"). */
export const employerKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);

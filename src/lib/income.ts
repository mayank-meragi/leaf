// Salary is paid after the month it's for (August's pay lands on 2 September), so income is grouped by
// pay month: the payslip whose net pay the credit matches, else a sensible guess.

import type { Payslip, Transaction } from "@/types";

const monthEnd = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const prevMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

/** The month a salary credit pays for. */
export function payMonthOf(t: Transaction, payslips: Payslip[]): string {
  const slip = payslips.find((p) => Math.abs(p.net - t.amount) <= 1 && days(monthEnd(p.month), t.date) >= -10 && days(monthEnd(p.month), t.date) <= 25);
  if (slip) return slip.month;
  // Payroll emails arrive in the first days of the next month; a bank credit mid-month is that month's pay.
  return Number(t.date.slice(8, 10)) <= 10 ? prevMonth(t.date.slice(0, 7)) : t.date.slice(0, 7);
}

export const isSalaryCredit = (t: Transaction) => t.category === "Salary" && t.direction === "credit";

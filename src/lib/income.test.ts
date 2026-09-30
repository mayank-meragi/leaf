import { describe, expect, it } from "vitest";
import type { Payslip, Transaction } from "@/types";
import { payMonthOf } from "./income";

const slip = (month: string, net: number): Payslip => ({ month, employer: "Acme", gross: 0, net, tds: 0, pfEmployee: 0, pfEmployer: 0, source: { kind: "manual" } });
const credit = (date: string, amount: number): Transaction => ({
  id: date, date, amount, currency: "INR", direction: "credit", description: "Salary", category: "Salary", source: { account: "a", messageId: date, parser: "payroll" },
});

describe("payMonthOf", () => {
  it("matches the payslip whose net pay the credit is", () => {
    const slips = [slip("2026-08", 123456), slip("2026-07", 100000), slip("2026-03", 100001)];
    expect(payMonthOf(credit("2026-09-02", 123456), slips)).toBe("2026-08");
    expect(payMonthOf(credit("2026-08-02", 100000), slips)).toBe("2026-07");
    expect(payMonthOf(credit("2026-04-02", 100001), slips)).toBe("2026-03"); // March pay, previous FY
  });
  it("falls back to the previous month for early-month credits, else the credit month", () => {
    expect(payMonthOf(credit("2026-10-02", 300000), [])).toBe("2026-09");
    expect(payMonthOf(credit("2026-01-03", 300000), [])).toBe("2025-12");
    expect(payMonthOf(credit("2026-09-28", 300000), [])).toBe("2026-09");
  });
});

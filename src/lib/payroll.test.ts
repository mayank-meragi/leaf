import { expect, it } from "vitest";
import { employerKey, parseSalaryCredit, payMonthHint } from "./payroll";

const razorpay =
  "Hello Test User, Your salary has been credited to your bank account. Here are the details - Amount: Rs. 1,23,456. " +
  "You can view your pay slip, which will give you much more detail about your pay at https://payroll.razorpay.com/reports/paySlip?orgId=12345&pm=01%2F08%2F26. Thanks, Team RazorpayX Payroll";

it("reads RazorpayX salary emails", () => {
  expect(parseSalaryCredit(razorpay)).toBe(123456);
  expect(parseSalaryCredit("Happy Birthday Nandini K")).toBeNull();
  expect(payMonthHint(razorpay, [])).toBe("2026-08");
  expect(payMonthHint("", ["EMP01-User-01-07-26-1788340635.9949.pdf"])).toBe("2026-07");
  expect(payMonthHint("no hint", ["payslip.pdf"])).toBeNull();
});

it("employerKey matches name variants", () => {
  expect(employerKey("ACME PAYROLL SERVICES PRIVATE LIMITED")).toBe(employerKey("Acme Payroll Services Pvt Ltd"));
});

import { expect, it } from "vitest";
import { isKnown } from "./discover";

it("recognises senders Leaf already reads", () => {
  expect(isKnown("hdfcbank.bank.in", [])).toBe(true);
  expect(isKnown("alerts.hdfcbank.net", [])).toBe(true);
  expect(isKnown("mail.acme-payroll.com", ["acme-payroll.com"])).toBe(true);
  expect(isKnown("sc.com", [])).toBe(false);
});

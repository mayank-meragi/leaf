import { expect, it } from "vitest";
import { parseNpsContribution } from "./nps";

it("parses Protean contribution credits", () => {
  const text = `Dear Subscriber, Units with NAV of 31/08/2026 have been credited for TIER1 in your PRAN XX9999 against Rs. 2000.00 as
    Voluntary contribution on 31/08/2026. For further information…`;
  expect(parseNpsContribution(text)).toEqual({ tier: 1, pranTail: "9999", amount: 2000, date: "2026-08-31" });
  expect(parseNpsContribution(text.replace("TIER1", "TIER2").replace("2000.00", "1,50,000.00"))).toMatchObject({ tier: 2, amount: 150000 });
  expect(parseNpsContribution("Protean - Password Expiry Alert")).toBeNull();
});

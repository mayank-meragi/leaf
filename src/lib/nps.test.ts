import { describe, expect, it } from "vitest";
import type { WealthAccount } from "@/types";
import { npsAccount, parseNpsContribution, resolveNpsAccount } from "./nps";

it("parses Protean contribution credits", () => {
  const text = `Dear Subscriber, Units with NAV of 31/08/2026 have been credited for TIER1 in your PRAN XX9999 against Rs. 2000.00 as
    Voluntary contribution on 31/08/2026. For further information…`;
  expect(parseNpsContribution(text)).toEqual({ tier: 1, pranTail: "9999", amount: 2000, date: "2026-08-31" });
  expect(parseNpsContribution(text.replace("TIER1", "TIER2").replace("2000.00", "1,50,000.00"))).toMatchObject({ tier: 2, amount: 150000 });
  expect(parseNpsContribution("Protean - Password Expiry Alert")).toBeNull();
});

describe("resolveNpsAccount", () => {
  const uploaded: WealthAccount = { id: "nps-muojm19i45lb", kind: "nps", name: "Protean CRA NPS", institution: "Protean CRA", ref: "••6595" };

  it("reuses an account made by uploading a statement instead of creating a second one", () => {
    // This is how the duplicate arose: the sync only looked for its own derived id.
    expect(resolveNpsAccount([uploaded], "6595", 1)).toBe(uploaded);
  });
  it("prefers the derived id when it exists", () => {
    const derived = npsAccount("6595", 1);
    expect(resolveNpsAccount([uploaded, derived], "6595", 1)).toBe(derived);
  });
  it("makes a new account when there's none for that PRAN, and never gives a Tier II to a Tier I statement's account", () => {
    expect(resolveNpsAccount([], "6595", 1)).toEqual(npsAccount("6595", 1));
    expect(resolveNpsAccount([uploaded], "6595", 2)).toEqual(npsAccount("6595", 2));
    expect(resolveNpsAccount([uploaded], "1234", 1)).toEqual(npsAccount("1234", 1));
  });
});

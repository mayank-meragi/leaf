// NPS from Protean CRA emails: "Intimation of Contribution Credit" (amount, date, tier) and the
// monthly "Transaction Statement" PDF (current holding value).

import type { WealthAccount } from "@/types";

export interface NpsContribution {
  tier: 1 | 2;
  pranTail: string;
  amount: number;
  date: string;
}

// "Units with NAV of 31/08/2026 have been credited for TIER1 in your PRAN XX9999 against Rs. 2000.00
//  as Voluntary contribution on 31/08/2026."
const CREDIT = /credited for\s+TIER\s*([12I]+)\s+in your PRAN\s+X*(\d{3,6})\s+against\s+Rs\.?\s*([\d,]+(?:\.\d+)?)[\s\S]*?contribution on\s+(\d{2})\/(\d{2})\/(\d{4})/i;

export function parseNpsContribution(text: string): NpsContribution | null {
  const m = text.replace(/\s+/g, " ").match(CREDIT);
  if (!m) return null;
  const amount = Number(m[3].replace(/,/g, ""));
  if (!(amount > 0)) return null;
  return { tier: m[1] === "2" || m[1].toUpperCase() === "II" ? 2 : 1, pranTail: m[2].slice(-4), amount, date: `${m[6]}-${m[5]}-${m[4]}` };
}

export const npsAccountId = (pranTail: string, tier: 1 | 2) => `nps-${pranTail}-t${tier}`;

export function npsAccount(pranTail: string, tier: 1 | 2): WealthAccount {
  return { id: npsAccountId(pranTail, tier), kind: "nps", name: `NPS Tier ${tier === 1 ? "I" : "II"}`, institution: "Protean CRA", ref: `PRAN ••${pranTail}` };
}

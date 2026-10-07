// Reads the conditions of an insurance policy (what decides how a claim pays) from its document.
// Numbers use -1 and enums use "not_stated" for anything the document doesn't say, so nothing is guessed.

import { z } from "zod";
import type { PolicyTerms } from "@/types";
import type { DocInput } from "./documents";
import { DEFAULT_MODEL, generateJson, type Part } from "./llm";

const yn = z.enum(["yes", "no", "not_stated"]);

const TermsSchema = z.object({
  roomRentKind: z.enum(["no_limit", "capped", "single_private", "shared", "not_stated"]).describe("Hospital room rent limit: none, a cap (rupees or % of sum insured per day), a room category such as single private room, or shared room"),
  roomRentDetail: z.string().describe("The room rent wording in a few words, e.g. '1% of sum insured per day'; empty if none"),
  coPayPct: z.number().describe("Percent of each claim the insured pays (co-payment); 0 if the policy says there is none; -1 if not stated"),
  deductible: z.number().describe("Deductible in rupees (top-up / super top-up plans); 0 if none; -1 if not stated"),
  waitingPreExistingMonths: z.number().describe("Waiting period for pre-existing diseases, in months; -1 if not stated"),
  waitingSpecificMonths: z.number().describe("Waiting period for listed specific illnesses/surgeries (cataract, hernia…), in months; -1 if not stated"),
  initialWaitingDays: z.number().describe("Initial waiting period in days before illness claims; -1 if not stated"),
  restore: yn.describe("Does the sum insured refill/restore/recharge after it is used?"),
  noClaimBonusPct: z.number().describe("Cumulative bonus per claim-free year as % of sum insured; 0 if none; -1 if not stated"),
  floater: yn.describe("One sum insured shared by the family (floater)? 'no' for an individual policy"),
  cashless: yn.describe("Cashless treatment at network hospitals"),
  subLimits: z.array(z.string()).describe("Caps on specific treatments or items, each as a short phrase with its amount, e.g. 'Cataract: ₹40,000 per eye'. Empty if none stated"),
  exclusions: z.array(z.string()).describe("Up to 6 notable exclusions or restrictions a buyer should know, each a short phrase. Empty if none stated"),
});

type Raw = z.infer<typeof TermsSchema>;

const SYSTEM = `You read an Indian insurance policy document (schedule and/or policy wording) and extract the terms that decide how claims pay.
Amounts are plain rupee numbers. Don't guess: use the not-stated values (-1, "not_stated", empty list) for anything the document doesn't say.
Quote limits as the document does. Keep phrases short.`;

const known = (n: number) => (n >= 0 ? n : undefined);
const flag = (v: Raw["restore"]) => (v === "not_stated" ? undefined : v === "yes");

/** Drops everything the document didn't state. */
export function toTerms(r: Raw): PolicyTerms {
  const t: PolicyTerms = {
    roomRent: r.roomRentKind === "not_stated" ? undefined : { kind: r.roomRentKind, detail: r.roomRentDetail || undefined },
    coPayPct: known(r.coPayPct),
    deductible: known(r.deductible),
    waitingPreExistingMonths: known(r.waitingPreExistingMonths),
    waitingSpecificMonths: known(r.waitingSpecificMonths),
    initialWaitingDays: known(r.initialWaitingDays),
    restore: flag(r.restore),
    noClaimBonusPct: known(r.noClaimBonusPct),
    floater: flag(r.floater),
    cashless: flag(r.cashless),
    subLimits: r.subLimits.length ? r.subLimits : undefined,
    exclusions: r.exclusions.length ? r.exclusions : undefined,
  };
  return Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined)) as PolicyTerms;
}

export class PolicyReader {
  constructor(
    private apiKey: string,
    private model = DEFAULT_MODEL,
  ) {
  }

  async read(input: DocInput, fileName: string): Promise<PolicyTerms> {
    const parts: Part[] = "text" in input ? [{ text: `File: ${fileName}\n\n${input.text.slice(0, 200_000)}` }] : [{ inline: input.inline }, { text: `File: ${fileName}` }];
    return toTerms(await generateJson({ apiKey: this.apiKey, model: this.model, system: SYSTEM, parts, schema: TermsSchema }));
  }
}

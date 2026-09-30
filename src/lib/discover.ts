// "Find senders": scan an inbox for emails that look like money moving, grouped by sender, so senders
// Leaf doesn't know (a salary-account bank, an employer's payroll mails) can be added in one click.

import { getHeaders, pool, searchIds } from "./google/gmail";
import { ALERT_SENDERS, CARD_EVENT_SENDERS } from "./sources";

export interface SenderCandidate {
  /** What gets added to the query: the address's domain, e.g. "kotak.com". */
  sender: string;
  address: string;
  count: number;
  subjects: string[];
}

const QUERY =
  'newer_than:180d (debited OR credited OR "has been credited" OR salary OR "transaction alert" OR "amount of" OR "payment received") ' +
  "(Rs OR INR OR ₹ OR amount) -from:(cred.club)";

// Newsletters and apps that talk about money without moving it.
const NOISE = /digest|newsletter|offers?\.|marketing|promo|news|groww|etmoney|livemint|the-ken|indeed|glassdoor|linkedin|axismf|motilaloswal|abslmf|zerodha|smallcase|kuvera/i;

const domainOf = (from: string) => from.match(/@([\w.-]+)/)?.[1]?.toLowerCase() ?? "";

export function isKnown(domain: string, extra: string[]): boolean {
  return [...ALERT_SENDERS, ...CARD_EVENT_SENDERS, ...extra].some((s) => domain === s || domain.endsWith(`.${s}`) || domain.includes(s));
}

export async function discoverSenders(account: string, extra: string[], onProgress?: (n: number, total: number) => void): Promise<SenderCandidate[]> {
  const ids = await searchIds(account, QUERY, 150);
  const headers = await pool(ids, 5, (id) => getHeaders(account, id), (n) => onProgress?.(n, ids.length));
  const by = new Map<string, SenderCandidate>();
  for (const h of headers) {
    const domain = domainOf(h.from);
    if (!domain || isKnown(domain, extra) || NOISE.test(domain)) continue;
    const c = by.get(domain) ?? { sender: domain, address: h.from.replace(/.*</, "").replace(">", ""), count: 0, subjects: [] };
    by.set(domain, c);
    c.count++;
    const subject = h.subject.trim().slice(0, 80);
    if (c.subjects.length < 3 && !c.subjects.includes(subject)) c.subjects.push(subject);
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}

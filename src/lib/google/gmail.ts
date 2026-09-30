import { getToken, googleError } from "./auth";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

interface Part {
  partId?: string;
  mimeType: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body: { data?: string; attachmentId?: string; size: number };
  parts?: Part[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  internalDate: string; // ms since epoch
  payload: Part;
}

export interface ParsedEmail {
  id: string;
  date: Date;
  from: string;
  subject: string;
  text: string;
  attachments: { filename: string; mimeType: string; attachmentId: string }[];
}

// Gmail meters "query cost units" per user per minute (messages.get = 5, list = 5), and a first sync
// fetches hundreds of messages. Space requests per account and back off when Google says so.
const MIN_INTERVAL_MS = 100;
const MAX_RETRIES = 6;
const nextSlot = new Map<string, number>();

async function throttle(account: string) {
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(account) ?? 0);
  nextSlot.set(account, slot + MIN_INTERVAL_MS);
  if (slot > now) await sleep(slot - now);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function isRateLimited(res: Response) {
  if (res.status === 429) return true;
  if (res.status !== 403) return false;
  const text = await res.clone().text();
  return /RATE_LIMIT_EXCEEDED|rateLimitExceeded|userRateLimitExceeded/.test(text);
}

async function call<T>(account: string, path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await throttle(account);
    const token = await getToken(account);
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) return res.json();
    const retryable = res.status >= 500 || (await isRateLimited(res));
    if (!retryable || attempt >= MAX_RETRIES) throw await googleError(res, `Gmail ${path.split("?")[0]}`);
    const retryAfter = Number(res.headers.get("retry-after"));
    const backoff = retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt + Math.random() * 500;
    // Push every in-flight request for this account back, not just this one.
    nextSlot.set(account, Math.max(nextSlot.get(account) ?? 0, Date.now() + backoff));
    await sleep(backoff);
  }
}

/** All message ids matching a Gmail search query (paginated). */
export async function searchIds(account: string, q: string, max = 500): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ q, maxResults: "100", ...(pageToken ? { pageToken } : {}) });
    const page = await call<{ messages?: { id: string }[]; nextPageToken?: string }>(account, `/messages?${params}`);
    ids.push(...(page.messages ?? []).map((m) => m.id));
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < max);
  return ids.slice(0, max);
}

function b64urlToBytes(data: string): Uint8Array {
  const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("style,script").forEach((n) => n.remove());
  // Keep table cells / rows apart so regexes don't glue words together.
  doc.querySelectorAll("br,p,div,tr,li").forEach((n) => n.append("\n"));
  doc.querySelectorAll("td,th").forEach((n) => n.append(" "));
  return (doc.body.textContent ?? "").replace(/[ \t ]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

function walk(part: Part, out: { plain: string[]; html: string[]; attachments: ParsedEmail["attachments"] }) {
  if (part.filename && part.body.attachmentId) {
    out.attachments.push({ filename: part.filename, mimeType: part.mimeType, attachmentId: part.body.attachmentId });
  } else if (part.body.data && part.mimeType === "text/plain") {
    out.plain.push(new TextDecoder().decode(b64urlToBytes(part.body.data)));
  } else if (part.body.data && part.mimeType === "text/html") {
    out.html.push(new TextDecoder().decode(b64urlToBytes(part.body.data)));
  }
  part.parts?.forEach((p) => walk(p, out));
}

export async function getEmail(account: string, id: string): Promise<ParsedEmail> {
  const msg = await call<GmailMessage>(account, `/messages/${id}?format=full`);
  const header = (n: string) => msg.payload.headers?.find((h) => h.name.toLowerCase() === n)?.value ?? "";
  const out = { plain: [] as string[], html: [] as string[], attachments: [] as ParsedEmail["attachments"] };
  walk(msg.payload, out);
  // Bank alerts are often HTML-only, and their plain parts are frequently empty stubs.
  const plain = out.plain.join("\n").trim();
  const text = plain.length > 40 ? plain : out.html.map(htmlToText).join("\n") || plain;
  return {
    id: msg.id,
    date: new Date(Number(msg.internalDate)),
    from: header("from"),
    subject: header("subject"),
    text,
    attachments: out.attachments,
  };
}

/** Just From / Subject / date (cheap: no body). */
export async function getHeaders(account: string, id: string): Promise<{ id: string; from: string; subject: string; date: Date }> {
  const msg = await call<GmailMessage>(account, `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
  const header = (n: string) => msg.payload.headers?.find((h) => h.name.toLowerCase() === n)?.value ?? "";
  return { id, from: header("from"), subject: header("subject"), date: new Date(Number(msg.internalDate)) };
}

export async function getAttachment(account: string, messageId: string, attachmentId: string): Promise<Uint8Array> {
  const r = await call<{ data: string }>(account, `/messages/${messageId}/attachments/${attachmentId}`);
  return b64urlToBytes(r.data);
}

/** Runs `fn` over items with bounded concurrency (Gmail rate-limits bursts). */
export async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>, onEach?: (done: number) => void): Promise<R[]> {
  let done = 0;
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
        onEach?.(++done);
      }
    }),
  );
  return results;
}

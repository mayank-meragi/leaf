import type { FundHoldings } from "./holdings";

/**
 * The local helper (`backend/`, `pnpm holdings-helper`): a small Python server on this machine that fetches fund
 * holdings for us, since the source doesn't allow requests from web pages. It only exists on your own computer.
 */
export const HELPER_URL: string = (import.meta.env.VITE_LEAF_HELPER_URL as string | undefined) ?? "http://127.0.0.1:8787";
export const HELPER_COMMAND = "pnpm holdings-helper";

/** A holdings file this young isn't refetched; funds disclose once a month. */
export const FRESH_DAYS = 20;

export async function helperUp(timeoutMs = 1500, url = HELPER_URL): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    return res.ok && (await res.json()).name === "leaf-helper";
  } catch {
    return false;
  }
}

export interface SyncTarget {
  code: number;
  name: string;
}

export interface SyncPlan {
  fetch: SyncTarget[];
  /** Already fetched recently. */
  fresh: number[];
}

const daysBetween = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;

/** Which schemes need fetching: everything not fetched in the last FRESH_DAYS days (or everything, when forced). */
export function planSync(targets: SyncTarget[], existing: Map<number, FundHoldings>, today: string, force = false): SyncPlan {
  const seen = new Set<number>();
  const plan: SyncPlan = { fetch: [], fresh: [] };
  for (const t of targets) {
    if (seen.has(t.code)) continue; // two schemes can share a code
    seen.add(t.code);
    const old = existing.get(t.code);
    if (old && !force && daysBetween(old.fetched, today) < FRESH_DAYS) plan.fresh.push(t.code);
    else plan.fetch.push(t);
  }
  return plan;
}

/** Same portfolio, ignoring when it was fetched: so an unchanged month doesn't produce a commit. */
export function sameHoldings(a: FundHoldings, b: FundHoldings): boolean {
  const strip = ({ fetched: _f, ...rest }: FundHoldings) => JSON.stringify(rest);
  return strip(a) === strip(b);
}

export interface SyncOutcome {
  /** Documents that differ from what's saved: write these. */
  changed: FundHoldings[];
  unchanged: number[];
  failed: Record<number, string>;
}

export function settle(results: { code: number; doc?: FundHoldings; error?: string }[], existing: Map<number, FundHoldings>): SyncOutcome {
  const out: SyncOutcome = { changed: [], unchanged: [], failed: {} };
  for (const r of results) {
    if (!r.doc) out.failed[r.code] = r.error ?? "no data";
    else if (existing.has(r.code) && sameHoldings(existing.get(r.code)!, r.doc)) out.unchanged.push(r.code);
    else out.changed.push(r.doc);
  }
  return out;
}

/** Fetches through the helper, calling `onResult` as each scheme completes. Resolves with every result. */
export async function fetchViaHelper(
  targets: SyncTarget[],
  onResult: (r: { code: number; doc?: FundHoldings; error?: string }, done: number) => void,
  signal?: AbortSignal,
  url = HELPER_URL,
): Promise<{ code: number; doc?: FundHoldings; error?: string }[]> {
  const res = await fetch(`${url}/holdings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ schemes: targets }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`The helper refused the request (${res.status}).`);
  const results: { code: number; doc?: FundHoldings; error?: string }[] = [];
  for await (const line of ndjson(res.body)) {
    const r = line as { code: number; doc?: FundHoldings; error?: string };
    results.push(r);
    onResult(r, results.length);
  }
  return results;
}

/** Newline-delimited JSON from a byte stream; a line may arrive split across chunks. */
export async function* ndjson(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    buf += decoder.decode(value, { stream: !done });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) yield JSON.parse(line);
    }
    if (done) break;
  }
  if (buf.trim()) yield JSON.parse(buf);
}

/** The text committed for a holdings file; matches what the Python CLI writes, so either can be used. */
export const serializeHoldings = (doc: FundHoldings) => JSON.stringify(doc, null, 1) + "\n";

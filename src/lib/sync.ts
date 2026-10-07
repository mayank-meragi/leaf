// One sync = for every connected Gmail account, pull new alert emails, card statements and CAS PDFs,
// turn them into records, and write everything back in a single commit.

import type {
  CardPayment,
  CardStatement,
  CASStatement,
  LeafConfig,
  Payslip,
  TaxDocument,
  Transaction,
  WealthAccount,
  WealthFlow,
  WealthSnapshot,
} from "@/types";
import type { DocumentReader } from "./ai/documents";
import { knownPasswords, loadBytes, mergePayslips, NeedsPasswordError, payrollRecord } from "./documents";
import { parseSalaryCredit, payMonthHint } from "./payroll";
import { parseNpsContribution, resolveNpsAccount } from "./nps";
import { accountTail } from "./wealth";
import type { ExtractedTxn, Extractor } from "./ai/extract";
import { withoutStatementDuplicates } from "./bankStatement";
import { applyRules } from "./categories";
import { CARD_PAYMENTS_PATH, CARD_STATEMENTS_PATH, PATHS, monthShards, statementPath, type LeafData } from "./db";
import type { GitHubStore } from "./github/store";
import { needsSignIn } from "./google/auth";
import { getAttachment, getEmail, pool, searchIds, type ParsedEmail } from "./google/gmail";
import { cardRecords, corroborate, instruments, mergeCardPayments, mergeCardStatements, resolveCard } from "./instruments";
import { parseCAS } from "./parsers/cas/parse";
import { isCompleteStatement } from "./portfolio";
import { alertQuery, cardEventQuery, casQuery, npsQuery, payrollQuery } from "./sources";

const FIRST_SYNC_DAYS = 90;
const CHUNK = 100;
const CAS_LOOKBACK_DAYS = 400;
const CARD_EVENT_LOOKBACK_DAYS = 120;
const NPS_LOOKBACK_DAYS = 800;
const PAYROLL_LOOKBACK_DAYS = 400;
/** Transactions extracted by an older parser within this window are re-read once for new fields. */
const BACKFILL_DAYS = 60;
/** Bump when the extraction gains fields worth backfilling. */
export const PARSER = "gemini@2";

/** The steps each inbox goes through, in order; `SyncProgress.stage` indexes into this. */
export const SYNC_STAGES = ["Bank alerts", "Card bills", "NPS", "Payroll", "CAS statements"] as const;

export interface SyncFound {
  transactions: number;
  updated: number;
  cardStatements: number;
  cardPayments: number;
  wealth: number;
  payroll: number;
  statements: number;
}

export interface SyncProgress {
  account?: string;
  message: string;
  /** Index into SYNC_STAGES for the inbox being read. */
  stage?: number;
  /** 0–1 across every inbox and stage. */
  fraction: number;
  accountIndex: number;
  accountCount: number;
  /** What has been extracted so far this sync. */
  found: SyncFound;
  /** A record that was just extracted, as one line. */
  item?: string;
}

const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export interface SyncResult {
  transactions: number;
  updated: number;
  statements: number;
  cardStatements: number;
  cardPayments: number;
  /** NPS contributions and statement balances. */
  wealth: number;
  /** Payslips and Form 16s read from payroll emails. */
  payroll: number;
  warnings: string[];
}

const isoDay = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);

function toTxn(account: string, e: ParsedEmail, x: ExtractedTxn): Transaction {
  return {
    id: `${account}:${e.id}`,
    date: isoDay(x.date) ?? e.date.toISOString().slice(0, 10),
    amount: x.amount,
    currency: x.currency || "INR",
    direction: x.direction,
    description: x.description,
    instrument: x.instrument || undefined,
    instrumentKind: x.instrumentKind === "unknown" ? undefined : x.instrumentKind,
    balanceAfter: x.hasBalance ? x.balance : undefined,
    category: x.category,
    source: { account, messageId: e.id, parser: PARSER, receivedAt: e.date.toISOString() },
  };
}

export async function sync(
  store: GitHubStore,
  data: LeafData,
  extractor: Extractor,
  reader: DocumentReader,
  onProgress: (p: SyncProgress) => void,
): Promise<SyncResult> {
  const startedAt = Math.floor(Date.now() / 1000);
  const today = new Date().toISOString().slice(0, 10);
  const known = new Set(data.transactions.map((t) => t.id));
  const knownStatements = new Set(data.statements.flatMap((s) => (s.source.kind === "gmail" ? [s.source.messageId] : [])));
  // PDFs from CAMS/KFintech that turned out not to be a CAS; remembered so they aren't re-read every sync.
  const skippedCas = new Set(data.config.skippedCasMessages ?? []);
  const knownCardEvents = new Set([...data.cardStatements, ...data.cardPayments].map((s) => s.source.messageId));
  const newTxns: Transaction[] = [];
  const updated: Transaction[] = [];
  const newStatements: CASStatement[] = [];
  const newCardStatements: CardStatement[] = [];
  const newCardPayments: CardPayment[] = [];
  const wealthAccounts: WealthAccount[] = [...data.wealthAccounts];
  const newSnapshots: WealthSnapshot[] = [];
  const newFlows: WealthFlow[] = [];
  const newPayslips: Payslip[] = [];
  const newTaxDocs: TaxDocument[] = [];
  // Payroll emails already turned into a payslip / Form 16 (salary-only ones are known via their transaction id).
  const knownPayroll = new Set(
    [...data.payslips, ...data.taxDocs].flatMap((r) => (r.source.kind === "gmail" ? [r.source.messageId] : [])),
  );
  const knownDocs = new Set(
    [...data.wealthSnapshots, ...data.wealthFlows].flatMap((r) => (r.source.kind === "gmail" ? [r.source.messageId] : [])),
  );
  const warnings: string[] = [];
  const config: LeafConfig = structuredClone(data.config);

  let accountIndex = 0;
  let stage = 0;
  let within = 0;
  let lastMessage = "";
  let lastEmail: string | undefined;
  const found = (): SyncFound => ({
    transactions: newTxns.length,
    updated: updated.length,
    cardStatements: newCardStatements.length,
    cardPayments: newCardPayments.length,
    wealth: newSnapshots.length + newFlows.length,
    payroll: newPayslips.length + newTaxDocs.length,
    statements: newStatements.length,
  });
  const emit = (message: string, item?: string) => {
    lastMessage = message;
    const fraction = Math.min(1, (accountIndex + (stage + within) / SYNC_STAGES.length) / Math.max(1, config.accounts.length));
    onProgress({ account: lastEmail, message, stage, fraction, accountIndex, accountCount: config.accounts.length, found: found(), item });
  };
  const note = (item: string) => emit(lastMessage, item);
  const txnLine = (t: Transaction) => `${t.date} · ${t.description} · ${t.direction === "debit" ? "−" : "+"}${rupees(t.amount)}`;

  for (const [index, account] of config.accounts.entries()) {
    const email = account.email;
    accountIndex = index;
    lastEmail = email;
    stage = 0;
    within = 0;
    if (needsSignIn([email], 0).length) {
      warnings.push(`${email} was skipped: sign in to it (Settings, or when you press Sync) to include it`);
      continue;
    }
    const after = account.syncedUntil ?? startedAt - FIRST_SYNC_DAYS * 86400;
    const log = (message: string, w?: number) => {
      if (w !== undefined) within = Math.min(1, w);
      emit(message);
    };
    const begin = (s: number, message: string) => {
      stage = s;
      within = 0;
      log(message);
    };
    // A deleted email shouldn't fail the whole sync. `scope` maps 0–1 fetch progress onto the stage's progress.
    const fetchAll = (ids: string[], label: string, scope: (f: number) => number = (f) => f) =>
      pool(ids, 4, (id) => getEmail(email, id).catch(() => null), (n) => log(`${label} ${n}/${ids.length}…`, scope(n / ids.length))).then((es) =>
        es.filter((e): e is ParsedEmail => e != null),
      );

    try {
      // Bank / card / UPI alerts
      begin(0, "Searching alerts…");
      const extra = (config.extraSenders ?? []).map((x) => x.sender);
      const ids = (await searchIds(email, alertQuery(after, extra), 2000)).filter((id) => !known.has(`${email}:${id}`));
      // Senders added since this inbox last synced get the same look-back as a first sync.
      const fresh = (config.extraSenders ?? []).filter((x) => !account.syncedUntil || x.addedAt > account.syncedUntil).map((x) => x.sender);
      if (fresh.length && account.syncedUntil) {
        const back = await searchIds(email, alertQuery(startedAt - FIRST_SYNC_DAYS * 86400, fresh, true), 500);
        for (const id of back) if (!known.has(`${email}:${id}`) && !ids.includes(id)) ids.push(id);
      }
      // Work in chunks so a failure late in a big first sync doesn't throw away earlier progress.
      for (let i = 0; i < ids.length; i += CHUNK) {
        const size = Math.min(CHUNK, ids.length - i);
        const emails = await fetchAll(ids.slice(i, i + CHUNK), `Fetching emails ${i + 1}–${i + size} of ${ids.length}`, (f) => (i + f * 0.5 * size) / ids.length);
        const extracted = await extractor.extract(emails, (done) =>
          log(`Reading emails with OpenAI ${i + done}/${ids.length}…`, (i + 0.5 * size + (0.5 * size * done) / Math.max(1, emails.length)) / ids.length),
        );
        const batch = emails.flatMap((e) => (extracted.has(e.id) ? [toTxn(email, e, extracted.get(e.id)!)] : []));
        // The user's per-counterparty rules beat the model's guess; a bank statement already covering an alert wins over it.
        const added = applyRules(config, withoutStatementDuplicates(batch, data.transactions));
        newTxns.push(...added);
        for (const t of added) note(txnLine(t));
      }

      // One-time re-read of recent transactions from an older parser, for balance / card type.
      // Only the new fields are taken; amount, description and category (possibly user-edited) stay.
      const cutoff = new Date(Date.now() - BACKFILL_DAYS * 86_400_000).toISOString().slice(0, 10);
      const stale = data.transactions.filter((t) => t.source.account === email && t.source.parser !== PARSER && t.date >= cutoff);
      if (stale.length) begin(0, "Re-reading recent alerts for balances…");
      for (let i = 0; i < stale.length; i += CHUNK) {
        const chunk = stale.slice(i, i + CHUNK);
        const emails = await fetchAll(chunk.map((t) => t.source.messageId), "Re-reading recent alerts");
        const extracted = await extractor.extract(emails, () => log(`Updating balances ${i + emails.length}/${stale.length}…`, 1));
        const byId = new Map(emails.map((e) => [e.id, e]));
        for (const t of chunk) {
          const e = byId.get(t.source.messageId);
          const x = extracted.get(t.source.messageId);
          updated.push({
            ...t,
            instrumentKind: (x && x.instrumentKind !== "unknown" ? x.instrumentKind : undefined) ?? t.instrumentKind,
            balanceAfter: x?.hasBalance ? x.balance : t.balanceAfter,
            source: { ...t.source, parser: PARSER, receivedAt: e?.date.toISOString() ?? t.source.receivedAt },
          });
        }
      }

      // Card bills and bill payments (issuer statements, CRED "new bill" / "payment successful").
      // Not tied to the cursor, so the first run picks up recent history.
      begin(1, "Searching card bills and payments…");
      const eventIds = (await searchIds(email, cardEventQuery(startedAt - CARD_EVENT_LOOKBACK_DAYS * 86400), 100)).filter((id) => !knownCardEvents.has(id));
      if (eventIds.length) {
        const emails = await fetchAll(eventIds, "Fetching card bills", (f) => f * 0.5);
        log(`Reading ${emails.length} card emails with OpenAI…`, 0.5);
        const events = await extractor.extractCardEvents(emails);
        within = 1;
        const cards = instruments([...data.transactions, ...newTxns], config, cardRecords(data.cardStatements, data.cardPayments))
          .filter((c) => c.kind === "credit_card" || c.kind === "card")
          .map((c) => ({ key: c.key, last4: c.last4 }));
        const records = () => [
          ...[...data.cardStatements, ...newCardStatements].map((r) => ({ card: r.card, amount: r.totalDue, date: r.statementDate })),
          ...[...data.cardPayments, ...newCardPayments].map((r) => ({ card: r.card, amount: r.amount, date: r.date })),
        ];
        // Emails that show card digits first, so cards they reveal (CRED shows all four) are known
        // by the time digit-less ones (e.g. OneCard's statement) are matched.
        const withDigits = (e: ParsedEmail) => (events.get(e.id)?.cardDigits.replace(/\D/g, "").length ?? 0) > 0;
        for (const e of [...emails.filter(withDigits), ...emails.filter((e) => !withDigits(e))]) {
          const x = events.get(e.id);
          if (!x) continue;
          const emailDay = e.date.toISOString().slice(0, 10);
          const isStatement = x.kind === "statement";
          const amount = isStatement ? x.totalDue : x.amountPaid;
          const date = (isStatement ? isoDay(x.statementDate) : isoDay(x.paidOn)) ?? emailDay;
          const card = withDigits(e) ? resolveCard({ issuer: x.issuer, last4: x.cardDigits }, cards) : corroborate(x.issuer, amount, date, records());
          if (!card) {
            if (withDigits(e)) warnings.push(`Couldn't tell which ${x.issuer} card “${e.subject.slice(0, 60)}” is for`);
            continue;
          }
          if (!cards.some((c) => c.key === card)) cards.push({ key: card, last4: card.split("-")[1] });
          const src = { account: email, messageId: e.id };
          if (isStatement) {
            newCardStatements.push({ card, statementDate: date, totalDue: x.totalDue, minDue: x.minDue || undefined, dueDate: isoDay(x.dueDate), source: src });
            note(`${date} · ${x.issuer} card bill · ${rupees(x.totalDue)} due`);
          } else if (x.amountPaid > 0) {
            newCardPayments.push({ card, amount: x.amountPaid, date, via: x.via || undefined, reference: x.reference || undefined, source: src });
            note(`${date} · ${x.issuer} card payment · ${rupees(x.amountPaid)}`);
          }
        }
      }

      // NPS (Protean CRA): contribution credits add to the balance; the monthly statement resets it.
      begin(2, "Searching NPS…");
      const npsIds = (await searchIds(email, npsQuery(startedAt - NPS_LOOKBACK_DAYS * 86400), 200)).filter((id) => !knownDocs.has(id));
      if (npsIds.length) {
        const emails = (await fetchAll(npsIds, "Fetching NPS emails", (f) => f * 0.5)).sort((a, b) => b.date.getTime() - a.date.getTime());
        let statementsRead = 0;
        let locked = 0;
        const deleted = new Set(config.deletedAccounts ?? []);
        /** The account for this PRAN and tier, created if it's new. Null if you deleted it: don't bring it back. */
        const ensure = (tail: string, tier: 1 | 2) => {
          const acc = resolveNpsAccount(wealthAccounts, tail, tier);
          if (deleted.has(acc.id)) return null;
          if (!wealthAccounts.some((a) => a.id === acc.id)) wealthAccounts.push(acc);
          return acc.id;
        };
        for (const e of emails) {
          const src = { kind: "gmail" as const, account: email, messageId: e.id };
          const c = parseNpsContribution(e.text);
          if (c) {
            const account = ensure(c.pranTail, c.tier);
            if (account) {
              newFlows.push({ account, date: c.date, amount: c.amount, kind: "contribution", source: src });
              note(`${c.date} · NPS contribution · +${rupees(c.amount)}`);
            }
            continue;
          }
          const pdf = e.attachments.find((a) => a.filename.toLowerCase().endsWith(".pdf"));
          // Only the newest few statements matter (the latest sets the balance); older ones aren't worth a model call.
          if (!pdf || !/statement/i.test(e.subject) || statementsRead >= 3) continue;
          try {
            const bytes = await getAttachment(email, e.id, pdf.attachmentId);
            const { input } = await loadBytes(bytes, pdf.filename, "application/pdf", knownPasswords(config));
            statementsRead++;
            log(`Reading NPS statement ${statementsRead} with OpenAI…`, 0.5 + 0.1 * statementsRead);
            const x = await reader.read(input, pdf.filename);
            if (x.kind !== "nps_statement" || !(x.balance > 0)) continue;
            const known = [...new Set(wealthAccounts.filter((a) => a.kind === "nps").map(accountTail).filter(Boolean))];
            const tail = x.reference.replace(/\D/g, "").slice(-4) || (known.length === 1 ? known[0] : "");
            if (!tail) continue;
            const account = ensure(tail, 1);
            if (account) {
              const date = isoDay(x.asOfDate) ?? e.date.toISOString().slice(0, 10);
              newSnapshots.push({ account, date, value: x.balance, source: src });
              note(`${date} · NPS statement · balance ${rupees(x.balance)}`);
            }
          } catch (err) {
            if (err instanceof NeedsPasswordError) locked++;
            else warnings.push(`NPS statement “${e.subject.slice(0, 50)}”: ${(err as Error).message}`);
          }
        }
        if (locked) warnings.push(`NPS statements are password-protected: add the password under Settings → Document passwords, then Sync again.`);
      }

      // Payroll (RazorpayX etc.): "salary credited" emails and the payslip / Form 16 PDFs attached to them.
      begin(3, "Searching payroll emails…");
      // Salary-only emails are re-checked each sync (cheap, no model call) so a payslip that was locked
      // gets read once its password is added.
      const payIds = (await searchIds(email, payrollQuery(startedAt - PAYROLL_LOOKBACK_DAYS * 86400), 60)).filter((id) => !knownPayroll.has(id));
      if (payIds.length) {
        const emails = await fetchAll(payIds, "Fetching payroll emails", (f) => f * 0.5);
        let locked = 0;
        const haveMonth = (m: string) => [...data.payslips, ...newPayslips].some((p) => p.month === m);
        const allCredits = [...data.transactions, ...newTxns].filter((t) => t.direction === "credit");
        for (const e of emails) {
          const src = { kind: "gmail" as const, account: email, messageId: e.id };
          const day = e.date.toISOString().slice(0, 10);
          const salary = parseSalaryCredit(e.text);
          // The bank's own alert for the same credit, if Leaf reads that account, already counts it.
          if (salary && !known.has(`${email}:${e.id}`) && !allCredits.some((t) => Math.abs(t.amount - salary) <= 1 && Math.abs(Date.parse(t.date) - Date.parse(day)) <= 3 * 86_400_000)) {
            newTxns.push({
              id: `${email}:${e.id}`,
              date: day,
              amount: salary,
              currency: "INR",
              direction: "credit",
              description: "Salary",
              category: "Salary",
              source: { account: email, messageId: e.id, parser: "payroll", receivedAt: e.date.toISOString() },
            });
            note(txnLine(newTxns[newTxns.length - 1]));
          }
          const pdfs = e.attachments.filter((a) => a.filename.toLowerCase().endsWith(".pdf"));
          const hint = payMonthHint(e.text, pdfs.map((a) => a.filename));
          if (!pdfs.length || (hint && haveMonth(hint) && !/form\s*16/i.test(e.subject))) continue;
          for (const pdf of pdfs) {
            try {
              const bytes = await getAttachment(email, e.id, pdf.attachmentId);
              const { input } = await loadBytes(bytes, pdf.filename, "application/pdf", knownPasswords(config));
              log(`Reading ${pdf.filename} with OpenAI…`, 0.5 + (0.5 * emails.indexOf(e)) / emails.length);
              const rec = payrollRecord(await reader.read(input, pdf.filename), src, day);
              if (rec?.payslip) {
                newPayslips.push(rec.payslip);
                note(`${rec.payslip.month} · Payslip`);
              }
              if (rec?.taxDoc) {
                newTaxDocs.push(rec.taxDoc);
                note(`FY ${rec.taxDoc.fy} · Form 16`);
              }
            } catch (err) {
              if (err instanceof NeedsPasswordError) locked++;
              else warnings.push(`${pdf.filename}: ${(err as Error).message}`);
            }
          }
        }
        if (locked) warnings.push(`${locked} payslip / Form 16 PDFs are password-protected: add the password under Settings → Document passwords, then Sync again.`);
      }

      // CAS statements. Not tied to the sync cursor: any recent CAS email that isn't saved yet
      // (e.g. it failed for want of a password) is retried on every sync.
      begin(4, "Searching CAS statements…");
      const casIds = (await searchIds(email, casQuery(startedAt - CAS_LOOKBACK_DAYS * 86400), 20)).filter((id) => !knownStatements.has(id) && !skippedCas.has(id));
      // pdf.js is ~1MB; only load it when there is a statement to read.
      const { pdfToLines, WrongPasswordError } = casIds.length ? await import("./parsers/cas/pdf") : ({} as typeof import("./parsers/cas/pdf"));
      for (const [n, id] of casIds.entries()) {
        const msg = await getEmail(email, id);
        for (const att of msg.attachments.filter((a) => a.filename.toLowerCase().endsWith(".pdf"))) {
          log(`Parsing ${att.filename}…`, n / casIds.length);
          try {
            const bytes = await getAttachment(email, id, att.attachmentId);
            const lines = await pdfToLines(bytes, config.casPassword);
            const stmt = parseCAS(lines, { kind: "gmail", account: email, messageId: id });
            if (isCompleteStatement(stmt)) {
              newStatements.push(stmt);
              note(`${att.filename} · CAS statement`);
            }
            // Account statements / confirmations for one folio also come from CAMS; they aren't a CAS.
            else skippedCas.add(id);
          } catch (e) {
            warnings.push(`${att.filename}: ${e instanceof WrongPasswordError ? "set the CAS password in Settings" : (e as Error).message}`);
          }
        }
      }
      within = 1;
      log("Done with this inbox");
      account.syncedUntil = startedAt;
    } catch (e) {
      // Keep what this account produced so far; its cursor stays put so the next sync resumes.
      warnings.push(`${email}: ${(e as Error).message}`);
    }
  }

  // Earlier versions stored non-CAS PDFs from Gmail as statements; drop those files.
  const junk = data.statements.filter((s) => s.source.kind === "gmail" && !isCompleteStatement(s));
  for (const s of junk) if (s.source.kind === "gmail") skippedCas.add(s.source.messageId);
  if (skippedCas.size !== (data.config.skippedCasMessages?.length ?? 0)) config.skippedCasMessages = [...skippedCas];

  const result = {
    transactions: newTxns.length,
    updated: updated.length,
    statements: newStatements.length,
    cardStatements: newCardStatements.length,
    cardPayments: newCardPayments.length,
    wealth: newSnapshots.length + newFlows.length,
    payroll: newPayslips.length + newTaxDocs.length,
    warnings,
  };
  const nothing =
    !junk.length &&
    !result.payroll &&
    !newTxns.length && !updated.length && !newStatements.length && !newCardStatements.length && !newCardPayments.length && !result.wealth;
  if (nothing && JSON.stringify(config) === JSON.stringify(data.config)) {
    return result;
  }
  stage = SYNC_STAGES.length;
  within = 0;
  accountIndex = config.accounts.length;
  emit("Saving to GitHub…");
  const files: Record<string, unknown> = {
    "config.json": config,
    ...monthShards(data.transactions, newTxns, updated),
    ...Object.fromEntries(newStatements.map((s) => [statementPath(s), s])),
    ...Object.fromEntries(junk.map((s) => [statementPath(s), null])),
    ...(newPayslips.length ? { [PATHS.payslips]: mergePayslips(data.payslips, newPayslips) } : {}),
    ...(newTaxDocs.length ? { [PATHS.taxDocs]: [...data.taxDocs.filter((d) => !newTaxDocs.some((n) => n.fy === d.fy && n.kind === d.kind)), ...newTaxDocs] } : {}),
    ...(newCardStatements.length ? { [CARD_STATEMENTS_PATH]: mergeCardStatements(data.cardStatements, newCardStatements) } : {}),
    ...(newCardPayments.length ? { [CARD_PAYMENTS_PATH]: mergeCardPayments(data.cardPayments, newCardPayments) } : {}),
    ...(result.wealth
      ? {
          [PATHS.wealthAccounts]: wealthAccounts,
          [PATHS.wealthSnapshots]: [...data.wealthSnapshots, ...newSnapshots],
          [PATHS.wealthFlows]: [...data.wealthFlows, ...newFlows].sort((a, b) => b.date.localeCompare(a.date)),
        }
      : {}),
  };
  const parts = [
    `${newTxns.length} transactions`,
    updated.length && `${updated.length} updated`,
    newCardStatements.length && `${newCardStatements.length} card bills`,
    newCardPayments.length && `${newCardPayments.length} card payments`,
    result.wealth && `${result.wealth} NPS updates`,
    result.payroll && `${result.payroll} payslips / Form 16`,
    newStatements.length && `${newStatements.length} CAS`,
  ].filter(Boolean);
  await store.writeJSON(files, `Sync ${today}: ${parts.join(", ")}`);
  return result;
}

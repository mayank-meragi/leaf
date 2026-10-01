import { describe, expect, it } from "vitest";
import type { WealthAccount, WealthFlow, WealthSnapshot } from "@/types";
import { accountValue, duplicateGroups, financialYear, matchAccount, mergeAccounts, netWorth, pickSurvivor, removeAccount, wealthLines } from "./wealth";

const manual = { kind: "manual" } as const;
const snap = (account: string, date: string, value: number): WealthSnapshot => ({ account, date, value, source: manual });
const flow = (account: string, date: string, amount: number, kind: WealthFlow["kind"] = "contribution"): WealthFlow => ({ account, date, amount, kind, source: manual });

describe("accountValue", () => {
  it("adds contributions after the latest snapshot only", () => {
    const v = accountValue("nps", [snap("nps", "2026-08-31", 100000), snap("nps", "2026-07-31", 90000)], [flow("nps", "2026-08-15", 2000), flow("nps", "2026-09-01", 2500)], "2026-10-01");
    expect(v).toEqual({ value: 102500, asOf: "2026-08-31", flowsSince: 2500, stale: false });
  });
  it("falls back to flows alone and flags stale values", () => {
    expect(accountValue("nps", [], [flow("nps", "2026-09-01", 2000), flow("nps", "2026-09-05", 500, "withdrawal")], "2026-10-01")).toMatchObject({ value: 1500, asOf: "2026-09-05" });
    expect(accountValue("epf", [snap("epf", "2026-03-31", 500000)], [], "2026-10-01").stale).toBe(true);
    expect(accountValue("none", [], [], "2026-10-01")).toMatchObject({ value: 0, stale: true });
  });
});

describe("netWorth", () => {
  const accounts: WealthAccount[] = [
    { id: "epf", kind: "epf", name: "EPF", institution: "EPFO", ref: "UAN ••4321" },
    { id: "loan", kind: "loan", name: "Home loan", institution: "HDFC Bank" },
  ];
  it("subtracts liabilities and drops empty lines", () => {
    const lines = wealthLines(accounts, [snap("epf", "2026-09-30", 500000), snap("loan", "2026-09-30", 200000)], [], "2026-10-01");
    const nw = netWorth({ assets: [...lines.assets, { key: "mf", label: "Mutual funds", group: "Mutual funds", value: 1000000 }, { key: "x", label: "Empty", group: "Other", value: 0 }], liabilities: lines.liabilities });
    expect(nw.total).toBe(1300000);
    expect(nw.assets.map((a) => a.key)).toEqual(["mf", "epf"]);
    expect(nw.liabilities.map((a) => a.key)).toEqual(["loan"]);
  });

  it("matches documents to accounts by reference, then institution", () => {
    expect(matchAccount(accounts, "epf", undefined, "XXXXXXXX4321")?.id).toBe("epf");
    expect(matchAccount(accounts, "loan", "HDFC")?.id).toBe("loan");
    expect(matchAccount(accounts, "epf", undefined, "9999")).toBeUndefined();
    expect(matchAccount(accounts, "ppf", "SBI")).toBeUndefined();
  });
});

it("financialYear", () => {
  expect(financialYear("2026-05-10")).toBe("2026-27");
  expect(financialYear("2026-03-31")).toBe("2025-26");
});

describe("duplicate accounts", () => {
  // The real case: a statement uploaded by hand (random id) and the Gmail sync's own account (id from the PRAN),
  // both holding the same balance for 31 Aug.
  const uploaded: WealthAccount = { id: "nps-muojm19i45lb", kind: "nps", name: "Protean CRA NPS", institution: "Protean CRA", ref: "••6595" };
  const synced: WealthAccount = { id: "nps-6595-t1", kind: "nps", name: "NPS Tier I", institution: "Protean CRA", ref: "PRAN ••6595" };
  const gmail = { kind: "gmail", account: "a@b.c", messageId: "m1" } as const;
  const snaps: WealthSnapshot[] = [
    { account: uploaded.id, date: "2026-08-31", value: 545675.7, source: { kind: "upload", fileName: "x.pdf" } },
    { account: synced.id, date: "2026-08-31", value: 545675.7, source: gmail },
    { account: synced.id, date: "2026-06-30", value: 535150.94, source: gmail },
  ];

  it("spots the same account tracked twice, and counts it twice in net worth", () => {
    expect(duplicateGroups([uploaded, synced])).toEqual([[uploaded, synced]]);
    const { assets } = wealthLines([uploaded, synced], snaps, [], "2026-10-01");
    expect(netWorth({ assets, liabilities: [] }).total).toBeCloseTo(2 * 545675.7, 2);
  });

  it("doesn't mistake different accounts for duplicates", () => {
    const tier2: WealthAccount = { ...synced, id: "nps-6595-t2", name: "NPS Tier II", ref: "PRAN ••6595" };
    const epf: WealthAccount = { id: "epf-1", kind: "epf", name: "EPF", ref: "••6595" }; // same digits, different kind
    expect(duplicateGroups([synced, tier2, epf])).toEqual([]);
    expect(duplicateGroups([{ id: "a", kind: "fd", name: "FD" }, { id: "b", kind: "fd", name: "FD 2" }])).toEqual([]); // no reference to go on
  });

  it("keeps the account the sync feeds, folds the other into it and counts the money once", () => {
    expect(pickSurvivor([uploaded, synced], snaps).id).toBe("nps-6595-t1");
    const merged = mergeAccounts({ accounts: [uploaded, synced], snapshots: snaps, flows: [] }, synced.id, [uploaded.id]);
    expect(merged.accounts).toEqual([synced]);
    expect(merged.snapshots.map((s) => [s.account, s.date])).toEqual([[synced.id, "2026-08-31"], [synced.id, "2026-06-30"]]);
    expect(merged.snapshots[0].source).toEqual(gmail); // the survivor's own copy wins a tie on the same date
    const { assets } = wealthLines(merged.accounts, merged.snapshots, merged.flows, "2026-10-01");
    expect(netWorth({ assets, liabilities: [] }).total).toBeCloseTo(545675.7, 2);
    expect(duplicateGroups(merged.accounts)).toEqual([]);
  });

  it("brings across a balance and contributions only the duplicate had", () => {
    const only = [snap(uploaded.id, "2026-07-31", 500000)];
    const flows = [flow(uploaded.id, "2026-07-15", 2000), flow(synced.id, "2026-07-15", 2000)]; // same contribution seen twice
    const m = mergeAccounts({ accounts: [uploaded, synced], snapshots: [...snaps, ...only], flows }, synced.id, [uploaded.id]);
    expect(m.snapshots.map((s) => s.date)).toContain("2026-07-31");
    expect(m.snapshots.every((s) => s.account === synced.id)).toBe(true);
    expect(m.flows).toHaveLength(1);
  });

  it("deletes an account with its balances and contributions, and nothing else", () => {
    const other = snap("epf-1", "2026-08-31", 100);
    const r = removeAccount({ accounts: [uploaded, synced, { id: "epf-1", kind: "epf", name: "EPF" }], snapshots: [...snaps, other], flows: [flow(synced.id, "2026-07-15", 1), flow("epf-1", "2026-07-15", 1)] }, synced.id);
    expect(r.accounts.map((a) => a.id)).toEqual([uploaded.id, "epf-1"]);
    expect(r.snapshots.map((s) => s.account)).toEqual([uploaded.id, "epf-1"]);
    expect(r.flows.map((f) => f.account)).toEqual(["epf-1"]);
  });
});

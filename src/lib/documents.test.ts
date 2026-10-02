import { describe, expect, it } from "vitest";
import type { DocExtraction } from "./ai/documents";
import type { LeafData } from "./db";
import { PATHS } from "./db";
import { applyDocument } from "./documents";
import type { WealthAccount } from "@/types";

const empty: LeafData = {
  config: { version: 1, accounts: [] },
  transactions: [], statements: [], cardStatements: [], cardPayments: [],
  wealthAccounts: [], wealthSnapshots: [], wealthFlows: [], payslips: [], taxDocs: [], policies: [], stockStatements: [],
};
const blank: DocExtraction = {
  kind: "other", institution: "", reference: "", asOfDate: "", balance: 0, payMonth: "", gross: 0, net: 0, tds: 0,
  memberId: "", employer: "", epfEmployeeShare: 0, epfEmployerShare: 0, epfPension: 0, pfEmployee: 0, pfEmployer: 0, financialYear: "", taxableIncome: 0, policyType: "", cover: 0, premium: 0,
  renewalDate: "", insured: "", emi: 0, summary: "",
};
const src = { kind: "upload", fileName: "x.pdf" } as const;

describe("applyDocument: NPS", () => {
  const stmt = { ...blank, kind: "nps_statement" as const, institution: "Protean CRA", reference: "PRAN 1113536595", asOfDate: "2026-08-31", balance: 545675.7 };

  it("gives an uploaded statement the same account id the Gmail sync derives from the PRAN", () => {
    const r = applyDocument(stmt, empty, src, "2026-10-01");
    expect(r.files[PATHS.wealthAccounts]).toMatchObject([{ id: "nps-6595-t1", kind: "nps", ref: "PRAN ••6595" }]);
  });

  it("lands on the sync's existing account rather than adding a second", () => {
    const synced = { id: "nps-6595-t1", kind: "nps", name: "NPS Tier I", institution: "Protean CRA", ref: "PRAN ••6595" } as const;
    const r = applyDocument(stmt, { ...empty, wealthAccounts: [synced] }, src, "2026-10-01");
    expect(r.files[PATHS.wealthAccounts]).toHaveLength(1);
    expect(r.files[PATHS.wealthSnapshots]).toMatchObject([{ account: "nps-6595-t1", value: 545675.7 }]);
  });
});

describe("applyDocument", () => {
  it("creates an EPF account from a passbook, then updates it from the next one", () => {
    const first = applyDocument({ ...blank, kind: "epf_passbook", institution: "EPFO", reference: "UAN 1000 2000 4321", asOfDate: "2026-03-31", balance: 500000 }, empty, src, "2026-10-01");
    const accounts = first.files[PATHS.wealthAccounts] as WealthAccount[];
    expect(accounts).toMatchObject([{ kind: "epf", name: "EPFO EPF", ref: "••4321" }]);
    expect(first.description).toMatch(/^New account/);

    const data = { ...empty, wealthAccounts: accounts, wealthSnapshots: first.files[PATHS.wealthSnapshots] as LeafData["wealthSnapshots"] };
    const second = applyDocument({ ...blank, kind: "epf_passbook", institution: "EPFO", reference: "XXXX4321", asOfDate: "2026-09-30", balance: 560000 }, data, src, "2026-10-01");
    expect((second.files[PATHS.wealthAccounts] as WealthAccount[]).length).toBe(1);
    expect(second.files[PATHS.wealthSnapshots]).toHaveLength(2);
    expect(second.description).toMatch(/^Update/);
  });

  it("keeps a separate EPF account per employer even though the UAN is the same", () => {
    const passbook = (employer: string, memberId: string, balance: number, asOfDate = "2026-09-30") =>
      ({ ...blank, kind: "epf_passbook" as const, institution: "EPFO", reference: "UAN 100020004321", employer, memberId, asOfDate, balance });
    let data = empty;
    const add = (x: DocExtraction) => {
      const r = applyDocument(x, data, src, "2026-10-01");
      data = { ...data, wealthAccounts: r.files[PATHS.wealthAccounts] as WealthAccount[], wealthSnapshots: r.files[PATHS.wealthSnapshots] as LeafData["wealthSnapshots"] };
      return r;
    };
    add(passbook("Acme Pvt Ltd", "MHBAN00123450000012345", 300000));
    add(passbook("Globex Ltd", "KNBNG00987650000067890", 120000));
    expect(data.wealthAccounts).toMatchObject([{ name: "EPF · Acme Pvt Ltd", ref: "••2345" }, { name: "EPF · Globex Ltd", ref: "••7890" }]);
    expect(data.wealthSnapshots.map((s) => s.value).sort()).toEqual([120000, 300000]);

    // A newer passbook for one employer updates that account only; the employer's name alone is enough too.
    add(passbook("Acme Pvt Ltd", "MHBAN00123450000012345", 320000, "2026-10-31"));
    add({ ...passbook("Globex Ltd", "", 125000, "2026-10-31") });
    expect(data.wealthAccounts).toHaveLength(2);
    expect(data.wealthSnapshots).toHaveLength(4);
  });

  it("files payslips, replacing a re-upload of the same month", () => {
    const x = { ...blank, kind: "payslip" as const, institution: "Acme", payMonth: "2026-09", gross: 200000, net: 150000, tds: 30000, pfEmployee: 1800 };
    const once = applyDocument(x, empty, src, "2026-10-01");
    const twice = applyDocument({ ...x, net: 151000 }, { ...empty, payslips: once.files[PATHS.payslips] as LeafData["payslips"] }, src, "2026-10-01");
    expect(twice.files[PATHS.payslips]).toMatchObject([{ month: "2026-09", net: 151000 }]);
  });

  it("files insurance policies and Form 16", () => {
    const p = applyDocument({ ...blank, kind: "insurance_policy", institution: "Star Health", reference: "P/123/4567", policyType: "health", cover: 1000000, renewalDate: "2027-01-15" }, empty, src, "2026-10-01");
    expect(p.files[PATHS.policies]).toMatchObject([{ insurer: "Star Health", type: "health", policyRef: "••4567", cover: 1000000 }]);
    const f = applyDocument({ ...blank, kind: "form16", institution: "Acme", financialYear: "2025-26", gross: 2400000, tds: 400000 }, empty, src, "2026-10-01");
    expect(f.files[PATHS.taxDocs]).toMatchObject([{ fy: "2025-26", kind: "form16", tds: 400000 }]);
  });

  it("refuses documents it can't use", () => {
    expect(() => applyDocument({ ...blank, kind: "ppf_statement" }, empty, src, "2026-10-01")).toThrow(/balance/);
    expect(() => applyDocument(blank, empty, src, "2026-10-01")).toThrow(/doesn't look like/);
  });
});

describe("epfOverview", () => {
  it("combines employers, and carries each account's latest balance into the history", async () => {
    const { epfOverview } = await import("./epf");
    const accounts: WealthAccount[] = [
      { id: "a", kind: "epf", name: "EPF · Acme" },
      { id: "b", kind: "epf", name: "EPF · Globex" },
      { id: "n", kind: "nps", name: "NPS" },
    ];
    const snap = (account: string, date: string, value: number) => ({ account, date, value, source: src });
    const o = epfOverview(accounts, [snap("a", "2026-03-31", 100), snap("b", "2026-06-30", 40), snap("a", "2026-09-30", 150), snap("n", "2026-09-30", 999)], [], "2026-10-01");
    expect(o.total).toBe(190);
    expect(o.accounts.map((x) => x.account.id)).toEqual(["a", "b"]);
    expect(o.accounts[0].share).toBeCloseTo(150 / 190);
    expect(o.history).toEqual([{ date: "2026-03-31", value: 100 }, { date: "2026-06-30", value: 140 }, { date: "2026-09-30", value: 190 }]);
    expect(o.asOf).toBe("2026-06-30");
  });
});

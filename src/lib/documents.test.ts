import { describe, expect, it } from "vitest";
import type { DocExtraction } from "./ai/documents";
import type { LeafData } from "./db";
import { PATHS } from "./db";
import { applyDocument } from "./documents";
import type { WealthAccount } from "@/types";

const empty: LeafData = {
  config: { version: 1, accounts: [] },
  transactions: [], statements: [], cardStatements: [], cardPayments: [],
  wealthAccounts: [], wealthSnapshots: [], wealthFlows: [], payslips: [], taxDocs: [], policies: [],
};
const blank: DocExtraction = {
  kind: "other", institution: "", reference: "", asOfDate: "", balance: 0, payMonth: "", gross: 0, net: 0, tds: 0,
  pfEmployee: 0, pfEmployer: 0, financialYear: "", taxableIncome: 0, policyType: "", cover: 0, premium: 0,
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

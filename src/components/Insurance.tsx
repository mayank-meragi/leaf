import { useMemo } from "react";
import { AlertTriangleIcon, CheckCircle2Icon, InfoIcon, ShieldIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { ViewProps } from "@/App";
import { day, money } from "@/lib/format";
import { assessPolicy, coverage, type Finding, type Level } from "@/lib/insurance";
import { cn } from "@/lib/utils";
import type { InsurancePolicy } from "@/types";
import SectionCard from "./SectionCard";

const TYPE: Record<InsurancePolicy["type"], string> = { health: "Health", term_life: "Term life", life: "Life", motor: "Motor", travel: "Travel", home: "Home", other: "Other" };

const STYLE: Record<Level, { icon: typeof InfoIcon; cls: string }> = {
  good: { icon: CheckCircle2Icon, cls: "text-positive" },
  watch: { icon: AlertTriangleIcon, cls: "text-amber-600 dark:text-amber-400" },
  info: { icon: InfoIcon, cls: "text-muted-foreground" },
};

/** Insurance: what each policy actually says, what to watch out for, and whether your cover is enough. */
export default function Insurance({ data }: ViewProps) {
  const today = new Date().toISOString().slice(0, 10);
  const cov = useMemo(() => coverage(data.policies, data.payslips, today), [data.policies, data.payslips, today]);
  const policies = useMemo(() => [...data.policies].sort((a, b) => (a.renewalDate ?? "9999").localeCompare(b.renewalDate ?? "9999")), [data.policies]);

  if (!policies.length) {
    return (
      <Card className="items-center gap-2 px-6 py-12 text-center">
        <ShieldIcon className="size-6 text-muted-foreground" />
        <p className="font-medium">No policies yet</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Import the policy document (Import → Other document): the schedule, or better the full policy wording. Leaf reads the cover, premium, renewal date and the terms that decide how a claim pays.
        </p>
      </Card>
    );
  }

  const next = cov.nextRenewal;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Health cover" value={cov.health ? money(cov.health) : "—"} />
        <Stat label="Term life cover" value={cov.termLife ? money(cov.termLife) : "—"} sub={cov.annualIncome && cov.termLife ? `${(cov.termLife / cov.annualIncome).toFixed(1)}× yearly income` : undefined} />
        <Stat label="Premiums a year" value={cov.yearlyPremium ? money(cov.yearlyPremium) : "—"} sub={cov.healthPremium ? `${money(cov.healthPremium)} health` : undefined} />
        <Stat label="Next renewal" value={next ? day(next.policy.renewalDate!) : "—"} sub={next ? `${next.policy.insurer} · ${next.days < 0 ? "overdue" : `in ${next.days} days`}` : undefined} />
      </div>

      {cov.checks.length > 0 && (
        <SectionCard title="Is it enough?" description="Rules of thumb for a salaried person: guidance, not advice for your situation.">
          <Findings items={cov.checks} />
          {cov.healthPremium > 0 && (
            <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
              Health premiums of {money(cov.healthPremium)} a year can count towards the 80D deduction (up to ₹25,000 for you and family, ₹50,000 if senior citizens; parents' premiums are extra) under the old tax regime.
            </p>
          )}
        </SectionCard>
      )}

      {policies.map((p) => (
        <PolicyCard key={`${p.insurer}-${p.policyRef}-${p.type}`} p={p} today={today} />
      ))}
    </div>
  );
}

function PolicyCard({ p, today }: { p: InsurancePolicy; today: string }) {
  const findings = assessPolicy(p, today);
  const soon = p.renewalDate && p.renewalDate >= today && Date.parse(p.renewalDate) - Date.parse(today) < 45 * 86_400_000;
  const t = p.terms;
  const facts: [string, string][] = t
    ? ([
        ["Room rent", t.roomRent ? { no_limit: "No limit", capped: "Capped", single_private: "Room category", shared: "Shared room" }[t.roomRent.kind] + (t.roomRent.detail ? `: ${t.roomRent.detail}` : "") : ""],
        ["Co-pay", t.coPayPct === undefined ? "" : t.coPayPct ? `${t.coPayPct}%` : "None"],
        ["Deductible", t.deductible ? money(t.deductible) : ""],
        ["Pre-existing wait", t.waitingPreExistingMonths === undefined ? "" : `${t.waitingPreExistingMonths} months`],
        ["Specific illness wait", t.waitingSpecificMonths === undefined ? "" : `${t.waitingSpecificMonths} months`],
        ["Initial wait", t.initialWaitingDays === undefined ? "" : `${t.initialWaitingDays} days`],
        ["Restore", t.restore === undefined ? "" : t.restore ? "Yes" : "No"],
        ["No-claim bonus", t.noClaimBonusPct === undefined ? "" : t.noClaimBonusPct ? `${t.noClaimBonusPct}%` : "None"],
        ["Type", t.floater === undefined ? "" : t.floater ? "Family floater" : "Individual"],
        ["Cashless", t.cashless === undefined ? "" : t.cashless ? "Yes" : "No"],
      ] as [string, string][]).filter(([, v]) => v)
    : [];

  return (
    <SectionCard
      title={`${p.insurer} · ${TYPE[p.type]}`}
      subtitle={[p.policyRef, p.insured].filter(Boolean).join(" · ")}
      action={
        p.renewalDate && (
          <Badge variant={soon ? "default" : "outline"} className="font-normal">
            Renews {day(p.renewalDate)}
          </Badge>
        )
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
          {p.cover && (
            <span>
              <span className="text-muted-foreground">Cover </span>
              <b className="tabular-nums">{money(p.cover)}</b>
            </span>
          )}
          {p.premium && (
            <span>
              <span className="text-muted-foreground">Premium </span>
              <b className="tabular-nums">{money(p.premium)}</b>
            </span>
          )}
        </div>

        {findings.length > 0 && <Findings items={findings} />}

        {facts.length > 0 && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-t pt-3 text-sm sm:grid-cols-3">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}

        {!t && (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            Terms haven't been read for this policy. Import its document again (the full policy wording works best) to see room-rent limits, co-pay, waiting periods and more.
          </p>
        )}
        {t && !facts.length && !t.subLimits?.length && (
          <p className="text-xs text-muted-foreground">That document didn't state any terms. The full policy wording, not just the schedule, has them.</p>
        )}
      </div>
    </SectionCard>
  );
}

function Findings({ items }: { items: Finding[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((f) => {
        const { icon: Icon, cls } = STYLE[f.level];
        return (
          <li key={f.title} className="flex gap-3 text-sm">
            <Icon className={cn("mt-0.5 size-4 shrink-0", cls)} />
            <div className="min-w-0">
              <div className="font-medium">{f.title}</div>
              <div className="text-xs text-muted-foreground">{f.detail}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="gap-1 px-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}

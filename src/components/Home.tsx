import { useMemo } from "react";
import { AlertCircleIcon, ArrowRightIcon, CheckCircle2Icon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { LeafData } from "@/lib/db";
import { attentionItems, type AttentionItem } from "@/lib/attention";
import { day, money, monthLabel } from "@/lib/format";
import { computeNetWorth } from "@/lib/networth";
import { activeMonth, sourcesWithStatus } from "@/lib/spendingSources";
import type { Tab } from "@/lib/tabs";
import { duplicateGroups } from "@/lib/wealth";
import { cn } from "@/lib/utils";
import SectionCard from "./SectionCard";

interface Props {
  data: LeafData;
  onNavigate: (t: Tab, section?: string) => void;
}

const SLICE_COLORS = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4"];

export default function Home({ data, onNavigate }: Props) {
  const today = new Date().toISOString().slice(0, 10);

  const month = useMemo(() => activeMonth(data.transactions, today), [data.transactions, today]);

  const flow = useMemo(() => {
    const inMonth = data.transactions.filter((t) => t.date.startsWith(month) && t.currency === "INR" && t.category !== "Transfers");
    const byCat = new Map<string, number>();
    let spent = 0;
    let earned = 0;
    for (const t of inMonth) {
      if (t.direction === "debit") {
        spent += t.amount;
        byCat.set(t.category ?? "Other", (byCat.get(t.category ?? "Other") ?? 0) + t.amount);
      } else earned += t.amount;
    }
    return { spent, earned, categories: [...byCat.entries()].sort((a, b) => b[1] - a[1]) };
  }, [data.transactions, month]);

  const nw = useMemo(() => computeNetWorth(data, today), [data, today]);
  const assetsTotal = nw.assets.reduce((s, x) => s + x.value, 0);
  const liabilitiesTotal = nw.liabilities.reduce((s, x) => s + x.value, 0);
  const slices = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of nw.assets) m.set(a.group, (m.get(a.group) ?? 0) + a.value);
    const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 4);
    const rest = sorted.slice(4).reduce((s, [, v]) => s + v, 0);
    return rest > 0 ? [...top, ["Other", rest] as [string, number]] : top;
  }, [nw.assets]);

  const sources = useMemo(() => sourcesWithStatus(data, month, today), [data, month, today]);

  const attention = useMemo(
    () =>
      attentionItems({
        today,
        bills: sources.flatMap((s) => (s.bill ? [{ key: s.key, label: s.label, bill: s.bill }] : [])),
        duplicates: duplicateGroups(data.wealthAccounts),
        missingBalances: nw.missingBalances,
        staleLines: nw.assets.filter((a) => a.stale),
      }),
    [today, sources, data.wealthAccounts, nw],
  );

  if (!data.config.accounts.length && !data.transactions.length && !data.statements.length) {
    return (
      <Card className="items-center py-16 text-center">
        <CardHeader className="w-full">
          <CardTitle className="text-lg">Welcome to Leaf</CardTitle>
          <CardDescription className="mx-auto max-w-md">
            Connect one or more Gmail accounts, then hit Sync. Leaf reads bank alerts and CAS statements and saves everything to
            your repo.
          </CardDescription>
        </CardHeader>
        <Button onClick={() => onNavigate("Settings")}>Connect Gmail</Button>
      </Card>
    );
  }

  const left = flow.earned - flow.spent;
  const top = flow.categories[0]?.[1] ?? 1;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-5">
        <SectionCard
          title="Net worth"
          className="lg:col-span-3"
          action={
            <Button variant="ghost" size="sm" className="-my-1.5 text-muted-foreground" onClick={() => onNavigate("Net worth")}>
              Details <ArrowRightIcon />
            </Button>
          }
        >
          <div className="text-4xl font-semibold tabular-nums tracking-tight">{money(nw.total)}</div>
          <div className="mt-1 text-sm text-muted-foreground tabular-nums">
            {money(assetsTotal)} assets{liabilitiesTotal > 0 && <> · {money(liabilitiesTotal)} liabilities</>}
          </div>
          {assetsTotal > 0 && (
            <>
              <div className="mt-5 flex h-2 gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Share of assets by type">
                {slices.map(([name, v], i) => (
                  <div key={name} className={cn(SLICE_COLORS[i] ?? "bg-chart-other", name === "Other" && "bg-chart-other")} style={{ width: `${(v / assetsTotal) * 100}%` }} />
                ))}
              </div>
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {slices.map(([name, v], i) => (
                  <li key={name} className="flex items-center gap-1.5">
                    <span className={cn("size-2 rounded-full", SLICE_COLORS[i] ?? "bg-chart-other", name === "Other" && "bg-chart-other")} />
                    {name} <span className="tabular-nums text-foreground">{((v / assetsTotal) * 100).toFixed(0)}%</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </SectionCard>

        <SectionCard title="This month" subtitle={monthLabel(month)} className="lg:col-span-2">
          <dl className="space-y-3">
            <Row label="Received" value={money(flow.earned)} />
            <Row label="Spent" value={money(flow.spent)} />
            <div className="border-t pt-3">
              <Row label="Left over" value={`${left < 0 ? "−" : ""}${money(Math.abs(left))}`} tone={left < 0 ? "negative" : "positive"} strong />
            </div>
          </dl>
        </SectionCard>
      </div>

      <SectionCard title="Needs attention" subtitle={attention.length ? `${attention.length}` : undefined}>
        {attention.length ? (
          <ul className="-my-1 divide-y divide-border/60">
            {attention.map((item) => (
              <AttentionRow key={item.id} item={item} onOpen={() => onNavigate(item.to, item.section)} />
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2Icon className="size-4 text-positive" /> Nothing needs your attention.
          </p>
        )}
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-5">
        <SectionCard title="Where it went" subtitle={monthLabel(month)} className="lg:col-span-2">
          {flow.categories.length ? (
            <ul className="space-y-3">
              {flow.categories.slice(0, 6).map(([cat, amt]) => (
                <li key={cat}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>{cat}</span>
                    <span className="tabular-nums text-muted-foreground">{money(amt)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted">
                    <div className="h-1.5 rounded-full bg-chart-1" style={{ width: `${(amt / top) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No spending recorded yet.</p>
          )}
        </SectionCard>

        <SectionCard
          title="Recent"
          className="lg:col-span-3"
          action={
            <Button variant="ghost" size="sm" className="-my-1.5 text-muted-foreground" onClick={() => onNavigate("Spending")}>
              View all <ArrowRightIcon />
            </Button>
          }
        >
          <ul className="divide-y divide-border/60">
            {data.transactions.slice(0, 6).map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate">{t.description}</div>
                  <div className="text-xs text-muted-foreground">
                    {day(t.date)} · {t.category}
                  </div>
                </div>
                <span className={cn("tabular-nums", t.direction === "credit" && "text-positive")}>
                  {t.direction === "credit" ? "+" : "−"}
                  {money(t.amount, t.currency)}
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>

    </div>
  );
}

function Row({ label, value, tone, strong }: { label: string; value: string; tone?: "positive" | "negative"; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={cn("tabular-nums", strong ? "text-xl font-semibold" : "text-lg", tone === "positive" && "text-positive", tone === "negative" && "text-destructive")}>{value}</dd>
    </div>
  );
}

const ICON = { danger: AlertCircleIcon, warn: TriangleAlertIcon, info: InfoIcon } as const;
const ICON_COLOR = { danger: "text-destructive", warn: "text-amber-600 dark:text-amber-400", info: "text-muted-foreground" } as const;

function AttentionRow({ item, onOpen }: { item: AttentionItem; onOpen: () => void }) {
  const Icon = ICON[item.tone];
  return (
    <li>
      <button onClick={onOpen} className="flex w-full items-center gap-3 py-2.5 text-left text-sm hover:text-foreground">
        <Icon className={cn("size-4 shrink-0", ICON_COLOR[item.tone])} />
        <span className="min-w-0 flex-1">
          <span className="font-medium">{item.title}</span>
          {item.detail && <span className="text-muted-foreground"> · {item.detail}</span>}
        </span>
        <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}

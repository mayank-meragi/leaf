import { useMemo } from "react";
import { ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Tab } from "@/App";
import type { LeafData } from "@/lib/db";
import { day, money, monthLabel, pct } from "@/lib/format";
import { cardRecords, instrumentKey, instruments, sourceStatus } from "@/lib/instruments";
import { summarize } from "@/lib/portfolio";
import { cn } from "@/lib/utils";
import SourceTile from "./SourceTile";

interface Props {
  data: LeafData;
  onNavigate: (t: Tab) => void;
  onOpenSource: (key: string) => void;
}

export default function Overview({ data, onNavigate, onOpenSource }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);

  const stats = useMemo(() => {
    const inMonth = data.transactions.filter((t) => t.date.startsWith(month) && t.currency === "INR");
    const spend = inMonth.filter((t) => t.direction === "debit" && t.category !== "Transfers");
    const income = inMonth.filter((t) => t.direction === "credit" && t.category !== "Transfers");
    const byCat = new Map<string, number>();
    for (const t of spend) byCat.set(t.category ?? "Other", (byCat.get(t.category ?? "Other") ?? 0) + t.amount);
    return {
      spent: spend.reduce((s, t) => s + t.amount, 0),
      earned: income.reduce((s, t) => s + t.amount, 0),
      categories: [...byCat.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [data.transactions, month]);

  const mf = useMemo(() => summarize(data.statements), [data.statements]);

  // This month's money in/out per card and account.
  const sources = useMemo(() => {
    const flows = new Map<string, { out: number; in: number }>();
    for (const t of data.transactions) {
      if (!t.date.startsWith(month) || t.currency !== "INR") continue;
      const key = instrumentKey(t);
      if (!key) continue;
      const f = flows.get(key) ?? { out: 0, in: 0 };
      flows.set(key, f);
      if (t.direction === "debit") f.out += t.amount;
      else f.in += t.amount;
    }
    // Cards and accounts with nothing in the last two months (old or closed ones) stay out of the way.
    const recent = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    return instruments(data.transactions, data.config, cardRecords(data.cardStatements, data.cardPayments))
      .filter((i) => i.lastUsed >= recent)
      .map((i) => ({
        ...i,
        ...(flows.get(i.key) ?? { out: 0, in: 0 }),
        ...sourceStatus(i.key, data.transactions, data.cardStatements, data.cardPayments, today),
      }));
  }, [data.transactions, data.config, data.cardStatements, data.cardPayments, month, today]);

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

  const top = stats.categories[0]?.[1] ?? 1;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={`Spent · ${monthLabel(month)}`} value={money(stats.spent)} />
        <Stat label={`Received · ${monthLabel(month)}`} value={money(stats.earned)} />
        <Stat
          label={mf.asOf ? `Mutual funds · as of ${day(mf.asOf)}` : "Mutual funds"}
          value={mf.value ? money(mf.value) : "—"}
          sub={
            mf.cost
              ? `${money(mf.value - mf.cost)} (${pct((mf.value - mf.cost) / mf.cost)})${mf.xirr != null && mf.xirrCoverage > 0.999 ? ` · XIRR ${pct(mf.xirr).replace("+", "")}` : ""}`
              : undefined
          }
          positive={mf.value >= mf.cost}
        />
      </div>

      {sources.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Cards & accounts</CardTitle>
            <CardDescription>Card spends since each statement; account balances as of the latest alert</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {sources.map((s) => (
                <li key={s.key}>
                  <SourceTile source={s} monthName={monthLabel(month).split(" ")[0]} today={today} onOpen={() => onOpenSource(s.key)} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Where it went</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.categories.length ? (
              <ul className="space-y-3">
                {stats.categories.map(([cat, amt]) => (
                  <li key={cat}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span>{cat}</span>
                      <span className="tabular-nums text-muted-foreground">{money(amt)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted">
                      <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(amt / top) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No spending recorded this month yet.</p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Recent</CardTitle>
            <Button variant="ghost" size="sm" className="-my-2" onClick={() => onNavigate("Transactions")}>
              View all <ArrowRightIcon />
            </Button>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {data.transactions.slice(0, 8).map((t) => (
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  return (
    <Card className="gap-1 px-6">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {sub && <div className={cn("text-sm tabular-nums", positive ? "text-positive" : "text-destructive")}>{sub}</div>}
    </Card>
  );
}

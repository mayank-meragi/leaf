import { useMemo, useState } from "react";
import { XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ViewProps } from "@/App";
import { money, monthLabel } from "@/lib/format";
import { activeMonth } from "@/lib/spendingSources";
import { useSaveConfig } from "@/lib/useConfig";
import SectionCard from "./SectionCard";

/** Where the money went in a month, and the categories and rules that decide it. */
export default function Categories(props: ViewProps) {
  const { data } = props;
  const { config } = data;
  const { busy, saveConfig } = useSaveConfig(props);
  const today = new Date().toISOString().slice(0, 10);
  const months = useMemo(() => [...new Set(data.transactions.filter((t) => t.currency === "INR").map((t) => t.date.slice(0, 7)))].sort().reverse(), [data.transactions]);
  const [month, setMonth] = useState(() => activeMonth(data.transactions, today));

  const { rows, total } = useMemo(() => {
    const byCat = new Map<string, number>();
    for (const t of data.transactions) {
      if (t.direction !== "debit" || t.currency !== "INR" || t.category === "Transfers" || !t.date.startsWith(month)) continue;
      byCat.set(t.category ?? "Other", (byCat.get(t.category ?? "Other") ?? 0) + t.amount);
    }
    const rows = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
    return { rows, total: rows.reduce((s, [, v]) => s + v, 0) };
  }, [data.transactions, month]);

  return (
    <div className="space-y-4">
      <SectionCard
        title="Spending by category"
        action={
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger size="sm" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {months.map((m) => (
                <SelectItem key={m} value={m}>
                  {monthLabel(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      >
        {rows.length ? (
          <ul className="space-y-3">
            {rows.map(([cat, amt]) => (
              <li key={cat}>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{cat}</span>
                  <span className="tabular-nums text-muted-foreground">
                    <span className="text-foreground">{((amt / total) * 100).toFixed(0)}%</span> · {money(amt)}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted">
                  <div className="h-1.5 rounded-full bg-chart-1" style={{ width: `${(amt / rows[0][1]) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No spending recorded in {monthLabel(month)}.</p>
        )}
      </SectionCard>

      <SectionCard
        title="Your categories and rules"
        description="Create categories from any transaction's category picker. Tagging a transaction also tags everything to or from the same person, past and future."
        bodyClassName="space-y-5"
      >
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Categories</h3>
          {config.categories?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {config.categories.map((c) => (
                <Badge key={c} variant="secondary" className="gap-1 pr-1">
                  {c}
                  <button
                    aria-label={`Delete ${c}`}
                    disabled={busy}
                    className="rounded-sm p-0.5 hover:bg-foreground/10"
                    onClick={() =>
                      saveConfig(
                        {
                          ...config,
                          categories: config.categories!.filter((x) => x !== c),
                          categoryRules: config.categoryRules?.filter((r) => r.category !== c),
                        },
                        `Delete category ${c}`,
                      )
                    }
                  >
                    <XIcon className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">None yet. Type a new name in a transaction's category picker.</p>
          )}
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Rules</h3>
          {config.categoryRules?.length ? (
            <ul className="divide-y divide-border/60 text-sm">
              {config.categoryRules.map((r) => (
                <li key={`${r.direction}:${r.party}`} className="flex items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-muted-foreground">{r.direction === "debit" ? "Paid to" : "From"}</span> {r.party}
                  </span>
                  <Badge variant="outline">{r.category}</Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label="Delete rule"
                    disabled={busy}
                    onClick={() => saveConfig({ ...config, categoryRules: config.categoryRules!.filter((x) => x !== r) }, `Delete rule for ${r.party}`)}
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No rules yet.</p>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

import { useMemo, useState } from "react";
import { CreditCardIcon, SearchIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ViewProps } from "@/App";
import { allCategories, recategorize } from "@/lib/categories";
import { saveRecategorization } from "@/lib/db";
import { cardRecords, instrumentKey, instruments, KIND_LABEL, KIND_ORDER, paymentFor } from "@/lib/instruments";
import { day, money, monthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Transaction } from "@/types";
import CategoryCombobox from "./CategoryCombobox";

const ALL = "all";
const NONE = "none";

export default function Transactions({ store, data, setData, initialSource }: ViewProps & { initialSource?: string | null }) {
  const months = useMemo(() => [...new Set(data.transactions.map((t) => t.date.slice(0, 7)))], [data.transactions]);
  const sources = useMemo(
    () => instruments(data.transactions, data.config, cardRecords(data.cardStatements, data.cardPayments)),
    [data.transactions, data.config, data.cardStatements, data.cardPayments],
  );
  const sourceByKey = useMemo(() => new Map(sources.map((i) => [i.key, i])), [sources]);
  // Arriving from a card/account link shows that source's whole history, not just the latest month.
  const [month, setMonth] = useState(initialSource ? ALL : (months[0] ?? ALL));
  const [account, setAccount] = useState(ALL);
  const [source, setSource] = useState(initialSource ?? ALL);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const categories = useMemo(() => allCategories(data.config), [data.config]);

  const rows = useMemo(() => {
    const q = query.toLowerCase();
    return data.transactions.filter(
      (t) =>
        (month === ALL || t.date.startsWith(month)) &&
        (account === ALL || t.source.account === account) &&
        (source === ALL || (source === NONE ? !instrumentKey(t) : instrumentKey(t) === source)) &&
        (!q || `${t.description} ${t.category} ${t.instrument}`.toLowerCase().includes(q)),
    );
  }, [data.transactions, month, account, source, query]);

  const byDay = useMemo(() => {
    const groups = new Map<string, Transaction[]>();
    for (const t of rows) groups.set(t.date, [...(groups.get(t.date) ?? []), t]);
    return [...groups.entries()];
  }, [rows]);

  const total = (dir: "debit" | "credit") =>
    rows.filter((t) => t.direction === dir && t.currency === "INR").reduce((s, t) => s + t.amount, 0);

  const tag = async (t: Transaction, category: string) => {
    const rec = recategorize(data.config, data.transactions, t, category);
    const created = (rec.config.categories?.length ?? 0) > (data.config.categories?.length ?? 0);
    const others = rec.changed.filter((x) => x.id !== t.id).length;
    setSaving(true);
    try {
      await saveRecategorization(
        store,
        data.transactions,
        rec,
        `Tag ${t.direction === "debit" ? "payments to" : "money from"} ${t.description} as ${category}`,
      );
      const byId = new Map(rec.changed.map((x) => [x.id, x]));
      setData({ ...data, config: rec.config, transactions: data.transactions.map((x) => byId.get(x.id) ?? x) });
      toast.success(`${t.description} → ${category}`, {
        description: [
          created && `Created category “${category}”.`,
          others ? `Also re-tagged ${others} earlier ${others === 1 ? "transaction" : "transactions"}.` : null,
          "Future transactions will be tagged the same way.",
        ]
          .filter(Boolean)
          .join(" "),
      });
    } catch (e) {
      toast.error("Couldn't save category", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  if (!data.transactions.length) {
    return <Card className="py-16 text-center text-sm text-muted-foreground">No transactions yet. Hit Sync to pull them from Gmail.</Card>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All months</SelectItem>
            {months.map((m) => (
              <SelectItem key={m} value={m}>
                {monthLabel(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={account} onValueChange={setAccount}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All accounts</SelectItem>
            {data.config.accounts.map((a) => (
              <SelectItem key={a.email} value={a.email}>
                {a.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger className="w-60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All cards & accounts</SelectItem>
            {KIND_ORDER.map((kind) => {
              const group = sources.filter((i) => i.kind === kind);
              return (
                group.length > 0 && (
                  <SelectGroup key={kind}>
                    <SelectLabel>{KIND_LABEL[kind]}s</SelectLabel>
                    {group.map((i) => (
                      <SelectItem key={i.key} value={i.key}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )
              );
            })}
            <SelectGroup>
              <SelectLabel>Other</SelectLabel>
              <SelectItem value={NONE}>Unknown source</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <div className="flex gap-6 px-1 text-sm">
        <span>
          Out <b className="tabular-nums">{money(total("debit"))}</b>
        </span>
        <span>
          In <b className="tabular-nums text-positive">{money(total("credit"))}</b>
        </span>
        <span className="text-muted-foreground">{rows.length} transactions</span>
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        {byDay.map(([date, txns]) => (
          <div key={date}>
            <div className="border-b bg-muted/50 px-5 py-1.5 text-xs font-medium text-muted-foreground">{day(date)}</div>
            <ul className="divide-y">
              {txns.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{t.description}</span>
                      {(() => {
                        const paid = paymentFor(t, data.cardPayments);
                        const card = paid && sourceByKey.get(paid.card);
                        return (
                          paid && (
                            <Badge variant="secondary" className="shrink-0 gap-1 font-normal">
                              <CreditCardIcon className="size-3" />
                              Bill → {card?.label ?? paid.card}
                            </Badge>
                          )
                        );
                      })()}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[sourceByKey.get(instrumentKey(t) ?? "")?.label ?? t.instrument, t.source.account].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <CategoryCombobox
                    value={t.category}
                    categories={categories}
                    disabled={saving}
                    onChange={(c) => tag(t, c)}
                    className="w-28 px-2 sm:w-40"
                  />
                  <span className={cn("w-24 text-right tabular-nums sm:w-28", t.direction === "credit" && "text-positive")}>
                    {t.direction === "credit" ? "+" : "−"}
                    {money(t.amount, t.currency, true)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Card>
    </div>
  );
}

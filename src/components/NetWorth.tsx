import { useMemo, useState } from "react";
import { AlertTriangleIcon, ArrowRightIcon, MergeIcon, PencilIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ViewProps } from "@/App";
import { day, money } from "@/lib/format";
import { computeNetWorth } from "@/lib/networth";
import { cn } from "@/lib/utils";
import { duplicateGroups, mergeAccounts, newAccountId, pickSurvivor, type NetWorthLine } from "@/lib/wealth";
import type { WealthAccount } from "@/types";
import AccountEditor, { wealthFiles } from "./AccountEditor";
import NetWorthHistory from "./NetWorthHistory";
import SectionCard from "./SectionCard";

export default function NetWorth({ onOpenFunds, onOpenEpf, onOpenStocks, ...props }: ViewProps & { onOpenFunds: () => void; onOpenEpf: () => void; onOpenStocks: () => void }) {
  const { store, data, reload } = props;
  const today = new Date().toISOString().slice(0, 10);
  const [editing, setEditing] = useState<{ account: WealthAccount; isNew: boolean } | null>(null);

  const nw = useMemo(() => computeNetWorth(data, today), [data, today]);

  const assetsTotal = nw.assets.reduce((s, x) => s + x.value, 0);
  const liabTotal = nw.liabilities.reduce((s, x) => s + x.value, 0);
  const groups = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of nw.assets) m.set(a.group, (m.get(a.group) ?? 0) + a.value);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [nw.assets]);
  const accountById = new Map(data.wealthAccounts.map((a) => [a.id, a]));
  const duplicates = useMemo(() => duplicateGroups(data.wealthAccounts), [data.wealthAccounts]);
  const [busy, setBusy] = useState(false);

  const current = { accounts: data.wealthAccounts, snapshots: data.wealthSnapshots, flows: data.wealthFlows };

  /** Folds the duplicates of one account into the copy the sync keeps feeding. */
  const merge = async (group: WealthAccount[]) => {
    const keep = pickSurvivor(group, data.wealthSnapshots);
    setBusy(true);
    try {
      const next = mergeAccounts(current, keep.id, group.filter((a) => a.id !== keep.id).map((a) => a.id));
      await store.writeJSON(wealthFiles(next), `Merge duplicate ${keep.name}`);
      await reload();
      toast.success(`Merged into ${keep.name}`);
    } catch (e) {
      toast.error("Couldn't merge", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Net worth" value={money(nw.total)} strong />
          <Stat label="Assets" value={money(assetsTotal)} />
          <Stat label="Liabilities" value={money(liabTotal)} />
        </div>

        {duplicates.map((group) => (
          <div key={group.map((a) => a.id).join()} className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
            <AlertTriangleIcon className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="min-w-0 flex-1">
              <b>{group.map((a) => a.name).join(" and ")}</b> look like the same account ({group[0].ref}). Net worth counts it {group.length} times.
            </p>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => merge(group)}>
              <MergeIcon /> Merge
            </Button>
          </div>
        ))}

        {groups.length > 0 && (
          <SectionCard title="What you own">
            <ul className="space-y-2.5">
              {groups.map(([g, v]) => (
                <li key={g}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>{g}</span>
                    <span className="tabular-nums text-muted-foreground">
                      <span className="text-foreground">{((v / assetsTotal) * 100).toFixed(0)}%</span> · {money(v)}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted">
                    <div className="h-1.5 rounded-full bg-chart-1" style={{ width: `${(v / groups[0][1]) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </SectionCard>
        )}

      <NetWorthHistory store={store} data={data} />

      <div className="flex justify-end">
        <Button variant="outline" onClick={() => setEditing({ account: { id: newAccountId("epf"), kind: "epf", name: "" }, isNew: true })}>
          <PlusIcon /> Add account
        </Button>
      </div>

      <Lines title="Assets" lines={nw.assets} today={today} editable={accountById} onEdit={(a) => setEditing({ account: a, isNew: false })} openers={{ mf: onOpenFunds, epf: onOpenEpf, stocks: onOpenStocks }} />
      {nw.missingBalances.length > 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          No balance in alerts yet for {nw.missingBalances.join(", ")}. They'll appear once an alert includes one (after the next Sync).
        </p>
      )}
      <Lines title="Liabilities" lines={nw.liabilities} today={today} editable={accountById} onEdit={(a) => setEditing({ account: a, isNew: false })} openers={{ mf: onOpenFunds, epf: onOpenEpf, stocks: onOpenStocks }} />

      {editing && <AccountEditor store={store} data={data} reload={reload} editing={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Card className="gap-1 px-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("font-semibold tabular-nums tracking-tight", strong ? "text-3xl" : "text-2xl")}>{value}</div>
    </Card>
  );
}

interface LinesProps {
  title: string;
  lines: NetWorthLine[];
  today: string;
  /** Tracked accounts, which can be updated by hand (MF, bank and card lines come from sync). */
  editable: Map<string, WealthAccount>;
  onEdit: (account: WealthAccount) => void;
  /** Lines with a page of their own (mutual funds, EPF), by line key. */
  openers: Record<string, () => void>;
}

function Lines({ title, lines, today, editable, onEdit, openers }: LinesProps) {
  if (!lines.length) return null;
  return (
    <Card className="py-0">
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">{title}</TableHead>
              <TableHead>As of</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="w-12 pr-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => {
              const account = editable.get(l.key);
              return (
                <TableRow key={l.key}>
                  <TableCell className="pl-4 whitespace-normal">
                    <div className="font-medium">{l.label}</div>
                    <div className="text-xs text-muted-foreground">{[l.group, l.note].filter(Boolean).join(" · ")}</div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {l.asOf ? (l.asOf === today ? "Today" : day(l.asOf)) : "—"}
                    {l.stale && (
                      <Badge variant="outline" className="ml-2 gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400">
                        <AlertTriangleIcon className="size-3" /> Old
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(l.value)}</TableCell>
                  <TableCell className="pr-4">
                    {account && (
                      <Button variant="ghost" size="icon" className="size-8" aria-label={`Update ${l.label}`} onClick={() => onEdit(account)}>
                        <PencilIcon className="size-3.5" />
                      </Button>
                    )}
                    {openers[l.key] && (
                      <Button variant="ghost" size="icon" className="size-8" aria-label={`Open ${l.label}`} onClick={openers[l.key]}>
                        <ArrowRightIcon className="size-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

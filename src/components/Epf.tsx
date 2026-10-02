import { useMemo, useState } from "react";
import { AlertTriangleIcon, PencilIcon, PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ViewProps } from "@/App";
import { day, money } from "@/lib/format";
import { epfOverview, type EpfAccount } from "@/lib/epf";
import { accountTail, newAccountId } from "@/lib/wealth";
import { cn } from "@/lib/utils";
import AccountEditor, { type Editing } from "./AccountEditor";
import LineChart from "./LineChart";
import SectionCard from "./SectionCard";

/** EPF across every employer: the combined balance, then a page per employer's passbook. */
export default function Epf({ store, data, reload }: ViewProps) {
  const today = new Date().toISOString().slice(0, 10);
  const o = useMemo(() => epfOverview(data.wealthAccounts, data.wealthSnapshots, data.wealthFlows, today), [data, today]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const detail = o.accounts.find((a) => a.account.id === selected) ?? null;
  const addAccount = () => setEditing({ account: { id: newAccountId("epf"), kind: "epf", name: "", institution: "" }, isNew: true });

  if (!o.accounts.length) {
    return (
      <Card className="items-center gap-3 px-6 py-12 text-center">
        <p className="font-medium">No EPF accounts yet</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Import your EPF passbook (Import → Other document), one per employer; each becomes its own account here. Or add one by hand.
        </p>
        <Button variant="outline" onClick={addAccount}>
          <PlusIcon /> Add account
        </Button>
        {editing && <AccountEditor store={store} data={data} reload={reload} editing={editing} onClose={() => setEditing(null)} />}
      </Card>
    );
  }

  const withSplit = o.accounts.filter((a) => a.breakdown);
  const employee = withSplit.reduce((s, a) => s + a.breakdown!.employee, 0);
  const employer = withSplit.reduce((s, a) => s + a.breakdown!.employer, 0);
  const pension = withSplit.reduce((s, a) => s + (a.breakdown!.pension ?? 0), 0);
  const splitComplete = withSplit.length === o.accounts.length;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total EPF" value={money(o.total)} sub={o.asOf ? `As of ${day(o.asOf)}${o.stale ? " · old" : ""}` : undefined} strong />
        <Stat label="Employers" value={String(o.accounts.length)} sub={`${o.accounts.length} passbook${o.accounts.length === 1 ? "" : "s"}`} />
        <Stat label="Your contribution" value={splitComplete && employee ? money(employee) : "—"} sub={splitComplete && employee ? "Employee share, with interest" : "Needs a split in every passbook"} />
        <Stat label="Employer contribution" value={splitComplete && employer ? money(employer) : "—"} sub={splitComplete && pension ? `Pension (EPS) ${money(pension)}, not counted above` : undefined} />
      </div>

      {o.stale && (
        <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p>
            Some balances are more than 100 days old. EPF interest is credited once a year, and passbooks update monthly: download fresh ones from the EPFO passbook
            portal and import them.
          </p>
        </div>
      )}

      {o.history.length > 1 && (
        <SectionCard title="Balance over time" description="All employers combined, at each passbook you've saved.">
          <LineChart label="EPF balance" series={[{ key: "total", label: "Total EPF", color: "var(--chart-1)", points: o.history.map((h) => ({ date: h.date, v: h.value })) }]} />
        </SectionCard>
      )}

      <Card className="py-0">
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Employer</TableHead>
                <TableHead>As of</TableHead>
                <TableHead className="text-right">Share</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="w-12 pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {o.accounts.map((a) => (
                <TableRow key={a.account.id} className="cursor-pointer" onClick={() => setSelected(a.account.id)}>
                  <TableCell className="pl-4 whitespace-normal">
                    <div className="font-medium">{a.account.institution || a.account.name}</div>
                    <div className="text-xs text-muted-foreground">{accountTail(a.account) ? `Member ID ••${accountTail(a.account)}` : "No member ID"}</div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {a.asOf ? day(a.asOf) : "—"}
                    {a.stale && (
                      <Badge variant="outline" className="ml-2 gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400">
                        <AlertTriangleIcon className="size-3" /> Old
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{(a.share * 100).toFixed(0)}%</TableCell>
                  <TableCell className="text-right tabular-nums">{money(a.value)}</TableCell>
                  <TableCell className="pr-4">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={`Update ${a.account.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing({ account: a.account, isNew: false });
                      }}
                    >
                      <PencilIcon className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button variant="outline" onClick={addAccount}>
          <PlusIcon /> Add account
        </Button>
      </div>

      <Dialog open={!!detail} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[90vh] gap-5 overflow-y-auto sm:max-w-2xl">{detail && <Detail a={detail} />}</DialogContent>
      </Dialog>
      {editing && <AccountEditor store={store} data={data} reload={reload} editing={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Detail({ a }: { a: EpfAccount }) {
  const rows = a.history.map((s, i) => ({ s, change: a.history[i + 1] ? s.value - a.history[i + 1].value : null }));
  const points = [...a.history].reverse().map((s) => ({ date: s.date, v: s.value }));
  return (
    <>
      <DialogHeader>
        <DialogTitle className="pr-6 leading-snug">{a.account.name}</DialogTitle>
        <DialogDescription>{[a.account.institution, a.account.ref && `Member ID ${a.account.ref}`].filter(Boolean).join(" · ")}</DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Balance" value={money(a.value)} sub={a.asOf ? `As of ${day(a.asOf)}` : undefined} />
        <Tile label="Employee share" value={a.breakdown ? money(a.breakdown.employee) : "—"} />
        <Tile label="Employer share" value={a.breakdown ? money(a.breakdown.employer) : "—"} />
        <Tile label="Pension (EPS)" value={a.breakdown?.pension ? money(a.breakdown.pension) : "—"} sub="Not part of the balance" />
      </div>
      {a.flowsSince !== 0 && <p className="text-xs text-muted-foreground">Includes {money(a.flowsSince)} added since the last passbook.</p>}

      {points.length > 1 && <LineChart label={`${a.account.name} balance`} series={[{ key: a.account.id, label: a.account.name, color: "var(--chart-1)", points }]} />}

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Passbooks saved</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="text-right">Change</TableHead>
              <TableHead>From</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ s, change }) => (
              <TableRow key={s.date}>
                <TableCell>{day(s.date)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(s.value)}</TableCell>
                <TableCell className={cn("text-right tabular-nums", change != null && (change > 0 ? "text-positive" : change < 0 ? "text-destructive" : undefined))}>
                  {change == null ? "—" : `${change > 0 ? "+" : ""}${money(change)}`}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{s.source.kind === "upload" ? s.source.fileName : s.source.kind === "manual" ? "Entered by hand" : "Email"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border px-3 py-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Stat({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <Card className="gap-1 px-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("font-semibold tabular-nums tracking-tight", strong ? "text-3xl" : "text-2xl")}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}

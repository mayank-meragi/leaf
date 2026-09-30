import { useMemo, useState } from "react";
import { AlertTriangleIcon, PencilIcon, PlusIcon, ShieldIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ViewProps } from "@/App";
import { PATHS } from "@/lib/db";
import { manualBalance } from "@/lib/documents";
import { day, money } from "@/lib/format";
import { cardRecords, instruments, sourceStatus } from "@/lib/instruments";
import { summarize } from "@/lib/portfolio";
import { cn } from "@/lib/utils";
import { netWorth, newAccountId, WEALTH_KINDS, wealthLines, type NetWorthLine } from "@/lib/wealth";
import type { WealthAccount, WealthKind } from "@/types";
import ImportDocument from "./ImportDocument";
import WhereToGet from "./WhereToGet";

export default function NetWorth(props: ViewProps) {
  const { store, data, reload } = props;
  const today = new Date().toISOString().slice(0, 10);
  const [editing, setEditing] = useState<{ account: WealthAccount; isNew: boolean } | null>(null);

  const nw = useMemo(() => {
    const mf = summarize(data.statements);
    const sources = instruments(data.transactions, data.config, cardRecords(data.cardStatements, data.cardPayments));
    const status = (key: string) => sourceStatus(key, data.transactions, data.cardStatements, data.cardPayments, today);
    const wealth = wealthLines(data.wealthAccounts, data.wealthSnapshots, data.wealthFlows, today);

    const banks: NetWorthLine[] = sources
      .filter((s) => s.kind === "bank_account")
      .flatMap((s) => {
        const b = status(s.key).balance;
        const note = b?.adjusted ? `balance stated ${day(b.reportedOn)}, plus ${b.adjusted} transactions since` : "from alerts";
        return b ? [{ key: s.key, label: s.label, group: "Bank accounts", value: b.amount, asOf: b.asOf, stale: false, note }] : [];
      });
    const cards: NetWorthLine[] = sources
      .filter((s) => s.kind === "credit_card" || s.kind === "card")
      .flatMap((s) => {
        const st = status(s.key);
        const billDue = st.bill && st.bill.state !== "paid" ? Math.max(0, st.bill.totalDue - st.bill.paid) : 0;
        const due = billDue + Math.max(0, st.unbilled?.amount ?? 0);
        return due > 0 ? [{ key: s.key, label: s.label, group: "Credit cards", value: due, asOf: today, note: billDue ? "unpaid bill + unbilled" : "unbilled" }] : [];
      });
    const mfLine: NetWorthLine[] = mf.value ? [{ key: "mf", label: "Mutual funds", group: "Mutual funds", value: mf.value, asOf: mf.asOf, note: "from CAS" }] : [];
    const missingBalances = sources.filter((s) => s.kind === "bank_account" && !status(s.key).balance).map((s) => s.label);
    return { ...netWorth({ assets: [...mfLine, ...banks, ...wealth.assets], liabilities: [...cards, ...wealth.liabilities] }), missingBalances };
  }, [data, today]);

  const assetsTotal = nw.assets.reduce((s, x) => s + x.value, 0);
  const liabTotal = nw.liabilities.reduce((s, x) => s + x.value, 0);
  const groups = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of nw.assets) m.set(a.group, (m.get(a.group) ?? 0) + a.value);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [nw.assets]);
  const accountById = new Map(data.wealthAccounts.map((a) => [a.id, a]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" onClick={() => setEditing({ account: { id: newAccountId("epf"), kind: "epf", name: "" }, isNew: true })}>
          <PlusIcon /> Add account
        </Button>
        <ImportDocument {...props} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Net worth" value={money(nw.total)} strong />
        <Stat label="Assets" value={money(assetsTotal)} />
        <Stat label="Liabilities" value={money(liabTotal)} />
      </div>

      {groups.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>What you own</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      )}

      <Lines title="Assets" lines={nw.assets} today={today} editable={accountById} onEdit={(a) => setEditing({ account: a, isNew: false })} />
      {nw.missingBalances.length > 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          No balance in alerts yet for {nw.missingBalances.join(", ")}. They'll appear once an alert includes one (after the next Sync).
        </p>
      )}
      <Lines title="Liabilities" lines={nw.liabilities} today={today} editable={accountById} onEdit={(a) => setEditing({ account: a, isNew: false })} />

      <Protection policies={data.policies} today={today} />
      <WhereToGet />

      {editing && (
        <EditAccount
          account={editing.account}
          isNew={editing.isNew}
          onClose={() => setEditing(null)}
          onSave={async (account, value, date) => {
            try {
              const files = manualBalance(data, account, value, date);
              // Keep edits to name/institution made in the dialog.
              files[PATHS.wealthAccounts] = (files[PATHS.wealthAccounts] as WealthAccount[]).map((a) => (a.id === account.id ? account : a));
              await store.writeJSON(files, `${editing.isNew ? "Add" : "Update"} ${account.name}`);
              await reload();
              setEditing(null);
              toast.success(`${account.name}: ${money(value)}`);
            } catch (e) {
              toast.error("Couldn't save", { description: (e as Error).message });
            }
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Card className="gap-1 px-6">
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
}

function Lines({ title, lines, today, editable, onEdit }: LinesProps) {
  if (!lines.length) return null;
  return (
    <Card className="py-0">
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">{title}</TableHead>
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
                  <TableCell className="pl-6 whitespace-normal">
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

function EditAccount({
  account,
  isNew,
  onClose,
  onSave,
}: {
  account: WealthAccount;
  isNew: boolean;
  onClose: () => void;
  onSave: (account: WealthAccount, value: number, date: string) => Promise<void>;
}) {
  const [a, setA] = useState(account);
  const [value, setValue] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const amount = Number(value.replace(/,/g, ""));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            await onSave({ ...a, name: a.name.trim() || WEALTH_KINDS[a.kind].label }, amount, date);
            setBusy(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>{isNew ? "Add account" : `Update ${account.name}`}</DialogTitle>
            <DialogDescription>
              {isNew ? "For anything not in your email or a document. " : ""}Enter the balance as of a date; for loans, the principal outstanding.
            </DialogDescription>
          </DialogHeader>
          {isNew && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={a.kind} onValueChange={(k) => setA({ ...a, kind: k as WealthKind, id: newAccountId(k as WealthKind) })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(WEALTH_KINDS) as WealthKind[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {WEALTH_KINDS[k].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inst">Institution</Label>
                <Input id="inst" placeholder="EPFO, SBI, HDFC…" value={a.institution ?? ""} onChange={(e) => setA({ ...a, institution: e.target.value })} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" placeholder={WEALTH_KINDS[a.kind].label} value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} />
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="value">{WEALTH_KINDS[a.kind].liability ? "Outstanding" : "Balance"} (₹)</Label>
              <Input id="value" autoFocus inputMode="decimal" className="tabular-nums" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="date">As of</Label>
              <Input id="date" type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={busy || !(amount >= 0) || value === ""}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Protection({ policies, today }: { policies: ViewProps["data"]["policies"]; today: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldIcon className="size-4" /> Insurance
        </CardTitle>
        <CardDescription>Not part of net worth. Import a policy document to track cover and renewals.</CardDescription>
      </CardHeader>
      <CardContent>
        {policies.length ? (
          <ul className="divide-y text-sm">
            {[...policies]
              .sort((a, b) => (a.renewalDate ?? "9999").localeCompare(b.renewalDate ?? "9999"))
              .map((p) => {
                const soon = p.renewalDate && p.renewalDate >= today && Date.parse(p.renewalDate) - Date.parse(today) < 45 * 86_400_000;
                return (
                  <li key={`${p.insurer}-${p.policyRef}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">
                        {p.insurer} <span className="font-normal text-muted-foreground">· {p.type.replace("_", " ")}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">{[p.policyRef, p.insured].filter(Boolean).join(" · ")}</div>
                    </div>
                    {p.cover && <span className="tabular-nums">{money(p.cover)} cover</span>}
                    {p.premium && <span className="tabular-nums text-muted-foreground">{money(p.premium)} premium</span>}
                    {p.renewalDate && (
                      <Badge variant={soon ? "default" : "outline"} className="font-normal">
                        Renews {day(p.renewalDate)}
                      </Badge>
                    )}
                  </li>
                );
              })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No policies yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

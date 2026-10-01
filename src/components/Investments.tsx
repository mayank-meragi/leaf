import { useMemo, useRef, useState } from "react";
import { InfoIcon, Loader2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ViewProps } from "@/App";
import { statementPath } from "@/lib/db";
import { amcLabel, day, money, pct } from "@/lib/format";
import { parseCAS } from "@/lib/parsers/cas/parse";
import { capitalGains } from "@/lib/capitalGains";
import { pnl as computePnL } from "@/lib/pnl";
import { isCompleteStatement, schemeKey, summarize } from "@/lib/portfolio";
import { sips } from "@/lib/sips";
import { cn } from "@/lib/utils";
import Allocation from "./Allocation";
import CapitalGains from "./CapitalGains";
import SchemeDetail from "./SchemeDetail";
import SipTracker from "./SipTracker";
import Goals from "./Goals";
import PlanMix from "./PlanMix";
import Performance from "./Performance";
import Rebalance from "./Rebalance";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Investments({ store, data, reload, setData }: ViewProps) {
  const summary = useMemo(() => summarize(data.statements), [data.statements]);
  const cg = useMemo(() => capitalGains(data.statements), [data.statements]);
  const pnl = useMemo(() => computePnL(data.statements, cg), [data.statements, cg]);
  const sipPlans = useMemo(() => sips(data.statements).plans, [data.statements]);
  const [selected, setSelected] = useState<string | null>(null);
  const detail = summary.schemes.find((x) => x.name === selected) ?? null;
  const [busy, setBusy] = useState(false);
  // A PDF waiting for a password the saved one didn't open.
  const [locked, setLocked] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const importFile = async (file: File, pw = data.config.casPassword) => {
    setBusy(true);
    try {
      const stmt = /\.xlsx$/i.test(file.name) ? await fromXlsx(file) : await fromPdf(file, pw);
      if (!stmt) return; // waiting on a password
      if (!isCompleteStatement(stmt))
        throw new Error("This isn't a full consolidated statement (no statement period or folios). Upload a detailed CAS from CAMS, KFintech or MF Central.");
      await store.writeJSON({ [statementPath(stmt)]: stmt }, `Add CAS statement ${file.name}`);
      await reload();
      toast.success(`Imported ${stmt.folios.length} folios from ${file.name}`);
    } catch (e) {
      toast.error(`Couldn't import ${file.name}`, { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const fromXlsx = async (file: File) => {
    const { isMFCentralWorkbook, parseMFCentral, readWorkbook } = await import("@/lib/parsers/cas/mfcentral");
    const sheets = await readWorkbook(file);
    if (!isMFCentralWorkbook(sheets)) throw new Error("Unrecognised spreadsheet. Upload the CAS detailed report from MF Central.");
    return parseMFCentral(sheets, { kind: "upload", fileName: file.name });
  };

  const fromPdf = async (file: File, pw: string | undefined) => {
    const { pdfToLines, WrongPasswordError } = await import("@/lib/parsers/cas/pdf");
    try {
      const lines = await pdfToLines(new Uint8Array(await file.arrayBuffer()), pw);
      return parseCAS(lines, { kind: "upload", fileName: file.name });
    } catch (e) {
      if (!(e instanceof WrongPasswordError)) throw e;
      if (pw !== data.config.casPassword) toast.error("That password didn't work.");
      setLocked(file);
      return null;
    }
  };

  const partial = summary.schemes.filter((x) => !x.fullHistory);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{summary.asOf ? `Valued as of ${day(summary.asOf)}` : "No statements yet"}</p>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importFile(f);
            e.target.value = "";
          }}
        />
        <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
          Upload CAS
        </Button>
      </div>

      {summary.schemes.length ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Current value" value={money(summary.value)} />
            <Stat label="Invested" value={money(summary.cost)} />
            <Stat
              label="Gain"
              value={money(summary.value - summary.cost)}
              sub={summary.cost ? pct((summary.value - summary.cost) / summary.cost) : undefined}
              tone={summary.value >= summary.cost ? "positive" : "negative"}
            />
            <Stat
              label="XIRR"
              value={summary.xirr == null ? "—" : pct(summary.xirr).replace("+", "")}
              sub={
                summary.xirr == null
                  ? "Needs full transaction history"
                  : summary.xirrCoverage < 0.999
                    ? `Covers ${Math.round(summary.xirrCoverage * 100)}% of current value`
                    : "Annualised, all holdings"
              }
              tone={summary.xirr == null ? undefined : summary.xirr >= 0 ? "positive" : "negative"}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Stat
              label="Unrealised gain"
              value={money(summary.value - summary.cost)}
              sub="On what you still hold"
              tone={summary.value >= summary.cost ? "positive" : "negative"}
            />
            <Stat
              label="Realised gain"
              value={money(pnl.realised)}
              sub={cg.unmatched.length ? "Excludes sales of units bought before the statement" : "From redemptions and switches, all time"}
              tone={pnl.realised >= 0 ? "positive" : "negative"}
            />
            <Stat label="Dividends" value={money(pnl.dividends)} sub="Paid out or reinvested" />
          </div>

          <Tabs defaultValue="holdings" className="gap-4">
            <TabsList>
              <TabsTrigger value="holdings">Holdings</TabsTrigger>
              <TabsTrigger value="income">SIPs &amp; gains</TabsTrigger>
              <TabsTrigger value="performance">Performance</TabsTrigger>
              <TabsTrigger value="plan">Plan</TabsTrigger>
            </TabsList>

            <TabsContent value="holdings" className="space-y-4">
          {partial.length > 0 && (
            <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
              <InfoIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p>
                <b>
                  {partial.length} of {summary.schemes.length} schemes
                </b>{" "}
                were bought before this statement starts{summary.historyFrom ? ` (${day(summary.historyFrom)})` : ""}, so their XIRR
                can't be worked out honestly. Upload a statement that goes back to your first investment: on MF Central pick the
                earliest <i>From</i> date, or request a CAMS CAS <i>since inception</i>.
              </p>
            </div>
          )}

          <Allocation schemes={summary.schemes} />

          <Card className="py-0">
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Scheme</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="text-right">NAV</TableHead>
                    <TableHead className="text-right">Invested</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="pr-6 text-right">XIRR</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.schemes.map((r) => (
                    <TableRow key={r.name} className="cursor-pointer" onClick={() => setSelected(r.name)}>
                      <TableCell className="pl-6 whitespace-normal">
                        <div className="font-medium">{r.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {[r.equityStyle ?? r.assetClass, amcLabel(r.amc), r.folios.length > 1 ? `${r.folios.length} folios` : `Folio ${r.folios[0]}`].join(" · ")}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.units.toFixed(3)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.nav?.toFixed(2) ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.cost ? money(r.cost) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(r.value)}
                        {r.cost > 0 && (
                          <div className={cn("text-xs", r.value >= r.cost ? "text-positive" : "text-destructive")}>{pct((r.value - r.cost) / r.cost)}</div>
                        )}
                      </TableCell>
                      <TableCell
                        className={cn("pr-6 text-right tabular-nums", r.xirr != null && (r.xirr >= 0 ? "text-positive" : "text-destructive"))}
                        title={r.fullHistory ? undefined : "Bought before this statement starts; upload a statement with full history"}
                      >
                        {r.xirr == null ? <span className="text-muted-foreground">—</span> : pct(r.xirr).replace("+", "")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

            </TabsContent>

            <TabsContent value="income" className="space-y-4">
          <SipTracker statements={data.statements} onOpen={(name) => setSelected(summary.schemes.find((x) => schemeKey(x.name) === schemeKey(name))?.name ?? null)} />

          <CapitalGains statements={data.statements} />
            </TabsContent>

            <TabsContent value="performance">
              <Performance store={store} data={data} setData={setData} />
            </TabsContent>

            <TabsContent value="plan" className="space-y-4">
              <Rebalance store={store} data={data} setData={setData} schemes={summary.schemes} />
              <Goals store={store} data={data} setData={setData} schemes={summary.schemes} />
              <PlanMix schemes={summary.schemes} />
            </TabsContent>
          </Tabs>
        </>
      ) : (
        <Card className="py-16 text-center text-sm text-muted-foreground">
          <p>
            No mutual fund data yet. Request a <b>detailed</b> CAS from{" "}
            <a
              className="font-medium text-primary underline underline-offset-4"
              href="https://www.camsonline.com/Investors/Statements/Consolidated-Account-Statement"
              target="_blank"
              rel="noreferrer"
            >
              CAMS
            </a>{" "}
            to one of your connected inboxes and Sync, or upload the PDF here. The detailed report XLSX from{" "}
            <a className="font-medium text-primary underline underline-offset-4" href="https://app.mfcentral.com" target="_blank" rel="noreferrer">
              MF Central
            </a>{" "}
            works too.
          </p>
        </Card>
      )}

      <SchemeDetail
        scheme={detail}
        cg={cg}
        pnl={pnl}
        plan={detail ? sipPlans.find((p) => schemeKey(p.scheme) === schemeKey(detail.name)) : undefined}
        onClose={() => setSelected(null)}
      />

      <Dialog
        open={!!locked}
        onOpenChange={(open) => {
          if (!open) {
            setLocked(null);
            setPassword("");
          }
        }}
      >
        <DialogContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const file = locked!;
              setLocked(null);
              importFile(file, password);
              setPassword("");
            }}
          >
            <DialogHeader>
              <DialogTitle>Password needed</DialogTitle>
              <DialogDescription>
                {locked?.name} is locked. CAMS and KFintech use your PAN in capitals. Save it in Settings to skip this next time.
              </DialogDescription>
            </DialogHeader>
            <Input autoFocus type="password" className="font-mono" value={password} onChange={(e) => setPassword(e.target.value.trim())} />
            <DialogFooter>
              <Button disabled={!password}>Unlock</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "positive" | "negative" }) {
  return (
    <Card className="gap-1 px-6">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-2xl font-semibold tabular-nums tracking-tight", tone === "positive" && "text-positive", tone === "negative" && "text-destructive")}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}

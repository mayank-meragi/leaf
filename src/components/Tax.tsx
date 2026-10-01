import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ViewProps } from "@/App";
import { capitalGains, gainYears, summarizeFY } from "@/lib/capitalGains";
import { money, monthLabel } from "@/lib/format";
import { isSalaryCredit, payMonthOf } from "@/lib/income";
import { cn } from "@/lib/utils";
import { financialYear } from "@/lib/wealth";
import CapitalGains from "./CapitalGains";
import SectionCard from "./SectionCard";
import WhereToGet from "./WhereToGet";

const TABS = [
  { value: "income", label: "Income" },
  { value: "gains", label: "Capital gains" },
  { value: "documents", label: "Documents" },
] as const;

/** One financial year at a time: what you earned, what tax came off it, what you made selling funds, and the papers behind it. */
export default function Tax(props: ViewProps) {
  const { data } = props;
  const currentFy = financialYear(new Date().toISOString().slice(0, 10));
  const cg = useMemo(() => capitalGains(data.statements), [data.statements]);
  const years = useMemo(() => {
    const fys = new Set([
      currentFy,
      ...gainYears(cg),
      ...data.payslips.map((p) => financialYear(`${p.month}-01`)),
      ...data.taxDocs.map((d) => d.fy),
      ...data.transactions.filter(isSalaryCredit).map((t) => financialYear(`${payMonthOf(t, data.payslips)}-01`)),
    ]);
    return [...fys].sort().reverse();
  }, [data, cg, currentFy]);
  const [fy, setFy] = useState(currentFy);

  // Grouped by the month the pay is for (March's salary, paid 2 April, belongs to the earlier FY).
  const salary = data.transactions
    .filter(isSalaryCredit)
    .map((t) => ({ ...t, payMonth: payMonthOf(t, data.payslips) }))
    .filter((t) => financialYear(`${t.payMonth}-01`) === fy);
  const slips = data.payslips.filter((p) => financialYear(`${p.month}-01`) === fy);
  const form16 = data.taxDocs.filter((d) => d.fy === fy);
  const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
  const tds = form16.find((d) => d.tds)?.tds ?? sum(slips, (p) => p.tds);
  const slipMonths = new Set(slips.map((p) => p.month));
  const missing = [...new Set(salary.map((t) => t.payMonth))].filter((m) => !slipMonths.has(m)).sort();
  const gains = useMemo(() => summarizeFY(cg, fy), [cg, fy]);
  const realised = gains.equityShort + gains.equityLong + gains.otherShort + gains.otherLong;
  const hasGains = cg.lots.some((l) => l.fy === fy);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Select value={fy} onValueChange={setFy}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={y}>
                FY {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Salary received"
          value={money(sum(salary, (t) => t.amount))}
          sub={`${salary.length} month${salary.length === 1 ? "" : "s"} of pay`}
        />
        <Stat label="Tax deducted (TDS)" value={tds ? money(tds) : "—"} sub={form16.some((d) => d.tds) ? "from Form 16" : slips.length ? "from payslips" : "Import payslips or Form 16"} />
        <Stat
          label="Capital gains"
          value={hasGains ? money(realised) : "—"}
          tone={hasGains ? (realised > 0 ? "positive" : realised < 0 ? "negative" : undefined) : undefined}
          sub={hasGains ? `Est. ${money(gains.equityTax)} tax on equity` : "No sales this year"}
        />
        <Stat
          label="PF contributed"
          value={slips.length ? money(sum(slips, (p) => p.pfEmployee + p.pfEmployer)) : "—"}
          sub={slips.length ? `you ${money(sum(slips, (p) => p.pfEmployee))} · employer ${money(sum(slips, (p) => p.pfEmployer))}` : undefined}
        />
      </div>

      <Tabs defaultValue="income" className="gap-4">
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="income" className="space-y-4">
          {missing.length > 0 && (
            <p className="px-1 text-sm text-muted-foreground">Salary arrived but no payslip yet for {missing.map((m) => monthLabel(m)).join(", ")} pay.</p>
          )}
          <Card className="py-0">
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Payslip</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">TDS</TableHead>
                    <TableHead className="text-right">PF (you + employer)</TableHead>
                    <TableHead className="pr-4 text-right">Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slips.length ? (
                    slips.map((p) => (
                      <TableRow key={`${p.month}-${p.employer}`}>
                        <TableCell className="pl-4">
                          <div className="font-medium">{monthLabel(p.month)}</div>
                          <div className="text-xs text-muted-foreground">{p.employer}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{money(p.gross)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(p.tds)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(p.pfEmployee + p.pfEmployer)}</TableCell>
                        <TableCell className="pr-4 text-right tabular-nums">{money(p.net)}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                        No payslips for FY {fy}. They weren't in your connected inboxes; they may be in your work email.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="gains">
          <CapitalGains statements={data.statements} fy={fy} />
        </TabsContent>

        <TabsContent value="documents" className="space-y-4">
          <SectionCard title="Form 16" subtitle={`FY ${fy}`}>
            {form16.length ? (
              <ul className="divide-y divide-border/60 text-sm">
                {form16.map((d) => (
                  <li key={`${d.kind}-${d.employer}`} className="flex flex-wrap gap-x-6 gap-y-1 py-2">
                    <span className="flex-1 font-medium">{d.employer ?? "Form 16"}</span>
                    {d.grossSalary && <span className="tabular-nums">Gross {money(d.grossSalary)}</span>}
                    {d.taxableIncome && <span className="tabular-nums">Taxable {money(d.taxableIncome)}</span>}
                    {d.tds && <span className="tabular-nums">TDS {money(d.tds)}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">None yet. Use Import (top right) once you have it.</p>
            )}
          </SectionCard>
          <WhereToGet only={["Payslips & Form 16", "Tax (AIS / 26AS)"]} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "positive" | "negative" }) {
  return (
    <Card className="gap-1 px-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-2xl font-semibold tabular-nums tracking-tight", tone === "positive" && "text-positive", tone === "negative" && "text-destructive")}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}

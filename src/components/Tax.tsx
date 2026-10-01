import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ViewProps } from "@/App";
import { money, monthLabel } from "@/lib/format";
import { isSalaryCredit, payMonthOf } from "@/lib/income";
import { financialYear } from "@/lib/wealth";
import ImportDocument from "./ImportDocument";
import WhereToGet from "./WhereToGet";

export default function IncomeTax(props: ViewProps) {
  const { data } = props;
  const currentFy = financialYear(new Date().toISOString().slice(0, 10));
  const years = useMemo(() => {
    const fys = new Set([
      currentFy,
      ...data.payslips.map((p) => financialYear(`${p.month}-01`)),
      ...data.taxDocs.map((d) => d.fy),
      ...data.transactions.filter(isSalaryCredit).map((t) => financialYear(`${payMonthOf(t, data.payslips)}-01`)),
    ]);
    return [...fys].sort().reverse();
  }, [data, currentFy]);
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
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
        <ImportDocument {...props} label="Import payslip / Form 16" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Salary received"
          value={money(sum(salary, (t) => t.amount))}
          sub={`${salary.length} month${salary.length === 1 ? "" : "s"} of pay · from payroll emails and bank alerts`}
        />
        <Stat label="Gross pay" value={slips.length ? money(sum(slips, (p) => p.gross)) : "—"} sub={slips.length ? `${slips.length} payslips` : "Import payslips"} />
        <Stat label="Tax deducted (TDS)" value={tds ? money(tds) : "—"} sub={form16.some((d) => d.tds) ? "from Form 16" : slips.length ? "from payslips" : undefined} />
        <Stat
          label="PF contributed"
          value={slips.length ? money(sum(slips, (p) => p.pfEmployee + p.pfEmployer)) : "—"}
          sub={slips.length ? `you ${money(sum(slips, (p) => p.pfEmployee))} · employer ${money(sum(slips, (p) => p.pfEmployer))}` : undefined}
        />
      </div>

      {missing.length > 0 && (
        <p className="px-1 text-sm text-muted-foreground">
          Salary arrived but no payslip yet for {missing.map((m) => monthLabel(m)).join(", ")} pay.
        </p>
      )}

      <Card className="py-0">
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Payslip</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">TDS</TableHead>
                <TableHead className="text-right">PF (you + employer)</TableHead>
                <TableHead className="pr-6 text-right">Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slips.length ? (
                slips.map((p) => (
                  <TableRow key={`${p.month}-${p.employer}`}>
                    <TableCell className="pl-6">
                      <div className="font-medium">{monthLabel(p.month)}</div>
                      <div className="text-xs text-muted-foreground">{p.employer}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(p.gross)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(p.tds)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(p.pfEmployee + p.pfEmployer)}</TableCell>
                    <TableCell className="pr-6 text-right tabular-nums">{money(p.net)}</TableCell>
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

      <Card>
        <CardHeader>
          <CardTitle>Tax documents</CardTitle>
          <CardDescription>Form 16 for FY {fy}</CardDescription>
        </CardHeader>
        <CardContent>
          {form16.length ? (
            <ul className="divide-y text-sm">
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
            <p className="text-sm text-muted-foreground">None yet.</p>
          )}
        </CardContent>
      </Card>

      <WhereToGet only={["Payslips & Form 16", "Tax (AIS / 26AS)"]} />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="gap-1 px-6">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}

import { useMemo } from "react";
import { DownloadIcon, InfoIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CASStatement } from "@/types";
import { capitalGains, gainsCSV, summarizeFY } from "@/lib/capitalGains";
import { day, money } from "@/lib/format";
import { cn } from "@/lib/utils";
import SectionCard from "./SectionCard";

const tone = (n: number) => (n > 0 ? "text-positive" : n < 0 ? "text-destructive" : undefined);

export default function CapitalGains({ statements, fy }: { statements: CASStatement[]; fy: string }) {
  const cg = useMemo(() => capitalGains(statements), [statements]);
  const s = useMemo(() => summarizeFY(cg, fy), [cg, fy]);
  const lots = useMemo(() => cg.lots.filter((l) => l.fy === fy), [cg, fy]);

  if (!lots.length && !s.unmatched) {
    return (
      <SectionCard title="Capital gains" description={`No redemptions or switch-outs in FY ${fy}.`}>
        <p className="text-sm text-muted-foreground">Gains show up here once your statements include a sale in this financial year.</p>
      </SectionCard>
    );
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([gainsCSV(cg, fy)], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `capital-gains-${fy}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  const exempt = Math.min(s.exemption, Math.max(0, s.equityLong));

  return (
    <SectionCard
      title="Capital gains"
      subtitle={`FY ${fy}`}
      description="Realised gains from redemptions and switches, matched first-in-first-out."
      action={
        <Button variant="outline" size="sm" onClick={download}>
          <DownloadIcon />
          CSV
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Equity short term" value={s.equityShort} sub="Sold within 12 months" />
          <Tile
            label="Equity long term"
            value={s.equityLong}
            sub={`${money(exempt)} of ${money(s.exemption)} exemption used · ${money(s.equityLongTaxable)} taxable`}
          />
          <Tile label="Debt & gold, short term" value={s.otherShort} sub="Taxed at your slab rate" />
          <Tile label="Debt & gold, long term" value={s.otherLong} sub="Older holdings; indexation not applied" />
        </div>

        <p className="text-sm text-muted-foreground">
          Estimated tax on equity gains: <b className="text-foreground tabular-nums">{money(s.equityTax)}</b> before cess. Sold for{" "}
          {money(s.proceeds)} against a cost of {money(s.cost)}.
        </p>

        {s.unmatched > 0 && (
          <Note>
            <b>{money(s.unmatched)}</b> of sales this year came from units bought before your statement begins, so their cost is unknown and they
            aren't counted above. Upload a statement going back to your first investment to include them.
          </Note>
        )}
        {s.grandfatheringLots > 0 && (
          <Note>
            {s.grandfatheringLots} equity lot{s.grandfatheringLots === 1 ? " was" : "s were"} bought before 1 Feb 2018. Their cost should be stepped up to the
            31 Jan 2018 NAV (when that's higher than the real cost and lower than the sale price), which reduces the gain. Marked <i>GF</i> below.
          </Note>
        )}

        {lots.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Scheme</TableHead>
                <TableHead>Bought</TableHead>
                <TableHead>Sold</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Proceeds</TableHead>
                <TableHead className="text-right">Gain</TableHead>
                <TableHead className="text-right">Term</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lots.map((l, i) => (
                <TableRow key={i}>
                  <TableCell className="whitespace-normal">{l.scheme}</TableCell>
                  <TableCell className="whitespace-nowrap">{day(l.buyDate)}</TableCell>
                  <TableCell className="whitespace-nowrap">{day(l.sellDate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.units.toFixed(3)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(l.cost)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(l.proceeds)}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", tone(l.gain))}>{money(l.gain)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {l.term === "long" ? "Long" : "Short"}
                    {l.regime === "slab" && <span className="text-muted-foreground"> · slab</span>}
                    {l.grandfathering && <span className="text-amber-600 dark:text-amber-400" title="Bought before 1 Feb 2018"> · GF</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <p className="text-xs text-muted-foreground">
          An estimate from your statements, not tax advice. Hybrid funds are treated as equity-oriented, debt funds bought on or after 1 Apr 2023 as
          short term at slab rate, and equity rates change on 23 Jul 2024 (15%/10% before, 20%/12.5% after). Check against your AMC's capital
          gains statement before filing.
        </p>
      </div>
    </SectionCard>
  );
}

function Tile({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-lg border px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-xl font-semibold tabular-nums tracking-tight", tone(value))}>{money(value)}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
      <InfoIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <p>{children}</p>
    </div>
  );
}

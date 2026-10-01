import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ViewProps } from "@/App";
import { monthLabel } from "@/lib/format";
import { instruments, cardRecords, KIND_LABEL, KIND_ORDER, withInstrumentMeta } from "@/lib/instruments";
import { activeMonth, sourcesWithStatus } from "@/lib/spendingSources";
import { useSaveConfig } from "@/lib/useConfig";
import type { InstrumentKind } from "@/types";
import SectionCard from "./SectionCard";
import SourceTile from "./SourceTile";

/** Every card and account Leaf found in your alerts: where each stands, and how it's named. */
export default function CardsAccounts({ onOpenSource, ...props }: ViewProps & { onOpenSource: (key: string) => void }) {
  const { data } = props;
  const { busy, saveConfig } = useSaveConfig(props);
  const today = new Date().toISOString().slice(0, 10);
  const month = useMemo(() => activeMonth(data.transactions, today), [data.transactions, today]);
  const active = useMemo(() => sourcesWithStatus(data, month, today), [data, month, today]);
  // Includes old and closed ones, so any can be renamed or retyped.
  const all = useMemo(
    () => instruments(data.transactions, data.config, cardRecords(data.cardStatements, data.cardPayments)),
    [data.transactions, data.config, data.cardStatements, data.cardPayments],
  );
  const { config } = data;

  return (
    <div className="space-y-4">
      {active.length > 0 && (
        <SectionCard title="Right now" subtitle={monthLabel(month)} description="Card spends since each statement; balances as of the latest alert. Open one to see its transactions.">
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((s) => (
              <li key={s.key}>
                <SourceTile source={s} monthName={monthLabel(month).split(" ")[0]} today={today} onOpen={() => onOpenSource(s.key)} />
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <SectionCard
        title="Names and types"
        description="Found in your alerts. Leaf guesses the type from the wording; fix it here and give each a name you'll recognise."
      >
        {all.length ? (
          <ul className="divide-y divide-border/60">
            {all.map((i) => (
              <li key={i.key} className="flex flex-wrap items-center gap-2 py-2">
                <span className="w-28 shrink-0 text-sm tabular-nums text-muted-foreground">
                  {i.issuerLabel} ••{i.last4}
                </span>
                <Input
                  className="h-8 min-w-32 flex-1"
                  placeholder={`${i.issuerLabel} ${KIND_LABEL[i.kind]}`}
                  defaultValue={i.nickname ?? ""}
                  disabled={busy}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name !== (i.nickname ?? "")) saveConfig(withInstrumentMeta(config, i.key, { name }), `Rename ${i.key}`);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                />
                <Select
                  value={i.kind}
                  disabled={busy}
                  onValueChange={(kind) => saveConfig(withInstrumentMeta(config, i.key, { kind: kind as InstrumentKind }), `Set ${i.key} type`)}
                >
                  <SelectTrigger size="sm" className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KIND_ORDER.map((k) => (
                      <SelectItem key={k} value={k}>
                        {KIND_LABEL[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">None yet. They appear after a sync.</p>
        )}
      </SectionCard>
    </div>
  );
}

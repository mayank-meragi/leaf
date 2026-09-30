import { AlertCircleIcon, CheckCircle2Icon, CreditCardIcon, LandmarkIcon, WalletIcon } from "lucide-react";
import { day, money } from "@/lib/format";
import { KIND_LABEL, type Instrument, type SourceStatus } from "@/lib/instruments";
import { cn } from "@/lib/utils";

interface Props {
  source: Instrument & SourceStatus & { out: number; in: number };
  monthName: string;
  today: string;
  onOpen: () => void;
}

const daysUntil = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
const shortDay = (iso: string) => day(iso).replace(/ \d{4}$/, "");

export default function SourceTile({ source: s, monthName, today, onOpen }: Props) {
  const isCard = s.kind === "credit_card" || s.kind === "debit_card" || s.kind === "card";
  const isCredit = s.kind === "credit_card" || (s.kind === "card" && !!s.bill);
  const Icon = s.kind === "bank_account" ? LandmarkIcon : s.kind === "wallet" ? WalletIcon : CreditCardIcon;

  return (
    <button
      onClick={onOpen}
      className="flex h-full w-full flex-col rounded-lg border p-3 text-left transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {KIND_LABEL[s.kind]} ••{s.last4}
      </div>
      <div className="mt-1 truncate text-sm font-medium">{s.nickname ?? `${s.issuerLabel} ${KIND_LABEL[s.kind]}`}</div>

      <div className="mt-3 flex-1">
        {isCredit && s.count === 0 && s.bill ? (
          // No spend alerts: unbilled would read ₹0, so lead with the bill instead.
          <Figure value={money(s.bill.totalDue)} caption={`bill from ${shortDay(s.bill.statementDate)}`} />
        ) : isCredit && s.unbilled ? (
          <Figure value={money(s.unbilled.amount)} caption={`unbilled since ${shortDay(s.unbilled.since)}`} />
        ) : isCard ? (
          <Figure value={money(s.out)} caption={`spent in ${monthName}`} />
        ) : s.balance ? (
          <Figure
            value={money(s.balance.amount)}
            caption={s.balance.adjusted ? `est. balance · last stated ${shortDay(s.balance.reportedOn)}` : `balance · ${shortDay(s.balance.asOf)}`}
          />
        ) : (
          <Figure value={money(s.out)} caption={`out in ${monthName}`} />
        )}
      </div>

      <div className="mt-2 space-y-0.5 text-xs text-muted-foreground tabular-nums">
        {s.bill && <Bill bill={s.bill} today={today} />}
        {isCredit && s.balance && <div>{money(s.balance.amount)} limit available</div>}
        {isCredit && !s.bill && <div>No statement found yet: showing the calendar month</div>}
        {isCredit && s.count === 0 && <div>This card doesn't email spend alerts; only its bills are tracked</div>}
        {s.kind === "bank_account" && (
          <div>
            {monthName}: {money(s.out)} out{s.in > 0 && <span className="text-positive"> · {money(s.in)} in</span>}
            {!s.balance && <div>Balance not in these alerts</div>}
          </div>
        )}
      </div>
    </button>
  );
}

function Figure({ value, caption }: { value: string; caption: string }) {
  return (
    <div>
      <div className="text-lg font-semibold tabular-nums tracking-tight">{value}</div>
      <div className="text-xs text-muted-foreground">{caption}</div>
    </div>
  );
}

function Bill({ bill, today }: { bill: NonNullable<SourceStatus["bill"]>; today: string }) {
  const left = bill.dueDate ? daysUntil(today, bill.dueDate) : null;
  return (
    <div className="flex items-center gap-1.5">
      <span>Bill {money(bill.totalDue)}</span>
      {bill.state === "paid" ? (
        <span className="flex items-center gap-1 text-positive">
          <CheckCircle2Icon className="size-3" /> Paid{bill.paidOn && ` ${shortDay(bill.paidOn)}`}
        </span>
      ) : bill.state === "partial" ? (
        <span>
          {money(bill.paid)} paid · {money(bill.totalDue - bill.paid)} left
        </span>
      ) : (
        <span className={cn("flex items-center gap-1", bill.state === "overdue" && "text-destructive")}>
          {bill.state === "overdue" && <AlertCircleIcon className="size-3" />}
          {bill.state === "overdue"
            ? `Overdue since ${shortDay(bill.dueDate!)}`
            : left == null
              ? "Due"
              : left === 0
                ? "Due today"
                : `Due in ${left} day${left === 1 ? "" : "s"}`}
        </span>
      )}
    </div>
  );
}

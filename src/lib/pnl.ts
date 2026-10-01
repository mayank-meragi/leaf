import type { CASStatement } from "@/types";
import type { CapitalGains } from "./capitalGains";
import { groupSchemes } from "./capitalGains";
import { schemeKey } from "./portfolio";

export interface SchemePnL {
  /** Gains locked in by redemptions and switches (cost known only). */
  realised: number;
  /** Dividends paid out or reinvested. */
  dividends: number;
}

export interface PnL {
  byScheme: Map<string, SchemePnL>;
  realised: number;
  dividends: number;
}

const empty = (): SchemePnL => ({ realised: 0, dividends: 0 });

/** Realised gains and dividends, all time, keyed by `schemeKey`. Includes schemes you've fully exited. */
export function pnl(statements: CASStatement[], cg: CapitalGains): PnL {
  const byScheme = new Map<string, SchemePnL>();
  const at = (name: string) => {
    const k = schemeKey(name);
    let e = byScheme.get(k);
    if (!e) byScheme.set(k, (e = empty()));
    return e;
  };
  for (const l of cg.lots) at(l.scheme).realised += l.gain;
  for (const g of groupSchemes(statements))
    for (const t of g.txns) if (t.type === "DIVIDEND_PAYOUT" || t.type === "DIVIDEND_REINVEST") at(g.name).dividends += Math.abs(t.amount ?? 0);
  const all = [...byScheme.values()];
  return {
    byScheme,
    realised: all.reduce((s, x) => s + x.realised, 0),
    dividends: all.reduce((s, x) => s + x.dividends, 0),
  };
}

export const noPnL = empty;

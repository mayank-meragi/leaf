import { ASSET_CLASSES, breakdown, type AssetClass, type SchemeSummary } from "./portfolio";

export type Targets = Partial<Record<AssetClass, number>>;

export interface RebalanceRow {
  cls: AssetClass;
  value: number;
  share: number;
  /** Target in percent; undefined when none is set. */
  target?: number;
  /** Percentage points above (+) or below (−) the target. */
  drift: number;
  /** Buy (+) or sell (−) to land exactly on target with no new money. */
  toTarget: number;
  /** Where new money should go to close the gap without selling. */
  newMoney: number;
}

export const targetTotal = (t: Targets) => ASSET_CLASSES.reduce((s, c) => s + (t[c] ?? 0), 0);

/** `extra` adds holdings that aren't mutual funds (e.g. directly held stocks) to their asset class. */
export function rebalance(schemes: SchemeSummary[], targets: Targets, newMoney = 0, extra: Partial<Record<AssetClass, number>> = {}): RebalanceRow[] {
  const slices = new Map(breakdown(schemes, (s) => s.assetClass).map((s) => [s.key, s]));
  for (const c of ASSET_CLASSES) {
    const v = extra[c] ?? 0;
    if (v > 0) slices.set(c, { key: c, value: (slices.get(c)?.value ?? 0) + v, share: 0 });
  }
  const total = [...slices.values()].reduce((s, x) => s + x.value, 0);
  const classes = ASSET_CLASSES.filter((c) => slices.has(c) || (targets[c] ?? 0) > 0);
  const t = (c: AssetClass) => (targets[c] ?? 0) / 100;

  // New money first fills each class's shortfall against the post-contribution total; if that's more than we have, scale down.
  const after = total + newMoney;
  const shortfall = new Map(classes.map((c) => [c, Math.max(0, t(c) * after - (slices.get(c)?.value ?? 0))]));
  const need = [...shortfall.values()].reduce((a, b) => a + b, 0);
  const scale = need > newMoney && need > 0 ? newMoney / need : 1;

  return classes.map((cls) => {
    const value = slices.get(cls)?.value ?? 0;
    const share = total ? value / total : 0;
    const hasTarget = targets[cls] != null;
    return {
      cls,
      value,
      share,
      target: hasTarget ? targets[cls] : undefined,
      drift: hasTarget ? (share - t(cls)) * 100 : 0,
      toTarget: hasTarget ? t(cls) * total - value : 0,
      newMoney: newMoney > 0 && need > 0 ? (shortfall.get(cls) ?? 0) * scale : 0,
    };
  });
}

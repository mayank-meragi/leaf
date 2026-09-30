import type { LeafConfig, Transaction, TxnDirection } from "@/types";

export const DEFAULT_CATEGORIES = [
  "Food & Dining", "Groceries", "Shopping", "Transport", "Fuel", "Travel", "Bills & Utilities",
  "Rent", "Health", "Entertainment", "Subscriptions", "Education", "Investments", "Insurance",
  "EMI & Loans", "Transfers", "Salary", "Refunds", "Cash", "Fees & Charges", "Other",
];

export function allCategories(config: LeafConfig): string[] {
  const seen = new Set<string>();
  return [...DEFAULT_CATEGORIES, ...(config.categories ?? [])].filter((c) => {
    const k = c.toLowerCase();
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

/** "SWIGGY ", "Swiggy." and "swiggy" are the same counterparty. */
export function partyKey(description: string): string {
  return description.toLowerCase().replace(/[^a-z0-9@]+/g, " ").trim();
}

export function ruleFor(config: LeafConfig, t: Pick<Transaction, "description" | "direction">) {
  const party = partyKey(t.description);
  return config.categoryRules?.find((r) => r.party === party && r.direction === t.direction);
}

/** Overrides model-assigned categories with the user's rules. */
export function applyRules(config: LeafConfig, txns: Transaction[]): Transaction[] {
  if (!config.categoryRules?.length) return txns;
  return txns.map((t) => {
    const rule = ruleFor(config, t);
    return rule ? { ...t, category: rule.category } : t;
  });
}

export interface Recategorization {
  config: LeafConfig;
  /** Every transaction whose category changed (the edited one plus same-party history). */
  changed: Transaction[];
}

/**
 * Tags `target` with `category`, remembers it as a rule for that counterparty and direction,
 * and re-tags every past transaction with the same counterparty and direction.
 * Creates the category if it's new.
 */
export function recategorize(config: LeafConfig, all: Transaction[], target: Transaction, category: string): Recategorization {
  const name = category.trim();
  const existing = allCategories(config).find((c) => c.toLowerCase() === name.toLowerCase());
  const finalName = existing ?? name;
  const party = partyKey(target.description);
  const direction: TxnDirection = target.direction;

  const rules = (config.categoryRules ?? []).filter((r) => !(r.party === party && r.direction === direction));
  const next: LeafConfig = {
    ...config,
    categories: existing ? config.categories : [...(config.categories ?? []), finalName],
    // An empty party (unparsed description) would match every such transaction; don't make a rule for it.
    categoryRules: party ? [...rules, { party, direction, category: finalName }] : rules,
  };

  const changed = all
    .filter((t) => t.id === target.id || (party && t.direction === direction && partyKey(t.description) === party))
    .filter((t) => t.category !== finalName)
    .map((t) => ({ ...t, category: finalName }));

  return { config: next, changed };
}

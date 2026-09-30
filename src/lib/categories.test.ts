import { describe, expect, it } from "vitest";
import type { LeafConfig, Transaction } from "@/types";
import { allCategories, applyRules, partyKey, recategorize } from "./categories";

const cfg: LeafConfig = { version: 1, accounts: [] };
const t = (id: string, description: string, direction: "debit" | "credit" = "debit", category = "Other"): Transaction => ({
  id, description, direction, category, date: "2026-09-01", amount: 100, currency: "INR",
  source: { account: "a", messageId: id, parser: "gemini" },
});

describe("categories", () => {
  it("normalises counterparties", () => {
    expect(partyKey("SWIGGY. ")).toBe(partyKey("Swiggy"));
    expect(partyKey("rahul@okaxis")).toBe("rahul@okaxis");
  });

  it("recategorises same-party history in the same direction only", () => {
    const all = [t("1", "Rahul Sharma"), t("2", "RAHUL SHARMA"), t("3", "Rahul Sharma", "credit"), t("4", "Swiggy")];
    const rec = recategorize(cfg, all, all[0], "Rent");
    expect(rec.changed.map((x) => x.id)).toEqual(["1", "2"]);
    expect(rec.changed.every((x) => x.category === "Rent")).toBe(true);
    expect(rec.config.categoryRules).toEqual([{ party: "rahul sharma", direction: "debit", category: "Rent" }]);
    expect(rec.config.categories).toBeUndefined();
  });

  it("creates new categories case-insensitively and replaces the old rule", () => {
    const all = [t("1", "Gym Co")];
    const first = recategorize(cfg, all, all[0], "Fitness");
    expect(first.config.categories).toEqual(["Fitness"]);
    const second = recategorize(first.config, all, all[0], "fitness");
    expect(second.config.categories).toEqual(["Fitness"]);
    expect(second.config.categoryRules).toHaveLength(1);
    expect(allCategories(second.config)).toContain("Fitness");
  });

  it("applies rules to new transactions", () => {
    const { config } = recategorize(cfg, [], t("x", "Swiggy"), "Treats");
    expect(applyRules(config, [t("9", "SWIGGY", "debit", "Food & Dining")])[0].category).toBe("Treats");
    expect(applyRules(config, [t("9", "Swiggy", "credit", "Refunds")])[0].category).toBe("Refunds");
  });
});

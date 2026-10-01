import { describe, expect, it } from "vitest";
import { attentionItems } from "./attention";

const today = "2026-10-01";
const base = { today, bills: [], duplicates: [], missingBalances: [], staleLines: [] };
type Bill = Parameters<typeof attentionItems>[0]["bills"][number]["bill"];
const bill = (state: Bill["state"], dueDate: string, paid = 0) => ({ bill: { totalDue: 10000, paid, state, dueDate } as Bill });

describe("attentionItems", () => {
  it("is empty when nothing needs attention", () => {
    expect(attentionItems(base)).toEqual([]);
  });

  it("flags an overdue bill as danger and a bill due within a week as a warning", () => {
    const items = attentionItems({
      ...base,
      bills: [
        { key: "a", label: "A", bill: bill("overdue", "2026-09-25").bill },
        { key: "b", label: "B", bill: bill("due", "2026-10-04").bill },
        { key: "c", label: "C", bill: bill("due", "2026-10-20").bill },
        { key: "d", label: "D", bill: bill("paid", "2026-10-02").bill },
      ],
    });
    expect(items.map((i) => [i.id, i.tone])).toEqual([
      ["bill-a", "danger"],
      ["bill-b", "warn"],
    ]);
    expect(items[1].title).toBe("B bill due in 3 days");
  });

  it("shows only what is left on a partly paid bill", () => {
    const [item] = attentionItems({ ...base, bills: [{ key: "a", label: "A", bill: bill("partial", "2026-10-03", 4000).bill }] });
    expect(item.detail).toContain("6,000");
  });

  it("orders danger before warn before info and sends account issues to Net worth", () => {
    const items = attentionItems({
      ...base,
      missingBalances: ["Axis ••1"],
      duplicates: [[{ name: "EPF" }, { name: "EPF (old)" }]],
      bills: [{ key: "a", label: "A", bill: bill("overdue", "2026-09-25").bill }],
    });
    expect(items.map((i) => i.tone)).toEqual(["danger", "warn", "info"]);
    expect(items.slice(1).every((i) => i.to === "Net worth")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { activeMonth } from "./spendingSources";

const tx = (date: string, currency = "INR") => ({ date, currency }) as never;

describe("activeMonth", () => {
  it("uses the current month once it has transactions", () => {
    expect(activeMonth([tx("2026-09-30"), tx("2026-10-01")], "2026-10-01")).toBe("2026-10");
  });

  it("falls back to the latest month with transactions", () => {
    expect(activeMonth([tx("2026-08-12"), tx("2026-09-30")], "2026-10-01")).toBe("2026-09");
  });

  it("ignores foreign-currency transactions and defaults to the current month when empty", () => {
    expect(activeMonth([tx("2026-10-01", "USD"), tx("2026-09-05")], "2026-10-02")).toBe("2026-09");
    expect(activeMonth([], "2026-10-02")).toBe("2026-10");
  });
});

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inrPrecise = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

export const money = (n: number, currency = "INR", precise = false) =>
  currency === "INR"
    ? (precise ? inrPrecise : inr).format(n)
    : new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(n);

export const pct = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;

export const day = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export const monthLabel = (ym: string) =>
  new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

const ACRONYMS = new Set(["HDFC", "SBI", "ICICI", "HSBC", "UTI", "DSP", "PPFAS", "IDFC", "LIC", "JM", "ITI", "PGIM", "IIFL", "WOC", "NJ"]);

/** "MOTILAL OSWAL MUTUAL FUND" → "Motilal Oswal", "Quant MF" → "Quant", "SBI Mutual Fund" → "SBI". */
export function amcLabel(amc: string) {
  const s = amc.replace(/\s*(mutual fund|mf)\s*$/i, "").trim() || amc;
  return s.replace(/[A-Za-z]+/g, (w) =>
    ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : w === w.toUpperCase() ? w[0] + w.slice(1).toLowerCase() : w[0].toUpperCase() + w.slice(1),
  );
}

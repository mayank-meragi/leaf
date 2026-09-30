// Annualised internal rate of return for irregular cashflows (Excel's XIRR).
// Convention: money you put in is negative, money you get back (including current value) is positive.

export interface Flow {
  date: string; // YYYY-MM-DD
  amount: number;
}

const DAY = 86_400_000;

export function xirr(flows: Flow[]): number | null {
  const fs = flows.filter((f) => f.amount !== 0).map((f) => ({ t: Date.parse(f.date), a: f.amount }));
  if (!fs.some((f) => f.a < 0) || !fs.some((f) => f.a > 0)) return null;
  const t0 = Math.min(...fs.map((f) => f.t));
  const ys = fs.map((f) => ({ y: (f.t - t0) / DAY / 365, a: f.a }));
  const npv = (r: number) => ys.reduce((s, f) => s + f.a / (1 + r) ** f.y, 0);
  const dnpv = (r: number) => ys.reduce((s, f) => s - (f.y * f.a) / (1 + r) ** (f.y + 1), 0);

  // Newton from a sensible guess; fall back to bisection if it wanders off.
  let r = 0.1;
  for (let i = 0; i < 50; i++) {
    const v = npv(r);
    const d = dnpv(r);
    if (!Number.isFinite(v) || !Number.isFinite(d) || d === 0) break;
    const next = r - v / d;
    if (next <= -0.9999 || !Number.isFinite(next)) break;
    if (Math.abs(next - r) < 1e-9) return next;
    r = next;
  }

  let lo = -0.9999;
  let hi = 10;
  let vlo = npv(lo);
  if (Math.sign(vlo) === Math.sign(npv(hi))) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const v = npv(mid);
    if (Math.abs(v) < 1e-7 || hi - lo < 1e-10) return mid;
    if (Math.sign(v) === Math.sign(vlo)) {
      lo = mid;
      vlo = v;
    } else hi = mid;
  }
  return (lo + hi) / 2;
}

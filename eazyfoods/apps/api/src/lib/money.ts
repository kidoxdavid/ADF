/** Integer-cent helpers. No floating point money anywhere. */

/** pct of cents in basis points, rounded half up. */
export const bps = (cents: number, rateBps: number) => Math.floor((cents * rateBps + 5000) / 10000);

/** Split `total` across `weights` so the parts sum exactly to total (largest remainder). */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total === 0 || sum === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let rem = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f);
  for (const { i } of order) { if (rem-- <= 0) break; out[i]++; }
  return out;
}

/** Portion of `total` attributable to units (prev, next] of `qty`, with remainders settling on the last unit. */
export const prorate = (total: number, qty: number, prev: number, next: number) =>
  Math.round((total * next) / qty) - Math.round((total * prev) / qty);

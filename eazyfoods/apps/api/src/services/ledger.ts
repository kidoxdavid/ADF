import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

export type Entry = {
  account: 'cash_provider' | 'vendor_payable' | 'commission_revenue' | 'delivery_revenue' | 'tax_payable' | 'discount_expense' | 'driver_payable' | 'delivery_cost' | 'refund_loss';
  amount: number; // debit +, credit -
  vendorId?: string | null; driverId?: string | null; orderId?: string | null; suborderId?: string | null;
};

/** Post one balanced transaction. The database also rejects an unbalanced transaction at commit. */
export async function post(c: PoolClient, kind: string, ref: { type: string; id: string }, entries: Entry[]) {
  const live = entries.filter((e) => e.amount !== 0);
  if (live.reduce((a, e) => a + e.amount, 0) !== 0) throw new Error(`Unbalanced ledger transaction (${kind})`);
  if (!live.length) return;
  const txn = randomUUID();
  for (const e of live)
    await c.query(
      `INSERT INTO ledger_entries(txn_id, account, vendor_id, driver_id, order_id, suborder_id, amount_cents, kind, ref_type, ref_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [txn, e.account, e.vendorId ?? null, e.driverId ?? null, e.orderId ?? null, e.suborderId ?? null, e.amount, kind, ref.type, ref.id]);
}

type SubRow = { id: string; vendor_id: string; subtotal_cents: number; delivery_cents: number; delivery_tax_cents: number; tax_cents: number; commission_cents: number };

/** Customer payment confirmed: money held at provider is owed to vendors, minus our commission, delivery fee and tax. */
export async function postPaymentCaptured(c: PoolClient, order: { id: string; total_cents: number; discount_cents: number }, subs: SubRow[], paymentId: string) {
  const entries: Entry[] = [
    { account: 'cash_provider', amount: order.total_cents, orderId: order.id },
    { account: 'discount_expense', amount: order.discount_cents, orderId: order.id },
  ];
  for (const s of subs) {
    const ctx = { vendorId: s.vendor_id, orderId: order.id, suborderId: s.id };
    entries.push(
      { account: 'vendor_payable', amount: -(s.subtotal_cents - s.commission_cents), ...ctx },
      { account: 'commission_revenue', amount: -s.commission_cents, ...ctx },
      { account: 'delivery_revenue', amount: -s.delivery_cents, ...ctx },
      { account: 'tax_payable', amount: -(s.tax_cents + s.delivery_tax_cents), ...ctx });
  }
  await post(c, 'payment_captured', { type: 'payment', id: paymentId }, entries);
}

export type RefundAmounts = { merchandise: number; discount: number; tax: number; delivery: number; commission: number; amount: number };

/**
 * Refund reversal. vendor_funded: the vendor gives back its share (merchandise minus commission) and we return the commission.
 * Not vendor_funded (our fault, e.g. late/driver): the vendor keeps its earnings and the marketplace books the loss.
 */
export async function postRefund(c: PoolClient, r: { id: string; order_id: string; suborder_id: string; vendor_id: string; vendor_funded: boolean } & RefundAmounts) {
  const ctx = { vendorId: r.vendor_id, orderId: r.order_id, suborderId: r.suborder_id };
  const entries: Entry[] = [
    { account: 'cash_provider', amount: -r.amount, ...ctx },
    { account: 'delivery_revenue', amount: r.delivery, ...ctx },
    { account: 'tax_payable', amount: r.tax, ...ctx },
    { account: 'discount_expense', amount: -r.discount, ...ctx },
  ];
  if (r.vendor_funded) entries.push({ account: 'vendor_payable', amount: r.merchandise - r.commission, ...ctx }, { account: 'commission_revenue', amount: r.commission, ...ctx });
  else entries.push({ account: 'refund_loss', amount: r.merchandise, ...ctx });
  await post(c, 'refund', { type: 'refund', id: r.id }, entries);
}

export async function postDriverEarning(c: PoolClient, d: { driver_id: string; delivery_id: string; amount: number; order_id: string; suborder_id: string }) {
  await post(c, 'driver_earning', { type: 'delivery', id: d.delivery_id }, [
    { account: 'delivery_cost', amount: d.amount, driverId: d.driver_id, orderId: d.order_id, suborderId: d.suborder_id },
    { account: 'driver_payable', amount: -d.amount, driverId: d.driver_id, orderId: d.order_id, suborderId: d.suborder_id }]);
}

/** Paying a payee out of provider balance clears the payable. */
export async function postPayout(c: PoolClient, p: { id: string; payee_type: 'vendor' | 'driver'; vendor_id?: string | null; driver_id?: string | null; amount: number }) {
  const account = p.payee_type === 'vendor' ? 'vendor_payable' : 'driver_payable';
  await post(c, 'payout', { type: 'payout', id: p.id }, [
    { account, amount: p.amount, vendorId: p.vendor_id, driverId: p.driver_id },
    { account: 'cash_provider', amount: -p.amount, vendorId: p.vendor_id, driverId: p.driver_id }]);
}

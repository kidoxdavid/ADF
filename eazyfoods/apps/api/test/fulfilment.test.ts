import { beforeAll, describe, expect, it } from 'vitest';
import { addToCart, app, call, checkout, ledgerSum, login, newCustomer, offerRow, openAllStores, setOffer, simulate } from './helpers.js';
import { pool } from '../src/db/pool.js';

const S1 = 'demo-calgary-west-african-market';
beforeAll(openAllStores);

async function paid(extra: { stockChips?: number } = {}) {
  const u = await newCustomer();
  const garri = await setOffer(S1, 'garri-white', 2000, 10);
  const chips = await setOffer(S1, 'plantain-chips-salted', 1500, extra.stockChips ?? 10);
  await addToCart(u.cookie, garri, 2); await addToCart(u.cookie, chips, 1);
  const o = (await checkout(u.cookie, u.addressId)).body.order;
  await simulate(u.cookie, o.id, 'succeeded');
  const order = (await call(u.cookie, 'GET', `/api/orders/${o.id}`)).body;
  return { u, o: order, sid: order.suborders[0].id as string, garri, chips };
}
const who = async (e: string) => (await login(e)).cookie;

describe('end-to-end fulfilment', () => {
  it('store accepts, dispatcher assigns, driver delivers with the customer code, books earnings, finance pays out', async () => {
    const { u, o, sid } = await paid();
    const owner = await who('owner1@example.test'), disp = await who('dispatcher@example.test'), driver = await who('driver@example.test'), fin = await who('finance@example.test');

    expect((await call(owner, 'POST', `/api/vendor/suborders/${sid}/accept`)).status).toBe(200);
    expect((await call(owner, 'POST', `/api/vendor/suborders/${sid}/preparing`)).status).toBe(200);
    expect((await call(owner, 'POST', `/api/vendor/suborders/${sid}/ready`)).status).toBe(200);
    // illegal jump is refused
    expect((await call(owner, 'POST', `/api/vendor/suborders/${sid}/accept`)).status).toBe(409);

    const dispatch = (await call(disp, 'GET', '/api/admin/dispatch')).body;
    const job = dispatch.jobs.find((j: any) => j.order_number === o.order_number);
    expect(job.status).toBe('unassigned');
    const drv = dispatch.drivers[0];
    expect((await call(disp, 'POST', `/api/admin/deliveries/${job.id}/assign`, { driver_id: drv.id })).status).toBe(200);

    // customer sees a handover code only now; the driver payload never contains it
    const mine = (await call(u.cookie, 'GET', `/api/orders/${o.id}`)).body.suborders[0];
    expect(mine.handover_code).toMatch(/^\d{4}$/);
    const jobs = (await call(driver, 'GET', '/api/driver/jobs')).body;
    const dj = jobs.find((j: any) => j.order_number === o.order_number);
    expect(JSON.stringify(dj)).not.toContain(mine.handover_code);
    expect(dj.dropoff.first_name).toBe('Test');

    expect((await call(driver, 'POST', `/api/driver/jobs/${dj.id}/pickup`)).status).toBe(200);
    expect((await call(u.cookie, 'GET', `/api/orders/${o.id}`)).body.suborders[0].status).toBe('out_for_delivery');
    const wrong = await call(driver, 'POST', `/api/driver/jobs/${dj.id}/deliver`, { code: mine.handover_code === '0000' ? '1111' : '0000' });
    expect(wrong.status).toBe(400);
    const done = await call(driver, 'POST', `/api/driver/jobs/${dj.id}/deliver`, { code: mine.handover_code });
    expect(done.status).toBe(200);

    const final = (await call(u.cookie, 'GET', `/api/orders/${o.id}`)).body;
    expect(final.status).toBe('completed');
    expect(final.suborders[0].timeline.map((t: any) => t.status)).toEqual(['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered']);
    expect(await ledgerSum(o.id, 'driver_payable')).toBe(-450);
    expect((await call(driver, 'GET', '/api/driver/earnings')).body.unpaid_cents).toBeGreaterThanOrEqual(450);

    // payouts need the hold period; age the order, then pay the vendor
    expect((await call(fin, 'POST', `/api/admin/payouts/vendor/${(await pool.query('SELECT vendor_id FROM suborders WHERE id=$1', [sid])).rows[0].vendor_id}`)).status).toBe(400);
    await pool.query(`UPDATE suborders SET completed_at = now() - interval '3 days' WHERE id = $1`, [sid]);
    const vid = (await pool.query('SELECT vendor_id FROM suborders WHERE id=$1', [sid])).rows[0].vendor_id;
    const before = Number((await pool.query(`SELECT COALESCE(sum(amount_cents),0) s FROM ledger_entries WHERE vendor_id=$1 AND account='vendor_payable'`, [vid])).rows[0].s);
    const p = await call(fin, 'POST', `/api/admin/payouts/vendor/${vid}`);
    expect(p.status).toBe(201);
    expect(p.body.status).toBe('pending');                 // no payout account connected: manual transfer
    expect((await call(fin, 'POST', `/api/admin/payouts/${p.body.id}/mark-paid`, { reference: 'ETF-123' })).body.status).toBe('paid');
    const afterBal = Number((await pool.query(`SELECT COALESCE(sum(amount_cents),0) s FROM ledger_entries WHERE vendor_id=$1 AND account='vendor_payable'`, [vid])).rows[0].s);
    expect(afterBal - before).toBe(p.body.amount_cents);   // payable cleared by exactly the payout
    expect((await pool.query('SELECT payout_id FROM suborders WHERE id=$1', [sid])).rows[0].payout_id).toBe(p.body.id);
    expect((await call(fin, 'POST', `/api/admin/payouts/vendor/${vid}`)).status).toBe(400);   // cannot pay the same orders twice
  });

  it('a driver cannot see or act on another driver’s job; unapproved drivers see nothing', async () => {
    const { sid } = await paid();
    const owner = await who('owner1@example.test'), disp = await who('dispatcher@example.test');
    await call(owner, 'POST', `/api/vendor/suborders/${sid}/accept`); await call(owner, 'POST', `/api/vendor/suborders/${sid}/ready`);
    const jobId = (await pool.query('SELECT id FROM deliveries WHERE suborder_id=$1', [sid])).rows[0].id;
    const drv = (await call(disp, 'GET', '/api/admin/dispatch')).body.drivers[0];
    await call(disp, 'POST', `/api/admin/deliveries/${jobId}/assign`, { driver_id: drv.id });

    // a second, approved driver
    const other = await newCustomer();
    expect((await call(other.cookie, 'POST', '/api/driver/apply', { phone: '5875550199', vehicle: 'Bike' })).status).toBe(201);
    expect((await call(other.cookie, 'GET', '/api/driver/jobs')).status).toBe(403);   // applied, not approved
    const admin = await who('owner@example.test');
    const did = (await pool.query('SELECT id FROM drivers WHERE user_id=$1', [other.id])).rows[0].id;
    expect((await call(admin, 'PATCH', `/api/admin/drivers/${did}`, { status: 'approved' })).status).toBe(409);   // must verify first
    await call(admin, 'PATCH', `/api/admin/drivers/${did}`, { licence_verified: true, background_check_verified: true });
    expect((await call(admin, 'PATCH', `/api/admin/drivers/${did}`, { status: 'approved' })).status).toBe(200);
    const re = await who('driver@example.test'); void re;
    expect((await call(other.cookie, 'GET', '/api/driver/jobs')).body).toEqual([]);
    expect((await call(other.cookie, 'POST', `/api/driver/jobs/${jobId}/pickup`)).status).toBe(404);
    expect((await call(other.cookie, 'POST', `/api/driver/jobs/${jobId}/deliver`, { code: '1234' })).status).toBe(404);
    // and a customer cannot touch driver or dispatch endpoints
    expect((await call((await newCustomer()).cookie, 'GET', '/api/admin/dispatch')).status).toBe(403);
  });

  it('customer can cancel before acceptance (full refund, stock back) but not after', async () => {
    const { u, o, sid, garri } = await paid();
    expect((await offerRow(garri)).stock_on_hand).toBe(8);
    const r = await call(u.cookie, 'POST', `/api/orders/${o.id}/suborders/${sid}/cancel`);
    expect(r.status).toBe(200);
    const after = (await call(u.cookie, 'GET', `/api/orders/${o.id}`)).body;
    expect(after.payment_status).toBe('refunded');
    expect(after.status).toBe('cancelled');
    expect((await offerRow(garri)).stock_on_hand).toBe(10);
    expect(await ledgerSum(o.id)).toBe(0);

    const second = await paid();
    await call(await who('owner1@example.test'), 'POST', `/api/vendor/suborders/${second.sid}/accept`);
    expect((await call(second.u.cookie, 'POST', `/api/orders/${second.o.id}/suborders/${second.sid}/cancel`)).status).toBe(409);
    // someone else's order is invisible
    expect((await call((await newCustomer()).cookie, 'GET', `/api/orders/${second.o.id}`)).status).toBe(404);
  });

  it('vendor marks an item unavailable: that item alone is refunded', async () => {
    const { u, o, sid } = await paid();
    const owner = await who('owner1@example.test');
    await call(owner, 'POST', `/api/vendor/suborders/${sid}/accept`);
    const chip = o.suborders[0].lines.find((l: any) => l.name.startsWith('Plantain'));
    expect((await call(owner, 'POST', `/api/vendor/suborders/${sid}/lines/${chip.id}/unavailable`)).status).toBe(200);
    const after = (await call(u.cookie, 'GET', `/api/orders/${o.id}`)).body;
    expect(after.payment_status).toBe('partially_refunded');
    expect(after.suborders[0].lines.find((l: any) => l.id === chip.id).refunded_quantity).toBe(1);
    expect(await ledgerSum(o.id)).toBe(0);
    // another vendor cannot do this
    expect((await call(await who('owner2@example.test'), 'POST', `/api/vendor/suborders/${sid}/lines/${chip.id}/unavailable`)).status).toBe(403);
  });

  it('substitution needs the customer’s approval, costs nothing extra, and blocks "ready" until answered', async () => {
    const { u, o, sid } = await paid();
    const owner = await who('owner1@example.test');
    await call(owner, 'POST', `/api/vendor/suborders/${sid}/accept`);
    const garri = o.suborders[0].lines.find((l: any) => l.name.startsWith('Garri'));
    const alt = await setOffer(S1, 'fufu-flour-cassava', 900, 10);
    expect((await call(owner, 'POST', `/api/vendor/suborders/${sid}/lines/${garri.id}/substitute`, { offer_id: alt })).status).toBe(200);
    const blocked = await call(owner, 'POST', `/api/vendor/suborders/${sid}/ready`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('substitution_pending');
    const total = (await call(u.cookie, 'GET', `/api/orders/${o.id}`)).body.total_cents;
    expect((await call(u.cookie, 'POST', `/api/orders/${o.id}/lines/${garri.id}/substitution`, { accept: true })).body.status).toBe('approved');
    expect((await call(u.cookie, 'GET', `/api/orders/${o.id}`)).body.total_cents).toBe(total);   // no extra charge
    expect((await call(owner, 'POST', `/api/vendor/suborders/${sid}/ready`)).status).toBe(200);
  });

  it('declining a substitution refunds that item', async () => {
    const { u, o, sid } = await paid();
    const owner = await who('owner1@example.test');
    await call(owner, 'POST', `/api/vendor/suborders/${sid}/accept`);
    const garri = o.suborders[0].lines.find((l: any) => l.name.startsWith('Garri'));
    await call(owner, 'POST', `/api/vendor/suborders/${sid}/lines/${garri.id}/substitute`, { offer_id: await setOffer(S1, 'fufu-flour-cassava', 900, 10) });
    await call(u.cookie, 'POST', `/api/orders/${o.id}/lines/${garri.id}/substitution`, { accept: false });
    const after = (await call(u.cookie, 'GET', `/api/orders/${o.id}`)).body;
    expect(after.payment_status).toBe('partially_refunded');
    expect(await ledgerSum(o.id)).toBe(0);
  });

  it('customers report problems; support sees them, customers never see internal notes', async () => {
    const { u, o, sid } = await paid();
    const t = await call(u.cookie, 'POST', `/api/orders/${o.id}/issues`, { suborder_id: sid, category: 'missing_item', message: 'The garri was missing', line_ids: [o.suborders[0].lines[0].id] });
    expect(t.status).toBe(201);
    const support = await who('support@example.test');
    expect((await call(support, 'POST', `/api/admin/tickets/${t.body.id}/messages`, { body: 'Checking with the store', internal: true })).status).toBe(200);
    await call(support, 'POST', `/api/admin/tickets/${t.body.id}/messages`, { body: 'Sorry about that — looking into it.' });
    const mine = (await call(u.cookie, 'GET', `/api/support/tickets/${t.body.id}`)).body;
    expect(mine.messages.map((m: any) => m.body)).not.toContain('Checking with the store');
    expect(mine.messages).toHaveLength(2);
    expect((await call((await newCustomer()).cookie, 'GET', `/api/support/tickets/${t.body.id}`)).status).toBe(404);
    // customers cannot open a ticket on someone else's order
    expect((await call((await newCustomer()).cookie, 'POST', `/api/orders/${o.id}/issues`, { suborder_id: sid, category: 'other', message: 'hello there' })).status).toBe(404);
  });

  it('staff without the permission are refused; finance cannot cancel orders, support cannot see the ledger', async () => {
    expect((await call(await who('support@example.test'), 'GET', '/api/admin/ledger')).status).toBe(403);
    expect((await call(await who('finance@example.test'), 'POST', `/api/admin/suborders/${randomId()}/cancel`, { reason: 'because' })).status).toBe(403);
    expect((await call(await who('dispatcher@example.test'), 'POST', `/api/admin/refunds/${randomId()}/approve`)).status).toBe(403);
    expect((await call(await who('catalog@example.test').catch(() => ''), 'GET', '/api/admin/vendors')).status).toBe(401);
  });
});

const randomId = () => '00000000-0000-4000-8000-000000000000';
void app;

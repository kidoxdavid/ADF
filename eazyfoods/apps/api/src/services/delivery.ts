import type { PoolClient } from 'pg';
import { handoverCode } from '../lib/ids.js';
import { getSetting } from '../lib/settings.js';

/** Create the delivery job when a delivery suborder becomes ready. Snapshots both addresses so later edits cannot change a job in flight. */
export async function createDelivery(c: PoolClient, suborderId: string) {
  const s = (await c.query(
    `SELECT s.id, s.order_id, st.name AS store_name, st.address_line, st.city, st.postal_code, st.phone,
            o.address, o.customer_name, o.customer_phone, o.delivery_instructions
       FROM suborders s JOIN stores st ON st.id = s.store_id JOIN orders o ON o.id = s.order_id WHERE s.id = $1`, [suborderId])).rows[0];
  const earning = await getSetting<number>('driver.pay_per_delivery_cents', c);
  const r = await c.query(
    `INSERT INTO deliveries(suborder_id, handover_code, pickup, dropoff, instructions, earning_cents) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (suborder_id) DO NOTHING RETURNING id`,
    [suborderId, handoverCode(), { store_name: s.store_name, address_line: s.address_line, city: s.city, postal_code: s.postal_code, phone: s.phone },
     { ...s.address, recipient_name: s.customer_name, phone: s.customer_phone }, s.delivery_instructions, earning]);
  if (r.rows[0]) await c.query(`INSERT INTO delivery_events(delivery_id, type) VALUES ($1,'created')`, [r.rows[0].id]);
}

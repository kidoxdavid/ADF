import { pool, tx } from './db/pool.js';
import { getSetting } from './lib/settings.js';
import { moveSuborder } from './services/orders.js';
import { releaseExpiredReservations } from './services/payments.js';
import { processOutbox } from './services/notify.js';

/** Stores that never respond get the order rejected (and the customer fully refunded) after the configured time. */
export async function autoRejectStaleOrders() {
  const mins = await getSetting<number>('vendor.auto_reject_minutes');
  const stale = (await pool.query(`SELECT s.id FROM suborders s JOIN orders o ON o.id = s.order_id WHERE s.status = 'placed' AND o.placed_at < now() - make_interval(mins => $1)`, [mins])).rows;
  let n = 0;
  for (const s of stale) {
    try { await tx((c, after) => moveSuborder(c, after, s.id, 'rejected', { userId: null, kind: 'system' }, 'The store did not respond in time')); n++; }
    catch (e) { console.error('auto-reject failed', s.id, e); }
  }
  return n;
}

export async function runJobsOnce() {
  const released = await releaseExpiredReservations();
  const rejected = await autoRejectStaleOrders();
  const sent = await processOutbox();
  return { released, rejected, sent };
}

let running = false;
export function startJobs() {
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runJobsOnce(); } catch (e) { console.error('background job failed', e); } finally { running = false; }
  };
  const t = setInterval(tick, 30_000);
  t.unref();
  return () => clearInterval(t);
}

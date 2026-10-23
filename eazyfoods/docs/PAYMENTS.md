# Payments, refunds and settlement

## Principles
- The browser never decides an order is paid. Only a **signature-verified provider webhook** moves an order to paid.
- The amount the customer pays is computed on the server from current prices; the payment amount is compared to the provider's reported amount, and a mismatch is **not** treated as paid (it raises a support ticket).
- Webhooks are recorded once per `(provider, event_id)`; replays are ignored. Applying an event runs in one transaction, so a failure makes the provider retry.
- Card numbers never touch our servers or database (Stripe's Payment Element collects them).

## Provider interface
`apps/api/src/payments/provider.ts`: `createPayment`, `cancelPayment`, `parseWebhook`, `refund`, `transfer`.
- `mock` (development/test only): no network, no money. Exercises the same signed-webhook code path. **Refuses to start in production.** The dev-only simulate endpoint does not exist in production and cannot mark anything paid by itself.
- `stripe`: PaymentIntents + Payment Element, refunds, transfers for vendor payouts. **Written against Stripe's documented API but not yet run against a Stripe account.**

## Order of events
1. Checkout locks the offers, re-prices, reserves stock (15 min) and creates the order as `pending_payment`.
2. A payment is created for the exact total (idempotency key `pay:<order>`).
3. Webhook `payment succeeded` -> stock committed, order `placed`, suborders `placed`, ledger posted, basket cleared, emails queued.
4. Webhook `payment failed` or expiry -> reservations released; order `payment_failed`/`expired`; no ledger entries.
5. A late success after expiry re-claims stock if still free, otherwise the affected suborder is cancelled and fully refunded.

## Ledger (append-only, double entry)
Debits positive, credits negative; each transaction sums to zero (enforced by a deferred database trigger). Accounts: `cash_provider`, `vendor_payable`, `commission_revenue`, `delivery_revenue`, `tax_payable`, `discount_expense`, `driver_payable`, `delivery_cost`, `refund_loss`.
- **Payment captured:** cash in; vendor payable = merchandise - commission; commission, delivery fee and tax recognised; coupon booked as discount expense.
- **Refund (vendor-funded):** vendor payable and commission reversed pro-rata, tax and delivery reversed, discount expense reversed.
- **Refund (marketplace-funded):** vendor keeps earnings; our loss is booked.
- **Driver earning:** delivery cost / driver payable when delivery completes.
- **Payout:** clears the payable against cash.
Corrections are new reversing entries. Nothing is edited or deleted.

## When money is "earned"
Recorded as payable to the vendor at payment, but **paid out only after the order is delivered and a hold period passes** (default 2 days). Refunds after payout leave a negative balance that nets against later payouts.

## Refund workflow
Customers cannot refund themselves: they report a problem. Support/admin **request** a refund (line items, optional delivery fee, vendor- or marketplace-funded); **finance approves**; the provider is called outside any database transaction using an idempotency key; amounts are recomputed from live state at approval; over-refunding is blocked by an atomic quantity claim. Store rejections, customer cancellations before acceptance, declined substitutions, unavailable items and auto-timeouts refund automatically.

## Stripe go-live checklist (do before any live payment)
1. Confirm Stripe Connect is available for your business and the exact fund-flow/terms in Canada (separate charges and transfers vs destination charges; who is merchant of record; who is liable for disputes).
2. Create **test-mode** keys and a webhook endpoint (`POST /api/webhooks/payments`) subscribed to `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.dispute.created`. Set `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`.
3. Run these in test mode: successful 3-D Secure card, declined card, expired hold then late success, refund full and partial, dispute event, duplicate webhook delivery, vendor payout transfer to a test connected account.
4. Reconcile the Stripe balance report with the ledger `cash_provider` account for the test period.
5. Implement/verify vendor Connect onboarding (accounts are currently attached by an admin entering the `acct_...` id) and import processing fees into the ledger.
6. Only then switch to live keys. Never fabricate events to "prove" it works.

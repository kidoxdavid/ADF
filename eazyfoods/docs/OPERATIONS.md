# Operations and support workflows

## Daily rhythm (dispatcher / support)
1. **Admin > Dashboard (exceptions):** work top to bottom: unaccepted orders (call the store), unassigned deliveries (assign a driver), failed deliveries, open tickets, refunds waiting, payment anomalies.
2. **Dispatch:** assign available drivers to ready deliveries. Late jobs are flagged against the promised time.
3. **Support:** reply to tickets; use internal notes for staff-only context (customers never see them).

## Common cases
| Situation | What to do |
|---|---|
| Store does not respond | The system escalates at 15 min and auto-rejects + fully refunds at 45 min. Call the store sooner. |
| Item missing/damaged/wrong | Customer reports from the order. Support reviews, then **requests a refund** for the affected lines (vendor-funded if the store's fault). Finance approves. |
| Driver cannot deliver | Driver marks the job failed -> exception queue. Re-assign, or cancel the suborder with a reason (automatic refund). |
| Late delivery | Support may request a **marketplace-funded** refund of the delivery fee (vendor keeps earnings; our cost is booked as refund loss). |
| Customer cancels | Allowed until the store accepts (automatic refund, stock returned). After that: support decides. |
| Chargeback/dispute | A ticket is created from the provider event. Respond to the provider before the deadline. |
| Payment amount mismatch | Never marked paid; a ticket is created. Investigate with the provider before fulfilling. |
| Store out of stock on a paid item | Vendor marks unavailable -> automatic item refund; or proposes a replacement. |

## Roles (least privilege)
`owner` (everything), `admin` (vendors, catalogue, dispatch, content, promotions, CRM, ads), `support` (tickets, orders view, request refunds), `finance` (approve refunds, payouts, ledger, reports), `dispatcher`, `catalog`. Grant roles under Admin > Settings. Role changes and settings changes are audited.

## Payouts (finance)
Admin > Finance shows what each vendor is owed and what is payable now (delivered and past the hold). Create a payout: with a connected account it transfers through the provider; otherwise pay by bank transfer and **mark paid with the reference**, which clears the payable in the ledger. Driver earnings work the same way.

## Weekly review
KPI report (marketplace revenue, refund rate, on-time rate, out-of-stock rate), search demand (unmet queries are catalogue gaps), vendor activation, CRM pipeline.

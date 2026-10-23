# Launch readiness checklist

Nothing here is ticked automatically. A box is ticked only with evidence.

## Business and legal
- [ ] Commission, delivery fee, driver pay, minimums approved (see DECISIONS.md)
- [ ] Terms, Privacy Policy, Vendor Agreement reviewed by a professional (currently drafts)
- [ ] Accountant has verified every product's tax class and the GST treatment of delivery and the marketplace
- [ ] Driver arrangement (contractor/employee), insurance, and vehicle requirements confirmed
- [ ] Food-safety/licensing requirements confirmed per vendor; documents verified
- [ ] Privacy officer named; retention schedule defined

## Payments
- [ ] Stripe account, Connect eligibility, fund flow and dispute liability confirmed
- [ ] PAYMENTS.md go-live checklist completed in test mode with evidence
- [ ] Live keys set; webhook endpoint verified; first live order reconciled with the ledger

## Platform
- [ ] Production database with point-in-time recovery; restore drill passed (BACKUP_RECOVERY.md)
- [ ] `NODE_ENV=production`, mock provider refused, secrets in a secrets manager
- [ ] TLS, `WEB_ORIGIN`, proxy settings and rate limits verified behind the real proxy
- [ ] Object storage for images/documents; email provider verified with SPF/DKIM
- [ ] Error monitoring (Sentry DSN) or alerting on Admin > System
- [ ] First owner created; staff roles granted with least privilege; 2FA plan
- [ ] CI green; `npm audit` clean at high severity; end-to-end suite green on staging

## Operations
- [ ] Delivery zones, fees, ETAs verified; drivers approved with verified licence and background check
- [ ] Pilot stores onboarded, catalogue reviewed (including aliases), real product photos uploaded
- [ ] Support inbox staffed; exception queue owner assigned; escalation phone numbers
- [ ] Refund approvals owner (finance) and payout schedule agreed
- [ ] Demo/test data removed from production; test stores not visible

## Accessibility and quality
- [ ] Manual screen-reader pass on key flows (automated axe checks run in the e2e suite but are not a full audit)
- [ ] Real-device testing on iOS Safari and Android Chrome

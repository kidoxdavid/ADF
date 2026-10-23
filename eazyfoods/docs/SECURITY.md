# Security and privacy

**This is an engineering description, not a compliance claim.** Canadian privacy (PIPEDA and Alberta PIPA), consumer-protection, tax, accessibility (AODA-style guidance does not directly apply in Alberta but WCAG is the sensible target), food-safety and payment rules must be confirmed with qualified professionals before launch.

## Implemented
- Passwords hashed with scrypt; sessions are random 256-bit tokens stored only as SHA-256; sign-out and password change/reset revoke sessions.
- HttpOnly + SameSite=Lax cookies (Secure in production); Origin check on state-changing requests; CORS restricted to `WEB_ORIGIN`; Helmet headers.
- Rate limits on login, registration, reset, verification, checkout, uploads, ad events and analytics.
- Server-side validation of every input (zod); parameterised SQL only.
- Authorization: customers see only their own orders; vendors only their own stores/orders/ads/reports; drivers only their assigned jobs (and never the handover code); staff only what their role permits. Covered by automated tests, including cross-vendor and cross-customer attempts.
- Uploads: type detected from file bytes (JPEG/PNG/WebP, PDF for documents), 5 MB cap, random file names, only our own image URLs accepted by the API; **business documents are stored privately** and downloadable only by staff with `vendors.manage`.
- No card data stored. Payments via the provider; webhooks signature-verified and idempotent.
- Audit log (append-only) for approvals, role grants, setting changes, refunds, payouts, catalogue and content changes.
- Privacy: marketing consent stored with a timestamp and revocable; data export; account deletion that anonymises personal data while retaining anonymised order and payment records required for accounting. Email enumeration is prevented on password reset.
- `npm audit` (high and above) runs in CI.

## Not yet done / recommended before launch
- Professional review of the Terms, Privacy Policy and Vendor Agreement drafts.
- Penetration test and dependency/secret scanning in CI beyond `npm audit`.
- Data retention schedule (how long to keep search events, analytics, tickets) and automated enforcement.
- Two-factor authentication for staff and owners.
- Move image/document storage to a private S3-compatible bucket with signed URLs; malware scanning of uploads.
- Backups and a tested restore (see BACKUP_RECOVERY.md).
- Review the app behind a real TLS-terminating proxy (trust proxy settings, real client IPs for rate limiting).

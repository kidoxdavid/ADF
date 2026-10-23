INSERT INTO app_settings(key, value) VALUES
 ('ads.min_cpc_cents', '25'),
 ('ads.min_budget_cents', '2000'),
 ('vendor.agreement_version', '"2026-draft-1"');
INSERT INTO pages(slug, title, body, needs_legal_review) VALUES
 ('vendor-agreement', 'Vendor agreement (draft)', E'DRAFT. This agreement must be reviewed by a qualified professional before any vendor is asked to accept it.\n\n## Summary of commercial terms\n- EAZyfoods charges a commission on the merchandise value of each order. The current rate is shown in your vendor dashboard.\n- Payment-processing fees are paid by EAZyfoods and are not deducted from your payout.\n- Earnings from delivered orders are paid out after a short hold period, by transfer to your connected payout account.\n- You are responsible for the accuracy of your prices, stock and product information, and for food-safety and licensing obligations that apply to your business.\n- If you cannot supply an item, mark it unavailable promptly so the customer is refunded; you may propose a replacement at no extra charge to the customer.\n- Refunds for items you could not supply or supplied incorrectly are deducted from your earnings.', true);

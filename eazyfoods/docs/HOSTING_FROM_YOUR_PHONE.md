# Put the demo online (works from a phone)

This creates a private **demo** site with invented data and a mock payment provider (no real money). It redeploys by itself whenever code is pushed to `main`.

1. Create a free account at **render.com** (sign up with GitHub).
2. Tap **New +**, then **Blueprint**.
3. Connect the GitHub repo **kidoxdavid/ADF** and pick branch **main**. Render reads `render.yaml` and proposes a web service and a database. Tap **Apply**.
4. Wait for the first build (several minutes). When it says **Live**, open the service's URL, e.g. `https://eazyfoods.onrender.com`.
5. If the address Render gives you differs from `eazyfoods.onrender.com`, set the service's **WEB_ORIGIN** environment variable to it (Render > service > Environment). Sign-in works either way because the site and API share one address.

Notes
- Free plans sleep when idle (the first visit can take about a minute) and the free database expires after a limited period. Check Render's current plans and pricing.
- Demo logins use password `dev-password-123`: `customer@example.test`, `owner1@example.test` (/vendor), `owner@example.test` (/admin), `driver@example.test` (/driver).
- Do **not** use this setup for real customers or real payments. A real launch needs `NODE_ENV=production`, Stripe, email, and the checklist in `LAUNCH_CHECKLIST.md`.

# Design system

**Type.** Display: *Unbounded* (wide, heavy, rounded geometric; used for the logo, headings, prices, stats and the handover code). Text and UI: *Onest* (clean, warm grotesque). Both are variable fonts, self-hosted through `@fontsource-variable` (no third-party font requests). Defined as `--display` and `--body` in `apps/web/src/styles.css`; change them in one place to re-skin.

**Colour.** Deep green (trust, food), ochre (warmth, regional accent), cream paper; red for danger and sale prices. Full dark mode via `prefers-color-scheme`. Text pairs are checked by axe in CI (WCAG 2 AA).

**Layout.** Mobile-first. Bottom tab bar on phones, header with region chips on desktop. 44px minimum touch targets, 16px+ inputs (no iOS zoom), safe-area insets, tables that become cards below 720px, portals with a sidebar on desktop and a scrolling tab strip on phones.

**Honesty rules.** No stock photography or fake ratings: products without a real photo show an initials tile; ratings appear only after 3 verified-purchase reviews; demo data is labelled; sponsored items are labelled; test-mode payments are labelled.

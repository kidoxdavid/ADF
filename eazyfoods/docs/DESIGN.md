# Design system

**Type.** Display: *Unbounded* (wide, heavy, rounded geometric; used for the logo, headings, prices, stats and the handover code). Text and UI: *Onest* (clean, warm grotesque). Both are variable fonts, self-hosted through `@fontsource-variable` (no third-party font requests). Defined as `--display` and `--body` in `apps/web/src/styles.css`; change them in one place to re-skin.

**Colour.** Deep green (trust, food), ochre (warmth, regional accent), cream paper; red for danger and sale prices. Full dark mode via `prefers-color-scheme`. Text pairs are checked by axe in CI (WCAG 2 AA).

**Layout.** Mobile-first. Bottom tab bar on phones, header with region chips on desktop. 44px minimum touch targets, 16px+ inputs (no iOS zoom), safe-area insets, tables that become cards below 720px, portals with a sidebar on desktop and a scrolling tab strip on phones.

**Honesty rules.** No stock photography or fake ratings: products without a real photo show an initials tile; ratings appear only after 3 verified-purchase reviews; demo data is labelled; sponsored items are labelled; test-mode payments are labelled.

## Storefront model (retail-style)
Information architecture follows large grocery retailers: utility bar, department search, "Deliver to" postal check, basket total, department mega-menu, hero carousel, region quad tiles, deal and collection shelves, department circles, store tiles, trust strip; search pages with facet counts and active-filter chips; product pages with a gallery, sticky buy box (store selector, delivery estimate, add to basket), store price comparison and related items; two-column basket with a sticky summary.

**Imagery.** No real photography exists yet, so products are drawn as the package they come in (bag, jar, pouch, tin, bottle, box, frozen bag, fresh crate) labelled with the real name, brand and size by `apps/web/src/art.tsx`. These are illustrations and are labelled as such on the product page; a store's uploaded photo replaces them automatically. Demo brands are fictional.

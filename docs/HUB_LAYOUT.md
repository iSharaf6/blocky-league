# Compact hub and Store — static layout audit

Scope: read-only source and real-font geometry audit. The supplied iPhone screenshot IMG_3406.PNG shows a two-row header squeezing the match card and a Daily done message sharing unused progress tracks. Build 4 made landscape status controls one row, shrank the level area and optional labels, and gave completed Daily challenges a two-track layout. The follow-up restores the visible Ad Free price within that same header row, and replaces the Store's squeezed multi-column layout with readable scrolling products. It preserves 44px tap targets. **No browser rendering, headless rendering, simulator visual inspection, or actual-device visual QA was performed. These calculations do not prove every rendering state.**

Audited source hashes (SHA-256):

- src/ui/menus.css: `91171e3098aef185e646aa2f4b35e3d3e20fe2858cf5da22092d8fcd87a916e8`
- src/ui/menus.ts: `de4c3ff2bba329016679c4f8fd30261db09209aba9bb6f74410a7bff5255222b`

Finite matrix: SMALL .88, MEDIUM 1 and LARGE 1.18 checked. Width maxima are fixed by CSS and height/text values grow monotonically across these scales, so the table uses the limiting LARGE case. Notch/home-indicator values are assumptions shown explicitly; both landscape orientations have the same safe width. Every optional native header action is present, with account/sign-in, remove ads, gems, coins, Help, Settings, level, and daily gift or tomorrow reward.

| Viewport CSS px | Side/bottom safe inset | Hub width | Width tier | Header maximum px | Width spare px | Hero available/cup required px |
| --- | --- | --- | --- | --- | --- | --- |
| 568×320 | 0/0 | 540.0 | tiny | ≤539 | 1.0 | 150.0/141.6 |
| 667×375 | 0/0 | 639.0 | narrow | ≤557 | 82.0 | 205.0/185.4 |
| 736×414 | 0/0 | 708.0 | medium | ≤697 | 11.0 | 244.0/185.4 |
| 780×360 | 50/21 | 680.0 | narrow | ≤557 | 123.0 | 179.0/142.5 |
| 812×375 | 44/21 | 724.0 | medium | ≤697 | 27.0 | 194.0/185.4 |
| 844×390 | 59/21 | 726.0 | medium | ≤697 | 29.0 | 209.0/185.4 |
| 852×393 | 59/21 | 734.0 | medium | ≤697 | 37.0 | 212.0/185.4 |
| 896×414 | 44/21 | 808.0 | medium | ≤697 | 111.0 | 233.0/185.4 |
| 926×428 | 59/21 | 808.0 | medium | ≤697 | 111.0 | 247.0/185.4 |
| 932×430 | 59/21 | 814.0 | medium | ≤697 | 117.0 | 249.0/185.4 |
| 1024×768 | 0/21 | 996.0 | medium | ≤697 | 299.0 | 560.0/398.9 |
| 1112×834 | 0/21 | 1084.0 | medium | ≤697 | 387.0 | 600.5/422.1 |
| 1180×820 | 0/21 | 1152.0 | medium | ≤697 | 455.0 | 601.0/417.2 |
| 1366×1024 | 0/21 | 1240.0 | base | ≤1170 | 70.0 | 593.1/475.4 |

Base iPad header maximum1170px is a conservative upper bound for full labels and price, plus bounded account160/gems104/coins170 and progress268. Compact maximums: medium697, narrow557, tiny539. These bounds include the visible price; on narrow/tiny headers the decorative coin plus is removed, while the whole coin button remains tappable. iOS15 uses viewport fallback thresholds800/660; that may choose an even smaller tier than the modern safe-width queries680/600, and fits these cases. No minimum OS increase is needed.

Font evidence: direct WOFF cmap/hmtx advance measurements of shipped Lilita One400 and Silkscreen700, with CSS letter spacing. Not browser shaping/visual measurements. At LARGE:

- Medium209 gems78.46/80px; tiny75.37/76px; base93.66/104px.
- Medium5,949 coins with + pill137.35/140px; tiny approximately104.2/108px without the plus pill; base168.45/170px. Extremely long balances intentionally ellipsize while the accessible label keeps the full value.
- Gift values100,150,200,250,300,350,400 checked. Largest+400 with12px font/icon12/gap3/padding6 needs58.09/60px. Tiny hides gift icon and keeps reward value.
- Tomorrow label now uses Lilita One7px: 46.50px, versus normal54px / tiny48px inner width. Coin/gem reward details remain in accessible labels.
- Level number18px, LV8px, 1px gap and narrow vertical padding12px total43.68/44px. Maximum stored level99 fits number width. Long title/streak is bounded and can ellipsize; full title and XP remain in the accessible label.
- ACCOUNT63.69/68px inner width; CLOUD44.07/48px; GOOGLE / APPLE68.29/68px is only0.29px beyond the medium inner width and has no surrounding control overlap (sub-label); primary SAVE/ACCOUNT remains fully fitting.
- Smallest footer with QUICK/EVENTS/INVITE leaves Daily160.99px; DAILY plus MORE TOMORROW needs149.01px. Done state has exactly2 tracks. Labels and next-message fit on separate lines within44px height.

The365px-high fixture compaction removes optional OVR/objective summaries and keeps cup icon14px; SE320px cup fixture needs141.64/150px. The separate380px-high rule hides only the Journey decorative crown, avoiding the119px offer-tile vs121.23px content edge at812×375 LARGE. Journey tier, progress, reward count and Club Pass remain.

Portrait web deliberately keeps wrapping, stacking and scrolling. Bounded club/division/news/goal titles and tiles may use ellipsis on small layouts. Actual-device verification is still required for WebKit shaping, animations, dynamic content and orientation transitions; this audit is not a claim of device-wide visual certification.

## Ad Free price correction

The same `info.noAds.price` from IAP is rendered visibly and in the accessible name. `IapProduct.price` remains StoreKit's unmodified localized string; only its layout changes. The 76×44px compact button has AD FREE over its price, with 68px available for each line. It does not create a second header row. The tiny coin chip is bounded at108px after removing its decorative plus; five-character balances such as5,949 still fit. The full coin amount remains in its accessible name if an unusually large wallet needs ellipsis.

Direct Lilita One400 WOFF advance measurements at font11px and an additional scale1.20 stress case (the actual LARGE setting is1.18):

| Visible string | Width px | Available px |
| --- | --- | --- |
| AD FREE, including letter spacing |48.39|68|
| $3.99 |31.92|68|
| US$3.99 (catalogue fallback) |47.22|68|
| A$5.99 |40.51|68|
| CHF 3.00 |51.48|68|
| EUR 3.99 |49.98|68|
| IDR 59.000 |66.77|68|

These are localized-price samples, not a claim that live StoreKit returned those prices. The IAP tests cover mock-provider price strings (`EUR 3.99`, `A$5.99`, `$3.99`, and `3,99 €`) surviving unchanged. The catalogue fallback is explicitly `US$3.99` until the native store supplies a localized Ad Free price. Paid products remain console setup work in the release record; a fallback price does not establish that a product is purchasable. Browser font fallback for additional currency glyphs, shaping, and every possible price string remain unverified.

## Store correction

Root causes identified in source:

- A fixed116px navigation rail plus an always-visible Club Pass column left five native gem packs approximately80px each on a notched landscape phone. Nonwrapping ribbons and prices could extend beyond their cards.
- COINS, OFFERS and CLUB used fixed-height rows without scrolling. Their content could overlap the footer or be clipped by the outer screen.
- Navigation buttons flex-shrank below44px. The gift/pass panels used their own separate scroll area, making the Store difficult to navigate.

The Store now uses pinned section tabs and one vertically scrolling product pane. CLUB PASS has its own section with its reward details, preview, cash price, and gem purchase option. Gem and coin grids use an intrinsic150px minimum card width and wrap into additional rows. Ribbons are in normal flow and can wrap. Prices stay inside the card; longer localized store prices can wrap rather than overlap. Offers have an intrinsic250px minimum width. Restore and payment information follow the products in the same scroll pane. Each section keeps its scroll position across purchases/redraws.

The shop rail scrolls with44px buttons and reveals the selected section when entered from a wallet shortcut. Product, purchase, Restore and section controls stay at least44px. The shell already applies zoom for text size; Store fonts are not multiplied a second time. SMALL uses50px base targets, resulting in44px after .88 zoom.

Finite source geometry checks for landscape Store card widths, including side safe areas, rail, body gap, and inner padding (medium text; large text reduces available logical width through shell zoom and may use one fewer column):

| Viewport | Side inset each | Product area px | Columns | Card width px |
| --- | --- | --- | --- | --- |
|568×320|10|412|2|200.0|
|667×375|10|511|3|162.3|
|736×414|10|580|3|185.3|
|780×360|50|544|3|173.3|
|812×375|44|588|3|188.0|
|844×390|59|590|3|188.7|
|852×393|59|598|3|191.3|
|896×414|44|672|4|159.0|
|932×430|59|678|4|160.5|

Portrait keeps horizontal navigation and the same pinned Store sections over its scrolling products. Intrinsic `min(150px,100%)` card sizing also permits a single column in narrower web frames. These checks establish intended constraints and source behavior; they are not rendered screenshots or actual-device visual QA.

Validation for this follow-up:105 existing tests passed across mainMenu, shop, iap and uiCopy. No CSS snapshot test has been substituted for visual verification.

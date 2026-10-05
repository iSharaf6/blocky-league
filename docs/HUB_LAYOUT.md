# Build 4 compact hub — static layout audit

Scope: read-only source and real-font geometry audit. The supplied iPhone screenshot IMG_3406.PNG shows a two-row header squeezing the match card and a Daily done message sharing unused progress tracks. This patch makes landscape status controls one row, shrinks the level area and optional labels, preserves 44px targets, and gives completed Daily challenges a two-track layout. **No browser rendering, headless rendering, simulator visual inspection, or actual-device visual QA was performed. These calculations do not prove every rendering state.**

Audited source hashes (SHA-256):

- src/ui/menus.css: `cacb0feec865495c08d5e9b75ce791a0555b70b7978094d58d5b3f4a792bc0bd`
- src/ui/menus.ts: `de4c3ff2bba329016679c4f8fd30261db09209aba9bb6f74410a7bff5255222b`

Finite matrix: SMALL .88, MEDIUM 1 and LARGE 1.18 checked. Width maxima are fixed by CSS and height/text values grow monotonically across these scales, so the table uses the limiting LARGE case. Notch/home-indicator values are assumptions shown explicitly; both landscape orientations have the same safe width. Every optional native header action is present, with account/sign-in, remove ads, gems, coins, Help, Settings, level, and daily gift or tomorrow reward.

| Viewport CSS px | Side/bottom safe inset | Hub width | Width tier | Header maximum px | Width spare px | Hero available/cup required px |
| --- | --- | --- | --- | --- | --- | --- |
| 568×320 | 0/0 | 540.0 | tiny | ≤535 | 5.0 | 150.0/141.6 |
| 667×375 | 0/0 | 639.0 | narrow | ≤549 | 90.0 | 205.0/185.4 |
| 736×414 | 0/0 | 708.0 | medium | ≤697 | 11.0 | 244.0/185.4 |
| 780×360 | 50/21 | 680.0 | narrow | ≤549 | 131.0 | 179.0/142.5 |
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

Base iPad header maximum1170px is a conservative upper bound for full labels and price, plus bounded account160/gems104/coins170 and progress268. Compact maximums: medium697, narrow549, tiny535. iOS15 uses viewport fallback thresholds800/660; that may choose an even smaller tier than the modern safe-width queries680/600, and fits these cases. No minimum OS increase is needed.

Font evidence: direct WOFF cmap/hmtx advance measurements of shipped Lilita One400 and Silkscreen700, with CSS letter spacing. Not browser shaping/visual measurements. At LARGE:

- Medium209 gems78.46/80px; tiny75.37/76px; base93.66/104px.
- Medium5,949 coins with + pill137.35/140px; tiny132.49/136px; base168.45/170px. Extremely long balances intentionally ellipsize while the accessible label keeps the full value.
- Gift values100,150,200,250,300,350,400 checked. Largest+400 with12px font/icon12/gap3/padding6 needs58.09/60px. Tiny hides gift icon and keeps reward value.
- Tomorrow label now uses Lilita One7px: 46.50px, versus normal54px / tiny48px inner width. Coin/gem reward details remain in accessible labels.
- Level number18px, LV8px, 1px gap and narrow vertical padding12px total43.68/44px. Maximum stored level99 fits number width. Long title/streak is bounded and can ellipsize; full title and XP remain in the accessible label.
- ACCOUNT63.69/68px inner width; CLOUD44.07/48px; GOOGLE / APPLE68.29/68px is only0.29px beyond the medium inner width and has no surrounding control overlap (sub-label); primary SAVE/ACCOUNT remains fully fitting.
- Smallest footer with QUICK/EVENTS/INVITE leaves Daily160.99px; DAILY plus MORE TOMORROW needs149.01px. Done state has exactly2 tracks. Labels and next-message fit on separate lines within44px height.

The365px-high fixture compaction removes optional OVR/objective summaries and keeps cup icon14px; SE320px cup fixture needs141.64/150px. The separate380px-high rule hides only the Journey decorative crown, avoiding the119px offer-tile vs121.23px content edge at812×375 LARGE. Journey tier, progress, reward count and Club Pass remain.

Portrait web deliberately keeps wrapping, stacking and scrolling. Bounded club/division/news/goal titles and tiles may use ellipsis on small layouts. Actual-device verification is still required for WebKit shaping, animations, dynamic content and orientation transitions; this audit is not a claim of device-wide visual certification.

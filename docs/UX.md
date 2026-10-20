# Blocky League UX rules (October 2026)

The owner, after playing on his iPhone: "most of the stuff i need to scroll big time ... i have to scroll down every
single time just to grab a player then scroll up to put him", "basic actions feel like a chore so there will defo be
churn", "u thave to reduce cognitive load", "implement global ux patterns".

These rules apply to every screen. The targets are landscape phones first (852x393 iPhone 15, 667x375 iPhone SE),
then iPad (1180x820) and the portal frames (900x506, 800x450).

## 1. One screen, no page scroll

- A screen fits its viewport. The page (the panel) never scrolls on a phone.
- Only a LIST may scroll, inside its own pane (`.pane-scroll`). The thing you act on and the place you act stay on
  screen together: pick a bench player and the pitch is still there to drop him on.
- Lists scroll inside fixed panes. No pane grows the screen.
- Restore a list's scroll position after every re-render, and scroll the selected or current item into view
  (`scrollIntoView({ block: 'nearest' })`).

## 2. The app shell (src/ui/shell.css)

Every menu screen uses the same frame. On short screens (max-height 560 px) it goes full-bleed:

```
.panel.mc.shell        (or .panel.shell for menus.ts panels): a flex column, 100dvh, safe-area padding
  header.mc-top        40 px: back (top-left, always), title + one-line subtitle, coins or the screen's key number
  nav.mc-tabs          34 px segmented tabs (optional)
  .mc-body             flex: 1, min-height: 0. The screen's content, usually two panes:
    .pane              a column: a small pane header, then
      .pane-scroll     the only thing that scrolls
  .mc-actions          optional pinned action bar (primary button on the right)
```

- Opt in per screen: `mountMeta(app, 'club shell')` puts `shell` on the root, and `.meta.shell .panel.mc` gets the
  frame. For panels in menus.ts, add `shell` to `.panel-wrap` and `.panel`.
- Big things (a club banner, long descriptions) do not go above the tabs. Put the key facts in the header subtitle.
- On tall screens (desktop) the same structure shows as the usual centred card, with a fixed height, so it still
  doesn't scroll as a page.

## 3. Master and detail

Any list where you then do something to an item (transfers, training, the shop, players) is two panes. On the left
is the list, with filters as one compact row of chips above it. On the right is the selected item's detail, with its
action button pinned at the bottom of that pane.
- A row tap selects; it never navigates away.
- The first sensible item starts selected, so the detail pane is never empty.

## 4. Tap to select, tap to place, or drag

- Moving things (squad swaps, subs) works by tap then tap with both ends visible, AND by drag and drop (pointer
  events, with a ghost and highlighted drop targets).
- A selected item is obvious (thick outline, lift). Valid targets glow. Tapping the selection again cancels it.

## 5. Do it for me

Every chore gets a one-tap helper:
- squad: AUTO PICK (the best XI for the formation, keepers in goal)
- subs: SUGGESTED SUBS (tired or carded players out)
- training: TRAIN BEST (the cheapest upgrade with the most impact)
- transfers: a FOR YOU sort (biggest upgrade on your weakest position that you can afford)
- rewards: CLAIM ALL
- the hub: PLAY NEXT, and NEXT GOAL under the hero (one line, a tap goes there: meta/goal.ts)
- the academy: PROMOTE BEST (ROAD TO GLORY > CLUB)
- the long season: SIM (an ordinary league match settled in one tap, beside PLAY), and the match length chip on
  the match card
- morale and injuries: ROTATE (the one swap that helps most) and TEAM TALK, beside AUTO PICK (which leaves the
  injured out)
- player development: ALL DEFENDERS (one training focus for a whole position) and AUTO MENTOR (MY CLUB > TRAIN > GROW)
- decisions: event cards come one at a time with two or three answers, each saying what it does; never a spreadsheet
- decisions about a player: his card is on the screen where you decide (ui/playerCard.ts): face, age, position, OVR and
  potential, key stats as bars, this season's apps, goals, assists and average, wage, years, value and morale. A bid
  shows the offer beside his value. A list row of a signing (scout finds, the academy) carries his key stats and wage.
- the squad's numbers: MY CLUB > STATS has the leaders (top scorer, assists, appearances, best average), a SEASON / ALL
  TIME switch, and each player's apps, starts, minutes, goals, assists, rating, cards and man of the match (keepers:
  clean sheets, saves, goals conceded, penalties saved). meta/stats.ts keeps them on the players.
- half time is full time's sibling (the same shell): the score, the best player, four two-sided bars, one row of quick
  actions, one big SECOND HALF
- the ground: the best part to build next starts selected (MY CLUB > STADIUM), so BUILD is one tap

## 6. Less to read

- Labels of one to three words. At most one hint line per screen, and only until the player has done the thing once.
- No paragraphs on phones. Numbers over words (OVR, price, wage).
- The thing to do next is the biggest and brightest element on screen. Everything else is quieter.

## 7. Touch

- Targets of at least 44 px for main actions and at least 36 px for chips and rows. Rows are whole-row tappable.
- Feedback within 100 ms: a pressed state, haptics (src/platform/haptics.ts), sound.
- Toasts appear top centre under the header, short, never over the primary action.

## 8. Memory

- Remember the last tab, filter, sort and selection per screen for the session.
- Back always returns to where you came from, at the same scroll position.

## 9. Taste (unchanged)

No "·", "●", "—" or "–" separators (use `sep()` from src/ui/text.ts). No emojis (use `pixelIcon`). No monospace fonts.
No hyphens in Silkscreen captions. Bold, saturated, chunky blocks.

## 10. Every frame: the fit box (src/ui/fitBox.ts)

CrazyGames rejected the Full Launch (October 2026) for menus that overlapped or ran off screen on iPhones (landscape
under Safari's bars and the portal's banner, and upright) and iPads held upright. The rule since then:

- The menus are designed for landscape frames of at least 667 by 375. A frame outside that (narrower, shorter, or
  upright: width over height under 1.25) lays each menu screen (`#ui > .screen`) out at a landscape design box and
  scales it to fit, centred, with the stadium around it:
  - small landscape frames: the frame scaled up to 375 tall or 667 wide, same shape (640x290 is laid out at 827x375,
    scale 0.77), held at 2.4 to 1 at most;
  - upright frames: 852x480 (an iPad: 820x1100 at 0.96, 930x1250 at 1.09), or 667x375 under 600 wide (a phone: 390x700
    at 0.58).
- Inside the box the screen is its own size container. So every layout rule asks `@container app (...)`, never
  `@media (...)` (#ui is the `app` container everywhere else, so the HUD sees the window as before), and uses
  `var(--vw)`, `var(--vh)`, `var(--dvh)`, `var(--vmin)` and `var(--sa-top)` etc. instead of raw viewport units and
  `env(safe-area-inset-*)`. `@media` is only for `prefers-reduced-motion`, `hover` and `pointer`.
- A rule on the `.screen` element itself still sees the window (an element cannot query itself): give it a
  `#ui.fit > .screen` override in shell.css when it matters.
- Code that turns client rects into scroll offsets or sizes divides by `layoutScale(el)`.
- Every strip or list that holds more than fits scrolls by finger and by mouse drag (src/ui/dragScroll.ts); a mouse
  wheel moves a sideways strip sideways.
- Every pane that scrolls shows a scrollbar that is always visible, on every platform (src/ui/scrollbars.ts,
  installed with dragScroll): a track and a thumb 5px thick on screen, ink on light panels and yellow on dark ones,
  never faded. iOS Safari and macOS hide their own bars until a scroll moves, so CrazyGames' second Full Launch review
  (October 2026) read a cut row of tiles as a broken screen. The pane keeps a gutter for it (padding on the bar's
  side, more where a NEW tag hangs past the tiles), so it never covers a word, a button or a tile. Drag the thumb, or
  tap the track to page. A pane that fits has no bar. Fit first: a bar is for a list that is genuinely long, never an
  excuse for a card or a button row that should fit.
- The smallest labels never draw under 8px on screen in a box shrunk under 0.8 (640x290) or 9px otherwise (700x320 and
  above): fitFloor writes `--fit-floor`, the fitted screen hands it on as `--fs-floor`, and every label under 11px
  takes `font-size: max(its size, var(--fs-floor, 0px))`. A new label under 11px follows the same pattern. (An upright
  phone's 0.58 is past what the floor lifts: its labels stay small.)
- A line that can be too long for its box (LARGE text at 667 wide, a long name) wraps onto a second line or its box
  scrolls; an ellipsis that hides words is a cut.
- Check a change with `__uiAudit()` in the console (dev builds): text that spills or is cut, buttons off the frame or
  cut, interactive elements or text drawn over each other, labels drawn under the floor (`small`), a pane that runs
  past its box without a visible bar (`nobar`, saying why), and a bar over the pane's words or buttons (`bar-over`).
  It should return `[]` on every screen, in MEDIUM and LARGE text, at 640x290, 700x320, 667x375, 852x393, 800x450,
  1080x607, 1180x760, 1920x1080, 820x1100, 930x1250 and 390x700, and at the real iPhone frames inside CrazyGames in
  Safari (its toolbar, the "open in the app" banner and the portal's left rail take the rest): 745x290, 785x282,
  700x280 and 844x300. All four are laid out at 900x375, scale 0.75 to 0.8. Emulate touch at the phone sizes, and
  check the iPhone frames in WebKit (Playwright's) as well as Chrome. (In WebKit, LARGE text's CSS zoom can put the
  audit's hit tests off by the zoom: a `nobar ... under` there is checked on a screenshot before it is believed.)
- Under LARGE text at a box up to 400 tall (every short phone frame, and 852x393), the shop, transfers, MY CLUB,
  quick match, journeys and the season screens keep their MEDIUM size (shell.css), as they already did up to 830 by
  400 (style.css).
- The fit matrix lives outside the repo: a Playwright script that walks every screen (and a match: pause, its sub
  screens, half time, full time) at every size above in MEDIUM and LARGE, touch at the phone sizes, and writes one
  JSON of `__uiAudit()` results with a screenshot of each failure. Run it against a dev server without HMR.
- For CrazyGames: the game is landscape first; on phones ask for landscape only (upright works, scaled small).

## Checklist for every screen

1. Fits 852x393 and 667x375 with no page scroll, and `__uiAudit()` is empty at the sizes in section 10.
2. The primary action is visible without scrolling.
3. Selecting and acting happen with both visible.
4. There is a one-tap helper for the chore.
5. At most one hint line.
6. Works with touch (44 px), mouse, keyboard (Esc goes back) and a gamepad where the screen supports it.

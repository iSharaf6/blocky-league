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

## Checklist for every screen

1. Fits 852x393 and 667x375 with no page scroll.
2. The primary action is visible without scrolling.
3. Selecting and acting happen with both visible.
4. There is a one-tap helper for the chore.
5. At most one hint line.
6. Works with touch (44 px), mouse, keyboard (Esc goes back) and a gamepad where the screen supports it.

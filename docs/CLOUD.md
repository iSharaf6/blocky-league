# Cloud saves and sign-in

Optional account + cloud copy of the save, on Supabase's free tier. The game stays fully playable signed out; the
feature only appears in a build that carries `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, and never in the
CrazyGames / Poki / itch zips (portals forbid login requirements; `scripts/release.mjs` blanks the values for them).

## Status (honest)

| Piece | State |
|---|---|
| `src/platform/cloud.ts`: availability gate, lazy supabase-js, 3-way merge rules, debounce / offline queue / keepalive push, auth actions, toasts | **Implemented**, unit-tested with a mocked client (`tests/cloud.test.ts`) |
| `src/ui/account.ts` + `account.css`: ACCOUNT panel (signed out / signed in), "which save?" choice, toast | **Implemented**; not yet exercised in a browser against a real backend |
| `supabase/migrations/0001_saves.sql`, `supabase/README.md` | **Written**; needs the owner to create the project and run it |
| Google / GitHub / email / guest sign-in | **Needs the owner's project + providers** (OAuth apps in Google Cloud and GitHub; see the README) |
| End-to-end (real sign-in, real rows, two devices, the conflict panel) | **Unverified**: no project exists yet, so nothing has hit a real Supabase |
| Pages build wiring (`.github/workflows/pages.yml` passes the two repository secrets) | Done; inert until the secrets exist |
| Privacy page (`public/privacy.html`) and README still say "no accounts" | **To update when the feature is switched on** (not edited: those files belong to other work) |

## How it behaves

- **Signed out**: nothing runs. `cloudBoot` returns at once; the panel offers GOOGLE / GITHUB / EMAIL LINK / CONTINUE AS
  GUEST and says the game works without any of them.
- **Guest** (`signInAnonymously`): an anonymous Supabase user, so progress is backed up before choosing a provider.
  ADD GOOGLE / ADD GITHUB (`linkIdentity`) or ADD EMAIL (`updateUser`) make it permanent later. A guest that signs
  out cannot sign back in (the panel warns before doing it).
- **On boot with a session**, the cloud row is compared with this device's save three ways, using a per-user marker
  (`localStorage["blocky-league-save-v1:ts"]` = the cloud timestamp last agreed on):
  - only the local side moved → push; only the cloud moved → pull (silently); same data → nothing;
  - both moved, or no marker (first time on this device): a **barely-started** save (no match played, no XP, no
    career, no cup; daily-gift coins don't count) gives way to the other side whatever the dates, so a fresh device
    silently takes the cloud copy and a fresh cloud row is silently overwritten. When both are barely started the
    newer wins. When **both have real progress** a one-time **WHICH SAVE?** panel shows both (level, coins, matches,
    career line, date) and the player picks. Coins are never compared: they go down legitimately (transfers), and
    the career blob is opaque here, so guessing would risk overwriting real play.
  - The marker survives SIGN OUT (it is per user), so signing back in on the same device compares three ways
    instead of asking.
- **Afterwards**: the game's own `persist()` (which stamps `save.updatedAt`) is noticed within 1.5 s and pushed 5 s
  after the last change. Hiding or closing the tab sends one `keepalive` upsert straight to PostgREST (supabase-js
  cannot). Offline: the change waits for the `online` event. A failed push retries every 30 s and shows one toast
  per outage. Nothing here ever blocks play or throws; failures are toasts plus a `[cloud]` console line.
- **Panel actions**: SYNC NOW, LOAD FROM CLOUD (confirm), SIGN OUT (local save kept), DELETE CLOUD SAVE (confirm;
  sync pauses until SYNC NOW so the row is not recreated by the next persist).

## Privacy

Stored in the cloud, only when a player signs in:

- the save JSON as-is (coins, record, settings, career / cup blobs, progress) in `saves.data`, one row per user;
- what Supabase Auth keeps for the sign-in itself: an email address for email / Google / GitHub accounts, the
  provider's user id and the display name it sends, timestamps. Guests have none of that.

No analytics, no other tables, no sharing between users (row level security: each user reads and writes only
their own row). The anon key that ships in the build can do nothing outside those rules. Delete a user in the
Supabase dashboard and the row goes with it. `public/privacy.html` must gain a paragraph saying this before the
feature is switched on publicly.

## Turning it off

Remove the two GitHub Actions secrets (and `.env.local`), rebuild: `cloudAvailable()` is false, the panel says
cloud saves are not set up, and supabase-js is not even fetched (it is a separate chunk loaded on demand only when
the values are present). Existing rows stay in the project until deleted.

## For developers

- Public API used by the menus / boot: `cloudAvailable()`, `cloudUser()`, `openAccount(ctx, onClose)`,
  `cloudBoot(ctx)`; `CloudContext { save, persist, reload }`. `reload(d)` must replace the running save **in place**
  (`Object.assign(save, d)`) or update `ctx.save`, since the rest of the game holds the same object.
- Optional: `markDirty()` after a persist for an immediate note (the watcher catches it anyway),
  `cloudStatus()` / `onCloudChange(fn)` for a badge, `signInAsGuest()` etc. for a "PROTECT YOUR CLUB" prompt elsewhere.
- Bundle: supabase-js lands in its own chunk (`import('@supabase/supabase-js')`), ~150 KB min / ~40 KB gzip,
  loaded only when the build has the values and the page boots; `account.ts` + CSS is another small on-demand chunk.
- Tests: `npx vitest run --maxWorkers=2 tests/cloud.test.ts`.
- Dev: `cp .env.example .env.local`, `npm run dev`; `?portal=poki` previews a portal build and turns the feature off.

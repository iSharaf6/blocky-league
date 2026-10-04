# Optional accounts and cloud saves

The standalone web game and iPhone/iPad app offer ACCOUNT and INVITE FRIENDS. Signing in backs up the club to a
private cloud account; the device keeps its copy. Gameplay remains available without an account and offline.
Google and Apple provider configuration is recorded in [AUTH_SETUP.md](AUTH_SETUP.md).

CrazyGames, Poki and itch builds carry no account backend. Invitations are only exposed in own-site/native builds.

## Verified status — 5 October 2026

The existing Supabase project `kkumittamjteollyxszd` is `ACTIVE_HEALTHY`. All six public tables (`saves`, `profiles`,
`gc_links`, `device_links`, `referrals`, `rate_limits`) have RLS enabled. All four functions (`gc-login`,
`device-login`, `delete-account`, `referral`) are ACTIVE. The public production backend values are enabled;
`VITE_ONLINE_ACCOUNTS` is off, and iOS wraps `dist-ios`.

Google and Apple providers are **disabled**. Their code is wired, but real credentials and provider settings must
be configured before their sign-in can complete. Email is enabled; built-in delivery is limited and full email
sign-in has not been verified. Native Game Center/device sign-in uses the existing deployed edge functions;
a real Apple identity and cross-device sign-in still need device testing.

Focused tests verify PKCE callback validation/cold launch, Apple nonce/name/cancellation handling, save protection,
optional explicit device sign-in, cloud revision rules and invitations. Swift native bridge compilation/signing is
handled by the release build. This does not replace a real Google/Apple sign-in after provider configuration.

## Who signs in, and how (`src/platform/signin.ts`)

| Where | What happens |
|---|---|
| ACCOUNT > USE GAME CENTER / THIS DEVICE, Game Center signed in | `GameCenterPlugin.identity` (Swift) returns Apple's signed identity. The `gc-login` function checks the signature and answers with a session for that player's account. Same player on a new device: same account, same save. |
| The same explicit choice, no Game Center | A **device account**: a random secret kept on the device goes to `device-login`, which answers with a session. Nobody is locked out. |
| A later explicit Game Center connection | The device account **becomes** the Game Center account (nothing to merge). If that player already has an account from another device, the app switches to it and the two saves are compared (below). |
| ACCOUNT in the web game | Google, Apple or email; CONTINUE AS GUEST creates a device account on request. |
| ACCOUNT in the app | Native Apple identity-token sign-in, Google browser PKCE, or explicit Game Center/device account. |
| Portals, itch | Nothing: no backend in the build. |

The functions never see or store a name, an email or a password. Accounts made this way use an address at
`players.blockyleague.invalid` (a reserved domain that can never receive mail) only because the auth service needs
one; it is derived from a hash and shown to nobody.

How a session is made without a password: the function creates the user through the admin API, generates a
one-time sign-in token for it, redeems that token itself, and returns the two session tokens; the game calls
`auth.setSession`.

`gc-login` accepts a request only when: the bundle id is `com.calynx.blockyleague`; the timestamp is at most one
hour old (five minutes ahead); the certificate URL is `https://*.gc.apple.com/...cer`, fetched without following
redirects; the certificate is inside its validity dates; and the RSA-SHA256 signature over
`teamPlayerID + bundleID + timestamp (big-endian UInt64) + salt` verifies with the certificate's key. Limits: the
certificate's chain to Apple's root is not walked (the host and TLS are trusted), and a captured request could be
replayed inside the hour by someone who already intercepted TLS.

## The cloud save (`src/platform/cloud.ts`)

- One row per account in `saves`: the save JSON as it is (opaque to the server), a `version`, the client's
  timestamp, the server's timestamp and a revision `rev`.
- **Sync points:** at launch; 5 s after any change; at once at full time (`syncSoon`); when the app goes to the
  background (a keepalive request); when it comes back after more than a minute (the row is compared again).
- **Optimistic concurrency:** every write names the `rev` it last saw. A write from a stale copy is refused by the
  database (`stale_save`), the row is fetched and compared again. Nothing is overwritten blindly.
- **Which save wins** (three-way, with a per-account marker of the last agreed point):
  - only this device moved: push; only the cloud moved: pull, silently; same data: nothing;
  - both moved, or first time on this device: a barely-started save (no match, no XP, no career, no cup, no
    purchase) gives way to the other; two barely-started saves: the newer wins;
  - **two real saves that both moved: WHICH SAVE?** asks once, showing both. Until the player answers, nothing is
    written to the cloud, so neither is lost (also if the app is closed on the panel).
  - A push whose answer was lost (the app closed, the connection dropped) is recognised as this device's own on
    the next look, so it never causes a question.
- **Sanity caps** (a database trigger): the save must be a JSON object under 256 KB, and `coins` / `gems`, when
  present, must be between 0 and 1,000,000,000. The save is otherwise the player's own data: this is a single-player
  game, so the server stores it and refuses only the absurd. Anything competitive must validate server-side.

## Dormant required-account policy (`src/platform/online.ts`, `src/ui/connect.ts`)

The following policy is available behind `VITE_ONLINE_ACCOUNTS=on`. It is **off** for the current optional-account
release; none of these gates apply. Changing that flag would change the product policy and needs its own review.

- The gate is open when the device is online **and** an account is signed in.
- **Grace:** a connection that drops mid-session keeps everything open for 3 minutes. A match in progress is never
  interrupted; its result is saved on the device and goes up when the connection is back (`never lose a match`).
- Gated at: the hub's tiles (ROAD TO GLORY, MY CLUB, TRANSFERS, SHOP, SEASON, EVENTS, NEXT GOAL, the coins and
  gems), and at kick-off for any match that is not exhibition. Shut, the tiles are greyed and read CONNECT TO PLAY;
  a tap opens the panel (RETRY, BACK). The panel closes itself and carries on the moment the game is connected.
- Known limit: a screen already open when the connection goes (say, the squad) stays usable until the player
  leaves it; the next kick-off or hub tile is where the gate applies.
- First launch: one tap to the basics and the first match (exhibition); the sign-in runs in the background.

## Account deletion

ACCOUNT, DELETE ACCOUNT, YES, DELETE. The `delete-account` function (signed-in callers only, for themselves) deletes
the rows in `saves`, `profiles`, `gc_links`, `device_links` and `referrals`, then the auth user. The app then drops
its session, its device secret and its local progress (a fresh save), and stays signed out for the rest of the
session. Asking to connect again makes a new, empty account. An optional-account launch does not recreate it automatically.
Store purchases belong to the Apple ID and come back through RESTORE PURCHASES.

## Friend codes (`referral` function)

Every account has a 7-character code (ACCOUNT, INVITE FRIENDS, SHARE GAME + MY CODE). The hub also offers INVITE
FRIENDS without an account: it shares only the public game link. Native invitations use the iOS share sheet;
web uses a share sheet or clipboard. The game does not send messages or read contacts. A new player enters a friend's code
after their first win; both get 100 coins, once. Limits: one code per account ever; the account must be at most 30
days old and have a win in its cloud save; not your own code, not a player you invited; a code pays its owner for
at most 20 friends; 10 tries a day per account and 30 per network address. The server records who is owed; the
game adds the coins when `collect` answers, and each side is paid exactly once.

## Privacy

Stored on the server, per account: the save JSON; the account's random id; for a Game Center account the
`teamPlayerID` (an id scoped to this developer, not a name); for a device account a SHA-256 of the device's secret;
the profile (a display name that is always "Player" today, the club's name, the friend code); referral rows. For
players who add Google, Apple, GitHub or email: what that provider sends (email, provider id, display name). Rate
limiting keeps a salted hash of the caller's address for about two days. No analytics, no tracking, no sharing
between players. `public/privacy.html` says the same in plain words.

## Turning it off

Blank the two values in `.env.production` and rebuild: `cloudAvailable()` is false, nothing is gated, and the
backend code is inert (supabase-js is not even fetched). Portal and itch builds are always like this.

## For developers

- Env: `.env.production` holds the project URL and the publishable key (public values; commented out while the
  online-required policy is off). `npm run build:web` and `npm run build:ios` (the `ios` variant in `scripts/release.mjs`) carry
  them; `crazygames`, `poki` and `itch` always get blanks. GitHub Actions secrets with the same names override the
  file when set. `npm run ios` wraps `dist-ios`. `VITE_ONLINE_ACCOUNTS` stays off.
- `npm run dev` does not read `.env.production`, so the dev server is fully local. To switch the backend on in one
  tab: `sessionStorage.setItem('bl-dev-cloud', JSON.stringify({ url, key }))`, then reload. Or use `.env.local`.
- Public API: `cloudAvailable()`, `cloudUser()`, `cloudBoot(ctx)`, `openAccount(ctx, onClose)`, `syncSoon()`,
  `adoptSession(tokens)`, `callFunction(name, body)`; `gateNow()`, `canStart(kind)`, `onGateChange(fn)`;
  `connect(explicit)`, `watchConnection(ctx)`, `deleteAccount(ctx)`. `ctx.reload(d)` must replace the running save in
  place.
- Tests: `npx vitest run tests/cloud.test.ts tests/cloudSync.test.ts tests/online.test.ts tests/signin.test.ts
  tests/gcVerify.test.ts --maxWorkers=2`. `tests/cloudFake.ts` is the test double for the backend.
- Portal gating: `main.ts` loads `platform/signin.ts` and `cloud.ts` loads `ui/account.ts` behind the literal
  `import.meta.env.VITE_PORTAL` checks, so the bundler drops them from portal builds.

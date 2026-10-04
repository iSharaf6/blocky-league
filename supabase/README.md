# Supabase backend for Blocky League

Accounts, cloud saves, account deletion and friend codes. How the game uses them is docs/CLOUD.md.

**State (5 October 2026): optional cloud saves are enabled in production web and iPhone/iPad builds.** The existing
project `kkumittamjteollyxszd` was verified `ACTIVE_HEALTHY`; all six public tables have RLS and all four edge
functions are ACTIVE. The two public values in `.env.production` are enabled. `VITE_ONLINE_ACCOUNTS` stays off:
players choose whether to sign in and can play offline. Google and Apple providers are currently disabled and
require the real console configuration in [docs/AUTH_SETUP.md](../docs/AUTH_SETUP.md). No credentials were invented.

Never put a `service_role` or secret key in the repo or the client. The edge functions read theirs from their own
environment.

## What is in the project

| | |
|---|---|
| `saves` | One row per account: the save JSON, `version`, `client_updated_at`, `updated_at`, `rev`. A trigger (`saves_guard`) refuses a write from a stale `rev`, a save that is not an object, and absurd `coins` / `gems`. Max 256 KB. |
| `profiles` | Display name ("Player"), the club's name, the 7-character friend code. Made on first use by `my_profile()`. |
| `gc_links` | Game Center `teamPlayerID` to account. |
| `device_links` | SHA-256 of a device's secret to account. |
| `referrals` | A friend code used: referrer, referee, coins, when each side collected. |
| `rate_limits` | Request counts per hashed address, for the edge functions. |

Row level security is on for every table, with policies on `(select auth.uid())`: a player reads and writes only
their own `saves` and `profiles` rows, reads their own `gc_links` and `referrals`, and has no access to
`device_links` or `rate_limits` (the edge functions write those with the service role). The `anon` role has no
access to anything. Security advisor: no findings. Performance advisor: two "unused index" notes on new
foreign-key indexes, which is expected until there is traffic.

| Edge function | JWT check | What it does |
|---|---|---|
| `gc-login` | off (Apple's signature is the credential) | Verifies the Game Center identity, finds or makes the account, returns a session. |
| `device-login` | off (the device's secret is the credential) | Finds or makes the device's account, returns a session. |
| `delete-account` | on | Deletes the caller's rows and the account. |
| `referral` | on | `claim` a friend code, `collect` the coins owed. |

The two with the check off still require the project's publishable key in `apikey` and are rate limited per
address.

## Rebuilding it from the repo

Run `migrations/0001_saves.sql` then `migrations/0002_accounts.sql` in the SQL editor (both are safe to re-run),
or `npx supabase link --project-ref <ref>` and `npx supabase db push`. Deploy the functions with
`npx supabase functions deploy gc-login device-login delete-account referral` (`config.toml` sets the JWT checks).

## Production build configuration

The two public backend values are enabled in `.env.production`; `npm run ios` uses `build:ios` and Capacitor wraps
`dist-ios`. Keep `VITE_ONLINE_ACCOUNTS` off for optional accounts and unrestricted offline gameplay. An explicit
ACCOUNT choice can create a Game Center/device account without turning on the old online policy. The Google/Apple
buttons and native return handler are implemented; provider configuration remains required.

The tracked `.env.production.example` backs up the public configuration; copy it to the ignored `.env.production`
after restoring this repository. Configure those same two public build values in GitHub Actions for Pages.

`supabase/pending/docs-when-switched-on.patch` describes the older required-account policy. Do not apply that
patch to this optional-account release. Current privacy copy has been updated directly.

Dashboard (the owner):

1. **Authentication > Sign In / Providers > Email:** leave it enabled. The login functions redeem a one-time
   token through it; no email is ever sent and players never see an address.
2. **Authentication > Rate Limits > Token verifications:** every sign-in from the login functions counts against
   this, from the functions' own addresses. Raise it (to a few thousand an hour) before a launch so a busy day does
   not turn players away. Sessions last, so a player signs in about once per install.
3. **Keep the project awake:** a Free project with no requests for 7 days can be paused. While paused cloud sign-in
   is unavailable; local gameplay remains available. Restore the project in Supabase when needed.
4. The legacy `anon` / `service_role` keys stop working at the end of 2026. The game ships the publishable key and
   the functions prefer the project's secret key, so nothing needs changing.
5. App Store Connect: use the optional-cloud privacy answers in docs/APP_STORE.md. Native Sign in with Apple also
   needs the bundle App ID capability and signing profile; its entitlement and bridge are included in the app.

Google and Apple sign-in work on the native app and web after provider configuration. Native Apple uses an ID
token and needs no expiring OAuth secret; web Apple has separate Services ID/secret requirements. Google uses
PKCE through the native browser. Enable **Manual linking** for guest/device/Game Center identity linking. See
[AUTH_SETUP.md](../docs/AUTH_SETUP.md) for the exact native redirect and console checklist. Email is enabled, but
email delivery and a complete sign-in still need a live test; the built-in sender is limited.

## Google and legacy GitHub provider configuration

Both need an OAuth app that you own; Supabase shows the callback URL to paste into each. It is always
`https://<ref>.supabase.co/auth/v1/callback`.

**Google** (https://console.cloud.google.com, free):
1. Create a project (or reuse one) > **APIs & Services > OAuth consent screen**: External, app name "Blocky League",
   your support email, developer contact. Scopes: none beyond the defaults. Publish it.
2. **Credentials > Create credentials > OAuth client ID** > **Web application**.
   - Authorised JavaScript origins: `https://isharaf6.github.io` and `http://localhost:5173`
   - Authorised redirect URIs: `https://<ref>.supabase.co/auth/v1/callback`
3. Copy the **Client ID** and **Client secret** into Supabase > **Authentication > Sign In / Providers > Google**.

**GitHub** (https://github.com/settings/developers, free):
1. **OAuth Apps > New OAuth App**: name "Blocky League", Homepage `https://isharaf6.github.io/blocky-league/`,
   Authorization callback URL `https://<ref>.supabase.co/auth/v1/callback`.
2. **Generate a new client secret**. Copy the **Client ID** and the secret into Supabase > **Sign In / Providers >
   GitHub**.

**Redirect URLs** (Authentication > URL Configuration): Site URL `https://isharaf6.github.io/blocky-league/`;
Redirect URLs: that, `com.calynx.blockyleague://auth/callback`, and `http://localhost:5173/` for development.

**Email links:** the built-in sender is limited to a few messages an hour; add your own SMTP under
**Authentication > Emails > SMTP settings** before relying on it.

## Deleting data

- A player: ACCOUNT > DELETE ACCOUNT in the game, or **Authentication > Users** > delete the user (every row goes
  with it, `on delete cascade`).
- Everything: delete the project.

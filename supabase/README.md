# Supabase backend for Blocky League

Accounts, cloud saves, account deletion and friend codes. How the game uses them is docs/CLOUD.md.

**State (4 October 2026): the backend is live, the game is not using it yet.** The database and the four edge
functions are applied to the owner's project (`kkumittamjteollyxszd`, Singapore, Free plan). In the repo the
feature is **switched off**: `.env.production` has its three values commented out, so every build is fully local.
Nothing here costs money on the Free plan.

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

## Switching it on (the checklist for resuming)

Code:

1. `.env.production`: uncomment `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_ONLINE_ACCOUNTS=on`. (The
   third is the switch for the silent sign-in and the online rule. If the repository's GitHub Actions secrets set
   the first two, the web build has a backend but, without the third, only the optional ACCOUNT panel as before.)
2. `package.json`: `"ios": "npm run build:ios && npx cap sync ios"`. `capacitor.config.ts`: `webDir: 'dist-ios'`.
3. `git apply supabase/pending/docs-when-switched-on.patch`: the privacy page and the App Store answers, store
   copy and reviewer notes for accounts and the online rule. (It was written against 4 October's files: if it no
   longer applies, make the same edits by hand.) Then delete the `pending` folder.
4. Build and check: `npm run build:ios` and `npm run build:web` report the backend host; `npm run build:crazygames`
   and `npm run build:poki` must not (the release script fails them if they do).
5. On an iPhone signed in to Game Center: first launch signs in silently, a second device with the same Game
   Center player loads the same club, airplane mode shows CONNECT TO PLAY after three minutes, ACCOUNT > DELETE
   ACCOUNT works. This is the one path that could not be run without a device (docs/CLOUD.md, Status).

Dashboard (the owner):

1. **Authentication > Sign In / Providers > Email:** leave it enabled. The login functions redeem a one-time
   token through it; no email is ever sent and players never see an address.
2. **Authentication > Rate Limits > Token verifications:** every sign-in from the login functions counts against
   this, from the functions' own addresses. Raise it (to a few thousand an hour) before a launch so a busy day does
   not turn players away. Sessions last, so a player signs in about once per install.
3. **Keep the project awake:** a Free project with no requests for 7 days is paused, and while it is paused nobody
   new can sign in (so nobody new can play ROAD TO GLORY). Any player activity prevents it; restore is one click.
4. The legacy `anon` / `service_role` keys stop working at the end of 2026. The game ships the publishable key and
   the functions prefer the project's secret key, so nothing needs changing.
5. App Store Connect: nothing new. The Game Center capability is already in the app; the privacy answers are in
   docs/APP_STORE.md once step 3 above is applied.

Optional, for the web game only (the ACCOUNT panel's GOOGLE / GITHUB / EMAIL LINK buttons, which let a player open
the account on another device): enable **Manual linking**, and set up the providers as below. Without them those
buttons show a toast and everything else works.

## Google and GitHub sign-in (web, optional)

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
Redirect URLs: that, `http://localhost:5173/` and `http://localhost:5173/**`.

**Email links:** the built-in sender is limited to a few messages an hour; add your own SMTP under
**Authentication > Emails > SMTP settings** before relying on it.

## Deleting data

- A player: ACCOUNT > DELETE ACCOUNT in the game, or **Authentication > Users** > delete the user (every row goes
  with it, `on delete cascade`).
- Everything: delete the project.

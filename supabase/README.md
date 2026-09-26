# Supabase setup for Blocky League cloud saves

Everything the game needs from the backend is one table (`saves`) and Supabase Auth. Nothing here costs money on
the **Free** plan (no card needed). Until you finish these steps the game runs exactly as before: no accounts,
progress in `localStorage`. The feature switches on by itself when the two values in step 6 reach a build.

Owner-only steps: the code cannot (and must not) create projects, OAuth apps or secrets for you.

## 1. Create the project (free)

1. https://supabase.com/dashboard → **New project**. Any name (e.g. `blocky-league`), a strong database password
   (keep it; the game never uses it), the region closest to your players. Plan: **Free**.
2. Wait for it to provision (about a minute). Note the **Project ref** in the URL: `https://supabase.com/dashboard/project/<ref>`.

Free-plan facts worth knowing: 50 000 monthly active users, 500 MB database, and **a project that gets no
requests for 7 days is paused** (one click in the dashboard restores it; while paused the game just shows
"Cloud sync failed, will keep trying" and plays on locally). Two free projects per account.

## 2. Create the table

Dashboard → **SQL Editor** → **New query** → paste the whole of [`migrations/0001_saves.sql`](migrations/0001_saves.sql) → **Run**.

It creates `public.saves` with row level security so every user can only read / write their own row, and it is
safe to run again. (CLI alternative: `npx supabase link --project-ref <ref>` then `npx supabase db push`.)

Check: **Table Editor** shows `saves` with the columns `user_id, data, version, client_updated_at, updated_at`.

## 3. Auth settings

Dashboard → **Authentication** → **Sign In / Providers** (older dashboards: **Providers** and **Settings**):

- **Email**: leave enabled. The game only sends magic links (no passwords). The built-in email sender is limited to a
  handful of messages per hour and is meant for testing; for real players add your own SMTP under
  **Authentication → Emails → SMTP settings** (free options exist, e.g. Resend / Brevo free tiers) before you rely on it.
- **Anonymous sign-ins**: switch **Allow anonymous sign-ins** ON. This is the CONTINUE AS GUEST button.
- **Manual linking**: switch **Allow manual linking** ON. This lets a guest add Google / GitHub later
  (the "ADD GOOGLE / ADD GITHUB" buttons call `linkIdentity`). Without it those buttons fail with a toast.

## 4. Google and GitHub sign-in

Both providers need an OAuth app that you own; Supabase shows the callback URL to paste into each. It is always
`https://<ref>.supabase.co/auth/v1/callback`.

**Google** (https://console.cloud.google.com, free):
1. Create a project (or reuse one) → **APIs & Services → OAuth consent screen**: External, app name "Blocky League",
   your support email, developer contact. Scopes: none beyond the defaults (email / profile / openid). Publish it
   (or leave in Testing and add yourself as a test user while you try it).
2. **Credentials → Create credentials → OAuth client ID** → type **Web application**.
   - Authorised JavaScript origins: `https://isharaf6.github.io` and `http://localhost:5173`
   - Authorised redirect URIs: `https://<ref>.supabase.co/auth/v1/callback`
3. Copy the **Client ID** and **Client secret** into Supabase → **Authentication → Sign In / Providers → Google**,
   enable it, save.

**GitHub** (https://github.com/settings/developers, free):
1. **OAuth Apps → New OAuth App**: name "Blocky League", Homepage `https://isharaf6.github.io/blocky-league/`,
   Authorization callback URL `https://<ref>.supabase.co/auth/v1/callback`. Register.
2. **Generate a new client secret**. Copy the **Client ID** and the secret into Supabase → **Sign In / Providers →
   GitHub**, enable it, save.

## 5. Redirect URLs (where the browser may land after signing in)

Dashboard → **Authentication → URL Configuration**:

- **Site URL**: `https://isharaf6.github.io/blocky-league/`
- **Redirect URLs** (add each): `https://isharaf6.github.io/blocky-league/`, `http://localhost:5173/`,
  and `http://localhost:5173/**`. If you play the dev server from a phone on your Wi-Fi (`npm run dev` binds
  to the LAN), add that address too, e.g. `http://192.168.1.*:5173/**`.

The game sends the current page URL (origin + path, no query) as `redirectTo`; anything not on this list is refused
by Supabase and the sign-in silently lands on the Site URL.

## 6. Put the two values where the builds read them

Dashboard → **Project Settings → API** (or **API Keys**):

- **Project URL** → `VITE_SUPABASE_URL` (looks like `https://<ref>.supabase.co`)
- **anon / public key** → `VITE_SUPABASE_ANON_KEY`. Newer projects show a *publishable* key (`sb_publishable_...`)
  next to the legacy anon JWT; either works. Never use the `service_role` / secret key: it bypasses row level security.

The anon key is designed to ship in the browser; the row level security from step 2 is what protects the data.

**GitHub Pages (the public playtest):** repo → **Settings → Secrets and variables → Actions → New repository secret**,
twice: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The next push to `main` bakes them into the web build
(`.github/workflows/pages.yml` passes them to `npm run build:web`). Portal / itch zips never get them.

**Local dev:** `cp .env.example .env.local`, fill in both values, `npm run dev`. `.env.local` is git-ignored.

## 7. Check it works

1. Open the game, press **ACCOUNT** → **CONTINUE AS GUEST**. The toast says the progress is backed up; the
   **Table Editor → saves** shows one row.
2. Play a match, wait ~5 s, refresh the table: `client_updated_at` moved.
3. **SIGN OUT**, then **GOOGLE**: after the round trip the panel names you. From another browser, sign in with the
   same Google account: the game loads the cloud save (or asks which to keep if that browser had its own progress).
4. Any failure shows as a small toast at the top; the browser console (`[cloud] ...`) has the detail.

## Turning it off, deleting data

- Off for everyone: delete the two repository secrets (and `.env.local`), push. The next build has no backend
  and the ACCOUNT panel says so. Existing rows stay in the project until you delete them.
- Delete a player's data: **Authentication → Users** → delete the user (the `saves` row goes with it, `on delete cascade`).
- Delete everything: delete the project.

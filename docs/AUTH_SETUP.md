# Google / Apple sign-in and invites

The production web and iPhone/iPad builds carry the existing public Supabase project configuration. Accounts are
optional: `VITE_ONLINE_ACCOUNTS` is off, so signing out, canceling sign-in and losing a connection never lock gameplay.
The device always keeps its save. Native Game Center / device account creation occurs only after the player chooses it.

`.env.production` is ignored locally. The tracked `.env.production.example` preserves only the existing public URL
and publishable key: copy it to `.env.production` after a repository restore. GitHub Pages must receive the same two
build values through its configured Actions secrets; the template contains no server or OAuth credentials.

## Verified status — 5 October 2026

The existing project `kkumittamjteollyxszd` is `ACTIVE_HEALTHY`. Its public Auth settings returned HTTP 200 and:
Google **disabled**, Apple **disabled**, GitHub **disabled**, Email **enabled**, anonymous sign-in **disabled**.
No provider credentials were created or invented. The code and URL scheme are wired; Google/Apple sign-in cannot
complete until the owner configures these providers. A native Game Center/device account uses the existing edge
functions instead. Provider sign-in still needs a real-device check after console configuration.

## Redirects

Supabase **Authentication > URL Configuration**:

- Site URL: `https://isharaf6.github.io/blocky-league/`
- Additional redirect: `com.calynx.blockyleague://auth/callback` (exact, no broad wildcard needed).
- Web redirects: `https://isharaf6.github.io/blocky-league/`; development `http://localhost:5173/` as needed.
- Enable **Manual linking** if a guest, device or Game Center account will add Google/Apple through `linkIdentity`.

The iOS custom scheme is registered in `ios/App/App/Info.plist`; Capacitor's existing SceneDelegate forwards links.
The App plugin consumes both cold launch URLs and `appUrlOpen`. Google opens in the Capacitor Browser, returns a
PKCE code, then `exchangeCodeForSession` validates it. Unrelated links and access-token fragments are ignored.
A new account must compare its cloud club with the local club before any background save can write it.

## Google — web OAuth, including the native browser

1. In Google Auth Platform, configure Branding, Audience and Data Access for Blocky League. Supply the owner’s
   support/developer contact, privacy policy and terms where required. Use only basic sign-in scopes.
2. Create a **Web application** OAuth client. Authorized JavaScript origin: `https://isharaf6.github.io`;
   add `http://localhost:5173` only for development.
3. Authorized redirect URI: `https://kkumittamjteollyxszd.supabase.co/auth/v1/callback`.
   The custom app scheme belongs in Supabase's allowlist, not Google’s provider callback.
4. Put the real Google Client ID and Client Secret in Supabase **Authentication > Sign In / Providers > Google**;
   enable the provider. Publish the consent audience when ready to admit players beyond configured test users.

This browser OAuth path does not require a native Google client ID or a Google iOS SDK.
Never put the OAuth client secret in `.env`, JavaScript or the app bundle.

## Apple — native iOS

1. Enable **Sign in with Apple** for App ID `com.calynx.blockyleague` in Apple Developer Identifiers, and update
   the signing profile. The app's `com.apple.developer.applesignin` entitlement is `Default`.
2. Enable Supabase's Apple provider and include `com.calynx.blockyleague` in **Client IDs**.
3. The registered `NativeAuth` plugin requests Apple's identity token using SHA-256 of a fresh nonce; Supabase
   `signInWithIdToken` receives the token and original nonce. The first-sign-in name is saved when Apple supplies it.

Native-only Apple sign-in requires no Services ID client secret and no six-month OAuth secret rotation.
It signs into the durable Apple account. When that account already has a club, the normal WHICH SAVE? comparison
protects both copies and asks the player which to use.

## Apple — web only

To support the web ACCOUNT button too, register an actual **Services ID** attached to the Apple App ID, enable
Sign in with Apple, configure domain `kkumittamjteollyxszd.supabase.co` and return URL
`https://kkumittamjteollyxszd.supabase.co/auth/v1/callback`, then create and securely keep the `.p8` signing key.
Generate the real OAuth client secret and enter it in Supabase's Apple provider. List the Services ID **first**,
then the native bundle ID, in Client IDs. Apple web OAuth secrets must be renewed every six months; the phone's
native ID-token path is unaffected by that rotation. No Services ID, Team ID or signing key is invented in this repo.

## Invitations

INVITE FRIENDS is on the own-site/native hub and ACCOUNT panel. The share sheet includes the public playtest URL
`https://isharaf6.github.io/blocky-league/`, plus a valid friend code when signed in. It never shares
`capacitor://localhost`, reads contacts or sends a message automatically. Without native sharing, web uses its share
sheet or copies the link. Rewards use the existing server rules: a new account's first win, one referral code,
100 coins each, with existing age/referral/rate limits. This is an invitation to the published web playtest until an
actual App Store URL is available; no App Store app ID has been invented.

## Validation

`tests/cloudAuth.test.ts` exercises exact callback validation, cold/warm app returns, one-use PKCE completion,
existing local progress backup, two established clubs awaiting a choice, Apple nonce and name handling, cancellation,
Google identity linking and native invitations. Existing cloud, sign-in and online tests cover save revisions,
offline retries and the optional-account policy. Provider console configuration and a real Google/Apple sign-in on
an iPhone remain required before describing provider login as operational.

Official guidance: [Supabase Google](https://supabase.com/docs/guides/auth/social-login/auth-google),
[Supabase Apple](https://supabase.com/docs/guides/auth/social-login/auth-apple),
[Supabase redirects](https://supabase.com/docs/guides/auth/redirect-urls),
[Supabase PKCE exchange](https://supabase.com/docs/reference/javascript/auth-exchangecodeforsession),
[Capacitor App](https://capacitorjs.com/docs/apis/app), [Capacitor Browser](https://capacitorjs.com/docs/apis/browser),
[Capacitor Share](https://capacitorjs.com/docs/apis/share).

# Blocky League App Store metadata

Prepared 9 October 2026 for the native iPhone and iPad build. These files are ready to paste into App Store Connect; they do not change the live listing. `metadata.json` is a reference manifest, not an App Store Connect API request.

The authenticated App Store Connect session saved both locales' names and subtitles, version 1.0 promotional text,
descriptions, keywords, support and marketing URLs on 9 October 2026. Games > Sports and Casual were saved.
Build 1.0 (7) is attached to the App Store version draft and approved separately for external TestFlight testing;
no public App Store version has been submitted. See [APP_STORE.md](../../../docs/APP_STORE.md) for live artwork,
age-rating and private beta status. The source files remain the copy reference rather than a publishing mechanism.

| Field | English (Australia) | English (US) | Limit |
|---|---|---|---|
| Name | Blocky League: Football (23) | Blocky League: Soccer (21) | 30 characters |
| Subtitle | Voxel soccer. Build your club. (30) | Voxel football. Build a club. (29) | 30 characters |
| Promotional text | 152 characters | 152 characters | 170 characters |
| Description | 1331 characters | 1333 characters | 4,000 characters |
| Keywords | 99 bytes | 99 bytes | 100 bytes |

The brand remains Blocky League. The localized name identifies the sport; the subtitle pairs its voxel style with the club-building loop. AU copy uses football and kit; US copy uses soccer and uniform. Both descriptions name the actual modes, short match loop and offline guest play.

Use Games as the primary category, with Sports and Casual as the two subcategories. The authenticated App Store Connect category picker was checked on 9 October 2026: it offers Sports and Casual; Arcade is absent from its current taxonomy. The keyword field covers supported player intent: offline play, career management, penalties, shootouts, dribbling, skills, transfers, tactics and controllers. Keywords are comma-separated ASCII with no surrounding spaces and no repeated terms from the name, subtitle or categories. This is a relevance hypothesis; measure App Store search impressions, product-page conversion and downloads after release before changing it.

The native app hides online friendlies and goal-clip downloads. Public copy omits those features and Game Center availability while its console configuration remains pending. Offline play is supported by the current optional-account policy (`VITE_ONLINE_ACCOUNTS` is off). Recheck that statement if the policy changes.

## Files to paste

Each locale folder contains `name.txt`, `subtitle.txt`, `promotional-text.txt`, `description.txt` and `keywords.txt`. Trim the final newline when pasting single-line fields. The same values and counts are in `metadata.json`.

`testflight-beta-description.txt` goes in TestFlight > Test Information > Beta App Description. `testflight-what-to-test.txt` goes in the selected build's What to Test field. `testflight-review-notes.txt` is for TestFlight App Review notes. Keep the beta service-status sentence current when native purchases, Game Center and Apple sign-in have been verified. The feedback email is `calynx@zohomail.com.au`; reviewer contact details belong to the developer, not the first tester.

## Verification and sources

Features were checked against `README.md`, `src/meta/career.ts`, `src/meta/run.ts`, `src/meta/moments.ts`, `src/sim/blitz.ts`, `src/platform/native.ts` and the optional-account configuration. No search-volume or ranking measurements are claimed.

Apple documents name/subtitle limits in [App information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/), and promotional text, description and the 100-byte keyword limit in [Platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/).

[App Store search](https://developer.apple.com/app-store/search/) explains relevance factors, avoiding repeated or irrelevant keyword terms and measuring search performance. [Creating your product page](https://developer.apple.com/app-store/product-page/) guides descriptive, feature-led copy and the first screenshots. Promotional text is a conversion surface and does not affect search ranking.

[Provide test information](https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-test-information/) describes beta descriptions and feedback contacts. [TestFlight purchase testing](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testing-subscriptions-and-in-app-purchases-in-testflight/) confirms the sandbox environment; [Sandbox overview](https://developer.apple.com/help/app-store-connect/test-in-app-purchases/overview-of-testing-in-sandbox/) confirms that sandbox transactions incur no charge.

All sources accessed 9 October 2026. Metadata performance still needs live App Analytics data.

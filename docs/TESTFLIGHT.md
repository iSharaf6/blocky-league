# TestFlight handoff

App Store Connect app: **6819288055**. Bundle: `com.calynx.blockyleague`. Team: `U9Z36KR28N`.
The app supports landscape iPhone and iPad on iOS 15 or later. Build **1.0 (7)** is **Approved** for external
TestFlight testing in the private **Kareem First Beta** group. The group has zero testers, automatic notifications
off and no public link. Manual distribution and the owner's first email invitation remain; Approved is not yet
the distributed Testing state.
[RELEASE_STATUS.md](RELEASE_STATUS.md) records Apple's observed status and the exact QA scope.

## Local release artifacts

`release/testflight/1.0-7/` is ignored by Git. Keep a separate backup of that folder.

- `BlockyLeague.xcarchive`: signed Release archive.
- `export/App.ipa`: App Store distribution export.
- `logs/ios-release-audit.json`: signatures, version, profile, entitlements, privacy, artwork and web asset verification.
- `logs/seo-release-audit.json`: five package fingerprints, canonical URLs and sitemap checks.
- `logs/pages-workflow.json`, `logs/pages-workflow.log`, `logs/live-site-audit.json`: successful Pages deployment and live SEO/artwork verification.
- `simulator-smoke/`: installed icon, title and hub screenshots plus a precise native QA report.
- `proof/testflight-approved.jpg`: the private group's approved build and Notify Testers state.
- `proof/published-game.jpg`: the independently inspected live title screen with the final logo.
- `packages/`: the five release ZIPs and their manifests.
- `what-to-test.txt`, `beta-description.txt`, `review-notes.txt`: prepared beta copy.
- `first-tester.csv`: the owner's first recipient, kept out of tracked files. Use it as a contact reference for a manual email invitation.
- `ExportOptions.plist` and `UploadOptions.plist`: separate local export and Apple upload destinations.

Commit `f44befb613ce76553e5b320c7a9457de71b75018` is published on `main` and `release/ios-app`. Immutable tag
`testflight-build-7-2026-10-09` preserves that verified source. The
[Pages workflow](https://github.com/iSharaf6/blocky-league/actions/runs/37794780439) passed all 1,524 regression
checks, typecheck, packaging and deployment; the live web SEO, support/privacy copy and artwork were verified.

The reusable audit is:

```sh
node scripts/audit-ios-release.mjs \
  release/testflight/1.0-7/BlockyLeague.xcarchive \
  release/testflight/1.0-7/export/App.ipa \
  release/testflight/1.0-7/logs/ios-release-audit.json
```

It verifies current source fingerprints, the synced web bundle, archived and exported assets, code signatures,
Apple sign-in and Game Center entitlements, the UserDefaults privacy declaration, App Store provisioning and
the absence of a debugging entitlement in the IPA. It performs no upload or invitation. Source changes after
packaging require a fresh build; old artifacts cannot be certified against a different checkout.

## Apple upload and private first test

The upload options use normal App Store Connect distribution, allow external TestFlight testing and preserve
the chosen version/build number. The authenticated Xcode account can upload the verified archive with:

```sh
xcodebuild -exportArchive \
  -archivePath release/testflight/1.0-7/BlockyLeague.xcarchive \
  -exportOptionsPlist release/testflight/1.0-7/UploadOptions.plist \
  -exportPath release/testflight/1.0-7/upload \
  -allowProvisioningUpdates
```

Build 7 has already been uploaded successfully; do not re-upload it. For future iterations, increment the build
number, package and audit the new archive, then use that iteration's paths. An exported IPA alone does not
establish that Apple processed or approved the build.

In App Store Connect, open TestFlight and the external **Kareem First Beta** group. Build 7 is already attached,
its What to Test is saved, and Apple approved it with **Automatically notify testers** off. The group has no
public link. Since automatic notifications were disabled, the owner must manually distribute the approved build:
choose **Notify Testers**, then open the group's **Testers > Add Testers** and add/invite the single recipient
by email. The address is in ignored `first-tester.csv`. Adding a tester through the invitation flow sends an
email; do that only when the owner chooses to send. No tester has been added and no invitation or notification
has been sent by this release pass.

Apple documents the [external tester workflow](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/).
Later builds of the same version may have a shorter review. A build waiting for review remains unavailable to
external testers. Keep the existing approved playtest build until the new build is confirmed available.

## Beta feedback

Focus the first session on onboarding, touch controls, scoring and replays, Road to Glory progression,
local match recovery, and menus on the tester's device. Ask for device model, iOS version, steps and a screenshot
when reporting a problem. TestFlight offers screenshot and crash feedback.

Google test ads are still configured. Native purchase products, Game Center definitions and native Apple
sign-in need their respective console or device verification. Guest gameplay remains available. These pending
checks are recorded in the beta notes and must be completed before claiming public monetization readiness.

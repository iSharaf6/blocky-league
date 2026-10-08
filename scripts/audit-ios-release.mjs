#!/usr/bin/env node
// Verify the local archive and App Store IPA before distributing a TestFlight build.
// Usage: node scripts/audit-ios-release.mjs <archive.xcarchive> <export/App.ipa> [audit.json]
// No uploads, account changes or tester invitations are performed.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileFingerprint, isSafeBundlePath, sourceFingerprint } from './release-checks.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [archiveArg, ipaArg, outputArg] = process.argv.slice(2);
if (!archiveArg || !ipaArg || process.argv.length > 5) {
  console.error('Usage: node scripts/audit-ios-release.mjs <archive.xcarchive> <export/App.ipa> [audit.json]');
  process.exit(2);
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const command = (name, args, input) => {
  const result = spawnSync(name, args, { encoding: 'utf8', input, maxBuffer: 8 * 1024 * 1024 });
  assert(!result.error && result.status === 0, `${name} failed: ${result.error || result.stderr.trim() || `exit ${result.status}`}`);
  return result;
};
// plistlib handles dates and binary plists, including embedded signing profiles.
const plistParser = 'import base64, datetime, json, plistlib, sys; data=plistlib.loads(open(sys.argv[1], "rb").read() if len(sys.argv)>1 else sys.stdin.buffer.read()); print(json.dumps(data,default=lambda x: x.isoformat()+"Z" if isinstance(x,datetime.datetime) else base64.b64encode(x).decode("ascii")))';
const plist = (path) => JSON.parse(command('/usr/bin/python3', ['-c', plistParser, path]).stdout);
const xmlPlist = (xml) => JSON.parse(command('/usr/bin/python3', ['-c', plistParser], xml).stdout);
const files = (dir) => {
  const out = [];
  const walk = (current) => {
    for (const name of readdirSync(current).sort()) {
      if (name === '.DS_Store') continue;
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(dir, path));
    }
  };
  walk(dir);
  return out;
};
const compare = (from, to, names) => {
  for (const name of names) {
    assert(existsSync(join(to, name)), `Missing ${name} in ${relative(root, to)}`);
    assert(fileFingerprint(join(from, name)) === fileFingerprint(join(to, name)), `File differs: ${name} in ${relative(root, to)}`);
  }
};
const project = readFileSync(join(root, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
const setting = (name) => {
  const values = [...project.matchAll(new RegExp(`\\b${name} = ([^;]+);`, 'g'))].map((match) => match[1].replace(/^"|"$/g, ''));
  assert(values.length > 0 && new Set(values).size === 1, `Missing or inconsistent ${name}`);
  return values[0];
};
const expected = {
  version: setting('MARKETING_VERSION'),
  build: setting('CURRENT_PROJECT_VERSION'),
  bundleIdentifier: setting('PRODUCT_BUNDLE_IDENTIFIER'),
  team: setting('DEVELOPMENT_TEAM'),
  minimumOSVersion: setting('IPHONEOS_DEPLOYMENT_TARGET'),
};
const nativeSourceFingerprint = () => {
  const hash = createHash('sha256');
  const paths = ['capacitor.config.ts', 'ios/App/App.xcodeproj/project.pbxproj'];
  for (const name of files(join(root, 'ios/App/App'))) if (!name.startsWith('public/')) paths.push(`ios/App/App/${name}`);
  for (const name of paths.sort()) hash.update(name).update('\0').update(readFileSync(join(root, name))).update('\0');
  return hash.digest('hex');
};
const auditApp = (app, distribution) => {
  const info = plist(join(app, 'Info.plist'));
  assert(info.CFBundleShortVersionString === expected.version && info.CFBundleVersion === expected.build, 'Native version/build differs from the Xcode project');
  assert(info.CFBundleIdentifier === expected.bundleIdentifier, 'Wrong native bundle identifier');
  assert(info.MinimumOSVersion === expected.minimumOSVersion, 'Wrong minimum iOS version');
  assert(JSON.stringify(info.UIDeviceFamily) === JSON.stringify([1, 2]), 'App must support iPhone and iPad');
  assert(info.ITSAppUsesNonExemptEncryption === false, 'Unexpected export-compliance configuration');
  const icons = info.CFBundleIcons?.CFBundlePrimaryIcon?.CFBundleIconFiles;
  assert(Array.isArray(icons) && icons.length > 0 && existsSync(join(app, 'Assets.car')), 'Compiled app icon is missing');
  command('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  const entitlements = xmlPlist(command('/usr/bin/codesign', ['-d', '--entitlements', ':-', app]).stdout);
  const profile = xmlPlist(command('/usr/bin/security', ['cms', '-D', '-i', join(app, 'embedded.mobileprovision')]).stdout);
  for (const [label, signed] of [['app', entitlements], ['profile', profile.Entitlements]]) {
    assert(signed?.['application-identifier'] === `${expected.team}.${expected.bundleIdentifier}`, `Wrong ${label} application identifier`);
    assert(signed?.['com.apple.developer.applesignin']?.includes('Default'), `${label} does not allow Apple sign-in`);
    assert(signed?.['com.apple.developer.game-center'] === true, `${label} does not allow Game Center`);
    if (distribution) assert(signed?.['get-task-allow'] === false, `Distribution ${label} permits debugging`);
  }
  assert(entitlements['com.apple.developer.team-identifier'] === expected.team, 'Wrong signed developer team');
  assert(profile.TeamIdentifier?.includes(expected.team), 'Wrong provisioning team');
  assert(new Date(profile.ExpirationDate).getTime() > Date.now(), 'Provisioning profile expired');
  if (distribution) {
    assert(!profile.ProvisionedDevices && !profile.ProvisionsAllDevices, 'IPA must use an App Store distribution profile');
    assert(profile.Entitlements?.['beta-reports-active'] === true, 'IPA profile does not enable beta reports');
  }
  const privacy = plist(join(app, 'PrivacyInfo.xcprivacy'));
  assert(privacy.NSPrivacyAccessedAPITypes?.some((entry) => entry.NSPrivacyAccessedAPIType === 'NSPrivacyAccessedAPICategoryUserDefaults' && entry.NSPrivacyAccessedAPITypeReasons?.includes('CA92.1')), 'UserDefaults privacy reason CA92.1 is missing');
  assert(fileFingerprint(join(app, 'PrivacyInfo.xcprivacy')) === fileFingerprint(join(root, 'ios/App/App/PrivacyInfo.xcprivacy')), 'Privacy declaration differs from source');
  return {
    signatureVerified: true,
    distributionProfileVerified: distribution,
    compiledAppIconPresent: true,
    appleSignInEntitlement: true,
    gameCenterEntitlement: true,
    privacyUserDefaultsReason: 'CA92.1',
    profileExpiry: profile.ExpirationDate,
    deviceFamilies: info.UIDeviceFamily,
  };
};

const archive = resolve(archiveArg);
const ipa = resolve(ipaArg);
const archiveApp = join(archive, 'Products/Applications/App.app');
assert(existsSync(archiveApp) && existsSync(ipa), 'Archive or IPA does not exist');
const sourceHash = sourceFingerprint(root);
const nativeHash = nativeSourceFingerprint();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const basename = `blocky-league-ios-v${pkg.version}`;
const manifest = JSON.parse(readFileSync(join(root, 'release', `${basename}.json`), 'utf8'));
const zip = join(root, 'release', `${basename}.zip`);
assert(manifest.variant === 'ios' && manifest.version === pkg.version, 'Wrong iOS web release manifest');
assert(manifest.sourceHash === sourceHash, 'iOS web bundle was built from stale source');
assert(manifest.zipHash === fileFingerprint(zip), 'iOS web ZIP changed after its build');
const dist = join(root, 'dist-ios');
const nativePublic = join(root, 'ios/App/App/public');
const archivePublic = join(archiveApp, 'public');
const distFiles = files(dist);
const nativeFiles = files(nativePublic);
compare(dist, nativePublic, distFiles);
compare(nativePublic, archivePublic, nativeFiles);
assert(JSON.stringify(nativeFiles) === JSON.stringify(files(archivePublic)), 'Archived web asset inventory differs from Capacitor sync');
const extras = nativeFiles.filter((name) => !distFiles.includes(name)).sort();
assert(JSON.stringify(extras) === JSON.stringify(['cordova.js', 'cordova_plugins.js', 'plugins/cordova-plugin-purchase/www/store.js']), `Unexpected native web assets: ${extras.join(', ')}`);
assert(plist(join(archive, 'Info.plist')).ApplicationProperties.CFBundleVersion === expected.build, 'Archive metadata has the wrong build');
const archiveAudit = auditApp(archiveApp, false);

const zipEntries = command('/usr/bin/unzip', ['-Z1', ipa]).stdout.split('\n').filter(Boolean);
assert(zipEntries.every((entry) => isSafeBundlePath(entry.endsWith('/') ? entry.slice(0, -1) : entry)), 'Unsafe path in IPA');
const extracted = mkdtempSync(join(tmpdir(), 'blocky-league-ipa-audit-'));
try {
  command('/usr/bin/ditto', ['-x', '-k', ipa, extracted]);
  const exportedApp = join(extracted, 'Payload/App.app');
  assert(existsSync(exportedApp), 'IPA is missing Payload/App.app');
  const ipaAudit = auditApp(exportedApp, true);
  const ipaPublic = join(exportedApp, 'public');
  assert(JSON.stringify(files(ipaPublic)) === JSON.stringify(nativeFiles), 'IPA web asset inventory differs from the archive');
  compare(archivePublic, ipaPublic, nativeFiles);
  assert(fileFingerprint(join(archiveApp, 'Assets.car')) === fileFingerprint(join(exportedApp, 'Assets.car')), 'IPA artwork differs from the archive');
  assert(sourceFingerprint(root) === sourceHash && nativeSourceFingerprint() === nativeHash, 'Source changed during verification');
  const result = {
    auditedAt: new Date().toISOString(),
    ...expected,
    sourceFingerprint: sourceHash,
    nativeSourceFingerprint: nativeHash,
    archive: { path: relative(root, archive), ...archiveAudit, webAssetParityVerified: true },
    ipa: {
      path: relative(root, ipa), sha256: fileFingerprint(ipa), bytes: statSync(ipa).size,
      ...ipaAudit, archivePublicByteParityVerified: true, archiveArtworkByteParityVerified: true,
    },
    webAssetCount: nativeFiles.length,
    nativeExtras: extras,
    status: 'Local artifact verified; Apple processing, beta approval and tester availability must be checked in App Store Connect.',
  };
  if (outputArg) writeFileSync(resolve(outputArg), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  rmSync(extracted, { recursive: true, force: true });
}

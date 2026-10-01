import { afterEach, describe, expect, it } from 'vitest';
import { fileFingerprint, isSafeBundlePath, sourceFingerprint } from '../scripts/release-checks.mjs';

// This game typechecks against browser types; release tests run with Node 22+.
declare const process: {
  getBuiltinModule(id: 'node:fs'): {
    mkdtempSync(prefix: string): string;
    mkdirSync(path: string): void;
    rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
    utimesSync(path: string, atime: Date, mtime: Date): void;
    writeFileSync(path: string, value: string): void;
  };
  getBuiltinModule(id: 'node:os'): { tmpdir(): string };
  getBuiltinModule(id: 'node:path'): { join(...paths: string[]): string };
};
const { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } = process.getBuiltinModule('node:fs');
const { tmpdir } = process.getBuiltinModule('node:os');
const { join } = process.getBuiltinModule('node:path');

const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'blocky-release-'));
  temporary.push(root);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'boot.ts'), 'export const ready = true;');
  writeFileSync(join(root, 'src', 'boot.css'), '.boot { opacity: 1 }');
  writeFileSync(join(root, 'package.json'), '{"version":"1.0.0"}');
  return root;
}

describe('portal release verification', () => {
  it('detects changed game/boot source regardless of source timestamps', () => {
    const root = fixture();
    const before = sourceFingerprint(root);
    const css = join(root, 'src', 'boot.css');
    utimesSync(css, new Date(0), new Date(0));
    expect(sourceFingerprint(root)).toBe(before);
    writeFileSync(css, '.boot { opacity: 0 }');
    utimesSync(css, new Date(0), new Date(0));
    expect(sourceFingerprint(root)).not.toBe(before);
  });

  it('includes version and release configuration but ignores files outside the game bundle', () => {
    const root = fixture();
    const before = sourceFingerprint(root);
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs', 'STORE_LISTING.md'), 'New listing');
    expect(sourceFingerprint(root)).toBe(before);
    writeFileSync(join(root, 'package.json'), '{"version":"1.0.1"}');
    expect(sourceFingerprint(root)).not.toBe(before);
  });

  it('detects a replaced upload ZIP', () => {
    const root = fixture();
    const zip = join(root, 'game.zip');
    writeFileSync(zip, 'original upload');
    const before = fileFingerprint(zip);
    writeFileSync(zip, 'a different build');
    expect(fileFingerprint(zip)).not.toBe(before);
  });

  it.each(['index.html', 'assets/index-abc123.js', 'assets/goal...png'])('accepts a portable bundle path %s', (name) => {
    expect(isSafeBundlePath(name)).toBe(true);
  });

  it.each(['', '../outside.js', 'assets/../../outside.js', '/outside.js', '\\outside.js', 'C:\\outside.js', 'C:outside.js', 'assets\\index.js', './index.html', 'assets//index.js', 'assets/./index.js', 'assets/a\0.js'])('rejects unsafe bundle path %s', (name) => {
    expect(isSafeBundlePath(name)).toBe(false);
  });
});

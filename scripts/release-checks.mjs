import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Hash exactly the source/configuration used to produce a release, independent of file timestamps. */
export function sourceFingerprint(root) {
  const files = [];
  const add = (path) => {
    if (!existsSync(path)) return;
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path).sort()) if (name !== '.DS_Store') add(join(path, name));
    } else files.push(path);
  };
  for (const path of ['src', 'public', 'index.html', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'scripts/release.mjs', 'scripts/lib.mjs', 'scripts/release-checks.mjs']) add(join(root, path));
  const hash = createHash('sha256');
  for (const file of files.sort()) hash.update(relative(root, file)).update('\0').update(readFileSync(file)).update('\0');
  return hash.digest('hex');
}

export function fileFingerprint(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Portable relative file paths only; reject traversal before extracting any upload ZIP. */
export function isSafeBundlePath(name) {
  return !!name && !/^[\/\\]|^[a-z]:|[\\\0]/i.test(name) && name.split('/').every((part) => part !== '.' && part !== '..' && part !== '');
}

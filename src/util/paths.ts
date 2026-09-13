import * as path from 'node:path';
import * as fs from 'node:fs';

/** Convert any OS path to a `/` separated path so JSON output is OS independent. */
export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Absolute, resolved, `/` separated path. */
export function absPosix(p: string): string {
  return toPosix(path.resolve(p));
}

/** `true` when `child` is `parent` itself or below it. Both must be absolute. */
export function isInside(parent: string, child: string): boolean {
  const p = toPosix(path.resolve(parent)).replace(/\/+$/, '');
  const c = toPosix(path.resolve(child));
  if (c === p) return true;
  return c.startsWith(p + '/');
}

/** `true` when any path segment is exactly `node_modules`. */
export function hasNodeModulesSegment(p: string): boolean {
  return toPosix(p).split('/').includes('node_modules');
}

/** Path of `target` relative to `from`, `/` separated, never OS specific. */
export function relPosix(from: string, target: string): string {
  return toPosix(path.relative(from, target));
}

/** `fs.realpathSync` that degrades to the input when the path does not exist. */
export function realPathSafe(p: string): string {
  try {
    return toPosix(fs.realpathSync.native(p));
  } catch {
    return toPosix(p);
  }
}

export function existsFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function existsDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Code point order comparison (never locale dependent). See plan section 28.1. */
export function compareCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

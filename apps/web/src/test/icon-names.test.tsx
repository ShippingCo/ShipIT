import {readFileSync,readdirSync} from 'node:fs';
import {join,relative} from 'node:path';
import {expect,it} from 'vitest';
import symbolNames from '../assets/material-symbols/names.json';

/**
 * Only 340 Material Symbols are bundled. `Msym` falls back to `help_outline` for anything
 * else, so a misremembered name does not fail a build or a render — it silently puts a
 * question mark in the interface, and two destinations that should look different stop
 * doing so. This gate reads the source and refuses any name that is not in the bundle.
 */
const bundled = new Set(symbolNames as string[]);
const source = join(__dirname, '..');

function files(directory: string): string[] {
  return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'assets' || entry.name === 'test' ? [] : files(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

it('only uses Material Symbols that are actually bundled', () => {
  // Literal names only: a computed name cannot be checked here, and none is expected.
  const patterns = [/<Msym\s[^>]*name=["']([a-z0-9_]+)["']/g, /\bicon=["']([a-z0-9_]+)["']/g];
  const unknown: string[] = [];
  let checked = 0;
  for (const file of files(source)) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        checked++;
        if (!bundled.has(match[1]!)) unknown.push(`${relative(source, file)}: ${match[1]}`);
      }
    }
  }
  expect(checked).toBeGreaterThan(50);
  expect(unknown).toEqual([]);
});

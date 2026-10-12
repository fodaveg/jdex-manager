import { join } from 'node:path';
import { cwd } from 'node:process';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without types
import * as script from '../scripts/check-min-app-version.mjs';

interface Hit {
  file: string;
  line: number;
  text: string;
  since: string;
  via: string;
}
const { findTooNewApis, isNewer } = script as {
  findTooNewApis: (min: string, options?: { overrides?: Record<string, string> }) => Hit[];
  isNewer: (version: string, than: string) => boolean;
};

const ROOT = cwd();
const PROBE = join(ROOT, 'src', '__probe_min_app__.ts');

describe('minAppVersion guard (scripts/check-min-app-version.mjs)', () => {
  it('compares versions numerically', () => {
    expect(isNewer('1.11.1', '1.7.2')).toBe(true);
    expect(isNewer('1.7.2', '1.7.2')).toBe(false);
    expect(isNewer('1.4.16', '1.7.2')).toBe(false);
  });

  it('passes on the current source for the declared minAppVersion', () => {
    expect(findTooNewApis('1.7.2')).toEqual([]);
  });

  it('fails when the source uses a class declared @since a later version (deliberate negative)', () => {
    const hits = findTooNewApis('1.7.2', {
      overrides: {
        [PROBE]: [
          "import { SecretComponent } from 'obsidian';",
          'export function probe(el: HTMLElement, app: import("obsidian").App) {',
          '  return new SecretComponent(app, el);',
          '}'
        ].join('\n')
      }
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.file.endsWith('__probe_min_app__.ts'))).toBe(true);
    expect(hits.some((hit) => hit.since === '1.11.1')).toBe(true);
  });

  it('fails when a local structural type declares an App member that is too new (deliberate negative)', () => {
    const hits = findTooNewApis('1.7.2', {
      overrides: {
        [PROBE]: [
          'export function probe(host: { loadLocalStorage(key: string): unknown }) {',
          '  return host.loadLocalStorage("k");',
          '}'
        ].join('\n')
      }
    });
    expect(hits.some((hit) => hit.file.endsWith('__probe_min_app__.ts') && hit.text.includes('loadLocalStorage') && hit.since === '1.8.7')).toBe(true);
  });

  it('accepts the same member declared optional, which forces a guard before each call (control)', () => {
    const hits = findTooNewApis('1.7.2', {
      overrides: {
        [PROBE]: [
          'export function probe(host: { loadLocalStorage?(key: string): unknown }) {',
          '  return host.loadLocalStorage?.("k");',
          '}'
        ].join('\n')
      }
    });
    expect(hits).toEqual([]);
  });

  it('is sensitive to the threshold: the same API the plugin uses today is too new for 1.7.1', () => {
    const hits = findTooNewApis('1.7.1');
    expect(hits.some((hit) => hit.text.includes('revealLeaf') && hit.since === '1.7.2')).toBe(true);
  });
});

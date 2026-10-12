import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without types
import * as script from '../scripts/verify-release.mjs';

interface Asset {
  name: string;
  digest?: string | null;
}
const { verifyRelease, parseSums, RELEASE_ASSETS } = script as {
  verifyRelease: (input: {
    reference: Map<string, string>;
    assets: Asset[];
    files: Map<string, Buffer>;
    tag: string;
  }) => { problems: string[]; warnings: string[] };
  parseSums: (text: string) => Map<string, string>;
  RELEASE_ASSETS: string[];
};

const sha = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
const TAG = '9.9.9';

function scenario() {
  const files = new Map<string, Buffer>([
    ['main.js', Buffer.from('main')],
    ['manifest.json', Buffer.from('{}')],
    ['styles.css', Buffer.from('css')],
    ['hebra-main.mjs', Buffer.from('export const activate = 1;')],
    ['hebra-styles.css', Buffer.from('h-css')]
  ]);
  const manifest = {
    version: TAG,
    files: {
      'hebra-main.mjs': `sha256:${sha(files.get('hebra-main.mjs')!)}`,
      'hebra-styles.css': `sha256:${sha(files.get('hebra-styles.css')!)}`
    }
  };
  files.set('hebra.json', Buffer.from(JSON.stringify(manifest)));
  // The reference is taken from the build output, BEFORE upload.
  const reference = new Map([...files].map(([name, buffer]) => [name, sha(buffer)] as const));
  const assets: Asset[] = [...files].map(([name, buffer]) => ({ name, digest: `sha256:${sha(buffer)}` }));
  return { files, reference, assets };
}

describe('verify-release', () => {
  it('accepts six assets that match the reference built before the upload', () => {
    const { files, reference, assets } = scenario();
    expect(verifyRelease({ reference, assets, files, tag: TAG })).toEqual({ problems: [], warnings: [] });
  });

  it('fails when a file is altered after the reference was taken (deliberate negative)', () => {
    const { files, reference, assets } = scenario();
    files.set('main.js', Buffer.from('main, tampered'));
    const { problems } = verifyRelease({ reference, assets, files, tag: TAG });
    expect(problems.some((p) => p.startsWith('main.js: downloaded sha256'))).toBe(true);
  });

  it('fails when GitHub reports a digest different from the built file', () => {
    const { files, reference, assets } = scenario();
    assets.find((a) => a.name === 'styles.css')!.digest = `sha256:${'0'.repeat(64)}`;
    expect(verifyRelease({ reference, assets, files, tag: TAG }).problems.join('\n')).toContain('GitHub digest');
  });

  it('only warns when GitHub gives no digest, and fails on a missing or extra asset', () => {
    const { files, reference, assets } = scenario();
    assets[0].digest = null;
    expect(verifyRelease({ reference, assets, files, tag: TAG }).warnings).toHaveLength(1);
    const extra = [...assets, { name: 'notes.txt', digest: null }];
    expect(verifyRelease({ reference, assets: extra, files, tag: TAG }).problems.join('\n')).toContain('unexpected assets');
    files.delete('styles.css');
    expect(verifyRelease({ reference, assets, files, tag: TAG }).problems.join('\n')).toContain('styles.css: not downloaded');
  });

  it('fails when hebra.json does not describe the published Hebra files or the tag', () => {
    const { files, reference, assets } = scenario();
    expect(verifyRelease({ reference, assets, files, tag: '1.0.0' }).problems.join('\n')).toContain('!= tag 1.0.0');
  });

  it('parses sha256sum output', () => {
    const sums = parseSums(`${'a'.repeat(64)}  main.js\n${'b'.repeat(64)} *styles.css\n`);
    expect(sums.get('main.js')).toBe('a'.repeat(64));
    expect(sums.get('styles.css')).toBe('b'.repeat(64));
    expect(RELEASE_ASSETS).toHaveLength(6);
  });
});

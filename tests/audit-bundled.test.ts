import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without types
import * as script from '../scripts/audit-bundled.mjs';

const { packageOf, shippedHits } = script as {
  packageOf(input: string): string | null;
  shippedHits(audit: unknown, shipped: Set<string>): string[];
};

describe('audit-bundled', () => {
  it('names the innermost package of a bundled input', () => {
    expect(packageOf('node_modules/yaml/dist/index.js')).toBe('yaml');
    expect(packageOf('node_modules/a/node_modules/@s/b/x.js')).toBe('@s/b');
    expect(packageOf('src/main.ts')).toBeNull();
  });

  it('fails on an advisory in a shipped package and ignores one in a dev-only package', () => {
    const audit = {
      vulnerabilities: {
        yaml: { severity: 'high', via: [{ title: 'x' }] },
        moment: { severity: 'moderate', via: [{ title: 'y' }] }
      }
    };
    expect(shippedHits(audit, new Set(['yaml']))).toEqual(['yaml (high)']);
    expect(shippedHits(audit, new Set(['tslib']))).toEqual([]);
  });
});

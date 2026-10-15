import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without types
import * as script from '../scripts/sign-publish.mjs';

const { parseArgs } = script as {
  parseArgs: (argv: string[]) => { tag: string; repo: string; dryRun: boolean };
};

describe('sign-publish arguments', () => {
  it('takes a plain version tag, the project repo by default and no dry run', () => {
    expect(parseArgs(['0.6.1'])).toEqual({ tag: '0.6.1', repo: 'fodaveg/jdex-manager', dryRun: false });
  });

  it('accepts --dry-run and --repo', () => {
    expect(parseArgs(['1.2.3', '--dry-run', '--repo', 'someone/fork'])).toEqual({
      tag: '1.2.3',
      repo: 'someone/fork',
      dryRun: true
    });
  });

  it('refuses a missing or odd tag, an odd repo and unknown options (the tag is interpolated into a jq filter)', () => {
    expect(() => parseArgs([])).toThrow(/usage/);
    expect(() => parseArgs(['v0.6.1'])).toThrow(/usage/);
    expect(() => parseArgs(['0.6.1" or true'])).toThrow(/usage/);
    expect(() => parseArgs(['0.6.1', '--repo', 'no-slash'])).toThrow(/--repo/);
    expect(() => parseArgs(['0.6.1', '--force'])).toThrow(/unknown option/);
    expect(() => parseArgs(['0.6.1', '0.6.2'])).toThrow(/unexpected argument/);
  });
});

import { describe, expect, it } from 'vitest';
import measured from './fixtures/host-set-property-cases.json';
import { fakeSetProperty } from './support/fakes';

interface MeasuredCase {
  name: string;
  body: string;
  key: string;
  value: string | string[] | null;
  result: string;
}

describe('fakeSetProperty behaves like the host setProperty', () => {
  const cases = (measured as { cases: MeasuredCase[] }).cases;

  it('covers the cases the audit asked for', () => {
    const names = cases.map((entry) => entry.name);
    for (const required of [
      'duplicate key is a no-op',
      'flow map continuation is a no-op',
      'null leaves key empty',
      'capitalized key keeps its spelling',
      'inline comment preserved',
      'CRLF replace',
      'block list replaced',
      'no frontmatter'
    ]) {
      expect(names).toContain(required);
    }
  });

  it.each(cases.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    expect(fakeSetProperty(entry.body, entry.key, entry.value)).toBe(entry.result);
  });
});

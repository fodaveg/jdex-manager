import { describe, expect, it } from 'vitest';
import { findJdNumbers } from '../../src/jd/reading-links';
import { maskNonProse } from '../../src/hebra/jdex-markdown-contexts';

const all = () => true;
const found = (text: string) => findJdNumbers(maskNonProse(text), all).map((m) => text.slice(m.start, m.end));

describe('maskNonProse', () => {
  it('keeps the length and the offsets', () => {
    const text = 'a `21.11` b 21.12';
    expect(maskNonProse(text)).toHaveLength(text.length);
    expect(found(text)).toEqual(['21.12']);
  });

  it('leaves prose alone', () => {
    expect(found('ver 21.11 y 21.12.')).toEqual(['21.11', '21.12']);
  });

  it('skips inline code, wikilinks, embeds, link targets and URLs', () => {
    expect(found('`21.11`')).toEqual([]);
    expect(found('``a ` 21.11``')).toEqual([]);
    expect(found('[[21.11 Hebra]]')).toEqual([]);
    expect(found('![[21.11.png]]')).toEqual([]);
    expect(found('[texto](21.11.md)')).toEqual([]);
    expect(found('https://x.org/a/21.11')).toEqual([]);
  });

  it('skips fenced code, with the matching closing fence only', () => {
    expect(found('antes\n```\n21.11\n```\ndespués 21.12')).toEqual(['21.12']);
    expect(found('~~~\n21.11\n```\n21.12\n~~~\n21.13')).toEqual(['21.13']);
    expect(found('```\n21.11 sin cerrar')).toEqual([]);
  });

  it('skips the properties block at the top, and only at the top', () => {
    expect(found('---\nid: 21.11\n---\ncuerpo 21.12')).toEqual(['21.12']);
    expect(found('intro\n---\nid: 21.11\n---\n')).toEqual(['21.11']);
  });
});

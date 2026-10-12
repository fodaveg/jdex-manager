/* eslint-disable @typescript-eslint/unbound-method -- vi.fn members of the vault double are read as values to assert on. */
import { describe, expect, it, vi } from 'vitest';
import { buildIndex } from '../src/jd/index';
import type { Effect } from '../src/jd/journal';
import { retireId } from '../src/vault/retire';
import { FakeObsidianVault } from './support/fake-obsidian-vault';

function setup(frontmatter: string) {
  // The JDex note lives outside the ID folder, so moving the folder never moves the note.
  const path = 'J/21.11 Note.md';
  const folder = '20-29 Area/21 Cat/21.11 Note';
  const v = new FakeObsidianVault();
  for (const dir of ['J', folder, '20-29 Area/21 Cat/21.09 Archive']) v.folder(dir);
  v.file(path, `---\n${frontmatter}---\n# 21.11 Note\n`);
  const index = buildIndex({ systemRoot: '', jdexFolder: 'J', notePaths: [path], folderPaths: ['20-29 Area', '20-29 Area/21 Cat', folder, '20-29 Area/21 Cat/21.09 Archive'] });
  return { v, app: v.app, index, entry: index.ids.find((entry) => entry.id === '21.11')!, path, renameFile: v.app.fileManager.renameFile };
}

describe('Obsidian retirement', () => {
  it('rejects a retired note from live frontmatter without changing its date or folder', async () => {
    const { v, app, index, entry, renameFile, path } = setup('tipo: archivado\narchivado: 2026-09-01\n');
    const before = v.bodies.get(path);
    const effects: Effect[] = [];
    await expect(retireId(app, index, entry, undefined, effects)).rejects.toThrow('Ya retirado el 2026-09-01');
    expect(v.bodies.get(path)).toBe(before);
    expect(renameFile).not.toHaveBeenCalled();
    expect(effects).toEqual([]);
  });

  it('retains the actual frontmatter effect when moving subsequently fails', async () => {
    const { app, index, entry, renameFile } = setup('tipo: id\n');
    vi.mocked(renameFile).mockRejectedValue(new Error('Move failed'));
    const effects: Effect[] = [];
    await expect(retireId(app, index, entry, undefined, effects)).rejects.toThrow('Move failed');
    expect(effects).toMatchObject([{ kind: 'frontmatter-block', before: '---\ntipo: id\n---\n' }]);
    expect((effects[0] as { after: string }).after).toContain('tipo: "archivado"');
  });

  it('moves the ID folder to the archive of its category and leaves the note where it was', async () => {
    const { v, app, index, entry, path } = setup('tipo: id\n');
    const effects: Effect[] = [];
    await retireId(app, index, entry, undefined, effects);
    const moved = effects.find((effect) => effect.kind === 'moved') as { to: string };
    expect(moved.to).toMatch(/^20-29 Area\/21 Cat\/21\.09 Archive\/\d{4}-\d{2}-\d{2} 21\.11 Note$/);
    expect(v.exists(moved.to)).toBe(true);
    expect(v.exists('20-29 Area/21 Cat/21.11 Note')).toBe(false);
    expect(v.exists(path)).toBe(true);
    expect(effects.map((effect) => effect.kind)).toEqual(['frontmatter-block', 'moved', 'line']);
  });
});

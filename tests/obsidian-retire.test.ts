import { describe, expect, it, vi } from 'vitest';
import { type App, TFile } from 'obsidian';
import { buildIndex } from '../src/jd/index';
import type { Effect } from '../src/jd/journal';
import { retireId } from '../src/vault/retire';

function setup(fm: Record<string, unknown>) {
  const path = 'J/21.11 Note.md';
  const folder = '20-29 Area/21 Cat/21.11 Note';
  const index = buildIndex({ systemRoot: '', jdexFolder: 'J', notePaths: [path], folderPaths: ['20-29 Area', '20-29 Area/21 Cat', folder, '20-29 Area/21 Cat/21.09 Archive'] });
  const file = Object.assign(new TFile(), { path });
  const renameFile = vi.fn(async () => {});
  const app = { vault: { getAbstractFileByPath: (p: string) => p === path ? file : p === folder ? { path: folder } : null, read: async () => '# 21.11 Note\n', modify: vi.fn() }, fileManager: { renameFile, processFrontMatter: async (_file: TFile, apply: (fm: Record<string, unknown>) => void) => apply(fm) } } as unknown as App;
  return { app, index, entry: index.ids.find((entry) => entry.id === '21.11')!, renameFile };
}

describe('Obsidian retirement', () => {
  it('rejects a retired note from live frontmatter without changing its date or folder', async () => {
    const fm = { tipo: 'archivado', archivado: '2026-09-01' };
    const { app, index, entry, renameFile } = setup(fm);
    const effects: Effect[] = [];
    await expect(retireId(app, index, entry, undefined, effects)).rejects.toThrow('Ya retirado el 2026-09-01');
    expect(fm.archivado).toBe('2026-09-01');
    expect(renameFile).not.toHaveBeenCalled();
    expect(effects).toEqual([]);
  });

  it('retains the actual frontmatter effect when moving subsequently fails', async () => {
    const { app, index, entry, renameFile } = setup({ tipo: 'id' });
    renameFile.mockRejectedValue(new Error('Move failed'));
    const effects: Effect[] = [];
    await expect(retireId(app, index, entry, undefined, effects)).rejects.toThrow('Move failed');
    expect(effects).toMatchObject([{ kind: 'frontmatter', previous: { tipo: 'id' } }]);
  });
});

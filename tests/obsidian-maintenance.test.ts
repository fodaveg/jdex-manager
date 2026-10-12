/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from 'vitest';
import { type App, TFile, TFolder } from 'obsidian';
import { mergeSettings } from '../src/jd/settings';
import type { Effect } from '../src/jd/journal';
import { maintainSystem } from '../src/vault/maintenance';
import { onceNotifier } from '../src/vault/maintenance-gate';
import { collectAudit } from '../src/vault/audit';
import { createSystemReport } from '../src/vault/system-report';
import { readFrontmatter } from '../src/vault/frontmatter-lines';

function fixture() {
  const folderPaths = ['J', 'Reports', '20-29 Area', '20-29 Area/21 Cat', '20-29 Area/21 Cat/21.01 Inbox', '20-29 Area/21 Cat/21.11 Different'];
  const folders = folderPaths.map((path) => Object.assign(new TFolder(), { path }));
  // The frontmatter lives in the text, as in a vault; the metadata cache derives from it.
  const manual = '---\ndescripcion: Manual description\n---\n';
  const bodies = new Map([
    ['J/21.11 Note.md', `${manual}# 21.11 Note\n\nManual prose.\n`],
    ['J/21.10 ■ Header.md', `${manual}# 21.10 ■ Header\n\n<!-- jdex:hijos -->\n<!-- /jdex:hijos -->\n`],
    ['J/00.00 Index.md', `${manual}# 00.00 Index\n\n<!-- jdex:indice -->\n<!-- /jdex:indice -->\n`],
    ['20-29 Area/21 Cat/21.01 Inbox/old.pdf', 'pdf'],
  ]);
  const fm = { get: (path: string) => readFrontmatter(bodies.get(path) ?? '') ?? undefined };
  const files = [...bodies.keys()].map((path) => Object.assign(new TFile(), { path, name: path.split('/').pop(), basename: path.split('/').pop()!.replace(/\.[^.]+$/, ''), extension: path.endsWith('.md') ? 'md' : 'pdf', parent: { path: path.slice(0, path.lastIndexOf('/')) }, stat: { ctime: 1, mtime: 1 } }));
  const create = vi.fn(async (path: string, body: string) => {
    const file = Object.assign(new TFile(), { path, basename: path.split('/').pop()!.slice(0, -3), extension: 'md', parent: { path: 'Reports' }, stat: { ctime: files.length, mtime: files.length } });
    bodies.set(path, body); files.push(file); return file;
  });
  const app = { vault: {
    getAllLoadedFiles: () => [...folders, ...files], getMarkdownFiles: () => files.filter((file) => file.extension === 'md'),
    getAbstractFileByPath: (path: string) => [...folders, ...files].find((file) => file.path === path) ?? null,
    read: async (file: TFile) => bodies.get(file.path)!, cachedRead: async (file: TFile) => bodies.get(file.path)!,
    process: vi.fn(async (file: TFile, transform: (current: string) => string) => { const body = transform(bodies.get(file.path)!); bodies.set(file.path, body); return body; }), create,
  }, metadataCache: { getFileCache: (file: TFile) => ({ frontmatter: fm.get(file.path) }) }, fileManager: {
    renameFile: vi.fn(), trashFile: vi.fn(),
  } } as unknown as App;
  return { app, bodies, fm, files, settings: mergeSettings({ jdexFolder: 'J', reportsFolder: 'Reports' }) };
}

describe('Obsidian optional maintenance', () => {
  it('is off by default and only updates derived fields and managed blocks when enabled', async () => {
    const { app, settings, bodies, fm } = fixture();
    const effects: Effect[] = [];
    await maintainSystem(app, settings, effects);
    expect(effects).toEqual([]);
    settings.automaticMaintenance = true;
    await maintainSystem(app, settings, effects);
    expect(fm.get('J/21.11 Note.md')).toMatchObject({ jd: '21.11', tipo: 'id', descripcion: 'Manual description' });
    expect(bodies.get('J/21.11 Note.md')).toContain('Manual prose');
    expect(bodies.get('J/21.10 ■ Header.md')).toContain('[[21.11 Note]]');
    expect(bodies.get('J/00.00 Index.md')).toContain('21.11 Note');
    expect(app.fileManager.renameFile).not.toHaveBeenCalled();
    expect(app.fileManager.trashFile).not.toHaveBeenCalled();
    expect(app.vault.create).not.toHaveBeenCalled();
    // Frontmatter fixes are exact rewrites now, like the managed blocks.
    const rewritten = effects.flatMap((effect) => effect.kind === 'note-rewrite' ? [effect.path] : []);
    expect(rewritten).toContain('J/21.11 Note.md');
    expect(rewritten).toContain('J/21.10 ■ Header.md');
    expect(rewritten).toContain('J/00.00 Index.md');
    expect(effects.some((effect) => effect.kind === 'frontmatter')).toBe(false);
    const next: Effect[] = [];
    await maintainSystem(app, settings, next);
    expect(next).toEqual([]);
  });

  it('reports an index note without markers on every pass, so the caller can show it once per session', async () => {
    const { app, settings, bodies } = fixture();
    settings.automaticMaintenance = true;
    bodies.set('J/00.00 Index.md', '# 00.00 Index\n\nNo markers here.\n');
    const warn = vi.fn();
    const shown = vi.fn();
    const once = onceNotifier(shown);
    for (let pass = 0; pass < 3; pass++) await maintainSystem(app, settings, [], (message) => { warn(message); once(message); });
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls[0][0]).toContain('has no <!-- jdex:indice --> markers');
    expect(shown).toHaveBeenCalledTimes(1);
  });
  it('audits inbox attachments by creation time and keeps previous reports when generating another', async () => {
    const { app, settings, bodies } = fixture();
    expect((await collectAudit(app, settings)).findings.filter((finding) => finding.kind === 'inbox-stale')).toHaveLength(1);
    const effects: Effect[] = [];
    const first = await createSystemReport(app, settings, effects, '2026-10-05');
    const before = bodies.get(first.path);
    await app.vault.create('Reports/Informe JD - 2026-10-06.md', '# Edited invalid report');
    const second = await createSystemReport(app, settings, effects, '2026-10-05');
    expect(second.path).toBe('Reports/Informe JD - 2026-10-05 (2).md');
    expect(bodies.get(first.path)).toBe(before);
    expect(bodies.get(second.path)).toContain('Sin cambios en los indicadores');
    expect(effects.filter((effect) => effect.kind === 'created-note')).toHaveLength(2);
  });
  it('preserves prose edited between reading a managed note and committing its block', async () => {
    const { app, settings, bodies } = fixture();
    settings.automaticMaintenance = true;
    // `process` is already a vi.fn: take its implementation BEFORE replacing it (Vitest 5 spies on the
    // same mock, so binding the mock itself would recurse into the replacement).
    const process = vi.mocked(app.vault.process).getMockImplementation()!;
    vi.spyOn(app.vault, 'process').mockImplementation(async (file, transform) => {
      bodies.set(file.path, bodies.get(file.path)! + '\nConcurrent prose.\n');
      return process(file, transform);
    });
    const effects: Effect[] = [];
    await maintainSystem(app, settings, effects);
    for (const effect of effects) if (effect.kind === 'note-rewrite') {
      expect(effect.before).toContain('Concurrent prose.');
      expect(effect.after).toContain('Concurrent prose.');
      expect(bodies.get(effect.path)).toContain('Concurrent prose.');
    }
  });

});

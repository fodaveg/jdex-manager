// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEBUG_LOG_TITLE, DEFAULT_SETTINGS } from '../../src/hebra/engine';
import { createJdexDebugLog } from '../../src/hebra/jdex-debug-log';
import { activateJdex } from '../../src/hebra/jdex-runtime';
import { loadJdexSettings } from '../../src/hebra/settings';
import type { JdexLibraryWalk } from '../../src/hebra/library-index';
import { createJdexTestApi, FakeJdexVault, fakeFolder, fakeNote } from './support/fakes';

const REPORTS = '00-09 Sistema/00 Sistema/00.02 Informes';
const JDEX = '00-09 Sistema/00 Sistema/00.00 JDex';

function logSetup(debugLog = true) {
  const vault = new FakeJdexVault();
  vault.seedFolder(fakeFolder('reports', null, 'Informes'));
  const walk: JdexLibraryWalk = { rootFolderId: vault.rootFolderId(), folderPaths: new Map([['reports', 'Informes']]), systemFolderPaths: ['Informes'], systemNotes: [] };
  const settings = { debugLog, reportsFolder: 'Informes' };
  const log = createJdexDebugLog(vault, () => ({ settings, walk }));
  return { vault, log, settings };
}

async function logNote(vault: FakeJdexVault) {
  const page = await vault.notesPage(null, 200, { kind: 'folder', folderId: 'reports' });
  return page.items.find((note) => note.title === DEBUG_LOG_TITLE);
}

describe('Hebra debug log writer', () => {
  it('writes nothing while the setting is off', async () => {
    const { vault, log } = logSetup(false);
    await log.record('rebuild', new Error('x'));
    expect(await logNote(vault)).toBeUndefined();
  });

  it('creates the note in the reports folder, then appends with the checked rewrite', async () => {
    const { vault, log } = logSetup();
    await log.record('rebuild', new TypeError('contenido de una nota'), 'Informes/x.md');
    const created = (await logNote(vault))!;
    expect(created.title).toBe(DEBUG_LOG_TITLE);
    expect(vault.rewriteCalls).toHaveLength(0);
    await log.record('reparar', new Error('otro'));
    const body = (await vault.noteRead(created.id))!.body!;
    expect(vault.rewriteCalls).toHaveLength(1);
    expect(body.split('\n').filter((line) => line.startsWith('- 20')).map((line) => line.split(' | ')[1])).toEqual(['rebuild', 'reparar']);
    expect(body).not.toContain('contenido de una nota');
    expect(log.isOwn(created.id)).toBe(true);
    expect(log.isOwnChange([created.id])).toBe(true);
    expect(log.isOwnChange([created.id, 'other'])).toBe(false);
    expect(log.isOwnChange([])).toBe(false);
  });

  it('re-reads a note edited by hand between the read and the write instead of overwriting it', async () => {
    const { vault, log } = logSetup();
    await log.record('a', new Error('e'));
    const id = (await logNote(vault))!.id;
    const original = vault.notesRewriteBatch.bind(vault);
    let first = true;
    vi.spyOn(vault, 'notesRewriteBatch').mockImplementation(async (entries, options) => {
      if (first) {
        first = false;
        vault.saveElsewhere(id, `${(await vault.noteRead(id))!.body}Mi apunte a mano.\n`);
      }
      return original(entries, options);
    });
    await log.record('b', new Error('e'));
    const body = (await vault.noteRead(id))!.body!;
    expect(body).toContain('Mi apunte a mano.');
    expect(body).toContain('| b |');
  });

  it('swallows a failing vault', async () => {
    const { vault, log } = logSetup();
    vi.spyOn(vault, 'notesPage').mockRejectedValue(new Error('boom'));
    await expect(log.record('a', new Error('e'))).resolves.toBeUndefined();
  });
});

describe('Hebra debug log setting', () => {
  it('is stored as a boolean and off by default', async () => {
    const storage = { load: async () => ({ debugLog: true }) as never, save: async () => undefined };
    expect((await loadJdexSettings(storage)).debugLog).toBe(true);
    expect((await loadJdexSettings({ ...storage, load: async () => ({ debugLog: 'yes' }) as never })).debugLog).toBe(false);
    expect(DEFAULT_SETTINGS.debugLog).toBe(false);
  });
});

describe('Hebra runtime feeds the debug log', () => {
  afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); });

  async function runtime(debugLog: boolean) {
    const vault = new FakeJdexVault();
    for (const folder of [
      fakeFolder('sys', null, '00-09 Sistema'), fakeFolder('sys-cat', 'sys', '00 Sistema'),
      fakeFolder('jdex', 'sys-cat', '00.00 JDex'), fakeFolder('reports', 'sys-cat', '00.02 Informes'),
      fakeFolder('area', null, '20-29 Productos'), fakeFolder('cat', 'area', '21 Software'),
    ]) vault.seedFolder(folder);
    vault.seedNote(fakeNote('n-id', 'jdex', '# 21.11 Antes #claude\n\nDescripción.\n'));
    const { api, workspace } = await createJdexTestApi({ vault, settings: { ...DEFAULT_SETTINGS, jdexFolder: JDEX, reportsFolder: REPORTS, debugLog, automaticMaintenance: true } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cleanup = await activateJdex(api);
    return { vault, workspace, cleanup };
  }

  async function failARebuild(vault: FakeJdexVault, workspace: { emitFolders(f: Awaited<ReturnType<FakeJdexVault['foldersList']>>): void }) {
    vi.useFakeTimers();
    const folders = await vault.foldersList();
    vi.spyOn(vault, 'foldersList').mockRejectedValue(new Error('texto de una nota'));
    workspace.emitFolders(folders);
    await vi.advanceTimersByTimeAsync(2000);
    vi.useRealTimers();
    await vi.waitFor(() => undefined);
  }

  it('a failed rebuild lands in the log note when the setting is on, and the note is then ignored', async () => {
    const { vault, workspace, cleanup } = await runtime(true);
    await failARebuild(vault, workspace);
    const page = await vault.notesPage(null, 200, { kind: 'folder', folderId: 'reports' });
    const note = page.items.find((item) => item.title === DEBUG_LOG_TITLE)!;
    expect(note).toBeDefined();
    const body = (await vault.noteRead(note.id))!.body!;
    expect(body).toMatch(/\| (rebuild[\w-]*|reconstruir[\w-]*) \|/u);
    expect(body).not.toContain('texto de una nota');

    // A change event about the log note alone starts no update and no maintenance write.
    vi.useFakeTimers();
    const reads = vi.spyOn(vault, 'noteSummary');
    const writes = vault.rewriteCalls.length;
    workspace.emitNotes({ ids: [note.id], reason: 'save' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(reads).not.toHaveBeenCalled();
    expect(vault.rewriteCalls).toHaveLength(writes);
    await cleanup();
  });

  it('writes nothing with the setting off', async () => {
    const { vault, workspace, cleanup } = await runtime(false);
    await failARebuild(vault, workspace);
    const page = await vault.notesPage(null, 200, { kind: 'folder', folderId: 'reports' });
    expect(page.items.some((item) => item.title === DEBUG_LOG_TITLE)).toBe(false);
    await cleanup();
  });
});

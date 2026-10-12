// @vitest-environment happy-dom
/**
 * Contract of the Hebra test doubles against what the host does. The cases live in
 * `fixtures/host-vault-cases.json` (read from the Hebra source, see its `source` field);
 * `host-set-property.test.ts` holds the 32 measured `setProperty` cases. If a double drifts
 * from a case, this test fails: change the double, never the case, unless the host changed.
 */
import { describe, expect, it, vi } from 'vitest';
import cases from './fixtures/host-vault-cases.json';
import {
  bodySha256Of,
  createJdexTestApi,
  FakeJdexVault,
  FakeWorkspace,
  fakeFolder,
  fakeFrontmatter,
  fakeNote,
  HOST_REWRITE_BATCH_MAX,
  titleOf,
  withVaultCapabilities
} from './support/fakes';

const expand = (text: string): string =>
  text.replace(/\{(.)\*(\d+)\}/gu, (_all, char: string, count: string) => char.repeat(Number(count)));

describe('FakeJdexVault.titleOf against the host title rule', () => {
  it.each(cases.titles)('$name', ({ body, title }) => {
    expect(titleOf(expand(body))).toBe(expand(title));
  });
});

describe('FakeJdexVault hashes', () => {
  it('derives the hash from the body: the same body has the same hash, another one does not', async () => {
    const vault = new FakeJdexVault();
    const a = await vault.noteCreate({ folderId: null, body: '# Igual\n' });
    const b = await vault.noteCreate({ folderId: null, body: '# Igual\n' });
    const c = await vault.noteCreate({ folderId: null, body: '# Otro\n' });
    expect(a.revision.bodySha256).toBe(b.revision.bodySha256);
    expect(a.revision.bodySha256).toBe(bodySha256Of('# Igual\n'));
    expect(c.revision.bodySha256).not.toBe(a.revision.bodySha256);
    // SHA-256 of the empty string: a real digest, not an id-and-counter label.
    expect(bodySha256Of('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('a rewrite stores the hash of the stored body and bumps the sequence by one', async () => {
    const vault = new FakeJdexVault();
    vault.seedNote(fakeNote('n1', 'f1', '# Antes\n'));
    const before = (await vault.noteRead('n1'))!;
    const result = await vault.notesRewriteBatch([{ id: 'n1', body: '# Después\n', expected: before.revision }]);
    expect(result.committed[0].revision).toEqual({ localSeq: before.revision.localSeq + 1, bodySha256: bodySha256Of('# Después\n') });
  });
});

describe('FakeJdexVault.notesRewriteBatch against the host revision rules', () => {
  it.each(cases.rewriteRevision)('$name', async ({ strict, seq, hash, outcome }) => {
    const vault = new FakeJdexVault();
    vault.seedNote({ ...fakeNote('n1', 'f1', '# Antes\n'), revision: { localSeq: 5, bodySha256: bodySha256Of('# Antes\n') } });
    const expected = {
      localSeq: seq === 'same' ? 5 : 4,
      bodySha256: hash === 'same' ? bodySha256Of('# Antes\n') : bodySha256Of('# Leído antes\n')
    };
    const result = await vault.notesRewriteBatch([{ id: 'n1', body: '# Mío\n', expected, ...(strict ? { strictRevision: true } : {}) }]);
    expect(outcome === 'written' ? result.written : result.stale).toEqual(['n1']);
    expect(outcome === 'written' ? result.stale : result.written).toEqual([]);
    expect(vault.peekBody('n1')).toBe(outcome === 'written' ? '# Mío\n' : '# Antes\n');
  });

  it('accepts an upper-case expected hash, as the host lowercases it', async () => {
    const vault = new FakeJdexVault();
    vault.seedNote(fakeNote('n1', 'f1', '# Antes\n'));
    const note = (await vault.noteRead('n1'))!;
    const result = await vault.notesRewriteBatch([{ id: 'n1', body: '# Mío\n', expected: { localSeq: 99, bodySha256: note.revision.bodySha256.toUpperCase() } }]);
    expect(result.written).toEqual(['n1']);
  });

  it('a protected note rejects the WHOLE batch with note-locked and writes nothing', async () => {
    const vault = new FakeJdexVault();
    vault.seedNote(fakeNote('free', 'f1', '# Libre\n'));
    vault.seedNote(fakeNote('locked', 'f1', '# Cerrada\n'));
    vault.setLocked('locked', true);
    const free = (await vault.noteRead('free'))!;
    const locked = (await vault.noteRead('locked'))!;
    await expect(
      vault.notesRewriteBatch([
        { id: 'free', body: '# Cambiada\n', expected: free.revision },
        { id: 'locked', body: '# Cambiada\n', expected: locked.revision }
      ])
    ).rejects.toMatchObject({ name: 'PluginApiError', code: 'note-locked' });
    expect(vault.peekBody('free')).toBe('# Libre\n');
  });

  it('a purged note is stale AND missing; the rest of the batch still goes through', async () => {
    const vault = new FakeJdexVault();
    vault.seedNote(fakeNote('n1', 'f1', '# Uno\n'));
    vault.seedNote(fakeNote('n2', 'f1', '# Dos\n'));
    const n1 = (await vault.noteRead('n1'))!;
    const n2 = (await vault.noteRead('n2'))!;
    vault.purge('n2');
    const result = await vault.notesRewriteBatch([
      { id: 'n1', body: '# Uno bis\n', expected: n1.revision },
      { id: 'n2', body: '# Dos bis\n', expected: n2.revision }
    ]);
    expect(result).toMatchObject({ written: ['n1'], stale: ['n2'], missing: ['n2'] });
  });

  it('without a missing note the result carries no `missing` field', async () => {
    const vault = new FakeJdexVault();
    vault.seedNote(fakeNote('n1', 'f1', '# Uno\n'));
    const result = await vault.notesRewriteBatch([{ id: 'n1', body: '# Uno bis\n', expected: (await vault.noteRead('n1'))!.revision }]);
    expect(result).not.toHaveProperty('missing');
  });

  it('a trashed note is not locked: the host rewrites it like any live row (read from the engine, not measured)', async () => {
    const vault = new FakeJdexVault();
    vault.seedNote(fakeNote('n1', 'f1', '# Uno\n'));
    vault.setTrashed('n1', true);
    const result = await vault.notesRewriteBatch([{ id: 'n1', body: '# Uno bis\n', expected: (await vault.noteRead('n1'))!.revision }]);
    expect(result.written).toEqual(['n1']);
  });

  it(`rejects more than ${HOST_REWRITE_BATCH_MAX} entries with invalid-argument`, async () => {
    const vault = new FakeJdexVault();
    const entries = Array.from({ length: HOST_REWRITE_BATCH_MAX + 1 }, (_v, i) => ({ id: `n${i}`, body: '', expected: { localSeq: 1, bodySha256: '' } }));
    await expect(vault.notesRewriteBatch(entries)).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});

describe('FakeJdexVault.folderTrashEmpty against the host', () => {
  it.each(cases.folderTrashEmpty)('$name', async (spec) => {
    const vault = new FakeJdexVault();
    vault.seedFolder(fakeFolder('f1', null, 'Padre'));
    vault.seedFolder(fakeFolder('f2', null, 'Otro padre'));
    const parentId = 'folderAtRoot' in spec && spec.folderAtRoot ? vault.rootFolderId() : 'f1';
    vault.seedFolder(fakeFolder('target', parentId, '70 Adjuntos'));
    for (const child of spec.children) {
      if (child === 'folder') vault.seedFolder(fakeFolder('child', 'target', 'Hija'));
      else vault.seedNote(fakeNote('inside', 'target', '# Dentro\n'));
      if (child === 'trashed-note') vault.setTrashed('inside', true);
    }
    const id = 'target' in spec && spec.target === 'root' ? vault.rootFolderId() : 'target';
    const expectedParent = spec.expected.parent;
    expect(await vault.folderTrashEmpty(id, { name: spec.expected.name, parentId: expectedParent })).toBe(spec.result);
    const stillThere = (await vault.foldersList()).some((folder) => folder.id === 'target');
    expect(stillThere).toBe(!spec.result);
  });
});

describe('withVaultCapabilities against the host gate', () => {
  const read = ['vault.read'] as const;

  it('a read-only plugin reads but every write rejects with capability-not-declared', async () => {
    const vault = withVaultCapabilities(new FakeJdexVault(), read);
    await expect(vault.foldersList()).resolves.toEqual([]);
    await expect(vault.noteCreate({ folderId: null, body: '# X\n' })).rejects.toMatchObject({ name: 'PluginApiError', code: 'capability-not-declared' });
    await expect(vault.notesRewriteBatch([])).rejects.toMatchObject({ code: 'capability-not-declared' });
    await expect(vault.folderCreate(null, 'X')).rejects.toMatchObject({ code: 'capability-not-declared' });
  });

  it('a plugin with no vault capability cannot read either; the synchronous accessors throw', async () => {
    const vault = withVaultCapabilities(new FakeJdexVault(), []);
    await expect(vault.noteRead('n1')).rejects.toMatchObject({ code: 'capability-not-declared' });
    expect(() => vault.libraryId()).toThrow(/sin declarar/u);
  });

  it('with both capabilities the calls reach the vault', async () => {
    const vault = withVaultCapabilities(new FakeJdexVault(), ['vault.read', 'vault.write']);
    const note = await vault.noteCreate({ folderId: null, body: '# X\n' });
    expect((await vault.noteRead(note.id))?.title).toBe('X');
  });

  it('createJdexTestApi can hand the plugin a gated vault', async () => {
    const { api } = await createJdexTestApi({ vault: withVaultCapabilities(new FakeJdexVault(), read) });
    await expect(api.vault.folderCreate(null, 'X')).rejects.toMatchObject({ code: 'capability-not-declared' });
  });
});

describe('FakeWorkspace listener isolation (host workspace-bridge emit)', () => {
  it('a listener that throws is recorded and the others still run', () => {
    const workspace = new FakeWorkspace();
    const second = vi.fn();
    workspace.api.onFoldersChange(() => {
      throw new Error('listener roto');
    });
    workspace.api.onFoldersChange(second);
    workspace.emitFolders([]);
    expect(second).toHaveBeenCalledTimes(1);
    expect(workspace.listenerFaults).toHaveLength(1);
    expect(String(workspace.listenerFaults[0])).toContain('listener roto');
  });

  it.each([
    ['active note', (w: FakeWorkspace, fn: () => void) => w.api.onActiveNoteChange(fn), (w: FakeWorkspace) => w.setActiveNote(null)],
    ['notes', (w: FakeWorkspace, fn: () => void) => w.api.onNotesChange(fn), (w: FakeWorkspace) => w.emitNotes({ kind: 'changed', ids: [] } as never)],
    ['title renamed', (w: FakeWorkspace, fn: () => void) => w.api.onNoteTitleRenamed(fn), (w: FakeWorkspace) => w.emitTitleRenamed({} as never)]
  ])('%s: the same isolation', (_name, subscribe, emit) => {
    const workspace = new FakeWorkspace();
    const after = vi.fn();
    subscribe(workspace, () => {
      throw new Error('roto');
    });
    subscribe(workspace, after);
    emit(workspace);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('an unsubscribed listener is not called', () => {
    const workspace = new FakeWorkspace();
    const fn = vi.fn();
    const off = workspace.api.onFoldersChange(fn);
    off();
    workspace.emitFolders([]);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('domUi against the host modal and notice', () => {
  it('Escape (cancel) closes the dialog once and calls onClosed once; a second close does nothing', async () => {
    const { api } = await createJdexTestApi();
    const onClosed = vi.fn();
    const cleanup = vi.fn();
    const handle = api.ui.openModal((el) => {
      el.textContent = 'hola';
      return cleanup;
    }, { onClosed });
    const dialog = document.querySelector('dialog.hebra-module-modal')!;
    expect(dialog.textContent).toBe('hola');
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    handle.close();
    expect(document.querySelector('dialog.hebra-module-modal')).toBeNull();
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('a notice with an action renders a button that runs it; without one, plain text', async () => {
    const { api } = await createJdexTestApi();
    const click = vi.fn();
    api.ui.notice('Pulsa aquí', click);
    api.ui.notice('Solo texto');
    const notices = [...document.querySelectorAll('.hebra-module-notice')];
    (notices.at(-2)!.querySelector('button') as HTMLButtonElement).click();
    expect(click).toHaveBeenCalledTimes(1);
    expect(notices.at(-1)!.querySelector('button')).toBeNull();
    expect(notices.at(-1)!.textContent).toBe('Solo texto');
    for (const n of notices) n.remove();
  });
});

describe('fakeFrontmatter against the host projection (approximation)', () => {
  it('reads numbers as numbers, lists as lists, and a repeated key does not throw', () => {
    expect(fakeFrontmatter('---\njd: 21.11\ntags: [a, b]\nvacia:\n---\n# X\n')).toEqual({ jd: 21.11, tags: ['a', 'b'], vacia: null });
    expect(fakeFrontmatter('---\na: 1\na: 2\n---\n')).toEqual({ a: 2 });
  });

  it('is null without a frontmatter and for a block with no body at all', () => {
    expect(fakeFrontmatter('# Sin frontmatter\n')).toBeNull();
    expect(fakeFrontmatter('---\n---\n')).toBeNull();
  });
});

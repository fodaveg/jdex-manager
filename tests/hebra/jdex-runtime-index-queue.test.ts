// @vitest-environment happy-dom
/**
 * Audit 12 Oct 2026 (index coherence and lifecycle): by-id index refreshes must not
 * overwrite each other, a repeatable derived-write failure must not loop full rebuilds,
 * the initial rebuild must not block activation, and the notice batch has a max wait.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginNoteSummary } from 'hebra-plugin-api/v2';
import { DEFAULT_SETTINGS } from '../../src/hebra/engine';
import {
  activateJdex,
  JDEX_STATUS_AUDIT_ID,
  JDEX_STATUS_INBOX_ID
} from '../../src/hebra/jdex-runtime';
import { createJdexTestApi, FakeJdexVault, fakeFolder, fakeNote } from './support/fakes';

const JDEX = '00-09 Sistema/00 Sistema/00.00 JDex';

function seed(vault: FakeJdexVault, options: { idFrontmatter?: string } = {}): void {
  for (const folder of [
    fakeFolder('sys', null, '00-09 Sistema'),
    fakeFolder('sys-cat', 'sys', '00 Sistema'),
    fakeFolder('jdex', 'sys-cat', '00.00 JDex'),
    fakeFolder('area', null, '20-29 Productos'),
    fakeFolder('cat', 'area', '21 Software'),
    fakeFolder('inbox', 'cat', '21.01 Inbox'),
    fakeFolder('id', 'cat', '21.11 Antes')
  ]) vault.seedFolder(folder);
  vault.seedNote(fakeNote('n-inbox', 'jdex', '---\ndescripcion: "Bandeja."\n---\n# 21.01 Inbox\n'));
  vault.seedNote(fakeNote('n-id', 'jdex', `${options.idFrontmatter ?? '---\ndescripcion: "Algo."\n---\n'}# 21.11 Antes\n`));
  vault.seedNote(
    fakeNote('n-header', 'jdex', '---\ndescripcion: "Cabecera."\n---\n# 21.10 ■ Cabecera\n\n<!-- jdex:hijos -->\n<!-- /jdex:hijos -->\n')
  );
}

/** The first `noteSummary` that includes `id` once its body contains `written` waits
 *  `ms` (a slow library answering the refresh that follows the module's own write). */
function slowSummaryOnce(vault: FakeJdexVault, id: string, written: string, ms: number): void {
  const original = vault.noteSummary.bind(vault);
  let pending = true;
  vault.noteSummary = async (ids: readonly string[]): Promise<PluginNoteSummary[]> => {
    if (pending && ids.includes(id) && (await vault.noteRead(id))?.body?.includes(written)) {
      pending = false;
      const stale = await original(ids);
      await new Promise((resolve) => setTimeout(resolve, ms));
      return stale;
    }
    return original(ids);
  };
}

async function activate(vault: FakeJdexVault, settings: Record<string, unknown> = {}) {
  const harness = await createJdexTestApi({ vault, settings: { ...DEFAULT_SETTINGS, jdexFolder: JDEX, ...settings } });
  const cleanup = await activateJdex(harness.api);
  const text = (id: string) => harness.fake.recorded.statusBarItems.find((item) => item.id === id)?.text;
  return { ...harness, cleanup, text };
}

/** Status texts of a fresh activation over the same library: the ground truth. */
async function freshStatus(vault: FakeJdexVault, settings: Record<string, unknown> = {}) {
  vi.useRealTimers();
  const fresh = await activate(vault, settings);
  await vi.waitFor(() => expect(fresh.text(JDEX_STATUS_AUDIT_ID)).not.toBe('JD: …'));
  const result = { audit: fresh.text(JDEX_STATUS_AUDIT_ID), inbox: fresh.text(JDEX_STATUS_INBOX_ID) };
  await fresh.cleanup();
  return result;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Hebra: by-id index refreshes do not lose notes (218460b0)', () => {
  it('probe: a slow header refresh does not drop a note that arrived by sync meanwhile', async () => {
    const vault = new FakeJdexVault();
    seed(vault);
    const { workspace, text, cleanup } = await activate(vault);
    await vi.waitFor(() => expect(text(JDEX_STATUS_INBOX_ID)).toBe('Inbox: 0'));
    vi.useFakeTimers();
    slowSummaryOnce(vault, 'n-header', '21.11 Antes', 2000);
    // A folder notice: full rebuild, then the live header write and its slow by-id refresh.
    workspace.emitFolders(await vault.foldersList());
    await vi.advanceTimersByTimeAsync(800);
    expect((await vault.noteRead('n-header'))?.body).toContain('21.11 Antes');
    // Meanwhile a note reaches the inbox from another device.
    vault.seedNote(fakeNote('n-new', 'inbox', '# Llegada por sync\n'));
    workspace.emitNotes({ ids: ['n-new'], reason: 'sync' });
    await vi.advanceTimersByTimeAsync(800);
    await vi.advanceTimersByTimeAsync(3000);
    expect(text(JDEX_STATUS_INBOX_ID)).toBe('Inbox: 1');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(text(JDEX_STATUS_INBOX_ID)).toBe('Inbox: 1');
    await cleanup();
  });

  it('two overlapping refreshes finishing in reverse order keep both changes', async () => {
    const vault = new FakeJdexVault();
    // `n-id` lacks the derived fields: automatic maintenance writes them (slow refresh).
    seed(vault);
    const settings = { automaticMaintenance: true, liveHeaders: false };
    const { workspace, text, cleanup } = await activate(vault, settings);
    await vi.waitFor(() => expect(text(JDEX_STATUS_INBOX_ID)).toBe('Inbox: 0'));
    vi.useFakeTimers();
    slowSummaryOnce(vault, 'n-id', 'jd:', 2000);
    workspace.emitFolders(await vault.foldersList());
    await vi.advanceTimersByTimeAsync(800);
    expect((await vault.noteRead('n-id'))?.body).toContain('jd:');
    vault.seedNote(fakeNote('n-new', 'inbox', '# Llegada por sync\n'));
    workspace.emitNotes({ ids: ['n-new'], reason: 'sync' });
    await vi.advanceTimersByTimeAsync(800);
    await vi.advanceTimersByTimeAsync(3000);
    const audit = text(JDEX_STATUS_AUDIT_ID);
    const inbox = text(JDEX_STATUS_INBOX_ID);
    await cleanup();
    expect({ audit, inbox }).toEqual(await freshStatus(vault, settings));
    expect(inbox).toBe('Inbox: 1');
  });

  it('a save of a note that was indexed before is not discarded by the at-rest shortcut', async () => {
    const vault = new FakeJdexVault();
    seed(vault);
    vault.seedNote(fakeNote('n-mail', 'inbox', '# Correo\n'));
    const { workspace, text, cleanup } = await activate(vault);
    await vi.waitFor(() => expect(text(JDEX_STATUS_INBOX_ID)).toBe('Inbox: 1'));
    vi.useFakeTimers();
    // Trashed and restored by an external path whose notices never reached the module.
    vault.setTrashed('n-mail', true);
    workspace.emitNotes({ ids: ['n-mail'], reason: 'trash' });
    await vi.advanceTimersByTimeAsync(800);
    expect(text(JDEX_STATUS_INBOX_ID)).toBe('Inbox: 0');
    vault.setTrashed('n-mail', false);
    // Only a `save` arrives: the note was indexed before, so it is looked up again.
    workspace.emitNotes({ ids: ['n-mail'], reason: 'save' });
    await vi.advanceTimersByTimeAsync(800);
    expect(text(JDEX_STATUS_INBOX_ID)).toBe('Inbox: 1');
    await cleanup();
  });
});

describe('Hebra: bounded retries, activation and notice batching (3301265b)', () => {
  it('probe: a repeatable derived-write failure does not loop full rebuilds and warns once', async () => {
    const vault = new FakeJdexVault();
    seed(vault);
    const { workspace, fake, text, cleanup } = await activate(vault);
    await vi.waitFor(() => expect(text(JDEX_STATUS_AUDIT_ID)).not.toBe('JD: …'));
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vault.notesRewriteBatch = async () => {
      throw new Error('Hebra rechazó la escritura.');
    };
    const walks = vi.spyOn(vault, 'foldersList');
    workspace.emitNotes({ ids: ['n-header'], reason: 'save' });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(walks.mock.calls.length).toBeLessThanOrEqual(5);
    expect(fake.recorded.notices.filter((notice) => notice.includes('no pudo mantener'))).toHaveLength(1);
    // A later real change retries the derived write, still without a second notice.
    workspace.emitNotes({ ids: ['n-header'], reason: 'save' });
    await vi.advanceTimersByTimeAsync(800);
    expect(fake.recorded.notices.filter((notice) => notice.includes('no pudo mantener'))).toHaveLength(1);
    await cleanup();
  });

  it('an initial rebuild failure is retried instead of leaving the index empty', async () => {
    const vault = new FakeJdexVault();
    seed(vault);
    vault.seedNote(fakeNote('n-mail', 'inbox', '# Correo\n'));
    const original = vault.foldersList.bind(vault);
    let fail = true;
    vault.foldersList = async () => {
      if (fail) {
        fail = false;
        throw new Error('Biblioteca aún cerrada.');
      }
      return original();
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();
    const { text, cleanup } = await activate(vault);
    await vi.advanceTimersByTimeAsync(0);
    expect(text(JDEX_STATUS_INBOX_ID)).toBe('Inbox: …');
    await vi.advanceTimersByTimeAsync(800);
    expect(text(JDEX_STATUS_INBOX_ID)).toBe('Inbox: 1');
    await cleanup();
  });

  it('activation resolves before a slow initial walk ends and the bar catches up later', async () => {
    const vault = new FakeJdexVault();
    seed(vault);
    const original = vault.notesPage.bind(vault);
    vault.notesPage = async (...args: Parameters<FakeJdexVault['notesPage']>) => {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return original(...args);
    };
    vi.useFakeTimers();
    let activated = false;
    const harness = await createJdexTestApi({ vault, settings: { ...DEFAULT_SETTINGS, jdexFolder: JDEX } });
    const pending = activateJdex(harness.api).then((cleanup) => {
      activated = true;
      return cleanup;
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(activated).toBe(true);
    const audit = () => harness.fake.recorded.statusBarItems.find((item) => item.id === JDEX_STATUS_AUDIT_ID)?.text;
    expect(audit()).toBe('JD: …');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(audit()).not.toBe('JD: …');
    await (await pending)();
  });

  it('notices every 500 ms for 10 s are processed in at least three batches', async () => {
    const vault = new FakeJdexVault();
    seed(vault);
    const { workspace, text, cleanup } = await activate(vault);
    await vi.waitFor(() => expect(text(JDEX_STATUS_AUDIT_ID)).not.toBe('JD: …'));
    vi.useFakeTimers();
    const summaries = vi.spyOn(vault, 'noteSummary');
    for (let elapsed = 0; elapsed < 10_000; elapsed += 500) {
      workspace.emitNotes({ ids: ['n-id'], reason: 'save' });
      await vi.advanceTimersByTimeAsync(500);
    }
    const batches = summaries.mock.calls.filter(([ids]) => ids.length === 1 && ids[0] === 'n-id');
    expect(batches.length).toBeGreaterThanOrEqual(3);
    await cleanup();
  });
});

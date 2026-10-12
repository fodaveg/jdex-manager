/**
 * The audit view of the Hebra runtime with its two actions, «Aplicar» (a frontmatter fix) and
 * «Reparar» (audit 12 Oct 2026, 5.1 cut 4). It reads the runtime state through `state()` at
 * each step, never a copy, and remounts when the index changes (`refresh`), except while
 * «Reparar» walks its selection (it rebuilds between steps and remounts once at its end).
 */
import type { PluginMarkdown, PluginVault } from 'hebra-plugin-api';
import type { Finding, JdIndex, JdexManagerSettings } from './engine';
import { mountJdexAuditView } from './jdex-audit-view';
import type { JdexJournal } from './jdex-journal';
import { applyJdexFrontmatterFixes } from './jdex-normalize';
import { applyJdexRepair } from './jdex-repair';
import { jdexResolveFolderId, type JdexLibraryWalk } from './library-index';

export interface JdexAuditPanelState {
  readonly walk: JdexLibraryWalk | null;
  readonly index: JdIndex | null;
  readonly findings: readonly Finding[];
  readonly settings: JdexManagerSettings;
}

export interface JdexAuditPanelDeps {
  state(): JdexAuditPanelState;
  readonly journal: Pick<JdexJournal, 'run'>;
  readonly markdown: PluginMarkdown;
  isDisposed(): boolean;
  rebuild(): Promise<void>;
  afterWrite(vault: PluginVault): Promise<void>;
  notice(text: string): void;
  report(error: unknown, where: string): void;
  noteIdByPath(path: string): string | null;
  openNote(id: string): void;
  selectFolder(id: string): void;
}

export interface JdexAuditPanel {
  mount(el: HTMLElement): void;
  unmount(): void;
  /** Remounts an open view with the current findings (not while «Reparar» runs). */
  refresh(): void;
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Creation first, then frontmatter and renames, then moves. */
function repairOrder(finding: Finding): number {
  const type = finding.fix?.type;
  if (type === 'create-note' || type === 'create-folder' || type === 'folders') return 0;
  if (type === 'frontmatter' || type === 'rename') return 1;
  if (type === 'move') return 2;
  return 3;
}

export function createJdexAuditPanel(deps: JdexAuditPanelDeps): JdexAuditPanel {
  let viewEl: HTMLElement | null = null;
  let unmountView: (() => void) | undefined;
  let repairing = false;

  function remount(): void {
    if (!viewEl) return;
    unmountView?.();
    mountInto(viewEl);
  }

  function openPath(path: string): void {
    const { walk } = deps.state();
    if (!walk) return;
    if (path.endsWith('.md')) {
      const ref = walk.systemNotes.find((note) => note.path === path);
      if (ref) deps.openNote(ref.id);
      return;
    }
    const folderId = jdexResolveFolderId(walk, path);
    if (folderId) deps.selectFolder(folderId);
  }

  async function applyFrontmatterFix(finding: Finding): Promise<void> {
    try {
      const result = await deps.journal.run('fix', 'Aplicar arreglo de auditoría', (vault) => applyJdexFrontmatterFixes(vault, deps.markdown, [finding], (path) => deps.noteIdByPath(path)));
      for (const warning of result.warnings) deps.notice(warning);
      await deps.rebuild();
      remount();
    } catch (error) {
      deps.report(error, 'aplicar-frontmatter');
      deps.notice(errorMessage(error));
    }
  }

  async function repair(selected: readonly Finding[]): Promise<void> {
    let done = 0;
    let failed = 0;
    repairing = true;
    try {
      await deps.journal.run('fix', 'Reparar JDex', async (vault) => {
        // Turned off before this queued operation started: nothing to write.
        if (deps.isDisposed()) return;
        for (const finding of [...selected].sort((a, b) => repairOrder(a) - repairOrder(b))) {
          if (!finding.fix) continue;
          // Turned off mid-loop: `rebuild()` no longer refreshes, so the findings and the
          // walk would be stale; stop before writing anything else.
          if (deps.isDisposed()) break;
          try {
            await deps.rebuild();
            if (deps.isDisposed()) break;
            const { walk, index, findings, settings } = deps.state();
            if (!findings.some((fresh) => fresh.kind === finding.kind && JSON.stringify(fresh.fix) === JSON.stringify(finding.fix))) {
              throw new Error(`${finding.paths[0]}: cambió desde la vista previa; vuelve a abrir Reparar.`);
            }
            const result = await applyJdexRepair(vault, deps.markdown, walk!, index!, settings, finding.fix);
            for (const warning of result.warnings) deps.notice(warning);
            if (result.applied) done += 1;
            else failed += 1;
          } catch (error) {
            failed += 1;
            deps.notice(errorMessage(error));
          }
        }
        if (done > 0 && !deps.isDisposed()) await deps.afterWrite(vault);
      });
    } catch (error) {
      deps.report(error, 'reparar');
      if (!deps.isDisposed()) deps.notice(errorMessage(error));
    } finally {
      repairing = false;
      if (!deps.isDisposed()) {
        await deps.rebuild();
        remount();
        deps.notice(`Reparar: ${done} aplicado(s); ${failed} omitido(s) o fallido(s).`);
      }
    }
  }

  function mountInto(el: HTMLElement): void {
    unmountView = mountJdexAuditView(el, {
      findings: () => deps.state().findings,
      openPath,
      applyFrontmatterFix: (finding) => void applyFrontmatterFix(finding),
      repair: (selected) => void repair(selected)
    });
  }

  return {
    mount(el) {
      viewEl = el;
      mountInto(el);
    },
    unmount() {
      viewEl = null;
      unmountView?.();
      unmountView = undefined;
    },
    refresh() {
      if (!repairing) remount();
    }
  };
}

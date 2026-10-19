/**
 * Copy, move the active note to an ID and retire an ID in Hebra (audit 12 Oct 2026, 5.1
 * cut 5): the steps and the messages, with ports for the confirmation, the notices, the
 * journal and the index, so each one runs without activating the runtime. The runtime
 * passes the real ports; `tests/hebra/jdex-actions.test.ts` passes fakes.
 */
import type { PluginMarkdown, PluginVault } from 'hebra-plugin-api/v2';
import { applyMovePlan, isRepeatedId, planMoveIntoId, repeatedIdMessage, type IdEntry, type JdIndex, type JdexManagerSettings, type MovePlan } from './engine';
import type { JdexJournal } from './jdex-journal';
import { jdexResolveFolderId, type JdexLibraryWalk } from './library-index';
import { HebraMovePort, jdexLibraryState, type HebraMoveVault } from './library-port-adapter';

export interface JdexActionPorts {
  notice(text: string): void;
  readonly journal: Pick<JdexJournal, 'run'>;
  /** Full rebuild after a write that does not refresh derived blocks. */
  rebuild(): Promise<void>;
  /** Rebuild and derived blocks after a structural write, with the operation's vault. */
  afterWrite(vault: PluginVault): Promise<void>;
  report(error: unknown, where: string): void;
  /** Asks before an action that cannot be undone by repeating it; `false` when cancelled. */
  confirm(message: string, confirmLabel: string): Promise<boolean>;
}

const errorMessage =(error: unknown): string => (pluginErrorMessage(error));

/** «Copiar ID / ruta / ruta JD». */
export async function copyJdexText(
  ports: Pick<JdexActionPorts, 'notice'>,
  writeText: (text: string) => Promise<void>,
  text: string,
  successMessage: string
): Promise<boolean> {
  try {
    await writeText(text);
    ports.notice(successMessage);
    return true;
  } catch {
    ports.notice('No se pudo copiar.');
    return false;
  }
}

/** «Mover la nota abierta aquí»: the ACTIVE note, never one picked apart (the picker does
 *  not list notes again; ⌘K alone already searches them). It plans and applies with the
 *  shared engine (`planMoveIntoId`/`applyMovePlan`, as `hebra_jd_move` does) through
 *  `HebraMovePort`: a missing ID folder is created, and something already named like the
 *  note in the destination refuses the move. Hebra never dates the name (the name is the
 *  note's title), so the plan carries no `as`. */
export async function moveJdexNoteToEntry(
  ports: Pick<JdexActionPorts, 'notice' | 'journal' | 'rebuild'>,
  note: { readonly id: string; readonly folderId?: string; readonly title?: string } | null,
  entry: IdEntry,
  walk: JdexLibraryWalk,
  context: {
    readonly index: JdIndex;
    readonly settings: Partial<JdexManagerSettings>;
    /** The library, to plan (reads only); the write goes through the journal's own vault. */
    readonly library: HebraMoveVault;
    readonly markdown: Pick<PluginMarkdown, 'withTitle'>;
  }
): Promise<void> {
  if (!note) return;
  try {
    const jdexFolderId = jdexResolveFolderId(walk, context.settings.jdexFolder ?? '');
    if (!jdexFolderId) {
      ports.notice(`No se encontró la carpeta de ${entry.label}.`);
      return;
    }
    const planned = await planMoveIntoId(
      new HebraMovePort(context.library, context.markdown),
      jdexLibraryState(walk, context.index, context.settings, jdexFolderId),
      { source: { kind: 'note', id: note.id, ...(note.folderId !== undefined ? { folderId: note.folderId } : {}) }, toId: entry.id, systemId: entry.system ?? '' }
    );
    if (!planned.ok) {
      ports.notice(planned.message);
      return;
    }
    const plan: MovePlan = planned.value;
    await ports.journal.run('move', `Mover nota a ${entry.label}`, async (vault) => {
      const applied = await applyMovePlan(new HebraMovePort(vault, context.markdown), plan);
      if (!applied.ok) throw new Error(applied.message);
    });
    ports.notice(`Movida a ${entry.label}.`);
    await ports.rebuild();
  } catch (error) {
    ports.notice(errorMessage(error));
  }
}

export function jdexRetireQuestion(entry: Pick<IdEntry, 'label'>): string {
  return (
    `«${entry.label}» se retira: se marca archivado con la fecha de hoy y, si ` +
    `tiene carpeta, se mueve a la .09 de su categoría. El número NUNCA se ` +
    `reutiliza. ¿Confirmas?`
  );
}

/** «Retirar este ID»: a repeated number is refused, then a second question (moving to the
 *  `.09` and marking it archived is not undone by pressing again), then `retire` inside
 *  the journal. A partial failure rebuilds so the index shows what did happen. */
export async function retireJdexEntry(
  ports: JdexActionPorts,
  entry: IdEntry,
  index: JdIndex,
  retire: (vault: PluginVault) => Promise<{ readonly moved: boolean }>
): Promise<void> {
  if (isRepeatedId(index, entry)) {
    ports.notice(repeatedIdMessage(entry));
    return;
  }
  if (!(await ports.confirm(jdexRetireQuestion(entry), 'Retirar'))) return;
  try {
    const outcome = await ports.journal.run('retire', `Retirar ${entry.label}`, async (vault) => {
      const retired = await retire(vault);
      await ports.afterWrite(vault);
      return retired;
    });
    ports.notice(
      outcome.moved
        ? `${entry.label} retirado: movido a su archivo.`
        : `${entry.label} retirado (la carpeta se queda donde estaba).`
    );
  } catch (error) {
    ports.notice(errorMessage(error));
    await ports.rebuild().catch((cause: unknown) => ports.report(cause, 'rebuild-tras-retirada-parcial'));
  }
}
import { pluginErrorMessage } from './error-message';

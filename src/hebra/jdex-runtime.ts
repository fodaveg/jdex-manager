/**
 * El runtime de JDex Manager como plugin de Hebra: el motor puro (`./engine.ts`), el
 * adaptador (`./library-index.ts`) y todo lo que hace falta con el plugin ENCENDIDO,
 * escrito contra la API pública `HebraPluginApi` (`hebra-plugin-api`) y no contra
 * internos de Hebra. `main.ts` exporta `activate(api)` y llama a `activateJdex`.
 *
 * `activateJdex(api)`:
 * 1. espera a que la biblioteca esté abierta (`api.ui.onReady`);
 * 2. carga los ajustes del dispositivo (`./settings.ts`, `api.storage.settings`) y arranca la primera
 *    construcción del índice, la auditoría y el inbox (`rebuild`);
 * 3. registra las tres piezas de la barra de estado (ruta, auditoría, inbox), los dos
 *    comandos de paleta y la vista de auditoría (diálogo) y el panel de ajustes;
 * 4. se suscribe a la nota activa (la pieza de ruta) y a los cambios de carpetas de la
 *    biblioteca (auditoría e inbox, con un pequeño`debounce`: un `library-changed` no
 *    reconstruye el índice entero en cada tecla).
 *
 * Tareas 1-4 del lote 1 (encargo de David, 28 sep 2026): ver `jdex-audit-view.ts` para
 * el diálogo y `jdex-settings-panel.ts` para el panel de Ajustes.
 *
 * Lote 2 (mismo encargo, mismo día): «crear ID/categoría/área/cabecera/hijo (+)»
 * (`jdex-create-view.ts` + `jdex-create-write.ts`), «normalizar el frontmatter»
 * (`jdex-normalize.ts` + `jdex-normalize-view.ts`, y el botón «Aplicar» que
 * `jdex-audit-view.ts` añade a sus propios hallazgos) y «cabeceras e índice al día»
 * (`jdex-headers-sync.ts`, más el comando de migración de `jdex-wrap-headers.ts`).
 * Cada escritura de este lote termina en `afterJdexWrite()`: recalcula el índice
 * (`rebuild()`, pendiente del lote 1) y, si creó o tocó un ID, también las cabeceras y
 * el índice del sistema (tarea 3).
 *
 * Lote 3 (28 sep 2026): «avisar antes de renumerar un ID o cambiarlo de categoría al
 * renombrar o mover» (`jdex-rename-guard.ts` + `jdex-rename-warning-view.ts`, tarea
 * 1: `confirmRename` se apunta a `api.workspace.onBeforeFolderRename`, así que Hebra
 * la consulta ANTES de `folderRename`/`folderMove`; nunca actúa
 * sola, solo avisa) e «ir a un ID, mover la nota a un ID, buscar dentro de un ID,
 * copiar ID o ruta, retirar un ID» (tarea 2, paleta ⌘K).
 *
 * Lote 5 (29 sep 2026): «cubrir el cambio de TÍTULO de una nota JDex sin bloquear el
 * guardado» (`onNoteTitleRenamed`, mismo `jdex-rename-guard.ts`): a diferencia del
 * lote 3, el título se guarda igual que siempre y el aviso llega DESPUÉS, con
 * «Deshacer» como botón del propio aviso (`host.notice(text, onClick)`).
 */
import type {
  HebraPluginApi,
  PluginCleanup,
  PluginModalHandle,
  PluginActiveNote,
  PluginNoteTitleRenamedEvent,
  PluginNotesChange,
  PluginStatusBarItemHandle,
  PluginUnregister,
  PluginVault
} from 'hebra-plugin-api';
import {
  auditSystem,
  buildIndex,
  selectCreationSystem,
  systemKey,
  namePrefix,
  countProblems,
  headerEntries,
  locate,
  isRepeatedId,
  repeatedIdMessage,
  missingConfiguredFolders,
  todayIso,
  pairAction,
  pairBlockedByRepeat,
  extractJdPrefix,
  patternFor,
  staleInboxFindings,
  type Finding,
  type IdEntry,
  type JdIndex,
  type Location
} from './engine';
import {
  buildJdexAuditInput,
  applyJdexNoteChanges,
  jdexAuditNotes,
  loadJdexAuditEntries,
  buildJdexIndexInput,
  buildJdexInboxSummary,
  jdexFolderPaths,
  jdexNotePath,
  jdexNoteFileStem,
  jdexResolveFolderId,
  readJdexCreationIndex,
  walkJdexLibrary,
  type JdexAuditEntry,
  type JdexInboxSummary,
  type JdexLibraryWalk
} from './library-index';
import { mountJdexSettingsPanel } from './jdex-settings-panel';
import { autodetectJdexSettings, jdexSettingsFromStored, loadJdexSettings, persistJdexSettings } from './settings';
import {
  followedFolderNotice,
  followTrackedFolders,
  loadTrackedFolderIds,
  persistTrackedFolderIds,
  TRACKED_FOLDER_KEYS
} from './jdex-folder-tracking';
import {
  mountCreateAreaDialog,
  mountCreateCategoryDialog,
  mountCreateChildDialog,
  mountCreateHeaderDialog,
  mountCreateIdDialog
} from './jdex-create-view';
import { isJdexChildEntry, JDEX_CHILD_OF_CHILD_MESSAGE, jdexCreationIndex } from './jdex-create';
import { jdexTemplatesOutcomeMessage, writeJdexBuiltinTemplates } from './jdex-templates';
import { createJdexFolderRenameGuard } from './jdex-folder-rename';
import {
  createJdexArea,
  createJdexCategory,
  createJdexChild,
  createJdexHeader,
  createJdexId,
  type CreateAreaRequest,
  type CreateCategoryRequest,
  type CreateChildRequest,
  type CreateHeaderRequest,
  type CreateIdRequest
} from './jdex-create-write';
import { openJdexCreateDialog, type JdexCreateDialogPorts } from './jdex-create-dialog';
import { applyJdexFrontmatterFixes, frontmatterFindingsFor } from './jdex-normalize';
import { mountJdexNormalizeView } from './jdex-normalize-view';
import {
  refreshJdexHeaders,
  refreshJdexHeadersAndIndex,
  refreshJdexSystemIndex
} from './jdex-headers-sync';
import { applyJdexWrap, findJdexWrapCandidates } from './jdex-wrap-headers';
import { mountJdexWrapHeadersView } from './jdex-wrap-headers-view';
import {
  jdexRenameNoticeMessage,
  jdexPairNoticeMessage,
  jdexRenameWarning
} from './jdex-rename-guard';
import { mountJdexRenameWarningView } from './jdex-rename-warning-view';
import { mountJdexGotoView } from './jdex-goto-view';
import { mountJdexIdPicker } from './jdex-id-picker';
import { retireJdexId } from './jdex-retire';
import {
  archiveJdexInboxNote,
  jdexInboxArchiveTarget,
  jdexInboxQueue,
  moveJdexInboxNote,
  moveJdexInboxNoteCreatingFolder,
  trashJdexInboxNote
} from './jdex-inbox-process';
import { mountJdexInboxProcessView } from './jdex-inbox-process-view';
import { jdexEntryJdPath, registerJdexActiveNoteCommands } from './jdex-active-note-commands';
export {
  JDEX_COMMAND_ARCHIVE_NOTE,
  JDEX_COMMAND_COPY_JD_PATH,
  JDEX_COMMAND_COPY_NOTE_ID,
  JDEX_COMMAND_SEARCH_CATEGORY,
  JDEX_COMMAND_SEND_TO_INBOX
} from './jdex-active-note-commands';
import { jdexEditorExtension } from './jdex-editor-extension';
import { createJdexJournal, jdexDeviceId } from './jdex-journal';
import { guardJdexJournal, trackJdexModals } from './jdex-lifecycle';
import { mountJdexJournalView } from './jdex-journal-view';
import { createJdexDebugLog } from './jdex-debug-log';
import { createJdexHealthReport } from './jdex-health';
import { createJdexSystemReport } from './jdex-system-report';
import { createRebuildScheduler } from './rebuild-scheduler';
import { copyJdexText, moveJdexNoteToEntry, retireJdexEntry, type JdexActionPorts } from './jdex-actions';
import { registerJdexCommands, type JdexCommandHandlers } from './jdex-commands';
import { createJdexAuditPanel } from './jdex-audit-panel';
import { createJdexIdSectionPanel } from './jdex-id-section-panel';

export const JDEX_AUDIT_VIEW_ID = 'jdex:auditoria';
export const JDEX_ID_SECTION_VIEW_ID = 'jdex:seccion-del-id';
export const JDEX_STATUS_PATH_ID = 'jdex-path';
export const JDEX_STATUS_AUDIT_ID = 'jdex-audit';
export const JDEX_STATUS_INBOX_ID = 'jdex-inbox';
// The command ids live with their table (`./jdex-commands.ts`); re-exported for callers.
export {
  JDEX_COMMAND_AUDIT,
  JDEX_COMMAND_CREATE_AREA,
  JDEX_COMMAND_CREATE_CATEGORY,
  JDEX_COMMAND_CREATE_CHILD,
  JDEX_COMMAND_CREATE_HEADER,
  JDEX_COMMAND_CREATE_ID,
  JDEX_COMMAND_GOTO_ID,
  JDEX_COMMAND_HEALTH,
  JDEX_COMMAND_LOCATE,
  JDEX_COMMAND_NORMALIZE_ALL,
  JDEX_COMMAND_NORMALIZE_NOTE,
  JDEX_COMMAND_PROCESS_INBOX,
  JDEX_COMMAND_REFRESH_HEADERS,
  JDEX_COMMAND_REFRESH_INDEX,
  JDEX_COMMAND_REPAIR,
  JDEX_COMMAND_SYSTEM_REPORT,
  JDEX_COMMAND_TOGGLE,
  JDEX_COMMAND_UNDO,
  JDEX_COMMAND_WRAP_HEADERS,
  JDEX_COMMAND_WRITE_TEMPLATES
} from './jdex-commands';

/** The first rebuild of each activation, keyed by its cleanup (tests and diagnostics). */
const activationSettled = new WeakMap<PluginCleanup, Promise<void>>();

/** Resolves when the activation that returned `cleanup` has finished (or failed) its first
 *  rebuild. `activateJdex` itself does not wait for it. */
export function jdexActivationSettled(cleanup: PluginCleanup): Promise<void> {
  return activationSettled.get(cleanup) ?? Promise.resolve();
}

/** Feeds the optional debug log note (a no-op while its setting is off); set by `activateJdex`. */
let debugSink: ((error: unknown, where: string) => void) | null = null;

function report(error: unknown, where: string): void {
  console.error(`[jdex] ${where}`, error);
  debugSink?.(error, where);
}

export async function activateJdex(api: HebraPluginApi): Promise<PluginCleanup> {
  // Dialogs opened through `host` are closed by the cleanup.
  const modals = trackJdexModals(api.ui);
  const host = modals.ui;
  await new Promise<void>((resolve) => host.onReady(resolve));
  let settings = await loadJdexSettings(api.storage.settings);
  let folderIds = await loadTrackedFolderIds(api.storage.settings);
  // Operations still queued when the module is turned off do not write.
  const journal = guardJdexJournal(
    await createJdexJournal(api.vault, api.storage.settings, { device: jdexDeviceId(api.storage.device) }),
    () => disposed
  );

  let walk: JdexLibraryWalk | null = null;
  let index: JdIndex | null = null;
  let findings: Finding[] = [];
  let inboxSummary: JdexInboxSummary | null = null;
  let latestLocated: Location | null = null;
  let latestNote: PluginActiveNote | null = null;
  const debugLog = createJdexDebugLog(api.vault, () => ({ settings, walk }));
  debugSink = (error, where) => void debugLog.record(where, error);
  /** Repaints registered by the open editors (`jdexEditorExtension`'s `subscribe`). */
  const editorRepaints = new Set<() => void>();
  /** The audit view (`./jdex-audit-panel.ts`) and the ID section (`./jdex-id-section-panel.ts`).
   *  Created HERE, before the first `rebuild()`, because `derive()` refreshes them. */
  const auditPanel = createJdexAuditPanel({
    state: () => ({ walk, index, findings, settings }),
    journal,
    markdown: api.markdown,
    isDisposed: () => disposed,
    rebuild,
    afterWrite: (vault) => afterJdexWrite(true, vault),
    notice: (text) => host.notice(text),
    report,
    noteIdByPath,
    openNote: (id) => api.workspace.openNote(id),
    selectFolder: (id) => api.workspace.selectFolder(id)
  });
  const idSectionPanel = createJdexIdSectionPanel({
    state: () => ({ walk, index, settings, note: latestNote }),
    vault: api.vault,
    markdown: api.markdown,
    goto: (entry) => {
      if (walk) gotoJdexEntry(entry, walk);
    },
    openNote: (id) => api.workspace.openNote(id),
    createChild: () => openCreateChildDialog(),
    isoDates: () => api.env.isoDates(),
    report
  });

  let pathHandle: PluginStatusBarItemHandle | null = null;
  const auditHandle = host.registerStatusBarItem({
    id: JDEX_STATUS_AUDIT_ID,
    text: 'JD: …',
    icon: 'circle-check',
    tooltip: 'Auditoría del sistema JDex',
    order: 41,
    onClick: () => host.revealView(JDEX_AUDIT_VIEW_ID)
  });
  const inboxHandle = host.registerStatusBarItem({
    id: JDEX_STATUS_INBOX_ID,
    text: 'Inbox: …',
    icon: 'inbox',
    tooltip: 'Bandeja de entrada JDex: procesar',
    order: 42,
    onClick: () => openProcessInboxDialog()
  });

  /** Actions that pick "the" note or folder of a number refuse a repeated one. */
  function refuseRepeated(entry: { id: string; system?: string; title: string }): boolean {
    if (!index || !isRepeatedId(index, entry)) return false;
    host.notice(repeatedIdMessage(entry));
    return true;
  }

  function toggleNoteAndFolder(): void {
    const located = latestLocated;
    if (!located || !walk) {
      host.notice('Esta nota no vive en el sistema JDex.');
      return;
    }
    if (refuseRepeated(located.entry)) return;
    if (located.atNote) {
      const folderId = located.entry.folderPath
        ? jdexResolveFolderId(walk, located.entry.folderPath)
        : null;
      if (folderId) api.workspace.selectFolder(folderId);
      return;
    }
    if (located.entry.notePath) {
      const ref = walk.systemNotes.find((note) => note.path === located.entry.notePath);
      if (ref) api.workspace.openNote(ref.id);
      return;
    }
    host.notice(`${located.entry.label} no tiene nota en el JDex.`);
  }

  function refreshPathItem(): void {
    const note = api.workspace.activeNote();
    latestNote = note;
    const currentIndex = index;
    // By id first: two same-title notes have distinct paths only in the walk.
    const path = currentIndex && walk && note
      ? walk.systemNotes.find((ref) => ref.id === note.id && ref.title === note.title.normalize('NFC') && ref.folderId === note.folderId)?.path ?? jdexNotePath(walk.folderPaths, note)
      : null;
    const located =
      currentIndex && path
        ? locate(currentIndex, { jdexFolder: settings.jdexFolder }, path)
        : null;
    latestLocated = located;
    if (!located) {
      pathHandle?.remove();
      pathHandle = null;
      return;
    }
    if (pathHandle) {
      pathHandle.update({ text: located.text });
      return;
    }
    pathHandle = host.registerStatusBarItem({
      id: JDEX_STATUS_PATH_ID,
      text: located.text,
      icon: 'compass',
      tooltip: 'Dónde vive esta nota en el JDex (pulsa para alternar nota y carpeta)',
      order: 40,
      onClick: toggleNoteAndFolder
    });
  }

  function refreshCounterItems(): void {
    const problems = countProblems(findings);
    auditHandle.update({
      text: `JD: ${problems}`,
      tone: problems > 0 ? 'warning' : 'muted'
    });
    const total = inboxSummary?.total ?? 0;
    inboxHandle.update({ text: `Inbox: ${total}`, tone: total > 0 ? 'warning' : 'muted' });
  }

  /** Lo leído de cada nota de la carpeta JDex (frontmatter, y cuerpo si falta la
   *  descripción) con el SHA del cuerpo; junto a `walk`, es TODO lo que el índice, la
   *  auditoría y el inbox necesitan de las notas (PERF-07). */
  let auditEntries: ReadonlyMap<string, JdexAuditEntry> = new Map();
  /** Ids de las notas del recorrido actual (para descartar un aviso que no puede
   *  tocar al índice sin preguntar nada a la biblioteca). */
  let walkNoteIds: ReadonlySet<string> = new Set();
  /** Notes indexed at any point since activation: the at-rest `save` shortcut never
   *  discards one of these, even if an earlier refresh left it out of `walk`. */
  const everIndexed = new Set<string>();
  /** WHEN to rebuild or refresh (debounce, generations, retries): `./rebuild-scheduler.ts`.
   *  HOW is `runRebuild` and `refreshNotesNow` below. */
  const scheduler = createRebuildScheduler({
    fullRebuild: runRebuild,
    refreshIds: refreshNotesNow,
    syncDerived,
    folderPaths: () => walk?.folderPaths ?? null,
    isIndexed: (id) => walkNoteIds.has(id) || everIndexed.has(id),
    isOwn: (id) => debugLog.isOwn(id),
    report,
    derivedFailed: (error) => {
      const reason = error instanceof Error ? error.message : String(error);
      host.notice(`JDex no pudo mantener las cabeceras, el índice o el frontmatter: ${reason} Lo reintentará con el próximo cambio.`);
    }
  });

  /** Índice, auditoría e inbox a partir de `walk` y `auditEntries` (puro, sin
   *  biblioteca) y lo que se pinta de ellos. */
  function derive(): void {
    if (!walk) return;
    walkNoteIds = new Set(walk.systemNotes.map((note) => note.id));
    for (const id of walkNoteIds) everIndexed.add(id);
    index = buildIndex(buildJdexIndexInput(walk, settings));
    const notes = jdexAuditNotes(walk, auditEntries, settings.jdexFolder);
    const auditInput = buildJdexAuditInput(index, notes, walk, {
      noteWithoutFolderIsFinding: settings.noteWithoutFolderIsFinding,
      descriptionIsFinding: settings.descriptionIsFinding,
      structureNotesAreFindings: settings.structureNotesAreFindings
    });
    auditInput.patternFor = (category) => patternFor(settings, category);
    auditInput.jdexFolder = settings.jdexFolder;
    findings = auditSystem(auditInput);
    findings.unshift(...missingConfiguredFolders(settings, [...walk.folderPaths.values()]));
    findings.push(...staleInboxFindings(index, walk.systemNotes.flatMap((note) => {
      const folderPath = walk!.folderPaths.get(note.folderId);
      return folderPath && note.createdAt !== undefined ? [{ path: note.path, folderPath, createdAt: note.createdAt }] : [];
    }), settings.inboxStaleDays, Date.now()));
    inboxSummary = buildJdexInboxSummary(index, walk);
    refreshCounterItems();
    refreshPathItem();
    // La sección del ID (lote 4, tarea 2) puede estar montada con esta MISMA nota
    // activa: un `rebuild()` que crea un hijo o cambia el frontmatter no dispara
    // `onActiveNoteChange` (la nota activa no cambió), así que se refresca aquí.
    idSectionPanel.refresh();
    // Open editors repaint their numbers, and an open audit view shows the new findings
    // (not the ones captured when it was mounted). Not while Repair walks its selection.
    for (const repaint of [...editorRepaints]) repaint();
    auditPanel.refresh();
  }

  /** Reconstrucción COMPLETA: recorre la biblioteca desde cero. Reservada para la
   *  inicialización, un cambio de estructura de carpetas o de ajustes y las
   *  escrituras del propio módulo; un cambio de notas se pone al día por ids
   *  (`refreshNotes`). */
  function rebuild(): Promise<void> {
    return scheduler.rebuild();
  }

  async function runRebuild(isCurrent: () => boolean): Promise<'superseded' | void> {
    const rootFolderId = api.vault.rootFolderId();
    // La raíz no es una carpeta más: el recorrido la trata aparte (`walkJdexLibrary`).
    const folders = (await api.vault.foldersList()).filter((folder) => folder.id !== rootFolderId);
    if (disposed) return;
    const paths = jdexFolderPaths(folders, rootFolderId);
    const followed = followTrackedFolders(settings, folderIds, paths);
    if (followed.changed) {
      settings = followed.settings;
      folderIds = followed.ids;
      for (const moved of followed.moved) host.notice(followedFolderNotice(moved));
      if (followed.moved.length > 0) {
        await persistJdexSettings(api.storage.settings, settings).catch((error: unknown) => report(error, 'guardar-ajustes'));
      }
      await persistTrackedFolderIds(api.storage.settings, folderIds).catch((error: unknown) => report(error, 'guardar-ajustes'));
    }
    const { settings: autodetected, changed } = autodetectJdexSettings(settings, [
      ...paths.values()
    ]);
    if (changed) {
      settings = autodetected;
      await persistJdexSettings(api.storage.settings, settings).catch((error: unknown) =>
        report(error, 'guardar-ajustes')
      );
    }
    const nextWalk = await walkJdexLibrary(api.vault, folders, settings.systemRoot, rootFolderId, paths, settings.jdexFolder);
    // Con el módulo apagado mientras leía, nada de escribir estado ni de pintar.
    if (disposed) return;
    if (!isCurrent()) return 'superseded';
    const nextEntries = await loadJdexAuditEntries(
      api.vault,
      api.markdown,
      nextWalk,
      settings.jdexFolder,
      auditEntries
    );
    if (disposed) return;
    // Superada por otra más nueva mientras leía: lo suyo es anterior, no pisa nada.
    if (!isCurrent()) return 'superseded';
    walk = nextWalk;
    auditEntries = nextEntries;
    derive();
  }

  // ---- Lote 2: crear ID/categoría/área/cabecera/hijo (+), normalizar el
  // frontmatter, cabeceras e índice al día -----------------------------------

  function noteIdByPath(path: string): string | null {
    return walk?.noteIdByPath?.get(path) ?? walk?.systemNotes.find((note) => note.path === path)?.id ?? null;
  }

  /** Una escritura propia recorre la biblioteca una vez; las cabeceras modificadas
   *  después se incorporan por ids, sin otra reconstrucción completa. */
  async function afterJdexWrite(syncHeaders: boolean, vault: PluginVault = api.vault): Promise<void> {
    await rebuild();
    scheduler.settleFolderChanges();
    if (syncHeaders && walk && index) {
      const result = await refreshJdexHeadersAndIndex(vault, walk, index, settings.systemIndexNote);
      if (result.written.length > 0) await refreshNotes(result.written);
    }
  }

  /** Manual JDex and folder changes refresh managed blocks; unchanged bodies do not write. */
  async function syncLiveHeaders(): Promise<void> {
    if (disposed || !(settings.liveHeaders || settings.automaticMaintenance) || !walk || !index) return;
    const result = await journal.run('fix', 'Actualizar cabeceras e índice vivos', (vault) => refreshJdexHeadersAndIndex(vault, walk!, index!, settings.systemIndexNote), { automatic: true });
    if (result.written.length > 0) await refreshNotes(result.written);
  }

  /** Only fields derived from JDex structure are safe to repair after external edits. */
  async function maintainDerivedFrontmatter(): Promise<void> {
    if (disposed || !settings.automaticMaintenance || !walk || !index) return;
    const keys = new Set(['jd', 'tipo', 'area', 'categoria']);
    const chosen = frontmatterFindingsFor(findings).flatMap((finding) => {
      if (finding.fix?.type !== 'frontmatter') return [];
      const set = Object.fromEntries(Object.entries(finding.fix.set).filter(([key]) => keys.has(key)));
      if (Object.keys(set).length === 0) return [];
      const expected = finding.fix.expected
        ? Object.fromEntries(Object.entries(finding.fix.expected).filter(([key]) => keys.has(key)))
        : undefined;
      return [{ ...finding, fix: { ...finding.fix, set, expected } }];
    });
    if (chosen.length === 0) return;
    const result = await journal.run('fix', 'Mantenimiento automático JDex', (vault) => applyJdexFrontmatterFixes(vault, api.markdown, chosen, noteIdByPath), { automatic: true });
    for (const warning of result.warnings) host.notice(warning);
    if (result.written.length > 0) await refreshNotes(result.written);
  }

  async function syncDerived(): Promise<void> {
    await maintainDerivedFrontmatter();
    await syncLiveHeaders();
  }

  /** The five create dialogs (`./jdex-create-dialog.ts`): the library is revalidated right
   *  before writing, after the notices still pending are applied. */
  const createPorts: JdexCreateDialogPorts = {
    ui: host,
    journal,
    isDisposed: () => disposed,
    live: async () => {
      await scheduler.settle();
      if (!walk || !index) throw new Error('El índice JDex aún no está listo.');
      return { walk, index };
    },
    afterWrite: (vault) => afterJdexWrite(true, vault),
    openNote: (id) => api.workspace.openNote(id)
  };

  /** The creation system is the one chosen when the dialog opened, even if the settings
   *  change before it writes (Codex review of the 12 Oct audit); the rest is read live. */
  type ChosenSystem = Pick<typeof settings, 'systemId' | 'prefixNamesWithSystem'>;
  function chosenSystem(): ChosenSystem {
    return { systemId: settings.systemId, prefixNamesWithSystem: settings.prefixNamesWithSystem };
  }
  function withSystem(chosen: ChosenSystem): typeof settings {
    return { ...settings, ...chosen };
  }

  function openCreateIdDialog(): void {
    if (!walk || !index) return;
    if (index.categories.length === 0) {
      host.notice('No hay ninguna categoría en el sistema: crea una primero.');
      return;
    }
    const chosen = chosenSystem();
    const prefix = namePrefix(chosen);
    const currentIndex = jdexCreationIndex(index, prefix);
    openJdexCreateDialog<CreateIdRequest>(createPorts, {
      title: 'JDex: crear ID',
      kind: 'create-id',
      label: 'Crear ID',
      mount: (el, onSubmit) =>
        mountCreateIdDialog(el, {
          index: currentIndex,
          refreshIndex: async () => jdexCreationIndex(await readJdexCreationIndex(api.vault, settings), prefix),
          categories: currentIndex.categories,
          createFolderDefault: settings.createFolderByDefault,
          createPatternDefault: settings.createPatternByDefault,
          patternFor: (category) => patternFor(settings, category),
          onSubmit
        }),
      write: (vault, request, live) => createJdexId(vault, api.markdown, live.walk, withSystem(chosen), live.index, request)
    });
  }

  function openCreateCategoryDialog(): void {
    if (!walk || !index) return;
    if (index.areas.length === 0) {
      host.notice('No hay ninguna área en el sistema: crea una primero.');
      return;
    }
    const chosen = chosenSystem();
    const prefix = namePrefix(chosen);
    const currentIndex = jdexCreationIndex(index, prefix);
    openJdexCreateDialog<CreateCategoryRequest>(createPorts, {
      title: 'JDex: crear categoría',
      kind: 'create-structure',
      label: 'Crear categoría',
      mount: (el, onSubmit) =>
        mountCreateCategoryDialog(el, {
          index: currentIndex,
          refreshIndex: async () => selectCreationSystem(await readJdexCreationIndex(api.vault, settings), prefix),
          areas: currentIndex.areas,
          createFolderDefault: settings.createFolderByDefault,
          onSubmit
        }),
      write: async (vault, request, live) => {
        // Re-read at the write: the number may have been taken while the dialog was open.
        const liveIndex = selectCreationSystem(await readJdexCreationIndex(vault, settings), prefix);
        return createJdexCategory(vault, api.markdown, live.walk, withSystem(chosen), liveIndex, request);
      }
    });
  }

  function openCreateAreaDialog(): void {
    if (!walk || !index) return;
    const chosen = chosenSystem();
    const prefix = namePrefix(chosen);
    const currentIndex = selectCreationSystem(index, prefix);
    openJdexCreateDialog<CreateAreaRequest>(createPorts, {
      title: 'JDex: crear área',
      kind: 'create-structure',
      label: 'Crear área',
      mount: (el, onSubmit) =>
        mountCreateAreaDialog(el, {
          index: currentIndex,
          refreshIndex: async () => selectCreationSystem(await readJdexCreationIndex(api.vault, settings), prefix),
          createFolderDefault: settings.createFolderByDefault,
          onSubmit
        }),
      write: async (vault, request, live) => {
        const liveIndex = selectCreationSystem(await readJdexCreationIndex(vault, settings), prefix);
        return createJdexArea(vault, api.markdown, live.walk, withSystem(chosen), request, liveIndex);
      }
    });
  }

  function openCreateHeaderDialog(): void {
    if (!walk || !index) return;
    if (index.categories.length === 0) {
      host.notice('No hay ninguna categoría en el sistema: crea una primero.');
      return;
    }
    const chosen = chosenSystem();
    const prefix = namePrefix(chosen);
    const currentIndex = jdexCreationIndex(index, prefix);
    openJdexCreateDialog<CreateHeaderRequest>(createPorts, {
      title: 'JDex: crear cabecera',
      kind: 'create-id',
      label: 'Crear cabecera',
      mount: (el, onSubmit) =>
        mountCreateHeaderDialog(el, {
          index: currentIndex,
          refreshIndex: async () => jdexCreationIndex(await readJdexCreationIndex(api.vault, settings), prefix),
          categories: currentIndex.categories,
          onSubmit
        }),
      write: (vault, request, live) => createJdexHeader(vault, api.markdown, live.walk, withSystem(chosen), live.index, request)
    });
  }

  function openCreateChildDialog(): void {
    if (!walk || !index) return;
    const parent: IdEntry | undefined = latestLocated?.atNote ? latestLocated.entry : undefined;
    if (!parent) {
      host.notice('Abre la nota JDex de un ID para crearle un hijo (+).');
      return;
    }
    if (isJdexChildEntry(parent)) {
      host.notice(JDEX_CHILD_OF_CHILD_MESSAGE);
      return;
    }
    const chosen = chosenSystem();
    const currentIndex = index;
    openJdexCreateDialog<CreateChildRequest>(createPorts, {
      title: `JDex: crear ID hijo de ${parent.label}`,
      kind: 'create-id',
      label: 'Crear hijo de ID',
      mount: (el, onSubmit) =>
        mountCreateChildDialog(el, {
          index: currentIndex,
          refreshIndex: () => readJdexCreationIndex(api.vault, settings),
          parent,
          createFolderDefault: settings.createFolderByDefault,
          onSubmit
        }),
      write: (vault, request, live) => createJdexChild(vault, api.markdown, live.walk, withSystem(chosen), live.index, request)
    });
  }

  function openNormalizeDialog(scopePath: string | null): void {
    const subset = frontmatterFindingsFor(findings, scopePath ?? undefined);
    let handle: PluginModalHandle | undefined;
    handle = host.openModal(
      (el) =>
        mountJdexNormalizeView(el, {
          findings: subset,
          onApply: async (chosenPaths) => {
            const result = await journal.run('fix', 'Normalizar frontmatter JDex', (vault) => applyJdexFrontmatterFixes(vault, api.markdown, subset, noteIdByPath, chosenPaths));
            for (const warning of result.warnings) host.notice(warning);
            handle?.close();
            await rebuild();
          }
        }),
      {
        title:
          scopePath === null
            ? 'JDex: normalizar el frontmatter de toda la JDex'
            : 'JDex: normalizar el frontmatter de esta nota'
      }
    );
  }

  function openNormalizeThisNote(): void {
    const path = latestLocated?.atNote ? latestLocated.entry.notePath : undefined;
    if (!path) {
      host.notice('Esta nota no es una nota JDex (abre la del 00.00, no la de contenido).');
      return;
    }
    openNormalizeDialog(path);
  }

  async function refreshHeadersCommand(): Promise<void> {
    if (!walk || !index) return;
    const result = await journal.run('fix', 'Actualizar cabeceras', (vault) => refreshJdexHeaders(vault, walk!, index!));
    host.notice(
      result.written.length > 0
        ? `${result.written.length} cabecera(s) actualizada(s).`
        : 'Ninguna cabecera con marcadores que actualizar.'
    );
    await rebuild();
  }

  async function refreshIndexCommand(): Promise<void> {
    if (!walk || !index) return;
    const result = await journal.run('fix', 'Actualizar índice', (vault) => refreshJdexSystemIndex(vault, walk!, index!, settings.systemIndexNote));
    host.notice(
      result.written.length > 0
        ? 'Índice del sistema actualizado.'
        : 'Sin nota de índice o sin marcadores que actualizar.'
    );
    await rebuild();
  }

  async function openWrapHeadersDialog(): Promise<void> {
    if (!walk || !index) return;
    const currentWalk = walk;
    const currentIndex = index;
    const port = api.vault;
    const bodies = new Map<string, string>();
    for (const header of headerEntries(currentIndex)) {
      if (!header.notePath) continue;
      const ref = currentWalk.systemNotes.find((note) => note.path === header.notePath);
      if (!ref) continue;
      const row = await port.noteRead(ref.id);
      if (row?.body != null) bodies.set(ref.id, row.body);
    }
    const candidates = findJdexWrapCandidates(
      currentWalk,
      currentIndex,
      (noteId) => bodies.get(noteId) ?? null
    );
    let handle: PluginModalHandle | undefined;
    handle = host.openModal(
      (el) =>
        mountJdexWrapHeadersView(el, {
          candidates,
          onApply: async (chosenIds) => {
            await journal.run('fix', 'Envolver cabeceras', async (vault) => {
              const wrapped = await applyJdexWrap(vault, candidates, [...chosenIds]);
              for (const warning of wrapped.warnings) host.notice(warning);
              await afterJdexWrite(true, vault);
            });
            handle?.close();
          }
        }),
      { title: 'JDex: envolver las listas de cabeceras en marcadores' }
    );
  }

  // ---- Lote 3, tarea 1: avisar antes de renumerar un ID o cambiarlo de
  // categoría al renombrar o mover -------------------------------------------

  /** `api.workspace.onBeforeFolderRename`: Hebra llama esto ANTES de
   *  `folderRename`/`folderMove`. A change that needs a warning is refused at once and
   *  redone by the plugin only if the user confirms (`jdex-folder-rename.ts`): Hebra lets
   *  a guard through after 5 s, so waiting for the answer is not safe. Sin índice aún
   *  cargado, deja pasar. */
  const folderRenameGuard = createJdexFolderRenameGuard({
    ui: host,
    markdown: api.markdown,
    snapshot: () => (walk && index ? { walk, index, settings } : null),
    write: (label, action) => journal.run('move', label, async (vault) => {
      await action(vault);
      await afterJdexWrite(true, vault);
    }),
    report
  });
  const confirmRename = folderRenameGuard.confirm;

  // ---- Lote 5: avisar tras renombrar el TÍTULO de una nota JDex, sin bloquear
  // el guardado (encargo de David, 29 sep 2026) ---------------------------------

  /** `api.workspace.onNoteTitleRenamed`: Hebra llama esto DESPUÉS de
   *  guardar el título (nunca antes: el guardado sigue síncrono, `renameTitle`/
   *  `commitTitle`/`flush` intactos). Los cambios de número ofrecen deshacer el
   *  título; los cambios de nombre con pareja ofrecen renombrar su carpeta. */
  function onNoteTitleRenamed(event: PluginNoteTitleRenamedEvent): void {
    if (!walk || !index) return;
    const warning = jdexRenameWarning(
      { kind: 'note-rename', noteId: event.noteId, newTitle: event.newTitle },
      walk,
      index,
      settings
    );
    if (warning) host.notice(jdexRenameNoticeMessage(warning), () => event.undo());
    const folderPath = walk.folderPaths.get(event.folderId);
    if (folderPath !== settings.jdexFolder) return;
    const oldPath = `${folderPath}/${jdexNoteFileStem(event.oldTitle)}.md`;
    const newPath = `${folderPath}/${jdexNoteFileStem(event.newTitle)}.md`;
    const beforeIndex = { ...index, ids: index.ids.map((entry) => entry.notePath === newPath
      ? { ...entry, notePath: oldPath, title: extractJdPrefix(event.oldTitle)?.title ?? entry.title } : entry) };
    const action = pairAction({ oldPath, newPath, isFolder: false }, beforeIndex, settings);
    const blockedByRepeat = action.type === 'none' && pairBlockedByRepeat({ oldPath, newPath, isFolder: false }, beforeIndex, settings);
    if (action.type !== 'rename-partner' && !blockedByRepeat) return;
    const renamed = extractJdPrefix(event.newTitle);
    if (renamed?.number.kind === 'id' && refuseRepeated({ id: renamed.number.extension ? `${renamed.number.id}+` : renamed.number.id, system: renamed.number.system, title: renamed.title })) return;
    if (action.type !== 'rename-partner') return;
    const folderId = jdexResolveFolderId(walk, action.partnerPath);
    if (!folderId) return;
    const parentSeparator = action.partnerPath.lastIndexOf('/');
    const parentPath = parentSeparator === -1 ? '' : action.partnerPath.slice(0, parentSeparator);
    const expectedParentId = jdexResolveFolderId(walk, parentPath);
    const oldName = action.partnerPath.slice(action.partnerPath.lastIndexOf('/') + 1);
    const newName = action.newPartnerPath.slice(action.newPartnerPath.lastIndexOf('/') + 1);
    const renamePartnerFolder = (): void => {
      // The notice outlives the module: pressing it after turning JDex off does nothing.
      if (disposed) return;
      void journal.run('move', `Renombrar carpeta ${oldName}`, async (vault) => {
        const note = await vault.noteRead(event.noteId);
        const folders = await vault.foldersList();
        const folder = folders.find((entry) => entry.id === folderId);
        if (!note || note.title !== event.newTitle || !folder || folder.name !== oldName || (folder.parentId ?? vault.rootFolderId()) !== expectedParentId) throw new Error('La nota o la carpeta cambió desde el aviso; vuelve a auditar.');
        if (folders.some((entry) => entry.id !== folderId && entry.parentId === folder.parentId && entry.name === newName)) throw new Error(`Ya existe una carpeta «${newName}».`);
        await vault.folderRename(folderId, newName);
        await afterJdexWrite(true, vault);
      }).catch((error: unknown) => host.notice(error instanceof Error ? error.message : String(error)));
    };
    // The title is already saved here (this event comes after the save), so the folder
    // follows a rename that really happened. The setting skips the question.
    if (settings.renamePairsWithoutAsking) renamePartnerFolder();
    else host.notice(jdexPairNoticeMessage('folder', oldName, newName), renamePartnerFolder);
  }

  // ---- Lote 3, tarea 2: ir a un ID, mover la nota a un ID, buscar dentro de un
  // ID, copiar ID o ruta, retirar un ID ----------------------------------------

  /** Copy, move and retire run in `./jdex-actions.ts` with these ports. */
  const actionPorts: JdexActionPorts = {
    notice: (text) => host.notice(text),
    journal,
    rebuild,
    afterWrite: (vault) => afterJdexWrite(true, vault),
    report,
    confirm: (message, confirmLabel) =>
      new Promise<boolean>((resolve) => {
        let handle: PluginModalHandle | undefined;
        handle = host.openModal(
          (el) =>
            mountJdexRenameWarningView(el, {
              message,
              confirmLabel,
              onContinue: () => {
                resolve(true);
                handle?.close();
              },
              onCancel: () => {
                resolve(false);
                handle?.close();
              }
            }),
          // Closed any other way (Escape, the module turned off): nothing happens.
          { title: 'JDex: retirar ID', onClosed: () => resolve(false) }
        );
      })
  };

  function copyToClipboard(text: string, successMessage: string): Promise<void> {
    return copyJdexText(actionPorts, (value) => navigator.clipboard.writeText(value), text, successMessage);
  }

  /** «Ir a este ID»: la carpeta si la tiene (como `toggleNoteAndFolder`), si no la
   *  nota JDex. */
  function gotoJdexEntry(entry: IdEntry, currentWalk: JdexLibraryWalk, preferNote = false): void {
    if (refuseRepeated(entry)) return;
    if (!preferNote && entry.folderPath) {
      const folderId = jdexResolveFolderId(currentWalk, entry.folderPath);
      if (folderId) {
        api.workspace.selectFolder(folderId);
        return;
      }
    }
    if (entry.notePath) {
      const ref = currentWalk.systemNotes.find((note) => note.path === entry.notePath);
      if (ref) {
        api.workspace.openNote(ref.id);
        return;
      }
    }
    if (preferNote && entry.folderPath) {
      const folderId = jdexResolveFolderId(currentWalk, entry.folderPath);
      if (folderId) {
        api.workspace.selectFolder(folderId);
        return;
      }
    }
    host.notice(`No se pudo abrir ${entry.label}.`);
  }

  /** «Mover la nota abierta aquí»: la nota ACTIVA (`latestNote`). */
  function moveActiveNoteToEntry(entry: IdEntry, currentWalk: JdexLibraryWalk): Promise<void> {
    return moveJdexNoteToEntry(actionPorts, latestNote, entry, currentWalk);
  }

  /** «Retirar este ID» with the walk and index of the dialog it was chosen in. */
  function confirmRetireEntry(entry: IdEntry, currentWalk: JdexLibraryWalk, currentIndex: JdIndex): void {
    void retireJdexEntry(actionPorts, entry, currentIndex, (vault) =>
      retireJdexId(vault, api.markdown, currentWalk, currentIndex, entry, todayIso())
    );
  }

  function retiredAt(entry: IdEntry): string | null {
    const noteId = entry.notePath ? noteIdByPath(entry.notePath) : null;
    const fm = noteId ? auditEntries.get(noteId)?.frontmatter : null;
    if (fm?.tipo !== 'archivado') return null;
    return typeof fm.archivado === 'string' ? fm.archivado : '';
  }

  function openGotoIdDialog(): void {
    if (!walk || !index) return;
    if (index.ids.length === 0) {
      host.notice('No hay ningún ID en el sistema.');
      return;
    }
    const currentWalk = walk;
    const currentIndex = index;
    let handle: PluginModalHandle | undefined;
    handle = host.openModal(
      (el) =>
        mountJdexGotoView(el, {
          entries: currentIndex.ids,
          hasActiveNote: latestNote !== null,
          retiredAt,
          onGoto: (entry) => {
            handle?.close();
            gotoJdexEntry(entry, currentWalk);
          },
          onMoveNoteHere: (entry) => {
            handle?.close();
            void moveActiveNoteToEntry(entry, currentWalk);
          },
          onSearchWithin: (entry) => {
            handle?.close();
            // `palette-query.ts` de Hebra: sin escape de comillas dentro de `path:"…"` (cada `"`
            // alterna «entrecomillado»); una carpeta con `"` en el nombre es un caso tan raro
            // que no vale la pena resolverlo.
            if (entry.folderPath) api.workspace.openSearch(`path:"${entry.folderPath}"`);
          },
          onCopyId: (entry) => {
            handle?.close();
            void copyToClipboard(systemKey(entry.id, entry.system), 'ID copiado.');
          },
          onCopyPath: (entry) => {
            handle?.close();
            const path = entry.folderPath ?? entry.notePath;
            if (path !== undefined) void copyToClipboard(path, entry.folderPath ? 'Ruta de la carpeta copiada.' : 'Ruta de la nota copiada.');
          },
          onCopyJdPath: (entry) => {
            handle?.close();
            // Same text as the «copiar la ruta JD de esta nota» command (`jdexEntryJdPath`).
            const text = jdexEntryJdPath(currentIndex, settings.jdexFolder, entry);
            if (text === null) host.notice(`${entry.label} no tiene nota ni carpeta.`);
            else void copyToClipboard(text, 'Ruta JD copiada.');
          },
          onRetire: (entry) => {
            handle?.close();
            confirmRetireEntry(entry, currentWalk, currentIndex);
          }
        }),
      { title: 'JDex: ir a un ID' }
    );
  }

  // ---- Lote 4, tarea 1: «Procesar inbox» -------------------------------------

  /** «Procesar inbox»: la cola sale de `inboxSummary`+`walk` (sin consulta nueva,
   *  `jdexInboxQueue`); mover reutiliza el mismo buscador que «ir a un ID»
   *  (`jdex-id-picker.ts`, vía `mountJdexInboxProcessView`). Se lanza desde ⌘K y
   *  al pulsar «Inbox: N» en la barra de estado. */
  function openProcessInboxDialog(): void {
    if (!walk || !index || !inboxSummary) return;
    const currentWalk = walk;
    const currentIndex = index;
    const queue = jdexInboxQueue(inboxSummary, currentWalk);
    if (queue.length === 0) {
      host.notice('La bandeja de entrada está vacía.');
      return;
    }
    const labelByFolderId = new Map(
      inboxSummary.folders
        .filter((f): f is typeof f & { folderId: string } => f.folderId !== null)
        .map((f) => [f.folderId, f.entry.label])
    );
    host.openModal(
      (el) =>
        mountJdexInboxProcessView(el, {
          queue,
          entries: currentIndex.ids,
          folderLabel: (note) => labelByFolderId.get(note.folderId) ?? 'Bandeja de entrada',
          archiveTarget: (note) => jdexInboxArchiveTarget(note, currentWalk, currentIndex)?.label ?? null,
          onMove: async (note, entry) => {
            if (!entry.folderPath) throw new Error(`${entry.label} no tiene carpeta.`);
            await journal.run('move', `Mover inbox a ${entry.label}`, (vault) => moveJdexInboxNote(vault, note, currentWalk, entry.folderPath!));
            await rebuild();
          },
          onArchive: async (note) => {
            await journal.run('move', 'Archivar nota de inbox', (vault) => archiveJdexInboxNote(vault, api.markdown, note, currentWalk, currentIndex, settings.dateFormat));
            await rebuild();
          },
          onOpen: (note) => api.workspace.openNote(note.id),
          readPreview: async (note) => (await api.vault.noteRead(note.id))?.body ?? null,
          onTrash: async (note) => {
            await journal.run('fix', `Papelera desde el inbox: ${note.title}`, (vault) => trashJdexInboxNote(vault, note));
            await rebuild();
          },
          onMoveCreatingFolder: async (note, entry) => {
            await journal.run('move', `Crear carpeta de ${entry.label} y mover desde el inbox`, (vault) => moveJdexInboxNoteCreatingFolder(vault, note, currentWalk, currentIndex, entry));
            await rebuild();
          }
        }),
      { title: 'JDex: procesar inbox' }
    );
  }

  // ---- PERF-07: lo que cambia se pone al día por ids, no recorriendo la biblioteca --

  /** `true` tras apagar el módulo: ningún reintento ni lote vuelve a armarse. */
  let disposed = false;

  /** Pone al día solo las notas `ids` (`applyJdexNoteChanges`); el recorrido completo
   *  se reserva para lo que no se puede resolver por ids. Serialised by the scheduler. */
  function refreshNotes(ids: readonly string[]): Promise<void> {
    return scheduler.refreshNotes(ids);
  }

  async function refreshNotesNow(ids: readonly string[], isCurrent: () => boolean): Promise<'retry' | 'rebuild' | void> {
    if (!walk) return 'rebuild';
    const base = walk;
    const update = await applyJdexNoteChanges(
      api.vault,
      api.markdown,
      { walk, entries: auditEntries },
      ids,
      settings
    );
    if (disposed) return;
    // Arrancó una reconstrucción completa mientras tanto: lee el estado de después.
    if (!isCurrent()) return;
    // Something else replaced `walk` meanwhile: apply the same ids to the new state.
    if (walk !== base) return 'retry';
    if (update.kind === 'rebuild') return 'rebuild';
    if (update.kind === 'updated') {
      walk = update.state.walk;
      auditEntries = update.state.entries;
      derive();
    }
  }

  function onNotesChanged(event: PluginNotesChange): void {
    // After an undo settles, a change to a note it restored lifts its protection.
    journal.observe(event.ids);
    // The debug log note is written by the plugin itself: never a reason to update the index.
    if (debugLog.isOwnChange(event.ids)) return;
    scheduler.notesChanged(event.reason, event.ids);
  }

  // Los oyentes se registran ANTES de la reconstrucción inicial: lo que llegue mientras
  // recorre (la primera ronda de sync) queda pendiente y se aplica al terminar.
  const offFolders = api.workspace.onFoldersChange((folders) => {
    const paths = jdexFolderPaths(folders.filter((folder) => folder.id !== api.vault.rootFolderId()), api.vault.rootFolderId());
    scheduler.foldersChanged(paths);
    folderRenameGuard.foldersChanged(folders);
  });
  const offNotes = api.workspace.onNotesChange(onNotesChanged);
  // Settings or journal saved elsewhere (another tab; later, sync): adopt the settings and
  // join the journal by identity, then rebuild with them.
  const offSettingsChange = api.storage.settings.onChange((value) => {
    if (disposed) return;
    settings = jdexSettingsFromStored(value);
    journal.absorb(value);
    scheduler.scheduleRebuild();
  });

  // Activation does not wait for the first walk (the host abandons a slow activation): the
  // bar shows «JD: …» until it lands. A failure enters the normal retry path.
  const initialRebuild = rebuild().catch((error: unknown) => {
    report(error, 'rebuild-inicial');
    scheduler.retryAfterFailure();
  });

  const offActiveNote = api.workspace.onActiveNoteChange(() => refreshPathItem());
  const offRenameGuard = api.workspace.onBeforeFolderRename(confirmRename);
  const offNoteTitleRenamed = api.workspace.onNoteTitleRenamed(onNoteTitleRenamed);

  // The palette (`./jdex-commands.ts`): the table has the ids and names, these the handlers.
  function openUndoDialog(): void {
    const entries = journal.entries();
    const operation = entries[entries.length - 1];
    // The identity confirmed in the dialog; the journal checks it inside its queue.
    const operationId = operation?.id;
    let handle: PluginModalHandle | undefined;
    handle = host.openModal((el) => mountJdexJournalView(el, {
      entries,
      status: journal.status(),
      onDiscard: async () => {
        if (!operationId) return;
        const discarded = await journal.discardLast(operationId);
        host.notice(discarded ? `«${operation.label}» se quitó del diario; no se tocó ninguna nota.` : 'El diario cambió desde que se abrió; no se descartó nada.');
        handle?.close();
      },
      onUndo: async () => {
        try {
          const result = await journal.undoLast(operationId);
          for (const warning of result.warnings) host.notice(warning);
          if (result.undone > 0) host.notice(`${result.undone} paso(s) deshecho(s).`);
          handle?.close();
          await rebuild();
        } catch (error) { host.notice(error instanceof Error ? error.message : String(error)); }
      }
    }), { title: 'Diario JDex' });
  }

  const commandHandlers: JdexCommandHandlers = {
    locate: () => {
      refreshPathItem();
      host.notice(latestLocated ? latestLocated.text : 'Esta nota no vive en el sistema JDex.');
    },
    toggle: () => {
      refreshPathItem();
      toggleNoteAndFolder();
    },
    audit: () => host.revealView(JDEX_AUDIT_VIEW_ID),
    repair: async () => {
      await rebuild();
      host.revealView(JDEX_AUDIT_VIEW_ID);
    },
    createId: () => openCreateIdDialog(),
    createCategory: () => openCreateCategoryDialog(),
    createArea: () => openCreateAreaDialog(),
    createHeader: () => openCreateHeaderDialog(),
    createChild: () => openCreateChildDialog(),
    normalizeNote: () => openNormalizeThisNote(),
    normalizeAll: () => openNormalizeDialog(null),
    refreshHeaders: () =>
      void refreshHeadersCommand().catch((error: unknown) =>
        report(error, 'actualizar-cabeceras')
      ),
    refreshIndex: () =>
      void refreshIndexCommand().catch((error: unknown) => report(error, 'actualizar-indice')),
    wrapHeaders: () =>
      void openWrapHeadersDialog().catch((error: unknown) =>
        report(error, 'envolver-cabeceras')
      ),
    gotoId: () => openGotoIdDialog(),
    processInbox: () => openProcessInboxDialog(),
    undo: () => openUndoDialog(),
    health: async () => {
      try {
        await rebuild();
        if (!walk || !index) return;
        const note = await journal.run('fix', 'Crear informe de salud', (vault) => createJdexHealthReport(vault, walk!, index!, settings, todayIso()));
        api.workspace.openNote(note.id);
      } catch (error) { host.notice(error instanceof Error ? error.message : String(error)); }
    },
    systemReport: async () => {
      try {
        await rebuild();
        if (!walk || !index) return;
        const note = await journal.run('fix', 'Crear informe del sistema', (vault) => createJdexSystemReport(vault, walk!, index!, findings, settings, todayIso()));
        api.workspace.openNote(note.id);
      } catch (error) { host.notice(error instanceof Error ? error.message : String(error)); }
    },
    writeTemplates: async () => {
      try { host.notice(await writeBuiltinTemplates()); } catch (error) { host.notice(error instanceof Error ? error.message : String(error)); }
    }
  };
  const offCommands = registerJdexCommands(host, commandHandlers, 'main');
  const offActiveNoteCommands = registerJdexActiveNoteCommands({
    api,
    state: () => (walk && index ? { walk, index, jdexFolder: settings.jdexFolder, dateFormat: settings.dateFormat } : null),
    journal,
    rebuild,
    copy: copyToClipboard
  });
  const offLateCommands = registerJdexCommands(host, commandHandlers, 'late');

  const offAuditView = host.registerView({
    id: JDEX_AUDIT_VIEW_ID,
    title: 'Auditoría JDex',
    icon: 'circle-check',
    placement: 'dialog',
    mount: (el) => auditPanel.mount(el),
    unmount: () => auditPanel.unmount()
  });

  // ---- Lote 4, tarea 2: sección del ID en el panel de contexto (`idSectionPanel`) ----

  const offIdSectionActiveNote = api.workspace.onActiveNoteChange(() => idSectionPanel.refresh());
  // El ajuste «Usar fechas ISO 8601» de Hebra: las fechas de la sección se repintan solas.
  const offIsoDates = api.env.onIsoDatesChange(() => idSectionPanel.refresh());

  const offIdSectionView = host.registerView({
    id: JDEX_ID_SECTION_VIEW_ID,
    title: 'JDex',
    icon: 'compass',
    placement: 'column',
    mount: (el) => idSectionPanel.mount(el),
    unmount: () => idSectionPanel.unmount()
  });

  // «Los números JD son clicables… y autocompletado» (lote 4, tarea 2): `ids()`
  // lee `index` en el momento (nunca una copia), así que un ID creado después de
  // abrir la nota queda clicable sin remontar el editor.
  // Hebra prueba la extensión antes de montarla y la rechaza (`extension-rechazada`) si
  // no se construyó con SU `@codemirror/state`: sin ella el módulo sigue vivo, solo sin
  // números clicables.
  let offEditorExtension: PluginUnregister = () => {};
  try {
    offEditorExtension = api.editor.registerExtension(
      jdexEditorExtension({
        ids: () => index?.ids ?? [],
        subscribe: (repaint) => {
          editorRepaints.add(repaint);
          return () => void editorRepaints.delete(repaint);
        },
        // Un número del texto lleva a su NOTA; la carpeta es la alternativa (⌘/Ctrl+Alt+clic).
        onNavigate: (entry, options) => {
          if (walk) gotoJdexEntry(entry, walk, !options?.folder);
        },
        // Varios hijos `+` con el mismo número: se pregunta cuál, con el mismo buscador.
        onAmbiguous: (entries, options) => {
          if (!walk) return;
          const currentWalk = walk;
          let handle: PluginModalHandle | undefined;
          handle = host.openModal(
            (el) => {
              const picker = mountJdexIdPicker(el, {
                entries,
                placeholder: 'Varios IDs comparten este número: elige uno…',
                onSelect: (entry) => {
                  handle?.close();
                  gotoJdexEntry(entry, currentWalk, !options.folder);
                }
              });
              picker.focus();
            },
            { title: 'JDex: ¿cuál?' }
          );
        },
        autocomplete: () => settings.autocomplete,
        autocompleteInsert: () => settings.autocompleteInsert
      })
    );
  } catch (error) {
    report(error, 'extension-del-editor');
  }

  /** «Escribir plantillas integradas»: the four built-in templates into `templatesFolder`,
   *  never over a note that already has the name. */
  async function writeBuiltinTemplates(): Promise<string> {
    await rebuild();
    if (!walk) throw new Error('El índice JDex aún no está listo.');
    const currentWalk = walk;
    const outcome = await journal.run('create-structure', 'Escribir plantillas integradas', (vault) => writeJdexBuiltinTemplates(vault, api.markdown, currentWalk, settings));
    await rebuild();
    return jdexTemplatesOutcomeMessage(outcome);
  }
  const offSettingsPanel = host.settingsPanel((el) =>
    mountJdexSettingsPanel(el, {
      writeTemplates: writeBuiltinTemplates,
      get: () => settings,
      save: (next) => {
        // A path changed by hand stops following the folder it pointed at before.
        for (const key of TRACKED_FOLDER_KEYS) if (next[key] !== settings[key]) delete folderIds[key];
        const baseline = settings;
        settings = next;
        void persistJdexSettings(api.storage.settings, settings, baseline).catch((error: unknown) =>
          report(error, 'guardar-ajustes')
        );
        void rebuild().catch((error: unknown) => report(error, 'rebuild-ajustes'));
      },
      pickFolder: async () => {
        // La API 1.1 devuelve el ID de la carpeta elegida, o `null` al cancelar y al elegir
        // «Raíz»: en ambos casos el panel no toca el campo. Un id que no está entre las
        // carpetas conocidas tampoco cambia nada.
        const picked = await host.pickFolder();
        if (picked === null) return null;
        const rootFolderId = api.vault.rootFolderId();
        const paths =
          walk?.folderPaths ??
          jdexFolderPaths(
            (await api.vault.foldersList()).filter((folder) => folder.id !== rootFolderId),
            rootFolderId
          );
        return paths.get(picked) ?? null;
      }
    })
  );

  const cleanup: PluginCleanup = () => {
    disposed = true;
    modals.closeAll();
    debugSink = null;
    offSettingsChange();
    scheduler.dispose();
    offActiveNote();
    offFolders();
    offNotes();
    offRenameGuard();
    offNoteTitleRenamed();
    offCommands();
    offActiveNoteCommands();
    offLateCommands();
    offAuditView();
    offIdSectionActiveNote();
    offIdSectionView();
    offEditorExtension();
    offIsoDates();
    offSettingsPanel();
    pathHandle?.remove();
    auditHandle.remove();
    inboxHandle.remove();
  };
  activationSettled.set(cleanup, initialRebuild);
  return cleanup;
}

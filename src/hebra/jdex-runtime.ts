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
import { mountJdexAuditView } from './jdex-audit-view';
import { mountJdexSettingsPanel } from './jdex-settings-panel';
import { autodetectJdexSettings, loadJdexSettings, persistJdexSettings } from './settings';
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
  type JdexCreateOutcome
} from './jdex-create-write';
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
import { loadJdexIdSection } from './jdex-id-section';
import { mountJdexIdSectionLoading, mountJdexIdSectionView } from './jdex-id-section-view';
import { jdexEditorExtension } from './jdex-editor-extension';
import { createJdexJournal } from './jdex-journal';
import { guardJdexJournal, trackJdexModals } from './jdex-lifecycle';
import { mountJdexJournalView } from './jdex-journal-view';
import { createJdexHealthReport } from './jdex-health';
import { applyJdexRepair } from './jdex-repair';
import { createJdexSystemReport } from './jdex-system-report';

export const JDEX_AUDIT_VIEW_ID = 'jdex:auditoria';
export const JDEX_ID_SECTION_VIEW_ID = 'jdex:seccion-del-id';
export const JDEX_STATUS_PATH_ID = 'jdex-path';
export const JDEX_STATUS_AUDIT_ID = 'jdex-audit';
export const JDEX_STATUS_INBOX_ID = 'jdex-inbox';
export const JDEX_COMMAND_LOCATE = 'jdex-donde-vive-esta-nota';
export const JDEX_COMMAND_TOGGLE = 'jdex-alternar-nota-y-carpeta';
export const JDEX_COMMAND_AUDIT = 'jdex-auditar-el-sistema';
export const JDEX_COMMAND_REPAIR = 'jdex-reparar';
export const JDEX_COMMAND_CREATE_ID = 'jdex-crear-id';
export const JDEX_COMMAND_CREATE_CATEGORY = 'jdex-crear-categoria';
export const JDEX_COMMAND_CREATE_AREA = 'jdex-crear-area';
export const JDEX_COMMAND_CREATE_HEADER = 'jdex-crear-cabecera';
export const JDEX_COMMAND_CREATE_CHILD = 'jdex-crear-id-hijo';
export const JDEX_COMMAND_NORMALIZE_NOTE = 'jdex-normalizar-esta-nota';
export const JDEX_COMMAND_NORMALIZE_ALL = 'jdex-normalizar-toda-la-jdex';
export const JDEX_COMMAND_REFRESH_HEADERS = 'jdex-actualizar-cabeceras';
export const JDEX_COMMAND_REFRESH_INDEX = 'jdex-actualizar-indice';
export const JDEX_COMMAND_WRAP_HEADERS = 'jdex-envolver-cabeceras';
export const JDEX_COMMAND_GOTO_ID = 'jdex-ir-a-un-id';
export const JDEX_COMMAND_PROCESS_INBOX = 'jdex-procesar-inbox';
export const JDEX_COMMAND_UNDO = 'jdex-deshacer-ultima-operacion';
export const JDEX_COMMAND_HEALTH = 'jdex-informe-de-salud';
export const JDEX_COMMAND_SYSTEM_REPORT = 'jdex-informe-del-sistema';
export const JDEX_COMMAND_WRITE_TEMPLATES = 'jdex-escribir-plantillas-integradas';

/** Reconstruir el índice tras un `library-changed` no en CADA aviso (una biblioteca que
 *  sincroniza muchas notas seguidas dispararía varias reconstrucciones completas). */
const REBUILD_DEBOUNCE_MS = 800;
/** Tras tantos fallos seguidos de la reconstrucción, el reintento automático para. */
const MAX_REBUILD_FAILURES = 5;
const MAX_REBUILD_DELAY_MS = 30_000;
/** Longest a pending notice waits while new notices keep re-arming the debounce. */
const MAX_BATCH_WAIT_MS = 3_000;

/** The first rebuild of each activation, keyed by its cleanup (tests and diagnostics). */
const activationSettled = new WeakMap<PluginCleanup, Promise<void>>();

/** Resolves when the activation that returned `cleanup` has finished (or failed) its first
 *  rebuild. `activateJdex` itself does not wait for it. */
export function jdexActivationSettled(cleanup: PluginCleanup): Promise<void> {
  return activationSettled.get(cleanup) ?? Promise.resolve();
}

function report(error: unknown, where: string): void {
  console.error(`[jdex] ${where}`, error);
}

export async function activateJdex(api: HebraPluginApi): Promise<PluginCleanup> {
  // Dialogs opened through `host` are closed by the cleanup.
  const modals = trackJdexModals(api.ui);
  const host = modals.ui;
  await new Promise<void>((resolve) => host.onReady(resolve));
  let settings = await loadJdexSettings(api.storage.settings);
  let folderIds = await loadTrackedFolderIds(api.storage.settings);
  // Operations still queued when the module is turned off do not write.
  const journal = guardJdexJournal(await createJdexJournal(api.vault, api.storage.settings), () => disposed);

  let walk: JdexLibraryWalk | null = null;
  let index: JdIndex | null = null;
  let findings: Finding[] = [];
  let inboxSummary: JdexInboxSummary | null = null;
  let latestLocated: Location | null = null;
  let latestNote: PluginActiveNote | null = null;
  /** Sección del ID (lote 4, tarea 2), `idSectionEl`: la pestaña puede volver a
   *  montarse sobre el mismo `el` mientras sigue abierta (la nota activa cambia);
   *  `idSectionRequest` descarta la respuesta de una petición vieja que llega
   *  tarde. Declarados AQUÍ, antes de `rebuild` (que los lee al final para
   *  refrescar la pestaña si está montada) — `rebuild()` se invoca por primera
   *  vez antes de que el bloque de registro de más abajo llegue a ejecutarse, y
   *  un `let` leído desde una función ya definida pero invocada antes de su
   *  propia línea sigue en zona muerta temporal (medido: `ReferenceError: Cannot
   *  access 'idSectionEl' before initialization` en el primer `rebuild()`). */
  let idSectionEl: HTMLElement | null = null;
  /** Repaints registered by the open editors (`jdexEditorExtension`'s `subscribe`). */
  const editorRepaints = new Set<() => void>();
  /** «Reparar» rebuilds between steps: the audit view is refreshed once at its end. */
  let repairing = false;
  let idSectionRequest = 0;
  let unmountIdSection: (() => void) | undefined;

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
  /** Generación de la última reconstrucción COMPLETA pedida: una que termina cuando ya
   *  hay otra más nueva no pisa el índice (su lectura es anterior a la de la nueva). */
  let generation = 0;
  let latestRebuild: Promise<void> = Promise.resolve();
  /** Reconstrucciones y puestas al día en vuelo: mientras haya alguna, un guardado no se
   *  descarta por no estar la nota en el recorrido (puede estar a punto de entrar). */
  let busy = 0;
  /** Every by-id refresh applies its result in this one queue (notice batches, own writes,
   *  live headers and maintenance): each starts from the state the previous one left, so
   *  two refreshes finishing in reverse order cannot drop each other's notes. The queue
   *  never waits for the journal or for a batch, so a batch can await it without a cycle. */
  let refreshTail: Promise<void> = Promise.resolve();
  /** Notes indexed at any point since activation: the at-rest `save` shortcut never
   *  discards one of these, even if an earlier refresh left it out of `walk`. */
  const everIndexed = new Set<string>();

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
    if (idSectionEl) renderIdSectionInto(idSectionEl);
    // Open editors repaint their numbers, and an open audit view shows the new findings
    // (not the ones captured when it was mounted). Not while Repair walks its selection.
    for (const repaint of [...editorRepaints]) repaint();
    if (auditViewEl && !repairing) {
      unmountAuditView?.();
      mountAuditViewInto(auditViewEl);
    }
  }

  /** Reconstrucción COMPLETA: recorre la biblioteca desde cero. Reservada para la
   *  inicialización, un cambio de estructura de carpetas o de ajustes y las
   *  escrituras del propio módulo; un cambio de notas se pone al día por ids
   *  (`refreshNotes`). */
  function rebuild(): Promise<void> {
    const gen = ++generation;
    busy += 1;
    const run = runRebuild(gen).finally(() => {
      busy -= 1;
    });
    latestRebuild = run;
    return run;
  }

  async function runRebuild(gen: number): Promise<void> {
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
    if (gen !== generation) return latestRebuild;
    const nextEntries = await loadJdexAuditEntries(
      api.vault,
      api.markdown,
      nextWalk,
      settings.jdexFolder,
      auditEntries
    );
    if (disposed) return;
    // Superada por otra más nueva mientras leía: lo suyo es anterior, no pisa nada.
    if (gen !== generation) return latestRebuild;
    walk = nextWalk;
    auditEntries = nextEntries;
    derive();
  }

  // ---- Lote 2: crear ID/categoría/área/cabecera/hijo (+), normalizar el
  // frontmatter, cabeceras e índice al día -----------------------------------

  function noteIdByPath(path: string): string | null {
    return walk?.noteIdByPath?.get(path) ?? walk?.systemNotes.find((note) => note.path === path)?.id ?? null;
  }

  function sameFolderPaths(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>): boolean {
    return left.size === right.size && [...left].every(([id, path]) => right.get(id) === path);
  }

  /** A folder notice emitted by our own write needs no second walk after that write's
   *  rebuild. A different snapshot remains queued for the next batch. */
  function settleFolderChanges(): void {
    if (walk && pendingFolderPaths && sameFolderPaths(walk.folderPaths, pendingFolderPaths)) {
      pendingFolderPaths = null;
      pendingFull = false;
    }
  }

  /** Una escritura propia recorre la biblioteca una vez; las cabeceras modificadas
   *  después se incorporan por ids, sin otra reconstrucción completa. */
  async function afterJdexWrite(syncHeaders: boolean, vault: PluginVault = api.vault): Promise<void> {
    await rebuild();
    settleFolderChanges();
    if (syncHeaders && walk && index) {
      const result = await refreshJdexHeadersAndIndex(vault, walk, index, settings.systemIndexNote);
      if (result.written.length > 0) await refreshNotes(result.written);
    }
  }

  /** Manual JDex and folder changes refresh managed blocks; unchanged bodies do not write. */
  async function syncLiveHeaders(): Promise<void> {
    if (disposed || !(settings.liveHeaders || settings.automaticMaintenance) || !walk || !index) return;
    const result = await journal.run('fix', 'Actualizar cabeceras e índice vivos', (vault) => refreshJdexHeadersAndIndex(vault, walk!, index!, settings.systemIndexNote));
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
    const result = await journal.run('fix', 'Mantenimiento automático JDex', (vault) => applyJdexFrontmatterFixes(vault, api.markdown, chosen, noteIdByPath));
    for (const warning of result.warnings) host.notice(warning);
    if (result.written.length > 0) await refreshNotes(result.written);
  }

  async function syncDerived(): Promise<void> {
    await maintainDerivedFrontmatter();
    await syncLiveHeaders();
  }

  function reportCreateOutcome(outcome: JdexCreateOutcome): void {
    if (outcome.folderNotice) host.notice(outcome.folderNotice);
  }

  function openCreateIdDialog(): void {
    if (!walk || !index) return;
    if (index.categories.length === 0) {
      host.notice('No hay ninguna categoría en el sistema: crea una primero.');
      return;
    }
    const currentIndex = jdexCreationIndex(index, namePrefix(settings));
    let handle: PluginModalHandle | undefined;
    handle = host.openModal(
      (el) =>
        mountCreateIdDialog(el, {
          index: currentIndex,
          refreshIndex: async () => {
            return jdexCreationIndex(await readJdexCreationIndex(api.vault, settings), namePrefix(settings));
          },
          categories: currentIndex.categories,
          createFolderDefault: settings.createFolderByDefault,
          createPatternDefault: settings.createPatternByDefault,
          patternFor: (category) => patternFor(settings, category),
          onSubmit: async (request) => {
            try {
              const outcome = await journal.run('create-id', 'Crear ID', async (vault) => {
                const created = await createJdexId(
                  vault,
                  api.markdown,
                  walk!,
                  settings,
                  index!,
                  request
                );
                await afterJdexWrite(true, vault);
                return created;
              });
              handle?.close();
              reportCreateOutcome(outcome);
              api.workspace.openNote(outcome.note.id);
            } catch (error) {
              host.notice(error instanceof Error ? error.message : String(error));
            }
          }
        }),
      { title: 'JDex: crear ID' }
    );
  }

  function openCreateCategoryDialog(): void {
    if (!walk || !index) return;
    if (index.areas.length === 0) {
      host.notice('No hay ninguna área en el sistema: crea una primero.');
      return;
    }
    const currentWalk = walk;
    const currentIndex = jdexCreationIndex(index, namePrefix(settings));
    let handle: PluginModalHandle | undefined;
    handle = host.openModal(
      (el) =>
        mountCreateCategoryDialog(el, {
          index: currentIndex,
          refreshIndex: async () => {
            return selectCreationSystem(await readJdexCreationIndex(api.vault, settings), namePrefix(settings));
          },
          areas: currentIndex.areas,
          createFolderDefault: settings.createFolderByDefault,
          onSubmit: async (request) => {
            try {
              const outcome = await journal.run('create-structure', 'Crear categoría', async (vault) => {
                // Re-read at the write: the number may have been taken while the dialog was open.
                const liveIndex = selectCreationSystem(await readJdexCreationIndex(vault, settings), namePrefix(settings));
                const created = await createJdexCategory(
                  vault,
                  api.markdown,
                  walk ?? currentWalk,
                  settings,
                  liveIndex,
                  request
                );
                await afterJdexWrite(true, vault);
                return created;
              });
              handle?.close();
              reportCreateOutcome(outcome);
              api.workspace.openNote(outcome.note.id);
            } catch (error) {
              host.notice(error instanceof Error ? error.message : String(error));
            }
          }
        }),
      { title: 'JDex: crear categoría' }
    );
  }

  function openCreateAreaDialog(): void {
    if (!walk || !index) return;
    const currentWalk = walk;
    const currentIndex = selectCreationSystem(index, namePrefix(settings));
    let handle: PluginModalHandle | undefined;
    handle = host.openModal(
      (el) =>
        mountCreateAreaDialog(el, {
          index: currentIndex,
          refreshIndex: async () => {
            return selectCreationSystem(await readJdexCreationIndex(api.vault, settings), namePrefix(settings));
          },
          createFolderDefault: settings.createFolderByDefault,
          onSubmit: async (request) => {
            try {
              const outcome = await journal.run('create-structure', 'Crear área', async (vault) => {
                const liveIndex = selectCreationSystem(await readJdexCreationIndex(vault, settings), namePrefix(settings));
                const created = await createJdexArea(
                  vault,
                  api.markdown,
                  walk ?? currentWalk,
                  settings,
                  request,
                  liveIndex
                );
                await afterJdexWrite(true, vault);
                return created;
              });
              handle?.close();
              reportCreateOutcome(outcome);
              api.workspace.openNote(outcome.note.id);
            } catch (error) {
              host.notice(error instanceof Error ? error.message : String(error));
            }
          }
        }),
      { title: 'JDex: crear área' }
    );
  }

  function openCreateHeaderDialog(): void {
    if (!walk || !index) return;
    if (index.categories.length === 0) {
      host.notice('No hay ninguna categoría en el sistema: crea una primero.');
      return;
    }
    const currentIndex = jdexCreationIndex(index, namePrefix(settings));
    let handle: PluginModalHandle | undefined;
    handle = host.openModal(
      (el) =>
        mountCreateHeaderDialog(el, {
          index: currentIndex,
          refreshIndex: async () => {
            return jdexCreationIndex(await readJdexCreationIndex(api.vault, settings), namePrefix(settings));
          },
          categories: currentIndex.categories,
          onSubmit: async (request) => {
            try {
              const outcome = await journal.run('create-id', 'Crear cabecera', async (vault) => {
                const created = await createJdexHeader(
                  vault,
                  api.markdown,
                  walk!,
                  settings,
                  index!,
                  request
                );
                await afterJdexWrite(true, vault);
                return created;
              });
              handle?.close();
              reportCreateOutcome(outcome);
              api.workspace.openNote(outcome.note.id);
            } catch (error) {
              host.notice(error instanceof Error ? error.message : String(error));
            }
          }
        }),
      { title: 'JDex: crear cabecera' }
    );
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
    const currentIndex = index;
    let handle: PluginModalHandle | undefined;
    handle = host.openModal(
      (el) =>
        mountCreateChildDialog(el, {
          index: currentIndex,
          refreshIndex: async () => {
            return readJdexCreationIndex(api.vault, settings);
          },
          parent,
          createFolderDefault: settings.createFolderByDefault,
          onSubmit: async (request) => {
            try {
              const outcome = await journal.run('create-id', 'Crear hijo de ID', async (vault) => {
                const created = await createJdexChild(
                  vault,
                  api.markdown,
                  walk!,
                  settings,
                  index!,
                  request
                );
                await afterJdexWrite(true, vault);
                return created;
              });
              handle?.close();
              reportCreateOutcome(outcome);
              api.workspace.openNote(outcome.note.id);
            } catch (error) {
              host.notice(error instanceof Error ? error.message : String(error));
            }
          }
        }),
      { title: `JDex: crear ID hijo de ${parent.label}` }
    );
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
    if (action.type !== 'rename-partner') return;
    const renamed = extractJdPrefix(event.newTitle);
    if (renamed?.number.kind === 'id' && refuseRepeated({ id: renamed.number.extension ? `${renamed.number.id}+` : renamed.number.id, system: renamed.number.system, title: renamed.title })) return;
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

  async function copyToClipboard(text: string, successMessage: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      host.notice(successMessage);
    } catch {
      host.notice('No se pudo copiar.');
    }
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

  /** «Mover la nota abierta aquí»: la nota ACTIVA (`latestNote`, tarea 2 del lote
   *  1), nunca una elegida aparte — el selector no vuelve a listar notas, que ya
   *  tiene su propio buscador (⌘K a secas). */
  async function moveActiveNoteToEntry(
    entry: IdEntry,
    currentWalk: JdexLibraryWalk
  ): Promise<void> {
    const note = latestNote;
    if (!note || !entry.folderPath) return;
    const folderId = jdexResolveFolderId(currentWalk, entry.folderPath);
    if (!folderId) {
      host.notice(`No se encontró la carpeta de ${entry.label}.`);
      return;
    }
    try {
      await journal.run('move', `Mover nota a ${entry.label}`, (vault) => vault.noteMove(note.id, folderId));
      host.notice(`Movida a ${entry.label}.`);
      await rebuild();
    } catch (error) {
      host.notice(error instanceof Error ? error.message : String(error));
    }
  }

  /** «Retirar este ID»: un segundo aviso (mismo componente que la tarea 1, «nunca
   *  actúa sola») antes de `retireJdexId` — mover a la `.09` y marcar archivado no
   *  se deshace pulsando otra vez. */
  function confirmRetireEntry(
    entry: IdEntry,
    currentWalk: JdexLibraryWalk,
    currentIndex: JdIndex
  ): void {
    if (isRepeatedId(currentIndex, entry)) {
      host.notice(repeatedIdMessage(entry));
      return;
    }
    let handle: PluginModalHandle | undefined;
    handle = host.openModal(
      (el) =>
        mountJdexRenameWarningView(el, {
          message:
            `«${entry.label}» se retira: se marca archivado con la fecha de hoy y, si ` +
            `tiene carpeta, se mueve a la .09 de su categoría. El número NUNCA se ` +
            `reutiliza. ¿Confirmas?`,
          confirmLabel: 'Retirar',
          onContinue: () => {
            handle?.close();
            void runRetireEntry(entry, currentWalk, currentIndex);
          },
          onCancel: () => handle?.close()
        }),
      { title: 'JDex: retirar ID' }
    );
  }

  async function runRetireEntry(
    entry: IdEntry,
    currentWalk: JdexLibraryWalk,
    currentIndex: JdIndex
  ): Promise<void> {
    try {
      const outcome = await journal.run('retire', `Retirar ${entry.label}`, async (vault) => {
        const retired = await retireJdexId(
          vault,
          api.markdown,
          currentWalk,
          currentIndex,
          entry,
          todayIso()
        );
        await afterJdexWrite(true, vault);
        return retired;
      });
      host.notice(
        outcome.moved
          ? `${entry.label} retirado: movido a su archivo.`
          : `${entry.label} retirado (la carpeta se queda donde estaba).`
      );
    } catch (error) {
      host.notice(error instanceof Error ? error.message : String(error));
      await rebuild().catch((cause: unknown) => report(cause, 'rebuild-tras-retirada-parcial'));
    }
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

  /** Lo acumulado en el lote: una reconstrucción completa pedida, o los ids de las
   *  notas cuyo aviso llegó (el mismo temporizador de siempre). */
  let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingFull = false;
  let pendingFolderPaths: ReadonlyMap<string, string> | null = null;
  /** `true` tras apagar el módulo: ningún reintento ni lote vuelve a armarse. */
  let disposed = false;
  /** Fallos seguidos de la reconstrucción (a 0 SOLO cuando una termina bien; un aviso
   *  no lo reinicia, o con un fallo determinista y autoguardado continuo cada aviso
   *  rearmaría el reintento a 800 ms sin fin): el reintento se espacia y se rinde tras
   *  `MAX_REBUILD_FAILURES`. Pasado el tope, cada aviso da UN intento (un fallo más no
   *  arma temporizador). */
  let failures = 0;
  const pendingIds = new Set<string>();
  /** Las puestas al día por ids van de una en una (cada una parte del estado que dejó la
   *  anterior). */
  let notesTail: Promise<void> = Promise.resolve();

  /** When the oldest unprocessed notice arrived: a steady stream of notices under the
   *  debounce still flushes every `MAX_BATCH_WAIT_MS`. */
  let batchSince: number | null = null;

  function armBatchTimer(delayMs: number = REBUILD_DEBOUNCE_MS, capped = true): void {
    if (disposed) return;
    if (rebuildTimer !== null) clearTimeout(rebuildTimer);
    if (capped) {
      batchSince ??= Date.now();
      delayMs = Math.max(0, Math.min(delayMs, MAX_BATCH_WAIT_MS - (Date.now() - batchSince)));
    }
    rebuildTimer = setTimeout(() => {
      rebuildTimer = null;
      batchSince = null;
      void flushBatch();
    }, delayMs);
  }

  /** Una reconstrucción o puesta al día falló: se pide una reconstrucción completa con
   *  retroceso exponencial (800 ms, 1,6 s, 3,2 s…, tope de 30 s) y, tras
   *  `MAX_REBUILD_FAILURES` seguidos, se para SIN temporizador: `pendingFull` queda a la
   *  espera y el siguiente aviso de notas o de carpetas reconstruye entero. Con el
   *  módulo apagado no hace nada (un puerto cerrado fallaría para siempre). */
  function retryAfterFailure(): void {
    if (disposed) return;
    failures += 1;
    pendingFull = true;
    if (failures >= MAX_REBUILD_FAILURES) return;
    armBatchTimer(Math.min(REBUILD_DEBOUNCE_MS * 2 ** (failures - 1), MAX_REBUILD_DELAY_MS), false);
  }

  /** `syncDerived` failed (a write the host rejects, a journal it cannot save): that is not
   *  a stale index, so no full rebuild. One notice until a batch succeeds again; the next
   *  real change retries the derived writes. */
  let derivedFailureNotified = false;
  function reportDerivedFailure(error: unknown): void {
    report(error, 'mantener-derivados');
    if (disposed || derivedFailureNotified) return;
    derivedFailureNotified = true;
    const reason = error instanceof Error ? error.message : String(error);
    host.notice(`JDex no pudo mantener las cabeceras, el índice o el frontmatter: ${reason} Lo reintentará con el próximo cambio.`);
  }

  /** Un cambio de estructura de carpetas (o de ajustes): reconstrucción completa, con
   *  retardo para no hacer una por aviso. */
  function scheduleRebuild(): void {
    pendingFull = true;
    armBatchTimer();
  }

  async function flushBatch(): Promise<void> {
    const full = pendingFull;
    const ids = [...pendingIds];
    pendingFull = false;
    pendingIds.clear();
    if (!full && ids.length === 0) return;
    // Only a failed rebuild or refresh asks for another full rebuild; a failed derived
    // write is reported once (`reportDerivedFailure`). `failures` resets only when the
    // whole batch ends well. By-id batches go one after another (`notesTail`); a full one
    // does not wait for them (a newer rebuild must be able to overtake a slow one).
    const batch = async (): Promise<void> => {
      try {
        if (full) {
          await rebuild();
          settleFolderChanges();
        } else {
          await refreshNotes(ids);
        }
      } catch (error) {
        report(error, full ? 'rebuild' : 'actualizar-notas');
        // Sin esto un fallo dejaría `walk` viejo (o `null`), o una nota cuya lectura
        // falló fuera del índice, hasta el próximo aviso.
        retryAfterFailure();
        return;
      }
      try {
        await syncDerived();
      } catch (error) {
        reportDerivedFailure(error);
        return;
      }
      failures = 0;
      derivedFailureNotified = false;
    };
    busy += 1;
    try {
      if (full) {
        await batch();
        return;
      }
      notesTail = notesTail.then(batch);
      await notesTail;
    } finally {
      busy -= 1;
    }
  }

  /** Pone al día solo las notas `ids` (`applyJdexNoteChanges`); el recorrido completo
   *  se reserva para lo que no se puede resolver por ids. Serialised in `refreshTail`. */
  function refreshNotes(ids: readonly string[]): Promise<void> {
    busy += 1;
    const run = refreshTail.then(() => refreshNotesNow(ids));
    refreshTail = run.catch(() => undefined);
    return run.finally(() => {
      busy -= 1;
    });
  }

  async function refreshNotesNow(ids: readonly string[]): Promise<void> {
    for (;;) {
      // Una reconstrucción en vuelo deja su estado antes; si arranca otra mientras
      // se espera, se espera también a esa.
      let seen: number;
      do {
        seen = generation;
        await latestRebuild.catch(() => undefined);
      } while (seen !== generation);
      if (disposed) return;
      if (!walk) {
        await rebuild();
        return;
      }
      const gen = generation;
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
      if (gen !== generation) return;
      // Something else replaced `walk` meanwhile: apply the same ids to the new state.
      if (walk !== base) continue;
      if (update.kind === 'rebuild') {
        await rebuild();
      } else if (update.kind === 'updated') {
        walk = update.state.walk;
        auditEntries = update.state.entries;
        derive();
      }
      return;
    }
  }

  /** Razones que no cambian nada de lo que JDex indexa (título, carpeta, estado,
   *  frontmatter de la carpeta JDex): anclar y ocultar del listado general. */
  const IRRELEVANT_REASONS: ReadonlySet<string> = new Set(['favorite', 'hide']);
  /** Razones que se resuelven por ids, con el efecto de cada una:
   *   - `save`: cuerpo, título y frontmatter (la nota no cambia de carpeta ni de estado);
   *   - `create`: alta; `purge`: baja definitiva;
   *   - `trash`, `restore`, `archive`: baja y alta de la pertenencia (viva, sin archivo);
   *   - `move`: carpeta nueva, dentro o fuera del sistema o de la carpeta JDex;
   *   - `resolve`: la copia de conflicto que se descarta o se adopta;
   *   - `sync`: lo que trae otro dispositivo (pocos ids; más de una `note_summary`
   *     reconstruye).
   *  El resto (`import`: importación masiva, y cualquier razón que no se conozca)
   *  reconstruye entero, como antes de PERF-07: un recorrido completo justificado. */
  const INCREMENTAL_REASONS: ReadonlySet<string> = new Set([
    'save',
    'create',
    'purge',
    'trash',
    'restore',
    'archive',
    'move',
    'resolve',
    'sync'
  ]);

  function onNotesChanged(event: PluginNotesChange): void {
    if (IRRELEVANT_REASONS.has(event.reason)) return;
    if (!INCREMENTAL_REASONS.has(event.reason)) {
      scheduleRebuild();
      return;
    }
    // Un guardado de una nota que no está en el recorrido no puede cambiar el índice
    // (guardar no la mueve ni la saca de la papelera): sin consultar nada. Solo vale
    // con todo en reposo; con algo en vuelo la nota podría estar a punto de entrar.
    if (
      event.reason === 'save' &&
      walk !== null &&
      !pendingFull &&
      busy === 0 &&
      rebuildTimer === null &&
      event.ids.every((id) => !walkNoteIds.has(id) && !pendingIds.has(id) && !everIndexed.has(id))
    ) {
      return;
    }
    for (const id of event.ids) pendingIds.add(id);
    armBatchTimer();
  }

  // Los oyentes se registran ANTES de la reconstrucción inicial: lo que llegue mientras
  // recorre (la primera ronda de sync) queda pendiente y se aplica al terminar.
  const offFolders = api.workspace.onFoldersChange((folders) => {
    const paths = jdexFolderPaths(folders.filter((folder) => folder.id !== api.vault.rootFolderId()), api.vault.rootFolderId());
    pendingFolderPaths = paths;
    scheduleRebuild();
    folderRenameGuard.foldersChanged(folders);
  });
  const offNotes = api.workspace.onNotesChange(onNotesChanged);

  // Activation does not wait for the first walk (the host abandons a slow activation): the
  // bar shows «JD: …» until it lands. A failure enters the normal retry path.
  const initialRebuild = rebuild().catch((error: unknown) => {
    report(error, 'rebuild-inicial');
    retryAfterFailure();
  });

  const offActiveNote = api.workspace.onActiveNoteChange(() => refreshPathItem());
  const offRenameGuard = api.workspace.onBeforeFolderRename(confirmRename);
  const offNoteTitleRenamed = api.workspace.onNoteTitleRenamed(onNoteTitleRenamed);

  const offCommandLocate = host.registerCommand({
    id: JDEX_COMMAND_LOCATE,
    name: 'JDex: dónde vive esta nota',
    run: () => {
      refreshPathItem();
      host.notice(latestLocated ? latestLocated.text : 'Esta nota no vive en el sistema JDex.');
    }
  });
  const offCommandToggle = host.registerCommand({
    id: JDEX_COMMAND_TOGGLE,
    name: 'JDex: alternar nota y carpeta',
    run: () => {
      refreshPathItem();
      toggleNoteAndFolder();
    }
  });
  const offCommandAudit = host.registerCommand({
    id: JDEX_COMMAND_AUDIT,
    name: 'JDex: auditar el sistema',
    run: () => host.revealView(JDEX_AUDIT_VIEW_ID)
  });
  const offCommandRepair = host.registerCommand({
    id: JDEX_COMMAND_REPAIR,
    name: 'JDex: reparar',
    run: async () => {
      await rebuild();
      host.revealView(JDEX_AUDIT_VIEW_ID);
    }
  });
  const offCommandCreateId = host.registerCommand({
    id: JDEX_COMMAND_CREATE_ID,
    name: 'JDex: crear ID',
    run: () => openCreateIdDialog()
  });
  const offCommandCreateCategory = host.registerCommand({
    id: JDEX_COMMAND_CREATE_CATEGORY,
    name: 'JDex: crear categoría',
    run: () => openCreateCategoryDialog()
  });
  const offCommandCreateArea = host.registerCommand({
    id: JDEX_COMMAND_CREATE_AREA,
    name: 'JDex: crear área',
    run: () => openCreateAreaDialog()
  });
  const offCommandCreateHeader = host.registerCommand({
    id: JDEX_COMMAND_CREATE_HEADER,
    name: 'JDex: crear cabecera',
    run: () => openCreateHeaderDialog()
  });
  const offCommandCreateChild = host.registerCommand({
    id: JDEX_COMMAND_CREATE_CHILD,
    name: 'JDex: crear ID hijo (+)',
    run: () => openCreateChildDialog()
  });
  const offCommandNormalizeNote = host.registerCommand({
    id: JDEX_COMMAND_NORMALIZE_NOTE,
    name: 'JDex: normalizar el frontmatter de esta nota',
    run: () => openNormalizeThisNote()
  });
  const offCommandNormalizeAll = host.registerCommand({
    id: JDEX_COMMAND_NORMALIZE_ALL,
    name: 'JDex: normalizar el frontmatter de toda la JDex',
    run: () => openNormalizeDialog(null)
  });
  const offCommandRefreshHeaders = host.registerCommand({
    id: JDEX_COMMAND_REFRESH_HEADERS,
    name: 'JDex: actualizar las listas de cabeceras',
    run: () =>
      void refreshHeadersCommand().catch((error: unknown) =>
        report(error, 'actualizar-cabeceras')
      )
  });
  const offCommandRefreshIndex = host.registerCommand({
    id: JDEX_COMMAND_REFRESH_INDEX,
    name: 'JDex: actualizar el índice del sistema',
    run: () =>
      void refreshIndexCommand().catch((error: unknown) => report(error, 'actualizar-indice'))
  });
  const offCommandWrapHeaders = host.registerCommand({
    id: JDEX_COMMAND_WRAP_HEADERS,
    name: 'JDex: envolver las listas de cabeceras en marcadores',
    run: () =>
      void openWrapHeadersDialog().catch((error: unknown) =>
        report(error, 'envolver-cabeceras')
      )
  });
  const offCommandGotoId = host.registerCommand({
    id: JDEX_COMMAND_GOTO_ID,
    name: 'JDex: ir a un ID…',
    run: () => openGotoIdDialog()
  });
  const offCommandProcessInbox = host.registerCommand({
    id: JDEX_COMMAND_PROCESS_INBOX,
    name: 'JDex: procesar inbox',
    run: () => openProcessInboxDialog()
  });
  const offActiveNoteCommands = registerJdexActiveNoteCommands({
    api,
    state: () => (walk && index ? { walk, index, jdexFolder: settings.jdexFolder, dateFormat: settings.dateFormat } : null),
    journal,
    rebuild,
    copy: copyToClipboard
  });
  const offCommandUndo = host.registerCommand({
    id: JDEX_COMMAND_UNDO,
    name: 'JDex: deshacer la última operación',
    run: () => {
      const entries = journal.entries();
      const operation = entries[entries.length - 1];
      let handle: PluginModalHandle | undefined;
      handle = host.openModal((el) => mountJdexJournalView(el, {
        entries,
        onUndo: async () => {
          try {
            const latest = journal.entries();
            if (latest[latest.length - 1] !== operation) throw new Error('El diario cambió desde que se abrió; vuelve a abrirlo antes de deshacer.');
            const result = await journal.undoLast();
            for (const warning of result.warnings) host.notice(warning);
            if (result.undone > 0) host.notice(`${result.undone} paso(s) deshecho(s).`);
            handle?.close();
            await rebuild();
          } catch (error) { host.notice(error instanceof Error ? error.message : String(error)); }
        }
      }), { title: 'Diario JDex' });
    }
  });
  const offCommandHealth = host.registerCommand({
    id: JDEX_COMMAND_HEALTH,
    name: 'JDex: informe de salud del sistema',
    run: async () => {
      try {
        await rebuild();
        if (!walk || !index) return;
        const note = await journal.run('fix', 'Crear informe de salud', (vault) => createJdexHealthReport(vault, walk!, index!, settings, todayIso()));
        api.workspace.openNote(note.id);
      } catch (error) { host.notice(error instanceof Error ? error.message : String(error)); }
    }
  });
  const offCommandSystemReport = host.registerCommand({
    id: JDEX_COMMAND_SYSTEM_REPORT,
    name: 'JDex: informe del sistema',
    run: async () => {
      try {
        await rebuild();
        if (!walk || !index) return;
        const note = await journal.run('fix', 'Crear informe del sistema', (vault) => createJdexSystemReport(vault, walk!, index!, findings, settings, todayIso()));
        api.workspace.openNote(note.id);
      } catch (error) { host.notice(error instanceof Error ? error.message : String(error)); }
    }
  });

  let unmountAuditView: (() => void) | undefined;
  let auditViewEl: HTMLElement | null = null;
  function mountAuditViewInto(el: HTMLElement): void {
    unmountAuditView = mountJdexAuditView(el, {
      findings: () => findings,
      openPath: (path) => {
        if (!walk) return;
        if (path.endsWith('.md')) {
          const ref = walk.systemNotes.find((note) => note.path === path);
          if (ref) api.workspace.openNote(ref.id);
          return;
        }
        const folderId = jdexResolveFolderId(walk, path);
        if (folderId) api.workspace.selectFolder(folderId);
      },
      applyFrontmatterFix: (finding) => {
        void (async () => {
          try {
            const result = await journal.run('fix', 'Aplicar arreglo de auditoría', (vault) => applyJdexFrontmatterFixes(vault, api.markdown, [finding], noteIdByPath));
            for (const warning of result.warnings) host.notice(warning);
            await rebuild();
            if (auditViewEl) {
              unmountAuditView?.();
              mountAuditViewInto(auditViewEl);
            }
          } catch (error) {
            report(error, 'aplicar-frontmatter');
            host.notice(error instanceof Error ? error.message : String(error));
          }
        })();
      },
      repair: (selected) => {
        void (async () => {
          let done = 0;
          let failed = 0;
          repairing = true;
          try {
            await journal.run('fix', 'Reparar JDex', async (vault) => {
              // Turned off before this queued operation started: nothing to write.
              if (disposed) return;
              const order = (finding: Finding): number => {
                const type = finding.fix?.type;
                if (type === 'create-note' || type === 'create-folder' || type === 'folders') return 0;
                if (type === 'frontmatter' || type === 'rename') return 1;
                if (type === 'move') return 2;
                return 3;
              };
              for (const finding of [...selected].sort((a, b) => order(a) - order(b))) {
                if (!finding.fix) continue;
                // Turned off mid-loop: `rebuild()` no longer refreshes, so `findings` and
                // `walk` would be stale; stop before writing anything else.
                if (disposed) break;
                try {
                  await rebuild();
                  if (disposed) break;
                  if (!findings.some((fresh) => fresh.kind === finding.kind && JSON.stringify(fresh.fix) === JSON.stringify(finding.fix))) {
                    throw new Error(`${finding.paths[0]}: cambió desde la vista previa; vuelve a abrir Reparar.`);
                  }
                  const result = await applyJdexRepair(vault, api.markdown, walk!, index!, settings, finding.fix);
                  for (const warning of result.warnings) host.notice(warning);
                  if (result.applied) done += 1;
                  else failed += 1;
                } catch (error) {
                  failed += 1;
                  host.notice(error instanceof Error ? error.message : String(error));
                }
              }
              if (done > 0 && !disposed) await afterJdexWrite(true, vault);
            });
          } catch (error) {
            report(error, 'reparar');
            if (!disposed) host.notice(error instanceof Error ? error.message : String(error));
          } finally {
            repairing = false;
            if (!disposed) {
              await rebuild();
              if (auditViewEl) {
                unmountAuditView?.();
                mountAuditViewInto(auditViewEl);
              }
              host.notice(`Reparar: ${done} aplicado(s); ${failed} omitido(s) o fallido(s).`);
            }
          }
        })();
      }
    });
  }
  const offAuditView = host.registerView({
    id: JDEX_AUDIT_VIEW_ID,
    title: 'Auditoría JDex',
    icon: 'circle-check',
    placement: 'dialog',
    mount: (el) => {
      auditViewEl = el;
      mountAuditViewInto(el);
    },
    unmount: () => {
      auditViewEl = null;
      unmountAuditView?.();
      unmountAuditView = undefined;
    }
  });

  // ---- Lote 4, tarea 2: sección del ID en el panel de contexto ----------------
  // (`idSectionEl`/`idSectionRequest`/`unmountIdSection` viven arriba, con el
  // resto del estado de `activate`: ver su comentario.)

  function renderIdSectionInto(el: HTMLElement): void {
    idSectionEl = el;
    const request = ++idSectionRequest;
    mountJdexIdSectionLoading(el);
    if (!walk || !index) return;
    void loadJdexIdSection(api.vault, api.markdown, walk, index, settings, latestNote)
      .then((data) => {
        if (request !== idSectionRequest || idSectionEl !== el) return;
        unmountIdSection?.();
        unmountIdSection = mountJdexIdSectionView(el, {
          data,
          onGoto: (entry) => {
            if (walk) gotoJdexEntry(entry, walk);
          },
          onOpenNote: (id) => api.workspace.openNote(id),
          onCreateChild: () => openCreateChildDialog(),
          isoDates: () => api.env.isoDates()
        });
      })
      .catch((error: unknown) => report(error, 'seccion-del-id'));
  }

  const offIdSectionActiveNote = api.workspace.onActiveNoteChange(() => {
    if (idSectionEl) renderIdSectionInto(idSectionEl);
  });
  // El ajuste «Usar fechas ISO 8601» de Hebra: las fechas de la sección se repintan solas.
  const offIsoDates = api.env.onIsoDatesChange(() => {
    if (idSectionEl) renderIdSectionInto(idSectionEl);
  });

  const offIdSectionView = host.registerView({
    id: JDEX_ID_SECTION_VIEW_ID,
    title: 'JDex',
    icon: 'compass',
    placement: 'column',
    mount: (el) => renderIdSectionInto(el),
    unmount: () => {
      idSectionEl = null;
      idSectionRequest += 1;
      unmountIdSection?.();
      unmountIdSection = undefined;
    }
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
  const offCommandWriteTemplates = host.registerCommand({
    id: JDEX_COMMAND_WRITE_TEMPLATES,
    name: 'JDex: escribir plantillas integradas en la carpeta de plantillas',
    run: async () => {
      try { host.notice(await writeBuiltinTemplates()); } catch (error) { host.notice(error instanceof Error ? error.message : String(error)); }
    }
  });

  const offSettingsPanel = host.settingsPanel((el) =>
    mountJdexSettingsPanel(el, {
      writeTemplates: writeBuiltinTemplates,
      get: () => settings,
      save: (next) => {
        // A path changed by hand stops following the folder it pointed at before.
        for (const key of TRACKED_FOLDER_KEYS) if (next[key] !== settings[key]) delete folderIds[key];
        settings = next;
        void persistJdexSettings(api.storage.settings, settings).catch((error: unknown) =>
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
    if (rebuildTimer !== null) clearTimeout(rebuildTimer);
    rebuildTimer = null;
    offActiveNote();
    offFolders();
    offNotes();
    offRenameGuard();
    offNoteTitleRenamed();
    offCommandLocate();
    offCommandToggle();
    offCommandAudit();
    offCommandRepair();
    offCommandCreateId();
    offCommandCreateCategory();
    offCommandCreateArea();
    offCommandCreateHeader();
    offCommandCreateChild();
    offCommandNormalizeNote();
    offCommandNormalizeAll();
    offCommandRefreshHeaders();
    offCommandRefreshIndex();
    offCommandWrapHeaders();
    offCommandGotoId();
    offCommandProcessInbox();
    offActiveNoteCommands();
    offCommandUndo();
    offCommandHealth();
    offCommandSystemReport();
    offCommandWriteTemplates();
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

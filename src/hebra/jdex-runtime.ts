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
  PluginFolderRenameEvent,
  PluginModalHandle,
  PluginActiveNote,
  PluginNoteTitleRenamedEvent,
  PluginNotesChange,
  PluginStatusBarItemHandle,
  PluginUnregister
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
  todayIso,
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
  jdexResolveFolderId,
  walkJdexLibrary,
  type JdexAuditEntry,
  type JdexInboxSummary,
  type JdexLibraryWalk
} from './library-index';
import { mountJdexAuditView } from './jdex-audit-view';
import { mountJdexSettingsPanel } from './jdex-settings-panel';
import { autodetectJdexSettings, loadJdexSettings, persistJdexSettings } from './settings';
import {
  mountCreateAreaDialog,
  mountCreateCategoryDialog,
  mountCreateChildDialog,
  mountCreateHeaderDialog,
  mountCreateIdDialog
} from './jdex-create-view';
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
  jdexRenameWarning,
  jdexRenameWarningMessage
} from './jdex-rename-guard';
import { mountJdexRenameWarningView } from './jdex-rename-warning-view';
import { mountJdexGotoView } from './jdex-goto-view';
import { retireJdexId } from './jdex-retire';
import { archiveJdexInboxNote, jdexInboxQueue, moveJdexInboxNote } from './jdex-inbox-process';
import { mountJdexInboxProcessView } from './jdex-inbox-process-view';
import { loadJdexIdSection } from './jdex-id-section';
import { mountJdexIdSectionLoading, mountJdexIdSectionView } from './jdex-id-section-view';
import { jdexEditorExtension } from './jdex-editor-extension';

export const JDEX_AUDIT_VIEW_ID = 'jdex:auditoria';
export const JDEX_ID_SECTION_VIEW_ID = 'jdex:seccion-del-id';
export const JDEX_STATUS_PATH_ID = 'jdex-path';
export const JDEX_STATUS_AUDIT_ID = 'jdex-audit';
export const JDEX_STATUS_INBOX_ID = 'jdex-inbox';
export const JDEX_COMMAND_LOCATE = 'jdex-donde-vive-esta-nota';
export const JDEX_COMMAND_TOGGLE = 'jdex-alternar-nota-y-carpeta';
export const JDEX_COMMAND_AUDIT = 'jdex-auditar-el-sistema';
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

/** Reconstruir el índice tras un `library-changed` no en CADA aviso (una biblioteca que
 *  sincroniza muchas notas seguidas dispararía varias reconstrucciones completas). */
const REBUILD_DEBOUNCE_MS = 800;
/** Tras tantos fallos seguidos de la reconstrucción, el reintento automático para. */
const MAX_REBUILD_FAILURES = 5;
const MAX_REBUILD_DELAY_MS = 30_000;

function report(error: unknown, where: string): void {
  console.error(`[jdex] ${where}`, error);
}

export async function activateJdex(api: HebraPluginApi): Promise<PluginCleanup> {
  const host = api.ui;
  await new Promise<void>((resolve) => host.onReady(resolve));
  let settings = await loadJdexSettings(api.storage.settings);

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

  function toggleNoteAndFolder(): void {
    const located = latestLocated;
    if (!located || !walk) {
      host.notice('Esta nota no vive en el sistema JDex.');
      return;
    }
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
    const path = currentIndex && walk && note ? jdexNotePath(walk.folderPaths, note) : null;
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

  /** Índice, auditoría e inbox a partir de `walk` y `auditEntries` (puro, sin
   *  biblioteca) y lo que se pinta de ellos. */
  function derive(): void {
    if (!walk) return;
    walkNoteIds = new Set(walk.systemNotes.map((note) => note.id));
    index = buildIndex(buildJdexIndexInput(walk, settings));
    const notes = jdexAuditNotes(walk, auditEntries, settings.jdexFolder);
    const auditInput = buildJdexAuditInput(index, notes, walk, {
      noteWithoutFolderIsFinding: settings.noteWithoutFolderIsFinding,
      descriptionIsFinding: settings.descriptionIsFinding,
      structureNotesAreFindings: settings.structureNotesAreFindings
    });
    findings = auditSystem(auditInput);
    inboxSummary = buildJdexInboxSummary(index, walk);
    refreshCounterItems();
    refreshPathItem();
    // La sección del ID (lote 4, tarea 2) puede estar montada con esta MISMA nota
    // activa: un `rebuild()` que crea un hijo o cambia el frontmatter no dispara
    // `onActiveNoteChange` (la nota activa no cambió), así que se refresca aquí.
    if (idSectionEl) renderIdSectionInto(idSectionEl);
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
    const { settings: autodetected, changed } = autodetectJdexSettings(settings, [
      ...paths.values()
    ]);
    if (changed) {
      settings = autodetected;
      await persistJdexSettings(api.storage.settings, settings).catch((error: unknown) =>
        report(error, 'guardar-ajustes')
      );
    }
    const nextWalk = await walkJdexLibrary(api.vault, folders, settings.systemRoot, rootFolderId);
    // Con el módulo apagado mientras leía, nada de escribir estado ni de pintar.
    if (disposed) return;
    if (gen !== generation) return latestRebuild;
    const nextEntries = await loadJdexAuditEntries(
      api.vault,
      api.markdown,
      nextWalk,
      settings.jdexFolder
    );
    if (disposed) return;
    // Superada por otra más nueva mientras leía: lo suyo es anterior, no pisa nada.
    if (gen !== generation) return latestRebuild;
    walk = nextWalk;
    auditEntries = nextEntries;
    failures = 0;
    derive();
  }

  // ---- Lote 2: crear ID/categoría/área/cabecera/hijo (+), normalizar el
  // frontmatter, cabeceras e índice al día -----------------------------------

  function noteIdByPath(path: string): string | null {
    return walk?.systemNotes.find((note) => note.path === path)?.id ?? null;
  }

  /** Tras CUALQUIER escritura de este lote: recalcula el índice (pendiente del
   *  lote 1, punto 4). Con `syncHeaders`, además relee cabeceras e índice del
   *  sistema (tarea 3, «tras crear o renombrar un ID desde Hebra») y recalcula otra
   *  vez, para que los hallazgos reflejen ese segundo escrito. */
  async function afterJdexWrite(syncHeaders: boolean): Promise<void> {
    await rebuild();
    if (syncHeaders && walk && index) {
      await refreshJdexHeadersAndIndex(api.vault, walk, index, settings.systemIndexNote);
      await rebuild();
    }
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
    const currentIndex = selectCreationSystem(index, namePrefix(settings));
    let handle: PluginModalHandle | undefined;
    handle = host.openModal(
      (el) =>
        mountCreateIdDialog(el, {
          index: currentIndex,
          refreshIndex: async () => {
            await rebuild();
            if (!index) throw new Error('No se pudo actualizar el índice.');
            return selectCreationSystem(index, namePrefix(settings));
          },
          categories: currentIndex.categories,
          createFolderDefault: settings.createFolderByDefault,
          onSubmit: async (request) => {
            try {
              const outcome = await createJdexId(
                api.vault,
                api.markdown,
                walk!,
                settings,
                index!,
                request
              );
              handle?.close();
              reportCreateOutcome(outcome);
              await afterJdexWrite(true);
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
    const currentIndex = selectCreationSystem(index, namePrefix(settings));
    let handle: PluginModalHandle | undefined;
    handle = host.openModal(
      (el) =>
        mountCreateCategoryDialog(el, {
          index: currentIndex,
          areas: currentIndex.areas,
          createFolderDefault: settings.createFolderByDefault,
          onSubmit: async (request) => {
            try {
              const outcome = await createJdexCategory(
                api.vault,
                api.markdown,
                currentWalk,
                settings,
                currentIndex,
                request
              );
              handle?.close();
              reportCreateOutcome(outcome);
              await afterJdexWrite(true);
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
          createFolderDefault: settings.createFolderByDefault,
          onSubmit: async (request) => {
            try {
              const outcome = await createJdexArea(
                api.vault,
                api.markdown,
                currentWalk,
                settings,
                request
              );
              handle?.close();
              reportCreateOutcome(outcome);
              await afterJdexWrite(true);
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
    const currentIndex = selectCreationSystem(index, namePrefix(settings));
    let handle: PluginModalHandle | undefined;
    handle = host.openModal(
      (el) =>
        mountCreateHeaderDialog(el, {
          index: currentIndex,
          refreshIndex: async () => {
            await rebuild();
            if (!index) throw new Error('No se pudo actualizar el índice.');
            return selectCreationSystem(index, namePrefix(settings));
          },
          categories: currentIndex.categories,
          onSubmit: async (request) => {
            try {
              const outcome = await createJdexHeader(
                api.vault,
                api.markdown,
                walk!,
                settings,
                index!,
                request
              );
              handle?.close();
              reportCreateOutcome(outcome);
              await afterJdexWrite(true);
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
    const currentIndex = index;
    let handle: PluginModalHandle | undefined;
    handle = host.openModal(
      (el) =>
        mountCreateChildDialog(el, {
          index: currentIndex,
          refreshIndex: async () => {
            await rebuild();
            if (!index) throw new Error('No se pudo actualizar el índice.');
            return index;
          },
          parent,
          createFolderDefault: settings.createFolderByDefault,
          onSubmit: async (request) => {
            try {
              const outcome = await createJdexChild(
                api.vault,
                api.markdown,
                walk!,
                settings,
                index!,
                request
              );
              handle?.close();
              reportCreateOutcome(outcome);
              await afterJdexWrite(true);
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
            const result = await applyJdexFrontmatterFixes(api.vault, api.markdown, subset, noteIdByPath, chosenPaths);
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
    const result = await refreshJdexHeaders(api.vault, walk, index);
    host.notice(
      result.written.length > 0
        ? `${result.written.length} cabecera(s) actualizada(s).`
        : 'Ninguna cabecera con marcadores que actualizar.'
    );
    await rebuild();
  }

  async function refreshIndexCommand(): Promise<void> {
    if (!walk || !index) return;
    const result = await refreshJdexSystemIndex(
      api.vault,
      walk,
      index,
      settings.systemIndexNote
    );
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
            await applyJdexWrap(api.vault, candidates, [...chosenIds]);
            handle?.close();
            await afterJdexWrite(true);
          }
        }),
      { title: 'JDex: envolver las listas de cabeceras en marcadores' }
    );
  }

  // ---- Lote 3, tarea 1: avisar antes de renumerar un ID o cambiarlo de
  // categoría al renombrar o mover -------------------------------------------

  /** `api.workspace.onBeforeFolderRename`: Hebra llama esto ANTES de
   *  `folderRename`/`folderMove`. Sin índice aún cargado, deja pasar (más seguro
   *  que bloquear una carpeta cualquiera mientras el módulo arranca). */
  async function confirmRename(event: PluginFolderRenameEvent): Promise<boolean> {
    if (!walk || !index) return true;
    const warning = jdexRenameWarning(event, walk, index, settings);
    if (!warning) return true;
    return new Promise<boolean>((resolve) => {
      let decided = false;
      const settle = (value: boolean): void => {
        if (decided) return;
        decided = true;
        resolve(value);
      };
      let handle: PluginModalHandle | undefined;
      handle = host.openModal(
        (el) =>
          mountJdexRenameWarningView(el, {
            message: jdexRenameWarningMessage(warning),
            onContinue: () => {
              settle(true);
              handle?.close();
            },
            onCancel: () => {
              settle(false);
              handle?.close();
            }
          }),
        // Escape o clic fuera cierran sin decidir: la opción segura es cancelar.
        { title: 'JDex: confirmar', onClosed: () => settle(false) }
      );
    });
  }

  // ---- Lote 5: avisar tras renombrar el TÍTULO de una nota JDex, sin bloquear
  // el guardado (encargo de David, 29 sep 2026) ---------------------------------

  /** `api.workspace.onNoteTitleRenamed`: Hebra llama esto DESPUÉS de
   *  guardar el título (nunca antes: el guardado sigue síncrono, `renameTitle`/
   *  `commitTitle`/`flush` intactos). Solo avisa si `jdex-rename-guard` detecta
   *  `renumbered` o `moved`; el propio aviso es el botón de deshacer
   *  (`host.notice(text, onClick)`, `onClick` = `event.undo()`). */
  function onNoteTitleRenamed(event: PluginNoteTitleRenamedEvent): void {
    if (!walk || !index) return;
    const warning = jdexRenameWarning(
      { kind: 'note-rename', noteId: event.noteId, newTitle: event.newTitle },
      walk,
      index,
      settings
    );
    if (!warning) return;
    host.notice(jdexRenameNoticeMessage(warning), () => event.undo());
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
  function gotoJdexEntry(entry: IdEntry, currentWalk: JdexLibraryWalk): void {
    if (entry.folderPath) {
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
      await api.vault.noteMove(note.id, folderId);
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
    let handle: PluginModalHandle | undefined;
    handle = host.openModal(
      (el) =>
        mountJdexRenameWarningView(el, {
          message:
            `«${entry.label}» se retira: se marca archivado con la fecha de hoy y, si ` +
            `tiene carpeta, se mueve a la .09 de su categoría. El número NUNCA se ` +
            `reutiliza. ¿Confirmas?`,
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
      const outcome = await retireJdexId(
        api.vault,
        api.markdown,
        currentWalk,
        currentIndex,
        entry,
        todayIso()
      );
      host.notice(
        outcome.moved
          ? `${entry.label} retirado: movido a su archivo.`
          : `${entry.label} retirado (la carpeta se queda donde estaba).`
      );
      await afterJdexWrite(true);
    } catch (error) {
      host.notice(error instanceof Error ? error.message : String(error));
    }
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
            if (path !== undefined) void copyToClipboard(path, 'Ruta copiada.');
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
          onMove: async (note, entry) => {
            if (!entry.folderPath) throw new Error(`${entry.label} no tiene carpeta.`);
            await moveJdexInboxNote(
              api.vault,
              note,
              currentWalk,
              entry.folderPath
            );
            await rebuild();
          },
          onArchive: async (note) => {
            await archiveJdexInboxNote(api.vault, api.markdown, note);
            await rebuild();
          },
          onOpen: (note) => api.workspace.openNote(note.id)
        }),
      { title: 'JDex: procesar inbox' }
    );
  }

  // ---- PERF-07: lo que cambia se pone al día por ids, no recorriendo la biblioteca --

  /** Lo acumulado en el lote: una reconstrucción completa pedida, o los ids de las
   *  notas cuyo aviso llegó (el mismo temporizador de siempre). */
  let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingFull = false;
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

  function armBatchTimer(delayMs: number = REBUILD_DEBOUNCE_MS): void {
    if (disposed) return;
    if (rebuildTimer !== null) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      rebuildTimer = null;
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
    armBatchTimer(Math.min(REBUILD_DEBOUNCE_MS * 2 ** (failures - 1), MAX_REBUILD_DELAY_MS));
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
    if (full) {
      await rebuild().catch((error: unknown) => {
        report(error, 'rebuild');
        // Sin esto un fallo dejaría `walk` viejo (o `null`) hasta el próximo aviso de
        // carpetas.
        retryAfterFailure();
      });
      return;
    }
    if (ids.length === 0) return;
    notesTail = notesTail
      .then(() => refreshNotes(ids))
      .catch((error: unknown) => {
        report(error, 'actualizar-notas');
        // Los ids ya salieron de `pendingIds`: sin una reconstrucción completa una
        // nota cuya lectura falló no entraría nunca en el índice.
        retryAfterFailure();
      });
    await notesTail;
  }

  /** Pone al día solo las notas `ids` (`applyJdexNoteChanges`); el recorrido completo
   *  se reserva para lo que no se puede resolver por ids. */
  async function refreshNotes(ids: readonly string[]): Promise<void> {
    busy += 1;
    try {
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
      if (update.kind === 'rebuild') {
        await rebuild();
      } else if (update.kind === 'updated') {
        walk = update.state.walk;
        auditEntries = update.state.entries;
        derive();
      }
    } finally {
      busy -= 1;
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
      event.ids.every((id) => !walkNoteIds.has(id) && !pendingIds.has(id))
    ) {
      return;
    }
    for (const id of event.ids) pendingIds.add(id);
    armBatchTimer();
  }

  // Los oyentes se registran ANTES de la reconstrucción inicial: lo que llegue mientras
  // recorre (la primera ronda de sync) queda pendiente y se aplica al terminar.
  const offFolders = api.workspace.onFoldersChange(() => scheduleRebuild());
  const offNotes = api.workspace.onNotesChange(onNotesChanged);

  await rebuild().catch((error: unknown) => report(error, 'rebuild-inicial'));

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
            const result = await applyJdexFrontmatterFixes(api.vault, api.markdown, [finding], noteIdByPath);
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
        onNavigate: (entry) => {
          if (walk) gotoJdexEntry(entry, walk);
        }
      })
    );
  } catch (error) {
    report(error, 'extension-del-editor');
  }

  const offSettingsPanel = host.settingsPanel((el) =>
    mountJdexSettingsPanel(el, {
      get: () => settings,
      save: (next) => {
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

  return () => {
    disposed = true;
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
}

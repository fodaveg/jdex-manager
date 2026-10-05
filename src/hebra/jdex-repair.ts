/** Applies an audited repair through Hebra's vault API. Every write may be wrapped by
 * the durable journal; this module never relies on paths as stable note identities. */
import type { PluginMarkdown, PluginVault } from 'hebra-plugin-api';
import { areaCode, isConflictCopyPath, renderTemplate, selectSystem, todayIso, type Fix, type JdIndex, type JdexManagerSettings } from './engine';
import { applyJdexFrontmatterFixes } from './jdex-normalize';
import { resolveJdexTemplate } from './jdex-create-write';
import { jdexFolderPaths, jdexNoteFileStem, type JdexLibraryWalk } from './library-index';

type RepairMarkdown = Pick<PluginMarkdown, 'withTitle' | 'setProperty' | 'frontmatterRange'>;

function parentOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'));
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Resolve against live folders, including folders made earlier in the same batch. */
async function folderAt(vault: PluginVault, path: string): Promise<string | null> {
  if (!path) return vault.rootFolderId();
  const folders = await vault.foldersList();
  const paths = jdexFolderPaths(folders, vault.rootFolderId());
  for (const [id, value] of paths) if (value === path) return id;
  return null;
}

async function ensureFolder(vault: PluginVault, path: string): Promise<string> {
  const existing = await folderAt(vault, path);
  if (existing) return existing;
  const parent = await folderAt(vault, parentOf(path));
  if (!parent) throw new Error(`${path}: falta la carpeta padre.`);
  return (await vault.folderCreate(parent, basename(path))).id;
}

/** Hebra permits same-titled notes, so reject a live destination explicitly. */
async function rejectNoteCollision(vault: PluginVault, folderId: string, filename: string): Promise<void> {
  let cursor: string | null = null;
  do {
    const page = await vault.notesPage(cursor, 200, { kind: 'folder', folderId });
    if (page.items.some((note) => `${jdexNoteFileStem(note.title)}.md` === filename)) throw new Error(`${filename} ya existe en la carpeta destino.`);
    cursor = page.nextCursor;
  } while (cursor !== null);
}

function noteId(walk: JdexLibraryWalk, path: string): string {
  const id = walk.systemNotes.find((note) => note.path === path)?.id;
  if (!id) throw new Error(`${path}: la nota ya no existe.`);
  return id;
}

/** One repair step; the caller reaudits before invoking it and after the batch. */
export async function applyJdexRepair(
  vault: PluginVault,
  markdown: RepairMarkdown,
  walk: JdexLibraryWalk,
  index: JdIndex,
  settings: JdexManagerSettings,
  fix: Fix
): Promise<{ applied: boolean; warnings: string[] }> {
  if (fix.type === 'frontmatter') {
    const result = await applyJdexFrontmatterFixes(vault, markdown, [{ kind: 'frontmatter-mismatch', paths: [fix.path], message: '', fix }], (path) => walk.systemNotes.find((note) => note.path === path)?.id ?? null);
    return { applied: result.written.length > 0, warnings: result.warnings };
  }
  if (fix.type === 'folders' || fix.type === 'create-folder') {
    for (const path of fix.paths) await ensureFolder(vault, path);
    return { applied: true, warnings: [] };
  }
  if (fix.type === 'create-note') {
    if ((fix.kind === 'area' || fix.kind === 'categoria') && !settings.structureNotesAreFindings) {
      throw new Error('Activa los hallazgos de notas de estructura antes de crearlas desde Reparar.');
    }
    if (walk.systemNotes.some((note) => note.path === fix.path)) throw new Error(`${fix.path} ya existe.`);
    const jdexFolderId = await folderAt(vault, settings.jdexFolder);
    if (!jdexFolderId) throw new Error('La carpeta JDex no existe.');
    await rejectNoteCollision(vault, jdexFolderId, basename(fix.path));
    const creationIndex = selectSystem(index, fix.system ?? '');
    const category = creationIndex.categories.find((entry) => entry.number === fix.category);
    const areaNumber = fix.kind === 'area' ? Number(fix.number.slice(0, 2)) : Math.floor(Number(fix.category) / 10) * 10;
    const area = creationIndex.areas.find((entry) => entry.number === areaNumber);
    if (!area || (fix.kind !== 'area' && !category)) throw new Error(`${fix.path}: falta su categoría o área.`);
    const template = await resolveJdexTemplate(vault, walk, settings, fix.kind, { category: fix.category || undefined, area: area.code });
    const content = renderTemplate(template, { id: fix.number, title: fix.title, area: areaCode(area.number), areaTitle: area.label, category: fix.category, categoryTitle: category?.label ?? '', date: todayIso() });
    await vault.noteCreate({ folderId: jdexFolderId, body: markdown.withTitle(content, basename(fix.path).slice(0, -3)) });
    return { applied: true, warnings: [] };
  }
  if (fix.type === 'trash') {
    if (!isConflictCopyPath(fix.path)) throw new Error(`${fix.path}: no está identificada como copia de conflicto.`);
    if (!vault.noteTrashIfUnchanged) throw new Error('Hebra no ofrece papelera protegida en la API del plugin; actualiza el host.');
    const copy = await vault.noteRead(noteId(walk, fix.path));
    const original = await vault.noteRead(noteId(walk, fix.identicalTo));
    if (!copy || !original || copy.trashedAt !== null || original.trashedAt !== null || copy.body === null || original.body === null || copy.body !== original.body) throw new Error(`${fix.path}: la copia ya no es idéntica.`);
    if (!await vault.noteTrashIfUnchanged(copy.id, { revision: copy.revision, folderId: copy.folderId })) {
      throw new Error(`${fix.path}: cambió mientras se enviaba a la papelera.`);
    }
    return { applied: true, warnings: [] };
  }
  const items = fix.type === 'move' ? fix.items : [{ from: fix.from, to: fix.to }];
  for (const { from, to } of items) {
    if (await folderAt(vault, to) || walk.systemNotes.some((note) => note.path === to)) throw new Error(`${to} ya existe.`);
    if (from.endsWith('.md')) {
      if (basename(from) !== basename(to)) throw new Error(`${from}: el traslado no puede cambiar el título de la nota.`);
      const parent = await folderAt(vault, parentOf(to));
      if (!parent) throw new Error(`${to}: falta la carpeta destino.`);
      await rejectNoteCollision(vault, parent, basename(to));
      const note = await vault.noteRead(noteId(walk, from));
      const sourceParent = await folderAt(vault, parentOf(from));
      if (!note || note.trashedAt !== null || note.folderId !== sourceParent) throw new Error(`${from}: cambió de carpeta desde la auditoría.`);
      if (!vault.noteMoveIfUnchanged) throw new Error('Hebra no ofrece movimiento atómico de notas; actualiza el host.');
      if (!await vault.noteMoveIfUnchanged(note.id, parent, { revision: note.revision, folderId: note.folderId })) {
        throw new Error(`${from}: cambió mientras se movía.`);
      }
    } else {
      const folders = await vault.foldersList();
      const paths = jdexFolderPaths(folders, vault.rootFolderId());
      let folder = folders.find((item) => paths.get(item.id) === from);
      if (!folder) throw new Error(`${from}: la carpeta ya no existe.`);
      const parent = await folderAt(vault, parentOf(to));
      if (!parent) throw new Error(`${to}: falta la carpeta destino.`);
      if (basename(from) !== basename(to)) {
        if (!vault.folderRenameIfUnchanged) throw new Error('Hebra no ofrece renombrado atómico de carpetas; actualiza el host.');
        const renamed = await vault.folderRenameIfUnchanged(folder.id, basename(to), { name: folder.name, parentId: folder.parentId });
        if (!renamed) throw new Error(`${from}: cambió mientras se renombraba.`);
        folder = renamed;
      }
      if (parentOf(from) !== parentOf(to)) {
        if (!vault.folderMoveIfUnchanged) throw new Error('Hebra no ofrece movimiento atómico de carpetas; actualiza el host.');
        if (!await vault.folderMoveIfUnchanged(folder.id, parent, { name: folder.name, parentId: folder.parentId })) {
          throw new Error(`${from}: cambió mientras se movía.`);
        }
      }
    }
  }
  return { applied: true, warnings: [] };
}

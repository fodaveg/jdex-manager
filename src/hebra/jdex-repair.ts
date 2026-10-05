/** Applies an audited repair through Hebra's vault API. Every write may be wrapped by
 * the durable journal; this module never relies on paths as stable note identities. */
import type { PluginMarkdown, PluginVault } from 'hebra-plugin-api';
import { areaCode, parseJdNumber, renderTemplate, sameSystem, todayIso, type Fix, type JdIndex, type JdexManagerSettings } from './engine';
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
): Promise<string[]> {
  if (fix.type === 'frontmatter') {
    const result = await applyJdexFrontmatterFixes(vault, markdown, [{ kind: 'frontmatter-mismatch', paths: [fix.path], message: '', fix }], (path) => walk.systemNotes.find((note) => note.path === path)?.id ?? null);
    return result.warnings;
  }
  if (fix.type === 'folders' || fix.type === 'create-folder') {
    for (const path of fix.paths) await ensureFolder(vault, path);
    return [];
  }
  if (fix.type === 'create-note') {
    if (walk.systemNotes.some((note) => note.path === fix.path)) throw new Error(`${fix.path} ya existe.`);
    const jdexFolderId = await folderAt(vault, settings.jdexFolder);
    if (!jdexFolderId) throw new Error('La carpeta JDex no existe.');
    await rejectNoteCollision(vault, jdexFolderId, basename(fix.path));
    const parsed = parseJdNumber(fix.number);
    const system = parsed?.system;
    const category = index.categories.find((entry) => entry.number === fix.category && sameSystem(entry, { system }));
    const area = index.areas.find((entry) => entry.number === Math.floor(Number(fix.category) / 10) * 10 && sameSystem(entry, { system }));
    if (!category || !area) throw new Error(`${fix.path}: falta su categoría o área.`);
    const template = await resolveJdexTemplate(vault, walk, settings, fix.kind, { category: fix.category, area: area.code });
    const content = renderTemplate(template, { id: fix.number, title: fix.title, area: areaCode(area.number), areaTitle: area.label, category: fix.category, categoryTitle: category.label, date: todayIso() });
    await vault.noteCreate({ folderId: jdexFolderId, body: markdown.withTitle(content, basename(fix.path).slice(0, -3)) });
    return [];
  }
  if (fix.type === 'trash') {
    const copy = await vault.noteRead(noteId(walk, fix.path));
    const original = await vault.noteRead(noteId(walk, fix.identicalTo));
    if (!copy || !original || copy.trashedAt !== null || original.trashedAt !== null || copy.body === null || original.body === null || copy.body !== original.body) throw new Error(`${fix.path}: la copia ya no es idéntica.`);
    await vault.noteTrash(copy.id);
    return [];
  }
  const items = fix.type === 'move' ? fix.items : [{ from: fix.from, to: fix.to }];
  for (const { from, to } of items) {
    if (await folderAt(vault, to) || walk.systemNotes.some((note) => note.path === to)) throw new Error(`${to} ya existe.`);
    if (from.endsWith('.md')) {
      if (basename(from) !== basename(to)) throw new Error(`${from}: el traslado no puede cambiar el título de la nota.`);
      const parent = await folderAt(vault, parentOf(to));
      if (!parent) throw new Error(`${to}: falta la carpeta destino.`);
      await rejectNoteCollision(vault, parent, basename(to));
      await vault.noteMove(noteId(walk, from), parent);
    } else {
      const folder = await folderAt(vault, from);
      if (!folder) throw new Error(`${from}: la carpeta ya no existe.`);
      const parent = await folderAt(vault, parentOf(to));
      if (!parent) throw new Error(`${to}: falta la carpeta destino.`);
      if (basename(from) !== basename(to)) await vault.folderRename(folder, basename(to));
      if (parentOf(from) !== parentOf(to)) await vault.folderMove(folder, parent);
    }
  }
  return [];
}

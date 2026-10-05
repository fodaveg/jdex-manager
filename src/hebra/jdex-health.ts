/** Creates a fresh health note, using the same report engine and counting notes and files. */
import type { PluginNote, PluginVault } from 'hebra-plugin-api';
import { healthFileName, renderHealthReport, type JdIndex, type JdexManagerSettings } from './engine';
import { jdexResolveFolderId, type JdexLibraryWalk } from './library-index';

/** Read each attachment folder once; the same paths feed health and system reports. */
export async function jdexHealthPaths(vault: Pick<PluginVault, 'filesPage'>, walk: JdexLibraryWalk): Promise<string[]> {
  const paths = walk.systemNotes.map((note) => note.path);
  const folders = new Map([...walk.folderPaths].filter(([, path]) => walk.systemFolderPaths.includes(path)));
  if (walk.systemFolderPaths.includes('')) folders.set(walk.rootFolderId, '');
  for (const [id, path] of folders) {
    let cursor: string | null = null;
    do {
      const page = await vault.filesPage(id, false, cursor);
      for (const file of page.items) paths.push(path === '' ? file.name : `${path}/${file.name}`);
      cursor = page.nextCursor;
    } while (cursor !== null);
  }
  return paths;
}

export async function createJdexHealthReport(
  vault: Pick<PluginVault, 'noteCreate' | 'filesPage'>,
  walk: JdexLibraryWalk,
  index: JdIndex,
  settings: Pick<JdexManagerSettings, 'reportsFolder' | 'healthMaxFiles'>,
  date: string
): Promise<PluginNote> {
  const folderId = settings.reportsFolder === '' ? null : jdexResolveFolderId(walk, settings.reportsFolder);
  if (folderId === null) throw new Error('Configura una carpeta de informes existente para guardar la salud del sistema.');
  const paths = await jdexHealthPaths(vault, walk);
  const title = healthFileName(date).slice(0, -3);
  const body = renderHealthReport(index, paths, date, { maxFiles: settings.healthMaxFiles, nearlyFull: 70 });
  const note = await vault.noteCreate({ folderId, body });
  if (note.title !== title) throw new Error('El informe se creó, pero Hebra no pudo conservar su título.');
  return note;
}

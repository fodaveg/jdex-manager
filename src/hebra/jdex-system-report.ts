/** Manual system report in the configured 00.02 folder. No scheduler is installed. */
import type { PluginNote, PluginVault } from 'hebra-plugin-api';
import { previousSystemSnapshot, renderSystemReport, systemReportName, type Finding, type JdIndex, type JdexManagerSettings } from './engine';
import { jdexHealthPaths } from './jdex-health';
import { jdexResolveFolderId, type JdexLibraryWalk } from './library-index';

export async function createJdexSystemReport(
  vault: Pick<PluginVault, 'noteCreate' | 'noteRead' | 'notesPage' | 'filesPage'>,
  walk: JdexLibraryWalk,
  index: JdIndex,
  findings: Finding[],
  settings: Pick<JdexManagerSettings, 'reportsFolder' | 'healthMaxFiles'>,
  date: string
): Promise<PluginNote> {
  const folderId = settings.reportsFolder ? jdexResolveFolderId(walk, settings.reportsFolder) : null;
  if (!folderId) throw new Error('Configura una carpeta de informes existente para guardar el informe del sistema.');
  let cursor: string | null = null;
  const candidates: { id: string; createdAt: number; updatedAt: number }[] = [];
  do {
    const page = await vault.notesPage(cursor, 200, { kind: 'folder', folderId });
    for (const note of page.items) {
      if (!/^Informe JD - \d{4}-\d{2}-\d{2}$/u.test(note.title)) continue;
      candidates.push({ id: note.id, createdAt: note.createdAt, updatedAt: note.updatedAt });
    }
    cursor = page.nextCursor;
  } while (cursor !== null);
  let priorBody: string | null = null;
  for (const previous of candidates.sort((a, b) => b.createdAt - a.createdAt || b.updatedAt - a.updatedAt || b.id.localeCompare(a.id))) {
    const note = await vault.noteRead(previous.id);
    if (note?.trashedAt !== null || note.folderId !== folderId) continue;
    if (previousSystemSnapshot(note.body)) { priorBody = note.body; break; }
  }
  const paths = await jdexHealthPaths(vault, walk);
  const body = renderSystemReport(index, findings, paths, date, settings.healthMaxFiles, priorBody);
  const note = await vault.noteCreate({ folderId, body });
  if (note.title !== systemReportName(date).slice(0, -3)) throw new Error('El informe se creó, pero Hebra no pudo conservar su título.');
  return note;
}

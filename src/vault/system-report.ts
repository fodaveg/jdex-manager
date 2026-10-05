/** Manual audit and health report, keeping each run for the next comparison. */
import { type App, normalizePath, TFile } from "obsidian";
import type { Effect } from "../jd/journal";
import { previousSystemSnapshot, renderSystemReport, systemReportName } from "../jd/system-report";
import { todayIso } from "../jd/template";
import type { JdexManagerSettings } from "../settings";
import { collectAudit } from "./audit";
import { ensureFolder } from "./create";

/** Writes a new note in the configured 00.02 folder; never replaces an older report. */
export async function createSystemReport(app: App, settings: JdexManagerSettings, effects: Effect[], date = todayIso()): Promise<TFile> {
  if (settings.reportsFolder === "") throw new Error("Set the reports folder first (00.02 by convention).");
  const candidates = app.vault.getMarkdownFiles().filter((file) =>
    file.parent?.path === settings.reportsFolder && /^Informe JD - \d{4}-\d{2}-\d{2}(?: \(\d+\))?$/u.test(file.basename)
  ).sort((a, b) => b.stat.ctime - a.stat.ctime || b.stat.mtime - a.stat.mtime || b.basename.localeCompare(a.basename, undefined, { numeric: true }));
  let previousBody: string | null = null;
  for (const previous of candidates) {
    const body = await app.vault.read(previous);
    if (previousSystemSnapshot(body)) { previousBody = body; break; }
  }
  const { index, findings, filePaths } = await collectAudit(app, settings);
  const body = renderSystemReport(index, findings, filePaths, date, settings.healthMaxFiles, previousBody);
  if (await ensureFolder(app, settings.reportsFolder)) effects.push({ kind: "created-folder", path: settings.reportsFolder });
  const base = normalizePath(`${settings.reportsFolder}/${systemReportName(date)}`);
  let path = base;
  let suffix = 2;
  while (app.vault.getAbstractFileByPath(path)) path = base.replace(/\.md$/u, ` (${suffix++}).md`);
  const note = await app.vault.create(path, body);
  effects.push({ kind: "created-note", path, content: body });
  return note;
}

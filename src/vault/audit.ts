import { type App, normalizePath, Notice, TFile, TFolder } from "obsidian";
import { auditSystem, type Finding, type Fix, type NoteMeta } from "../jd/audit";
import { renderReport, reportFileName } from "../jd/audit-report";
import { relativeTo } from "../jd/detect";
import { todayIso } from "../jd/template";
import type { JdexManagerSettings } from "../settings";
import { patternFor } from "../jd/patterns";
import { allFolderPaths, scanVault } from "./scan";
import { ensureFolder } from "./create";
import type { Effect } from "../jd/journal";

export interface AuditResult {
  findings: Finding[];
  /** Path of the report note, or null when no reports folder is configured. */
  reportPath: string | null;
}

/**
 * Frontmatter of every note directly inside the JDex folder, read from the metadata cache.
 * Notes without `descripcion` also carry their body so a description can be proposed.
 */
export async function jdexNoteMetas(app: App, settings: JdexManagerSettings): Promise<NoteMeta[]> {
  const out: NoteMeta[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    const rel = relativeTo(settings.jdexFolder, file.path);
    if (rel === null || rel === "" || rel.includes("/")) continue;
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    const meta: NoteMeta = { path: file.path, frontmatter: fm ? { ...fm } : null };
    const desc: unknown = fm?.descripcion;
    if (typeof desc !== "string" || desc.trim() === "") meta.body = await app.vault.cachedRead(file);
    out.push(meta);
  }
  return out;
}

/** Runs the audit over the live vault and writes (or replaces) today's report note. */
export async function runAudit(app: App, settings: JdexManagerSettings): Promise<AuditResult> {
  const index = scanVault(app, settings);
  const filePaths = app.vault
    .getAllLoadedFiles()
    .filter((f): f is TFile => f instanceof TFile)
    .map((f) => f.path);
  const findings = auditSystem({
    index,
    notes: await jdexNoteMetas(app, settings),
    filePaths,
    folderPaths: allFolderPaths(app),
    patternFor: (category) => patternFor(settings, category),
    options: {
      noteWithoutFolderIsFinding: settings.noteWithoutFolderIsFinding,
      descriptionIsFinding: settings.descriptionIsFinding,
      structureNotesAreFindings: settings.structureNotesAreFindings,
    },
  });

  if (settings.reportsFolder === "") {
    new Notice("No reports folder set; the audit ran but no report was written.");
    return { findings, reportPath: null };
  }
  const date = todayIso();
  const reportPath = normalizePath(`${settings.reportsFolder}/${reportFileName(date)}`);
  const content = renderReport(findings, date);
  const existing = app.vault.getAbstractFileByPath(reportPath);
  if (existing instanceof TFile) await app.vault.modify(existing, content);
  else if (existing) throw new Error(`${reportPath} exists and is not a note.`);
  else {
    const folder = app.vault.getAbstractFileByPath(settings.reportsFolder);
    if (!(folder instanceof TFolder)) await app.vault.createFolder(settings.reportsFolder);
    await app.vault.create(reportPath, content);
  }
  return { findings, reportPath };
}

/**
 * Applies one mechanical fix. Frontmatter edits go through Obsidian so the rest of the note is kept.
 * Audited values are checked inside the writer; fields edited since the audit are skipped.
 * Only actual edits are appended to `effects`, when given, so the operation can be undone.
 */
export async function applyFix(app: App, fix: Fix, effects?: Effect[]): Promise<void> {
  if (fix.type === "frontmatter") {
    const file = app.vault.getAbstractFileByPath(fix.path);
    if (!(file instanceof TFile)) throw new Error(`${fix.path} no es una nota.`);
    const previous: Record<string, unknown> = {};
    const skipped: string[] = [];
    await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(fix.set)) {
        if (fix.expected && JSON.stringify(fm[key]) !== JSON.stringify(fix.expected[key])) {
          skipped.push(key);
          continue;
        }
        previous[key] = fm[key];
        fm[key] = value;
      }
    });
    if (Object.keys(previous).length > 0) effects?.push({ kind: "frontmatter", path: fix.path, previous });
    if (skipped.length > 0) new Notice(`${fix.path}: se omitió ${skipped.join(", ")} porque cambió desde la auditoría.`);
    return;
  }
  if (fix.type === "folders") {
    for (const p of fix.paths) if (await ensureFolder(app, p)) effects?.push({ kind: "created-folder", path: normalizePath(p) });
    return;
  }
  const target = app.vault.getAbstractFileByPath(fix.from);
  if (!target) throw new Error(`${fix.from} ya no existe.`);
  if (app.vault.getAbstractFileByPath(fix.to)) throw new Error(`${fix.to} ya existe.`);
  await app.fileManager.renameFile(target, fix.to);
  effects?.push({ kind: "moved", from: fix.from, to: fix.to });
}

import { type App, normalizePath, Notice, TFile, TFolder } from "obsidian";
import { auditSystem, type Finding, type Fix, type NoteMeta } from "../jd/audit";
import { renderReport, reportFileName } from "../jd/audit-report";
import { relativeTo } from "../jd/detect";
import { renderTemplate, todayIso } from "../jd/template";
import { areaCode, sameSystem } from "../jd/index";
import { parseJdNumber } from "../jd/parse";
import type { JdexManagerSettings } from "../settings";
import { patternFor } from "../jd/patterns";
import { allFolderPaths, scanVault } from "./scan";
import { ensureFolder } from "./create";
import { resolveTemplate } from "./templates";
import type { Effect } from "../jd/journal";

export interface AuditResult {
  findings: Finding[];
  /** Path of the report note, or null when no reports folder is configured. */
  reportPath: string | null;
}

/**
 * Frontmatter of every note directly inside the JDex folder, read from the metadata cache.
 * Bodies also let the audit verify that a conflict copy is byte-identical before offering trash.
 */
export async function jdexNoteMetas(app: App, settings: JdexManagerSettings): Promise<NoteMeta[]> {
  const out: NoteMeta[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    const rel = relativeTo(settings.jdexFolder, file.path);
    if (rel === null || rel === "" || rel.includes("/")) continue;
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    const meta: NoteMeta = { path: file.path, frontmatter: fm ? { ...fm } : null };
    meta.body = await app.vault.cachedRead(file);
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
    jdexFolder: settings.jdexFolder,
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
export async function applyFix(app: App, fix: Fix, effects?: Effect[], settings?: JdexManagerSettings): Promise<void> {
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
  if (fix.type === "create-folder") {
    for (const path of fix.paths) if (await ensureFolder(app, path)) effects?.push({ kind: "created-folder", path: normalizePath(path) });
    return;
  }
  if (fix.type === "create-note") {
    if (!settings) throw new Error("Faltan los ajustes para crear la nota.");
    if (app.vault.getAbstractFileByPath(fix.path)) throw new Error(`${fix.path} ya existe.`);
    const index = scanVault(app, settings);
    const parsed = parseJdNumber(fix.number);
    const category = index.categories.find((entry) => entry.number === fix.category && sameSystem(entry, { system: parsed?.system }));
    const area = index.areas.find((entry) => entry.number === Math.floor(Number(fix.category) / 10) * 10 && sameSystem(entry, { system: parsed?.system }));
    if (!category || !area) throw new Error(`${fix.path}: categoría o área ausente.`);
    const template = await resolveTemplate(app, settings, fix.kind, { category: fix.category, area: area.code });
    const content = renderTemplate(template, { id: fix.number, title: fix.title, area: areaCode(area.number), areaTitle: area.label, category: fix.category, categoryTitle: category.label, date: todayIso() });
    await app.vault.create(fix.path, content);
    effects?.push({ kind: "created-note", path: fix.path, content });
    return;
  }
  if (fix.type === "trash") {
    const file = app.vault.getAbstractFileByPath(fix.path);
    const original = app.vault.getAbstractFileByPath(fix.identicalTo);
    if (!(file instanceof TFile) || !(original instanceof TFile)) throw new Error(`${fix.path}: copia u original ausente.`);
    const content = await app.vault.read(file);
    if (content !== await app.vault.read(original)) throw new Error(`${fix.path}: la copia ya no es idéntica.`);
    await app.fileManager.trashFile(file);
    effects?.push({ kind: "trashed-note", path: fix.path, content });
    return;
  }
  const items = fix.type === "move" ? fix.items : [{ from: fix.from, to: fix.to }];
  for (const item of items) {
    const target = app.vault.getAbstractFileByPath(item.from);
    if (!target) throw new Error(`${item.from} ya no existe.`);
    if (app.vault.getAbstractFileByPath(item.to)) throw new Error(`${item.to} ya existe.`);
    await app.fileManager.renameFile(target, item.to);
    effects?.push({ kind: "moved", from: item.from, to: item.to });
  }
}

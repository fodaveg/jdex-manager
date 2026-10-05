import { type App, normalizePath, Notice, TFile, TFolder } from "obsidian";
import { auditSystem, isConflictCopyPath, type Finding, type Fix, type NoteMeta } from "../jd/audit";
import { renderReport, reportFileName } from "../jd/audit-report";
import { relativeTo } from "../jd/detect";
import { renderTemplate, todayIso } from "../jd/template";
import { areaCode, selectSystem, systemKey } from "../jd/index";
import type { JdexManagerSettings } from "../settings";
import { patternFor } from "../jd/patterns";
import { allFolderPaths, scanVault } from "./scan";
import { ensureFolder } from "./create";
import { resolveTemplate } from "./templates";
import { durableEffect, type Effect } from "../jd/journal";
import { staleInboxFindings } from "../jd/inbox-stale";
import type { JdIndex } from "../jd/index";

export interface AuditResult {
  findings: Finding[];
  /** Path of the report note, or null when no reports folder is configured. */
  reportPath: string | null;
}

/**
 * Frontmatter of every note directly inside the JDex folder, read from the metadata cache.
 * Bodies are read for description proposals and candidate duplicate IDs only.
 */
export async function jdexNoteMetas(app: App, settings: JdexManagerSettings, duplicatePaths: ReadonlySet<string> = new Set()): Promise<NoteMeta[]> {
  const out: NoteMeta[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    const rel = relativeTo(settings.jdexFolder, file.path);
    if (rel === null || rel === "" || rel.includes("/")) continue;
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    const meta: NoteMeta = { path: file.path, frontmatter: fm ? { ...fm } : null };
    const description: unknown = fm?.descripcion;
    if (typeof description !== "string" || description.trim() === "" || duplicatePaths.has(file.path)) {
      meta.body = await app.vault.cachedRead(file);
    }
    out.push(meta);
  }
  return out;
}

/** Reads one live audit snapshot for repairs, maintenance and reports. */
export async function collectAudit(app: App, settings: JdexManagerSettings): Promise<{ index: JdIndex; findings: Finding[]; filePaths: string[] }> {
  const index = scanVault(app, settings);
  const idCounts = new Map<string, number>();
  for (const entry of index.rawIdNotes) {
    if (entry.id.endsWith("+")) continue;
    const key = systemKey(entry.id, entry.system);
    idCounts.set(key, (idCounts.get(key) ?? 0) + 1);
  }
  const duplicatePaths = new Set(index.rawIdNotes.filter((entry) => !entry.id.endsWith("+") && (idCounts.get(systemKey(entry.id, entry.system)) ?? 0) > 1).map((entry) => entry.path));
  const filePaths = app.vault
    .getAllLoadedFiles()
    .filter((f): f is TFile => f instanceof TFile)
    .map((f) => f.path);
  const findings = auditSystem({
    index,
    jdexFolder: settings.jdexFolder,
    notes: await jdexNoteMetas(app, settings, duplicatePaths),
    filePaths,
    folderPaths: allFolderPaths(app),
    patternFor: (category) => patternFor(settings, category),
    options: {
      noteWithoutFolderIsFinding: settings.noteWithoutFolderIsFinding,
      descriptionIsFinding: settings.descriptionIsFinding,
      structureNotesAreFindings: settings.structureNotesAreFindings,
    },
  });
  findings.push(...staleInboxFindings(index, app.vault.getAllLoadedFiles().filter((file): file is TFile => file instanceof TFile).map((file) => ({
    path: file.path, folderPath: file.path.slice(0, file.path.lastIndexOf('/')), createdAt: file.stat.ctime,
  })), settings.inboxStaleDays, Date.now()));
  return { index, findings, filePaths };
}

/** Fresh repair proposals without creating a report note. */
export async function collectAuditFindings(app: App, settings: JdexManagerSettings): Promise<Finding[]> {
  return (await collectAudit(app, settings)).findings;
}

/** Audits without mutating system content, then writes today's audit report. */
export async function runAudit(app: App, settings: JdexManagerSettings): Promise<AuditResult> {
  const { findings } = await collectAudit(app, settings);

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
    if (Object.keys(previous).length > 0) effects?.push(durableEffect({ kind: "frontmatter", path: fix.path, previous }));
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
    if ((fix.kind === "area" || fix.kind === "categoria") && !settings.structureNotesAreFindings) {
      throw new Error("Activa los hallazgos de notas de estructura antes de crearlas desde Reparar.");
    }
    if (app.vault.getAbstractFileByPath(fix.path)) throw new Error(`${fix.path} ya existe.`);
    const index = selectSystem(scanVault(app, settings), fix.system ?? "");
    const category = index.categories.find((entry) => entry.number === fix.category);
    const areaNumber = fix.kind === "area" ? Number(fix.number.slice(0, 2)) : Math.floor(Number(fix.category) / 10) * 10;
    const area = index.areas.find((entry) => entry.number === areaNumber);
    if (!area || (fix.kind !== "area" && !category)) throw new Error(`${fix.path}: categoría o área ausente.`);
    const template = await resolveTemplate(app, settings, fix.kind, { category: fix.category || undefined, area: area.code });
    const content = renderTemplate(template, { id: fix.number, title: fix.title, area: areaCode(area.number), areaTitle: area.label, category: fix.category, categoryTitle: category?.label ?? "", date: todayIso() });
    await app.vault.create(fix.path, content);
    effects?.push({ kind: "created-note", path: fix.path, content });
    return;
  }
  if (fix.type === "trash") {
    if (!isConflictCopyPath(fix.path)) throw new Error(`${fix.path}: no está identificada como copia de conflicto.`);
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

/**
 * Pure audit of a Johnny.Decimal system: the "librarian" pass of the documentation.
 * No Obsidian imports. Works on the index plus the frontmatter of the JDex notes and the
 * list of file paths, so it runs in Node tests.
 *
 * Deliberately NOT a finding: sub-folders more than one level deep inside an ID. Projects use them.
 */

import { areaCode, areaOfCategory, idIdentityKey, repeatedIdKeys, sameSystem, type IdEntry, type JdIndex, type MalformedEntry } from "./index";
import type { MessageLanguage } from "./pair";
import { firstSentence } from "./description";
import { missingPatternFolders } from "./patterns";
import { extractJdPrefix, isHeader, isReserved, jdexNoteName, parseJdNumber } from "./parse";
import { titleForCompare } from "./title";
import { filesByFolder } from "./path-index";

export type FindingKind =
  | "missing-folder"
  | "folder-without-note"
  | "note-without-folder"
  | "name-mismatch"
  | "frontmatter-mismatch"
  | "duplicate-id"
  | "reserved-used-as-content"
  | "header-with-files"
  | "out-of-parent"
  | "misplaced-number"
  | "malformed-number"
  | "missing-description"
  | "structure-without-note"
  | "pattern-missing"
  | "inbox-stale";

export const FINDING_KINDS: FindingKind[] = [
  "missing-folder",
  "folder-without-note",
  "name-mismatch",
  "frontmatter-mismatch",
  "duplicate-id",
  "reserved-used-as-content",
  "header-with-files",
  "out-of-parent",
  "misplaced-number",
  "malformed-number",
  "missing-description",
  "structure-without-note",
  "pattern-missing",
  "note-without-folder",
  "inbox-stale",
];

export type Fix =
  | {
      type: "frontmatter";
      path: string;
      set: Record<string, string>;
      /** Raw values at audit time; hosts skip fields changed before writing. */
      expected?: Record<string, unknown>;
    }
  | { type: "rename"; from: string; to: string }
  | { type: "folders"; paths: string[] }
  | { type: "create-note"; path: string; number: string; system?: string; title: string; kind: "id" | "cabecera" | "categoria" | "area"; category: string }
  | { type: "create-folder"; path: string; paths: string[] }
  | { type: "move"; items: { from: string; to: string }[] }
  | { type: "trash"; path: string; identicalTo: string };

export interface Finding {
  kind: FindingKind;
  /** JD number involved, when there is one. */
  number?: string;
  /** Vault paths involved; notes end in `.md`, the rest are folders. */
  paths: string[];
  /** One line for the report. Spanish unless the audit input asks for `language: "en"`. */
  message: string;
  fix?: Fix;
  /** Informative findings do not count as problems. */
  informative?: boolean;
}

export interface NoteMeta {
  path: string;
  frontmatter: Record<string, unknown> | null;
  /** Note body, only needed to propose a description. */
  body?: string;
}

export interface AuditInput {
  index: JdIndex;
  /** Location of flat JDex notes, needed to propose a missing note. */
  jdexFolder?: string;
  /** Frontmatter of the notes directly inside the JDex folder. */
  notes: NoteMeta[];
  /** Every file path in the vault (at least those under the system root). */
  filePaths: string[];
  /** Every folder path in the vault; needed for the subfolder pattern check. */
  folderPaths?: string[];
  /** Subfolder pattern expected inside the IDs of a category; empty = no check. */
  patternFor?: (category: string) => string[];
  /** Language of the finding messages (the Repair dialog). Omitted = Spanish, the text Hebra shows. */
  language?: MessageLanguage;
  options?: {
    /** Treat a JDex note without a folder as a problem instead of information. Default false. */
    noteWithoutFolderIsFinding?: boolean;
    /** Treat an empty `descripcion` as a problem. Default true. */
    descriptionIsFinding?: boolean;
    /** Treat a category or area folder without a JDex note as a problem. Default false. */
    structureNotesAreFindings?: boolean;
  };
}

const ATTACHMENT_FOLDER = /(^|\/)(70 )?adjuntos(\/|$)/i;
const MANAGEMENT_EXTENSIONS = new Set(["md", "base", "json", "canvas"]);
const CONFLICT_COPY = /(?:conflicted copy|conflict copy|copia en conflicto|sync.conflict|conflicto de sincronizaci[oó]n)/i;

/** A conflict marker must be in the duplicate's own filename, not in an ancestor. */
export function isConflictCopyPath(path: string): boolean {
  return CONFLICT_COPY.test(path.slice(path.lastIndexOf('/') + 1));
}

function noteName(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.endsWith(".md") ? base.slice(0, -3) : base;
}

function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  return i === -1 ? "" : base.slice(i + 1).toLowerCase();
}

function asString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** Independent snapshot of the fields a frontmatter fix proposes to replace. */
function expectedValues(frontmatter: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, frontmatter[key] === undefined ? undefined : JSON.parse(JSON.stringify(frontmatter[key])) as unknown]));
}

export function auditSystem(input: AuditInput): Finding[] {
  const { index, notes, filePaths } = input;
  const findings: Finding[] = [];
  const en = input.language === "en";
  const contentFolders = index.ids.filter((entry) => {
    if (!entry.folderPath) return false;
    if (isHeaderEntry(entry)) return true;
    const number = parseJdNumber(entry.id);
    return number?.kind === "id" && isReserved(number) && !["01", "09"].includes(number.id.split(".")[1]);
  }).map((entry) => entry.folderPath!);
  const folderFiles = filesByFolder(filePaths, contentFolders);
  const filePathSet = new Set(filePaths);
  const categoryFolder = (number: string, system?: string): string | undefined =>
    index.categories.find((category) => category.number === number && (category.system ?? "") === (system ?? ""))?.path;
  const inboxFolder = (category: string, system?: string): string | undefined =>
    index.ids.find((entry) => entry.id === `${category}.01` && (entry.system ?? "") === (system ?? ""))?.folderPath;
  const moveIntoInbox = (sources: string[], category: string, system?: string): Fix | undefined => {
    const folder = inboxFolder(category, system);
    if (!folder) return undefined;
    const items = sources.map((from) => ({ from, to: `${folder}/${from.slice(from.lastIndexOf("/") + 1)}` }));
    const targets = items.map((item) => item.to);
    if (new Set(targets).size !== targets.length || targets.some((target) => filePathSet.has(target))) return undefined;
    return { type: "move", items };
  };

  const archived = new Set(notes.filter((n) => asString(n.frontmatter?.tipo) === "archivado").map((n) => n.path));
  // A repeated number only reports duplicate-id: pairing rules would mix the two IDs.
  const repeated = repeatedIdKeys(index);

  // 1 and 2: folder without note, note without folder (ID level). Retired IDs and headers keep their notes without folders by design.
  for (const entry of index.ids) {
    if (entry.notePath && archived.has(entry.notePath)) continue;
    if (repeated.has(idIdentityKey(entry))) continue;
    if (entry.folderPath && !entry.notePath) {
      const folderName = entry.folderPath.slice(entry.folderPath.lastIndexOf("/") + 1);
      const child = entry.id.endsWith("+") && folderName.startsWith("+ ");
      const rawTitle = child ? folderName.slice(2) : extractJdPrefix(folderName)?.title;
      const title = isHeaderEntry(entry) ? rawTitle?.replace(/^■\s*/, "") : rawTitle;
      const noteName = child ? jdexNoteName(entry.id, title ?? "", entry.system ?? "") : folderName;
      findings.push({
        kind: "folder-without-note",
        number: entry.id,
        paths: [entry.folderPath],
        message: en ? `The folder ${entry.label} has no JDex note.` : `La carpeta ${entry.label} no tiene nota en el JDex.`,
        ...(input.jdexFolder && title ? { fix: { type: "create-note", path: `${input.jdexFolder}/${noteName}.md`, number: entry.id, ...(entry.system ? { system: entry.system } : {}), title, kind: isHeaderEntry(entry) ? "cabecera" : "id", category: entry.category } } : {}),
      });
    } else if (entry.notePath && !entry.folderPath && !isHeaderEntry(entry)) {
      const parent = entry.id.endsWith("+")
        ? index.ids.find((candidate) => candidate.id === entry.id.slice(0, -1) && sameSystem(candidate, entry))?.folderPath
        : categoryFolder(entry.category, entry.system);
      // A + child folder is `+ Title`: same sanitising as any JDex name and never its tags.
      const name = entry.id.endsWith("+") ? jdexNoteName("+", titleForCompare(entry.title)) : jdexNoteName(entry.id, titleForCompare(entry.title), entry.system ?? "");
      const path = parent && name !== "+" ? `${parent}/${name}` : undefined;
      const pattern = path && !entry.id.endsWith("+") ? input.patternFor?.(entry.category) ?? [] : [];
      findings.push({
        kind: "note-without-folder",
        number: entry.id,
        paths: [entry.notePath],
        message: en ? `The note ${entry.label} has no folder in the system.` : `La nota ${entry.label} no tiene carpeta en el sistema.`,
        informative: !input.options?.noteWithoutFolderIsFinding,
        ...(path ? { fix: { type: "create-folder", path, paths: [path, ...pattern.map((part) => `${path}/${part}`)] } } : {}),
      });
    }
  }

  // 3: note and folder with the same number but a different title. The note is the source.
  for (const entry of index.ids) {
    if (!entry.notePath || !entry.folderPath) continue;
    if (repeated.has(idIdentityKey(entry))) continue;
    const folderName = entry.folderPath.slice(entry.folderPath.lastIndexOf("/") + 1);
    const folderPrefix = extractJdPrefix(folderName);
    const childFolder = entry.id.endsWith("+") && folderName.startsWith("+ ");
    const folderTitle = titleForCompare(folderPrefix?.title ?? (childFolder ? folderName.slice(2) : ""));
    const noteTitle = titleForCompare(extractJdPrefix(noteName(entry.notePath))?.title ?? "");
    if (folderTitle === noteTitle) continue;
    const targetName = childFolder ? jdexNoteName("+", noteTitle) : jdexNoteName(entry.id, noteTitle, folderPrefix?.number.system ?? "");
    const parent = parentOf(entry.folderPath);
    const to = parent === "" ? targetName : `${parent}/${targetName}`;
    findings.push({
      kind: "name-mismatch",
      number: entry.id,
      paths: [entry.notePath, entry.folderPath],
      message: en ? `${entry.id}: the note is called «${noteTitle}» and the folder «${folderTitle}».` : `${entry.id}: la nota se llama «${noteTitle}» y la carpeta «${folderTitle}».`,
      fix: { type: "rename", from: entry.folderPath, to },
    });
  }

  // 4: frontmatter that does not match the name and position of the note.
  for (const note of notes) {
    const parsed = extractJdPrefix(noteName(note.path));
    if (!parsed) continue;
    const expected = expectedFrontmatter(index, parsed.number, noteName(note.path));
    const fm = note.frontmatter ?? {};
    if (asString(fm.tipo) === "archivado") delete expected.tipo;
    const wrong: Record<string, string> = {};
    for (const [key, value] of Object.entries(expected)) {
      if (asString(fm[key]) !== value) wrong[key] = value;
    }
    if (Object.keys(wrong).length === 0) continue;
    findings.push({
      kind: "frontmatter-mismatch",
      number: expected.jd,
      paths: [note.path],
      message: `${noteName(note.path)}: ${Object.keys(wrong)
        .map((k) => (en ? `${k} should be «${wrong[k]}» (it is «${asString(fm[k]) ?? "empty"}»)` : `${k} debería ser «${wrong[k]}» (es «${asString(fm[k]) ?? "vacío"}»)`))
        .join("; ")}.`,
      fix: { type: "frontmatter", path: note.path, set: wrong, expected: expectedValues(fm, Object.keys(wrong)) },
    });
  }

  // 4b: empty descripcion. JDex.base and the Dataview indexes read it.
  for (const note of notes) {
    const parsed = extractJdPrefix(noteName(note.path));
    if (!parsed) continue;
    const current = asString(note.frontmatter?.descripcion) ?? "";
    if (current !== "") continue;
    const proposal = note.body === undefined ? null : firstSentence(note.body);
    findings.push({
      kind: "missing-description",
      number: parsed.number.kind === "id" ? parsed.number.id : undefined,
      paths: [note.path],
      message: en
        ? proposal ? `${noteName(note.path)}: no description; proposed «${proposal}».` : `${noteName(note.path)}: no description and no body to take one from.`
        : proposal ? `${noteName(note.path)}: sin descripción; propuesta «${proposal}».` : `${noteName(note.path)}: sin descripción y sin cuerpo del que sacarla.`,
      informative: input.options?.descriptionIsFinding === false,
      ...(proposal ? { fix: { type: "frontmatter", path: note.path, set: { descripcion: proposal }, expected: expectedValues(note.frontmatter ?? {}, ["descripcion"]) } } : {}),
    });
  }

  // 5: duplicate numbers among notes or among folders. Several + children of one ID are
  // expected; two with the same title are not.
  for (const [source, raw] of [
    ["notas", index.rawIdNotes],
    ["carpetas", index.rawIdFolders],
  ] as const) {
    const byId = new Map<string, string[]>();
    for (const r of raw) {
      const key = idIdentityKey({ id: r.id, system: r.system, title: extractJdPrefix(r.label)?.title ?? "" });
      byId.set(key, [...(byId.get(key) ?? []), r.path]);
    }
    for (const [id, paths] of byId) {
      if (paths.length < 2) continue;
      const duplicate = source === "notas" ? paths.find((path) => {
        if (!isConflictCopyPath(path)) return false;
        const body = notes.find((note) => note.path === path)?.body;
        return body !== undefined && paths.some((other) => other !== path && notes.find((note) => note.path === other)?.body === body);
      }) : undefined;
      const original = duplicate ? paths.find((path) => path !== duplicate && notes.find((note) => note.path === path)?.body === notes.find((note) => note.path === duplicate)?.body) : undefined;
      findings.push({
        kind: "duplicate-id",
        number: id,
        paths,
        message: en ? `${id} is repeated in ${paths.length} ${source === "notas" ? "notes" : "folders"}.` : `${id} está repetido en ${paths.length} ${source}.`,
        ...(duplicate && original ? { fix: { type: "trash", path: duplicate, identicalTo: original } } : {}),
      });
    }
  }

  // 6: reserved numbers (.00, .02 to .08) holding content files. .01 inbox and .09 archive hold content by design.
  for (const entry of index.ids) {
    if (!entry.folderPath) continue;
    const n = parseJdNumber(entry.id);
    if (!n || n.kind !== "id" || !isReserved(n)) continue;
    const last = n.id.split(".")[1];
    if (last === "01" || last === "09") continue;
    const content = (folderFiles.get(entry.folderPath) ?? []).filter(
      (p) => !ATTACHMENT_FOLDER.test(p.slice(entry.folderPath!.length)) && !MANAGEMENT_EXTENSIONS.has(extensionOf(p)),
    );
    if (content.length === 0) continue;
    const fix = moveIntoInbox(content, entry.category, entry.system);
    findings.push({
      kind: "reserved-used-as-content",
      number: entry.id,
      paths: [entry.folderPath, ...content.slice(0, 5)],
      message: en ? `${entry.label} is a management number and holds ${content.length} content file(s).` : `${entry.label} es un número de gestión y contiene ${content.length} fichero(s) de contenido.`,
      ...(fix ? { fix } : {}),
    });
  }

  // 7: header IDs (AC.X0 ■) whose folder contains files.
  for (const entry of index.ids) {
    if (!entry.folderPath || !isHeaderEntry(entry)) continue;
    const files = folderFiles.get(entry.folderPath) ?? [];
    if (files.length === 0) continue;
    const fix = moveIntoInbox(files, entry.category, entry.system);
    findings.push({
      kind: "header-with-files",
      number: entry.id,
      paths: [entry.folderPath, ...files.slice(0, 5)],
      message: en ? `The header ${entry.label} holds ${files.length} file(s); a header only groups.` : `La cabecera ${entry.label} contiene ${files.length} fichero(s); una cabecera solo agrupa.`,
      ...(fix ? { fix } : {}),
    });
  }

  // 7b: areas and categories that exist as folders but have no note in the JDex.
  if (input.options?.structureNotesAreFindings) {
    for (const area of index.areas) {
      if (area.notePath || !area.path) continue;
      findings.push({
        kind: "structure-without-note",
        number: area.code,
        paths: [area.path],
        message: en ? `The area ${area.label} has no JDex note.` : `El área ${area.label} no tiene nota en el JDex.`,
        ...(input.jdexFolder ? { fix: { type: "create-note", path: `${input.jdexFolder}/${area.label}.md`, number: area.code, ...(area.system ? { system: area.system } : {}), title: area.title, kind: "area", category: "" } } : {}),
      });
    }
    for (const category of index.categories) {
      if (category.notePath || !category.path) continue;
      findings.push({
        kind: "structure-without-note",
        number: category.number,
        paths: [category.path],
        message: en ? `The category ${category.label} has no JDex note.` : `La categoría ${category.label} no tiene nota en el JDex.`,
        ...(input.jdexFolder ? { fix: { type: "create-note", path: `${input.jdexFolder}/${category.label}.md`, number: category.number, ...(category.system ? { system: category.system } : {}), title: category.title, kind: "categoria", category: category.number } } : {}),
      });
    }
  }

  // 7c: subfolder pattern of the category missing inside an ID folder.
  if (input.patternFor && input.folderPaths) {
    for (const entry of index.ids) {
      if (!entry.folderPath || entry.id.endsWith("+")) continue;
      const n = parseJdNumber(entry.id);
      if (!n || n.kind !== "id" || isReserved(n) || isHeaderEntry(entry)) continue;
      const pattern = input.patternFor(entry.category);
      if (pattern.length === 0) continue;
      const missing = missingPatternFolders(entry.folderPath, pattern, input.folderPaths);
      if (missing.length === 0) continue;
      findings.push({
        kind: "pattern-missing",
        number: entry.id,
        paths: [entry.folderPath],
        message: en ? `${entry.label} lacks ${missing.map((m) => m.slice(entry.folderPath!.length + 1)).join(", ")}.` : `${entry.label} no tiene ${missing.map((m) => m.slice(entry.folderPath!.length + 1)).join(", ")}.`,
        informative: true,
        fix: { type: "folders", paths: missing },
      });
    }
  }

  // 8: numbers outside their parent.
  for (const m of index.misplaced) {
    const parsed = parseJdNumber(m.number);
    const correctParent = !m.wrongDepth && parsed?.kind === "id" ? categoryFolder(parsed.category, m.system) : undefined;
    const target = correctParent ? `${correctParent}/${m.path.slice(m.path.lastIndexOf("/") + 1)}` : undefined;
    const occupied = index.ids.some((entry) => entry.id === m.number && sameSystem(entry, m) && entry.folderPath);
    findings.push({
      kind: m.wrongDepth ? "misplaced-number" : "out-of-parent",
      number: m.number,
      paths: [m.path],
      message: en ? `${m.label} sits inside ${m.parent}, which is not its parent.` : `${m.label} está dentro de ${m.parent}, que no es su padre.`,
      ...(target && !occupied && !input.folderPaths?.includes(target) ? { fix: { type: "move", items: [{ from: m.path, to: target }] } } : {}),
    });
  }

  for (const entry of index.malformed ?? []) {
    findings.push({ kind: "malformed-number", paths: [entry.path], message: en ? malformedMessageEn(entry) : entry.message });
  }

  return findings;
}

/** English wording of a malformed-number finding; the index stores the Spanish one. */
function malformedMessageEn(entry: MalformedEntry): string {
  if (entry.name === undefined) return entry.message;
  return entry.problem === "square-on-non-zero" ? `${entry.name}: ■ on an ID that does not end in 0.` : `${entry.name}: the ID needs two digits after the dot.`;
}

function isHeaderEntry(entry: IdEntry): boolean {
  return isHeader(entry.label) || (entry.notePath !== undefined && isHeader(noteName(entry.notePath)));
}

/** The frontmatter a JDex note must carry given its number and the labels in the index. */
export function expectedFrontmatter(
  index: JdIndex,
  number: ReturnType<typeof parseJdNumber>,
  name: string,
): Record<string, string> {
  if (!number) return {};
  if (number.kind === "area") {
    return { jd: areaCode(number.area), tipo: "area" };
  }
  const areaLabel = (n: number): string | undefined => index.areas.find((a) => a.number === n && sameSystem(a, number))?.label;
  if (number.kind === "category") {
    const out: Record<string, string> = { jd: number.category, tipo: "categoria" };
    const area = areaLabel(areaOfCategory(number.category));
    if (area) out.area = area;
    return out;
  }
  const out: Record<string, string> = {
    jd: number.extension ? `${number.id}+` : number.id,
    tipo: isHeader(name) ? "cabecera" : "id",
  };
  const area = areaLabel(areaOfCategory(number.category));
  if (area) out.area = area;
  const category = index.categories.find((c) => c.number === number.category && sameSystem(c, number))?.label;
  if (category) out.categoria = category;
  return out;
}

/** Folder settings the hosts read by path. */
export interface ConfiguredFolders {
  jdexFolder?: string;
  systemRoot?: string;
  reportsFolder?: string;
  templatesFolder?: string;
}

const CONFIGURED_FOLDER_LABELS_EN: Record<keyof ConfiguredFolders, string> = {
  jdexFolder: "The JDex folder",
  systemRoot: "The system root",
  reportsFolder: "The reports folder",
  templatesFolder: "The templates folder",
};

const CONFIGURED_FOLDER_LABELS: Record<keyof ConfiguredFolders, string> = {
  jdexFolder: "La carpeta JDex",
  systemRoot: "La raíz del sistema",
  reportsFolder: "La carpeta de informes",
  templatesFolder: "La carpeta de plantillas",
};

/** A configured folder that no longer exists (renamed, moved or deleted outside the
 *  plugin): every number would silently drop out of the index. Empty settings are unset. */
export function missingConfiguredFolders(settings: ConfiguredFolders, folderPaths: readonly string[], language: MessageLanguage = "es"): Finding[] {
  const known = new Set(folderPaths);
  const findings: Finding[] = [];
  for (const key of Object.keys(CONFIGURED_FOLDER_LABELS) as (keyof ConfiguredFolders)[]) {
    const path = settings[key];
    if (!path || known.has(path)) continue;
    findings.push({
      kind: "missing-folder",
      paths: [path],
      message: language === "en" ? `${CONFIGURED_FOLDER_LABELS_EN[key]} configured («${path}») does not exist: check the settings.` : `${CONFIGURED_FOLDER_LABELS[key]} configurada («${path}») no existe: revisa los ajustes.`,
    });
  }
  return findings;
}

/** Number of findings that count as problems (informative ones excluded). */
export function countProblems(findings: Finding[]): number {
  return findings.filter((f) => !f.informative).length;
}

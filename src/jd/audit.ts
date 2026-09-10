/**
 * Pure audit of a Johnny.Decimal system: the "librarian" pass of the documentation.
 * No Obsidian imports. Works on the index plus the frontmatter of the JDex notes and the
 * list of file paths, so it runs in Node tests.
 *
 * Deliberately NOT a finding: sub-folders more than one level deep inside an ID. Projects use them.
 */

import { areaCode, areaOfCategory, type IdEntry, type JdIndex } from "./index";
import { firstSentence } from "./description";
import { extractJdPrefix, isHeader, isReserved, parseJdNumber } from "./parse";

export type FindingKind =
  | "folder-without-note"
  | "note-without-folder"
  | "name-mismatch"
  | "frontmatter-mismatch"
  | "duplicate-id"
  | "reserved-used-as-content"
  | "header-with-files"
  | "out-of-parent"
  | "missing-description"
  | "structure-without-note";

export const FINDING_KINDS: FindingKind[] = [
  "folder-without-note",
  "name-mismatch",
  "frontmatter-mismatch",
  "duplicate-id",
  "reserved-used-as-content",
  "header-with-files",
  "out-of-parent",
  "missing-description",
  "structure-without-note",
  "note-without-folder",
];

export type Fix =
  | { type: "frontmatter"; path: string; set: Record<string, string> }
  | { type: "rename"; from: string; to: string };

export interface Finding {
  kind: FindingKind;
  /** JD number involved, when there is one. */
  number?: string;
  /** Vault paths involved; notes end in `.md`, the rest are folders. */
  paths: string[];
  /** Spanish, one line, for the report. */
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
  /** Frontmatter of the notes directly inside the JDex folder. */
  notes: NoteMeta[];
  /** Every file path in the vault (at least those under the system root). */
  filePaths: string[];
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

function noteName(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.endsWith(".md") ? base.slice(0, -3) : base;
}

function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

function filesUnder(folder: string, filePaths: string[]): string[] {
  const prefix = folder + "/";
  return filePaths.filter((p) => p.startsWith(prefix));
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

export function auditSystem(input: AuditInput): Finding[] {
  const { index, notes, filePaths } = input;
  const findings: Finding[] = [];

  // 1 and 2: folder without note, note without folder (ID level).
  for (const entry of index.ids) {
    if (entry.folderPath && !entry.notePath) {
      findings.push({
        kind: "folder-without-note",
        number: entry.id,
        paths: [entry.folderPath],
        message: `La carpeta ${entry.label} no tiene nota en el JDex.`,
      });
    } else if (entry.notePath && !entry.folderPath) {
      findings.push({
        kind: "note-without-folder",
        number: entry.id,
        paths: [entry.notePath],
        message: `La nota ${entry.label} no tiene carpeta en el sistema.`,
        informative: !input.options?.noteWithoutFolderIsFinding,
      });
    }
  }

  // 3: note and folder with the same number but a different title. The note is the source.
  for (const entry of index.ids) {
    if (!entry.notePath || !entry.folderPath) continue;
    const folderName = entry.folderPath.slice(entry.folderPath.lastIndexOf("/") + 1);
    const folderTitle = extractJdPrefix(folderName)?.title ?? "";
    const noteTitle = extractJdPrefix(noteName(entry.notePath))?.title ?? "";
    if (folderTitle === noteTitle) continue;
    const to = `${parentOf(entry.folderPath)}/${noteName(entry.notePath)}`;
    findings.push({
      kind: "name-mismatch",
      number: entry.id,
      paths: [entry.notePath, entry.folderPath],
      message: `${entry.id}: la nota se llama «${noteTitle}» y la carpeta «${folderTitle}».`,
      fix: { type: "rename", from: entry.folderPath, to },
    });
  }

  // 4: frontmatter that does not match the name and position of the note.
  for (const note of notes) {
    const parsed = extractJdPrefix(noteName(note.path));
    if (!parsed) continue;
    const expected = expectedFrontmatter(index, parsed.number, noteName(note.path));
    const fm = note.frontmatter ?? {};
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
        .map((k) => `${k} debería ser «${wrong[k]}» (es «${asString(fm[k]) ?? "vacío"}»)`)
        .join("; ")}.`,
      fix: { type: "frontmatter", path: note.path, set: wrong },
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
      message: proposal ? `${noteName(note.path)}: sin descripción; propuesta «${proposal}».` : `${noteName(note.path)}: sin descripción y sin cuerpo del que sacarla.`,
      informative: input.options?.descriptionIsFinding === false,
      ...(proposal ? { fix: { type: "frontmatter", path: note.path, set: { descripcion: proposal } } } : {}),
    });
  }

  // 5: duplicate numbers among notes or among folders.
  for (const [source, raw] of [
    ["notas", index.rawIdNotes],
    ["carpetas", index.rawIdFolders],
  ] as const) {
    const byId = new Map<string, string[]>();
    for (const r of raw) {
      if (r.id.endsWith("+")) continue; // several + children of one ID are expected
      byId.set(r.id, [...(byId.get(r.id) ?? []), r.path]);
    }
    for (const [id, paths] of byId) {
      if (paths.length < 2) continue;
      findings.push({
        kind: "duplicate-id",
        number: id,
        paths,
        message: `${id} está repetido en ${paths.length} ${source}.`,
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
    const content = filesUnder(entry.folderPath, filePaths).filter(
      (p) => !ATTACHMENT_FOLDER.test(p.slice(entry.folderPath!.length)) && !MANAGEMENT_EXTENSIONS.has(extensionOf(p)),
    );
    if (content.length === 0) continue;
    findings.push({
      kind: "reserved-used-as-content",
      number: entry.id,
      paths: [entry.folderPath, ...content.slice(0, 5)],
      message: `${entry.label} es un número de gestión y contiene ${content.length} fichero(s) de contenido.`,
    });
  }

  // 7: header IDs (AC.X0 ■) whose folder contains files.
  for (const entry of index.ids) {
    if (!entry.folderPath || !isHeaderEntry(entry)) continue;
    const files = filesUnder(entry.folderPath, filePaths);
    if (files.length === 0) continue;
    findings.push({
      kind: "header-with-files",
      number: entry.id,
      paths: [entry.folderPath, ...files.slice(0, 5)],
      message: `La cabecera ${entry.label} contiene ${files.length} fichero(s); una cabecera solo agrupa.`,
    });
  }

  // 7b: areas and categories that exist as folders but have no note in the JDex.
  for (const area of index.areas) {
    if (area.notePath || !area.path) continue;
    findings.push({
      kind: "structure-without-note",
      number: area.code,
      paths: [area.path],
      message: `El área ${area.label} no tiene nota en el JDex.`,
      informative: !input.options?.structureNotesAreFindings,
    });
  }
  for (const category of index.categories) {
    if (category.notePath || !category.path) continue;
    findings.push({
      kind: "structure-without-note",
      number: category.number,
      paths: [category.path],
      message: `La categoría ${category.label} no tiene nota en el JDex.`,
      informative: !input.options?.structureNotesAreFindings,
    });
  }

  // 8: numbers outside their parent.
  for (const m of index.misplaced) {
    findings.push({
      kind: "out-of-parent",
      number: m.number,
      paths: [m.path],
      message: `${m.label} está dentro de ${m.parent}, que no es su padre.`,
    });
  }

  return findings;
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
  const areaLabel = (n: number): string | undefined => index.areas.find((a) => a.number === n)?.label;
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
  const category = index.categories.find((c) => c.number === number.category)?.label;
  if (category) out.categoria = category;
  return out;
}

/** Number of findings that count as problems (informative ones excluded). */
export function countProblems(findings: Finding[]): number {
  return findings.filter((f) => !f.informative).length;
}

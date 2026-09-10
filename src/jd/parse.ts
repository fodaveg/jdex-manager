/**
 * Pure Johnny.Decimal number handling. No Obsidian imports, so it runs in plain Node tests.
 *
 * Vocabulary (johnnydecimal.com/documentation):
 * - area: a range of ten categories, `10-19`.
 * - category: two digits, `11`. Categories ending in 0 manage their area.
 * - id: `AC.ID`, `11.11`. IDs `.00` to `.09` manage their category; content starts at `.11`.
 * - header: an ID ending in 0 (`14.10`), usually titled with a black square, groups the IDs below it.
 * - extension: `AC.ID+` marks a child of that ID.
 * - system: with several systems, a `SYS.` prefix (letter and two digits, `D01.21.22`) names the system.
 */

export type JdArea = { kind: "area"; area: number; system?: string };
export type JdCategory = { kind: "category"; category: string; system?: string };
export type JdId = { kind: "id"; category: string; id: string; extension?: "+"; system?: string };
export type JdNumber = JdArea | JdCategory | JdId;

export interface ParsedPrefix {
  number: JdNumber;
  /** Text after the prefix and its separator, without a trailing `.md`. */
  title: string;
}

const AREA_RANGE = /^(\d)0-(\d)9$/;
const CATEGORY = /^(\d{2})$/;
const ID = /^(\d{2})\.(\d{1,2})(\+?)$/;
const SYSTEM = /^([A-Z]\d{2})\.(.+)$/;

export function parseJdNumber(input: string): JdNumber | null {
  let s = input.trim();
  if (s === "") return null;
  let system: string | undefined;
  const sys = SYSTEM.exec(s);
  if (sys) {
    system = sys[1];
    s = sys[2];
  }
  const withSystem = <T extends JdNumber>(n: T): T => (system ? { ...n, system } : n);

  const area = AREA_RANGE.exec(s);
  if (area) {
    if (area[1] !== area[2]) return null;
    return withSystem({ kind: "area", area: Number(area[1]) * 10 });
  }

  const cat = CATEGORY.exec(s);
  if (cat) return withSystem({ kind: "category", category: cat[1] });

  const id = ID.exec(s);
  if (id) {
    const out: JdId = { kind: "id", category: id[1], id: `${id[1]}.${id[2].padStart(2, "0")}` };
    if (id[3] === "+") out.extension = "+";
    return withSystem(out);
  }

  return null;
}

/** Prefix at the start of a file or folder name: `10-19`, `11`, `11.11`, `11.11+` (optionally `D01.` in front), followed by a separator or the end. */
const PREFIX = /^((?:[A-Z]\d{2}\.)?(?:\d0-\d9|\d{2}\.\d{1,2}\+?|\d{2}))(?:[\s_-]+|$)/;

export function extractJdPrefix(name: string): ParsedPrefix | null {
  const base = name.endsWith(".md") ? name.slice(0, -3) : name;
  const m = PREFIX.exec(base);
  if (!m) return null;
  const number = parseJdNumber(m[1]);
  if (!number) return null;
  return { number, title: base.slice(m[0].length).trim() };
}

/** Standard zeros: area 00-09, categories ending in 0, IDs .00 to .09. */
export function isReserved(n: JdNumber): boolean {
  switch (n.kind) {
    case "area":
      return n.area === 0;
    case "category":
      return n.category.endsWith("0");
    case "id":
      return idPart(n.id) <= 9;
  }
}

/** Header IDs end in 0 or carry a black square in the title. */
export function isHeader(name: string): boolean {
  const p = extractJdPrefix(name);
  if (!p || p.number.kind !== "id") return false;
  const n = idPart(p.number.id);
  return (n > 0 && n % 10 === 0) || p.title.startsWith("■");
}

function idPart(id: string): number {
  return Number(id.split(".")[1]);
}

/**
 * Next free content ID in a category, given the IDs already in use.
 * Starts at .11, takes the highest in use plus one, and skips numbers ending in 0 (headers).
 */
export function nextFreeId(category: string, existingIds: string[]): string | null {
  let max = 10;
  for (const raw of existingIds) {
    const n = parseJdNumber(raw);
    if (!n || n.kind !== "id" || n.category !== category) continue;
    max = Math.max(max, idPart(n.id));
  }
  let next = max + 1;
  if (next % 10 === 0) next += 1;
  if (next > 99) return null;
  return `${category}.${String(next).padStart(2, "0")}`;
}

/** Next free category in an area, given the categories already in use. Starts at A1. */
export function nextFreeCategory(area: number, existingCategories: string[]): string | null {
  let max = area;
  for (const raw of existingCategories) {
    const n = parseJdNumber(raw);
    if (!n || n.kind !== "category") continue;
    const value = Number(n.category);
    if (value < area || value > area + 9) continue;
    max = Math.max(max, value);
  }
  const next = max + 1;
  if (next > area + 9) return null;
  return String(next).padStart(2, "0");
}

/** `AC.ID Title` (or `SYS.AC.ID Title`) with the title made safe for every file system and for Obsidian Sync. */
export function jdexNoteName(id: string, title: string, system = ""): string {
  const safe = title
    .replace(/:/g, " -")
    .replace(/[*?"<>|/\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const number = system === "" ? id : `${system}.${id}`;
  return safe === "" ? number : `${number} ${safe}`;
}

/** `D01` → valid system identifier (a capital letter and two digits), else null. Empty stays empty. */
export function normalizeSystemId(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  if (s === "") return "";
  return /^[A-Z]\d{2}$/.test(s) ? s : null;
}

/**
 * Subfolder patterns inside an ID (johnnydecimal.com, "subfolder patterns"). Pure.
 * Settings hold a default pattern and overrides per category, one folder name per line.
 */

export interface PatternSettings {
  subfolderPattern: string;
  subfolderPatternsByCategory: Record<string, string>;
}

function parseLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

/** Folder names to create inside a new ID of `category`. */
export function patternFor(settings: PatternSettings, category: string): string[] {
  const own = settings.subfolderPatternsByCategory[category];
  return parseLines(own !== undefined && own.trim() !== "" ? own : settings.subfolderPattern);
}

/** `21: 40 Audits, 70 Adjuntos` per line → record. Blank or malformed lines are skipped. */
export function parseCategoryPatterns(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of parseLines(text)) {
    const m = /^(\d{2})\s*:\s*(.+)$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "")
      .join("\n");
  }
  return out;
}

export function formatCategoryPatterns(record: Record<string, string>): string {
  return Object.keys(record)
    .sort()
    .map((k) => `${k}: ${parseLines(record[k]).join(", ")}`)
    .join("\n");
}

/** Pattern folders missing inside `folderPath`, given every folder path in the vault. */
export function missingPatternFolders(folderPath: string, pattern: string[], folderPaths: string[]): string[] {
  const set = new Set(folderPaths);
  return pattern.map((p) => `${folderPath}/${p}`).filter((p) => !set.has(p));
}

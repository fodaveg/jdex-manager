import type { App, TFile } from "obsidian";

/** Frontmatter keys that carry the date a note was made, in order of preference. */
export const DATE_KEYS = ["fecha", "creado", "created", "date"] as const;

/** Local calendar date from a frontmatter value (`2026-03-04`, optionally followed by a time), or null. */
export function parseDateValue(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(value.trim());
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

/**
 * The date a file is dated with: a valid date in its frontmatter when it has one, else its ctime.
 * ctime is the file system's creation time on this device. For a file that arrived through Obsidian
 * Sync it is the arrival, not the original creation (measured on macOS on 12 Oct 2026: notes made on
 * other devices on different days shared one birthtime, the moment they arrived; on Linux ctime is
 * not even a creation time), which is why an explicit date wins.
 */
export function fileDate(app: App, file: TFile): Date {
  if (file.extension === "md") {
    const fm: Record<string, unknown> | undefined = app.metadataCache.getFileCache(file)?.frontmatter;
    for (const key of DATE_KEYS) {
      const date = parseDateValue(fm?.[key]);
      if (date) return date;
    }
  }
  return new Date(file.stat.ctime);
}

/**
 * Daily reports (audit, health) that never overwrite what the user wrote in them.
 * Each generated body ends with a stamp: an HTML comment, hidden in reading view, with
 * a hash of the body. Running the report again on the same day overwrites a note only
 * while its stamp still matches its body; an edited note (or one written before stamps
 * existed) is kept and the new report goes to `… (2).md`, `… (3).md`, like the system
 * report. The check and the write happen inside `vault.process`, so an edit made in
 * between is not lost either.
 */
import { type App, normalizePath, TFile } from "obsidian";
import { ensureFolder } from "./create";
import type { Effect } from "../jd/journal";

const STAMP = /\n?<!-- jdex:generado ([0-9a-f]{8}) -->\n?$/u;

/** FNV-1a over the UTF-16 code units: stable, synchronous and dependency-free. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** The generated body with its stamp appended. */
export function stampReport(body: string): string {
  const text = body.endsWith("\n") ? body : `${body}\n`;
  return `${text}\n<!-- jdex:generado ${fnv1a(text)} -->\n`;
}

/** Whether a report note is still exactly what the plugin generated. */
export function isUneditedReport(content: string): boolean {
  const match = STAMP.exec(content);
  if (!match) return false;
  return fnv1a(content.slice(0, match.index)) === match[1];
}

/**
 * Writes `body` as the report at `path`, or at the first `(n)` variant that is either
 * free or still unedited. Returns the note written and its path. Records the write in `effects`.
 */
export async function writeDailyReport(app: App, folder: string, path: string, body: string, effects?: Effect[]): Promise<{ file: TFile; path: string }> {
  const content = stampReport(body);
  const base = normalizePath(path);
  let candidate = base;
  for (let suffix = 2; ; suffix += 1) {
    const existing = app.vault.getAbstractFileByPath(candidate);
    if (!existing) break;
    if (existing instanceof TFile) {
      let replaced = false;
      await app.vault.process(existing, (current) => {
        if (!isUneditedReport(current)) return current;
        replaced = true;
        if (current !== content) effects?.push({ kind: "note-rewrite", path: candidate, before: current, after: content });
        return content;
      });
      if (replaced) return { file: existing, path: candidate };
    }
    candidate = base.replace(/\.md$/u, ` (${suffix}).md`);
  }
  await ensureFolder(app, folder, effects);
  const file = await app.vault.create(candidate, content);
  effects?.push({ kind: "created-note", path: candidate, content });
  return { file, path: candidate };
}

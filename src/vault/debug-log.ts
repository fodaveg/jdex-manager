/**
 * Obsidian side of the optional debug log (`src/jd/debug-log.ts`): one rolling note in the
 * reports folder. Writes go through `vault.process`, so an edit made by hand between the
 * read and the write is never lost, and are serialized so lines keep their order. The log
 * must never break what it observes: every failure is swallowed and nothing here calls
 * back into the code that reports errors.
 */
import { type App, normalizePath, TFile } from "obsidian";
import { appendDebugEntry, DEBUG_LOG_TITLE, formatDebugEntry, type JdexManagerSettings } from "../jd/public";
import { ensureFolder } from "./create";

type LogSettings = Pick<JdexManagerSettings, "debugLog" | "reportsFolder">;

/** Vault path of the log note, or null while there is no reports folder to put it in. */
export function debugLogPath(settings: Pick<JdexManagerSettings, "reportsFolder">): string | null {
  return settings.reportsFolder === "" ? null : normalizePath(`${settings.reportsFolder}/${DEBUG_LOG_TITLE}.md`);
}

/** Whether a vault event on `path` is the log note writing itself (not a reason for maintenance). */
export function isDebugLogPath(settings: Pick<JdexManagerSettings, "reportsFolder">, path: string | undefined): boolean {
  return path !== undefined && path === debugLogPath(settings);
}

export class DebugLogWriter {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly app: App) {}

  /** Adds one line for `error` when the setting is on. Resolves once written; never rejects. */
  record(settings: LogSettings, where: string, error: unknown, path?: string): Promise<void> {
    const target = settings.debugLog ? debugLogPath(settings) : null;
    if (target === null) return Promise.resolve();
    const entry = formatDebugEntry(new Date(), where, error, path);
    const run = this.tail.then(() => this.write(settings.reportsFolder, target, entry));
    this.tail = run.catch(() => undefined);
    return this.tail;
  }

  private async write(folder: string, path: string, entry: string): Promise<void> {
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (existing instanceof TFile) {
          await this.app.vault.process(existing, (current) => appendDebugEntry(current, entry));
          return;
        }
        if (existing) return; // A folder is in the way: leave it alone.
        try {
          await ensureFolder(this.app, folder);
          await this.app.vault.create(path, appendDebugEntry(null, entry));
          return;
        } catch {
          // Created meanwhile (sync or another window): the next pass appends to it.
        }
      }
    } catch {
      // A debug log that fails must not add a failure of its own.
    }
  }
}

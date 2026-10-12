import type { TFile } from "obsidian";

/** How long after its `create` event a file may be opened and still count as created on this device. */
export const LOCAL_OPEN_WINDOW_MS = 2000;

/**
 * Tells the files this device creates from the ones that arrive from elsewhere, for «date files
 * when they are created».
 *
 * Obsidian fires `create` both for a note made here and for a file that Obsidian Sync (or any other
 * sync) writes into the vault, and the ctime of a received file is its arrival on this device
 * (measured on 12 Oct 2026), so neither the event nor the file says where it came from. The
 * workspace does: Obsidian opens a note it has just created (new note, an unresolved link, the
 * daily note, a template), and nothing opens a file that arrives. A file counts as created here
 * when it is opened (`file-open`) within `LOCAL_OPEN_WINDOW_MS` of its `create`.
 *
 * Left undated on purpose: files made here that nobody opens (pasted or dropped attachments, files
 * written by other plugins, files copied into the vault folder) and a note opened in a tab that does
 * not take focus. A received file the user opens within the window would be dated; the window is
 * short so that only an app flow, not a person, opens a file that fast.
 */
export class LocalCreations {
  /** Files created in the last window, oldest first, with the time of their `create`. */
  private readonly created = new Map<TFile, number>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly windowMs = LOCAL_OPEN_WINDOW_MS,
  ) {}

  /** Notes a file the vault has just created; it counts as local only if it is opened in time. */
  add(file: TFile): void {
    this.prune();
    this.created.delete(file);
    this.created.set(file, this.now());
  }

  /** The file Obsidian has just opened when it was created moments ago, once per file; otherwise null. */
  take(file: TFile | null): TFile | null {
    this.prune();
    if (!file || !this.created.has(file)) return null;
    this.created.delete(file);
    return file;
  }

  /** Forgets files whose window has passed. */
  private prune(): void {
    const limit = this.now() - this.windowMs;
    for (const [file, at] of this.created) {
      if (at >= limit) break;
      this.created.delete(file);
    }
  }
}

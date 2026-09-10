import { type App, TFile, TFolder, SuggestModal } from "obsidian";
import type { IdEntry, JdIndex } from "../jd/index";

/** Picks an ID. Each row shows whether it has a note and a folder. `onPick` gets the entry and the modifier state. */
export class IdSuggestModal extends SuggestModal<IdEntry> {
  private readonly ids: IdEntry[];
  private readonly onPick: (entry: IdEntry, openFolder: boolean) => void;

  constructor(app: App, index: JdIndex, onPick: (entry: IdEntry, openFolder: boolean) => void, placeholder = "Type an ID or a title") {
    super(app);
    this.ids = index.ids;
    this.onPick = onPick;
    this.setPlaceholder(placeholder);
    this.setInstructions([
      { command: "↵", purpose: "open the note" },
      { command: "⌘ ↵", purpose: "open the folder" },
    ]);
  }

  getSuggestions(query: string): IdEntry[] {
    const q = query.trim().toLowerCase();
    if (q === "") return this.ids;
    return this.ids.filter((e) => e.label.toLowerCase().includes(q));
  }

  renderSuggestion(entry: IdEntry, el: HTMLElement): void {
    el.createDiv({ text: entry.label });
    const marks = [entry.notePath ? "note" : "no note", entry.folderPath ? "folder" : "no folder"];
    el.createDiv({ text: `${entry.category} › ${entry.id} · ${marks.join(" · ")}`, cls: "jdex-suggestion-note" });
  }

  onChooseSuggestion(entry: IdEntry, evt: MouseEvent | KeyboardEvent): void {
    this.onPick(entry, evt.metaKey || evt.ctrlKey);
  }
}

/** Opens the JDex note of an entry, or the first note inside its folder when asked for the folder. */
export async function openEntry(app: App, entry: IdEntry, openFolder: boolean): Promise<string | null> {
  if (!openFolder && entry.notePath) {
    const f = app.vault.getAbstractFileByPath(entry.notePath);
    if (f instanceof TFile) {
      await app.workspace.getLeaf(false).openFile(f);
      return null;
    }
  }
  if (entry.folderPath) {
    const folder = app.vault.getAbstractFileByPath(entry.folderPath);
    if (folder instanceof TFolder) {
      const first = folder.children.find((c): c is TFile => c instanceof TFile && c.extension === "md");
      if (first) {
        await app.workspace.getLeaf(false).openFile(first);
        return null;
      }
      return `${entry.label}: the folder has no note to open.`;
    }
  }
  return `${entry.label} has ${openFolder ? "no folder" : "no note"}.`;
}

import { AbstractInputSuggest, type App, TFolder } from "obsidian";

/** Folder paths that contain every word of `query` (case-insensitive), shortest first. Pure. */
export function matchFolderPaths(paths: readonly string[], query: string, limit = 50): string[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w !== "");
  return paths
    .filter((path) => path !== "" && path !== "/" && words.every((w) => path.toLowerCase().includes(w)))
    .sort((a, b) => a.length - b.length || a.localeCompare(b))
    .slice(0, limit);
}

/**
 * Offers the vault's folders under a text field. It is only a shortcut: the field stays free
 * text, so any path that was valid before still is, and nothing here restricts what is typed.
 */
export class FolderSuggest extends AbstractInputSuggest<string> {
  private readonly inputEl: HTMLInputElement;

  constructor(app: App, inputEl: HTMLInputElement) {
    super(app, inputEl);
    this.inputEl = inputEl;
  }

  getSuggestions(query: string): string[] {
    const paths = this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder).map((f) => f.path);
    return matchFolderPaths(paths, query);
  }

  renderSuggestion(path: string, el: HTMLElement): void {
    el.setText(path);
  }

  selectSuggestion(path: string): void {
    this.inputEl.value = path;
    // The Setting's onChange listens to `input`: this saves the chosen path like typing it.
    this.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    this.close();
  }
}

import { ItemView, TFile, TFolder, type WorkspaceLeaf } from "obsidian";
import { formatDate, locate } from "../jd/files";
import { childrenOf } from "../jd/headers";
import { childrenPlus, type IdEntry, type JdIndex } from "../jd/index";
import { openEntry } from "./go-to-id";

export const ID_PANEL_VIEW = "jdex-id-panel";

export interface PanelSource {
  index: () => JdIndex;
  settings: () => { jdexFolder: string };
}

/** Side panel: the ID the active file belongs to, its note, its files, its + children and its siblings. */
export class IdPanelView extends ItemView {
  private readonly source: PanelSource;

  constructor(leaf: WorkspaceLeaf, source: PanelSource) {
    super(leaf);
    this.source = source;
  }

  getViewType(): string {
    return ID_PANEL_VIEW;
  }

  getDisplayText(): string {
    return "ID panel";
  }

  getIcon(): string {
    return "hash";
  }

  async onOpen(): Promise<void> {
    this.registerEvent(this.app.workspace.on("file-open", () => this.render()));
    this.registerEvent(this.app.vault.on("rename", () => this.render()));
    this.registerEvent(this.app.vault.on("create", () => this.render()));
    this.registerEvent(this.app.vault.on("delete", () => this.render()));
    this.render();
    return Promise.resolve();
  }

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("jdex-panel");
    const file = this.app.workspace.getActiveFile();
    const settings = this.source.settings();
    if (!file || settings.jdexFolder === "") {
      root.createEl("p", { text: "Open a file inside an ID.", cls: "jdex-panel-muted" });
      return;
    }
    const index = this.source.index();
    const loc = locate(index, settings, file.path);
    if (!loc) {
      root.createEl("p", { text: "The active file is not inside an ID.", cls: "jdex-panel-muted" });
      return;
    }
    const entry = loc.entry;
    root.createDiv({ text: loc.text, cls: "jdex-panel-path" });
    const description = entry.notePath ? this.description(entry.notePath) : null;
    if (description) root.createEl("p", { text: description });

    const links = root.createDiv({ cls: "jdex-panel-links" });
    this.link(links, entry.notePath ? "JDex note" : "No JDex note", entry.notePath ? () => void openEntry(this.app, entry, false) : null);
    this.link(links, entry.folderPath ? "Folder" : "No folder", entry.folderPath ? () => void openEntry(this.app, entry, true) : null);

    if (entry.folderPath) {
      const folder = this.app.vault.getAbstractFileByPath(entry.folderPath);
      if (folder instanceof TFolder) this.section(root, "Files", this.fileRows(folder));
    }
    const plus = childrenPlus(index, entry.id);
    if (plus.length > 0) this.section(root, "Children (+)", plus.map((c) => this.entryRow(c)));
    const siblings = this.siblings(index, entry);
    if (siblings.entries.length > 0) this.section(root, siblings.title, siblings.entries.map((s) => this.entryRow(s, s.id === entry.id)));
  }

  private description(notePath: string): string | null {
    const f = this.app.vault.getAbstractFileByPath(notePath);
    if (!(f instanceof TFile)) return null;
    const d: unknown = this.app.metadataCache.getFileCache(f)?.frontmatter?.descripcion;
    return typeof d === "string" && d.trim() !== "" ? d.trim() : null;
  }

  private link(parent: HTMLElement, text: string, onClick: (() => void) | null): void {
    const el = parent.createEl(onClick ? "a" : "span", { text, cls: onClick ? "jdex-panel-link" : "jdex-panel-muted" });
    if (onClick) el.addEventListener("click", onClick);
  }

  private section(parent: HTMLElement, title: string, rows: HTMLElement[]): void {
    parent.createEl("h6", { text: title });
    const list = parent.createEl("ul", { cls: "jdex-panel-list" });
    for (const row of rows) list.appendChild(row);
  }

  private fileRows(folder: TFolder): HTMLElement[] {
    const children = [...folder.children].sort((a, b) => a.name.localeCompare(b.name));
    return children.map((child) => {
      const li = createEl("li");
      if (child instanceof TFile) {
        const a = li.createEl("a", { text: child.name, cls: "jdex-panel-link" });
        a.addEventListener("click", () => void this.app.workspace.getLeaf(false).openFile(child));
        li.createSpan({ text: ` · ${formatDate(new Date(child.stat.mtime), "YYYY-MM-DD")}`, cls: "jdex-panel-muted" });
      } else {
        li.createSpan({ text: `${child.name}/`, cls: "jdex-panel-muted" });
      }
      return li;
    });
  }

  private entryRow(entry: IdEntry, current = false): HTMLElement {
    const li = createEl("li");
    if (current) li.addClass("jdex-panel-current");
    if (entry.notePath) {
      const a = li.createEl("a", { text: entry.label, cls: "jdex-panel-link" });
      a.addEventListener("click", () => void openEntry(this.app, entry, false));
    } else li.createSpan({ text: entry.label });
    return li;
  }

  private siblings(index: JdIndex, entry: IdEntry): { title: string; entries: IdEntry[] } {
    const last = Number(entry.id.split(".")[1]);
    const tens = Math.floor(last / 10) * 10;
    if (tens === 0 || entry.id.endsWith("+")) return { title: "", entries: [] };
    const headerId = `${entry.category}.${tens}`;
    const header = index.ids.find((e) => e.id === headerId);
    const entries = childrenOf(index, headerId);
    if (entries.length <= 1 && !header) return { title: "", entries: [] };
    return { title: header ? `Under ${header.label}` : `${headerId.slice(0, -1)}1 to ${headerId.slice(0, -1)}9`, entries };
  }
}

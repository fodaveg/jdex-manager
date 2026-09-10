import { type App, Modal, Notice, Setting, TFile } from "obsidian";
import { categoryOfPath, type DateFormat, zeroOf } from "../jd/files";
import type { JdIndex } from "../jd/index";
import { confirm } from "./confirm";
import { IdSuggestModal } from "./go-to-id";
import { moveInto } from "../vault/files";

export interface InboxContext {
  index: JdIndex;
  systemRoot: string;
  dateFormat: DateFormat;
}

/** Walks the inbox files one by one: move to an ID, archive, skip or delete. */
export class ProcessInboxModal extends Modal {
  private readonly queue: TFile[];
  private readonly ctx: InboxContext;
  private readonly onDone: () => Promise<void>;
  private moved = 0;

  constructor(app: App, files: TFile[], ctx: InboxContext, onDone: () => Promise<void>) {
    super(app);
    this.queue = [...files];
    this.ctx = ctx;
    this.onDone = onDone;
  }

  onOpen(): void {
    void this.render();
  }

  onClose(): void {
    void this.onDone();
  }

  private async render(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    const file = this.queue[0];
    if (!file) {
      this.setTitle("Inbox");
      contentEl.createEl("p", { text: `Nothing left. ${this.moved} file(s) moved or archived in this pass.` });
      new Setting(contentEl).addButton((b) => b.setButtonText("Close").setCta().onClick(() => this.close()));
      return;
    }
    this.setTitle(`Inbox · ${this.queue.length} left`);
    contentEl.createEl("h3", { text: file.name });
    contentEl.createDiv({ text: `${file.parent?.path ?? ""} · ${formatSize(file.stat.size)}`, cls: "jdex-suggestion-note" });
    if (file.extension === "md") {
      const text = await this.app.vault.cachedRead(file);
      contentEl.createEl("pre", { text: text.slice(0, 600) + (text.length > 600 ? "…" : ""), cls: "jdex-preview" });
    }
    const category = categoryOfPath(this.ctx.systemRoot, file.path);
    const archive = category ? zeroOf(this.ctx.index, category, "09") : undefined;

    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText("Move to ID")
          .setCta()
          .onClick(() => {
            new IdSuggestModal(
              this.app,
              this.ctx.index,
              (entry) => {
                if (!entry.folderPath) {
                  new Notice(`${entry.label} has no folder. Create it first.`);
                  return;
                }
                void this.act(() => moveInto(this.app, file, entry.folderPath!));
              },
              "Move to which ID?",
            ).open();
          }),
      )
      .addButton((b) =>
        b
          .setButtonText(archive?.folderPath ? `Archive to ${archive.id}` : "Archive")
          .setDisabled(!archive?.folderPath)
          .onClick(() => void this.act(() => moveInto(this.app, file, archive!.folderPath!, { when: new Date(file.stat.ctime), format: this.ctx.dateFormat }))),
      )
      .addButton((b) =>
        b.setButtonText("Skip").onClick(() => {
          this.queue.shift();
          void this.render();
        }),
      )
      .addButton((b) =>
        b.setButtonText("Delete").onClick(async () => {
          const ok = await confirm(this.app, "Delete this file?", [file.path, "It goes to the trash, following your Obsidian deletion setting."], "Delete");
          if (!ok) return;
          await this.act(async () => {
            await this.app.fileManager.trashFile(file);
            return "";
          }, false);
        }),
      );
    if (file.extension === "md") {
      new Setting(contentEl).addButton((b) =>
        b.setButtonText("Open").onClick(() => {
          void this.app.workspace.getLeaf(false).openFile(file);
          this.close();
        }),
      );
    }
  }

  private async act(fn: () => Promise<string>, counts = true): Promise<void> {
    try {
      await fn();
      if (counts) this.moved += 1;
      this.queue.shift();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
    await this.render();
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

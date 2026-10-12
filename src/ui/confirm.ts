import { type App, Modal, Setting } from "obsidian";
import { trackModal } from "./modal-registry";
import { t } from "./i18n";

/** Yes/no dialog with a title, a body and two buttons. Resolves true when confirmed. */
export function confirm(app: App, title: string, lines: string[], okText = t().confirm): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new (class extends Modal {
      private answered = false;
      onOpen(): void {
        trackModal(this);
        this.setTitle(title);
        for (const line of lines) this.contentEl.createEl("p", { text: line });
        new Setting(this.contentEl)
          .addButton((b) =>
            b.setButtonText(t().cancel).onClick(() => {
              this.answered = true;
              resolve(false);
              this.close();
            }),
          )
          .addButton((b) =>
            b
              .setButtonText(okText)
              .setCta()
              .onClick(() => {
                this.answered = true;
                resolve(true);
                this.close();
              }),
          );
      }
      onClose(): void {
        if (!this.answered) resolve(false);
      }
    })(app);
    modal.open();
  });
}

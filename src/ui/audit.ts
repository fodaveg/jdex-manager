import { type App, Modal, Notice, Setting } from "obsidian";
import type { Finding, Fix } from "../jd/audit";
import type { Effect } from "../jd/journal";
import { applyFix } from "../vault/audit";

function describeFix(fix: Exclude<Fix, { type: "frontmatter" }>): string {
  if (fix.type === "rename") return `${fix.from} → ${fix.to}`;
  return `Crear ${fix.paths.map((p) => p.slice(p.lastIndexOf("/") + 1)).join(", ")}`;
}

/** Offers audit fixes, selecting only mechanical frontmatter fields by default. */
export class FixFindingsModal extends Modal {
  private readonly findings: Finding[];
  private readonly onDone: () => Promise<void>;
  private readonly selected = new Set<number>();
  /** What the applied fixes did, for the undo journal; the caller reads it in `onDone`. */
  readonly effects: Effect[] = [];

  constructor(app: App, findings: Finding[], onDone: () => Promise<void>) {
    super(app);
    this.findings = findings.filter((f) => f.fix);
    this.findings.forEach((finding, i) => {
      if (finding.kind === "frontmatter-mismatch" && finding.fix?.type === "frontmatter" &&
        Object.keys(finding.fix.set).every((key) => ["jd", "tipo", "area", "categoria"].includes(key))) this.selected.add(i);
    });
    this.onDone = onDone;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle("Arreglos de auditoría");

    if (this.findings.length === 0) {
      contentEl.createEl("p", { text: "La auditoría actual no tiene hallazgos con arreglo disponible." });
      return;
    }

    contentEl.createEl("p", {
      text: `${this.findings.length} hallazgo(s) con arreglo disponible. Solo los campos jd, tipo, area y categoria están marcados por defecto; revisa los demás antes de seleccionarlos.`,
    });

    this.findings.forEach((finding, i) => {
      const fix = finding.fix!;
      new Setting(contentEl)
        .setName(finding.message)
        .setDesc(fix.type === "frontmatter" ? fix.path : describeFix(fix))
        .addToggle((toggle) =>
          toggle.setValue(this.selected.has(i)).onChange((value) => {
            if (value) this.selected.add(i);
            else this.selected.delete(i);
          }),
        );
    });

    new Setting(contentEl).addButton((button) =>
      button
        .setButtonText("Aplicar")
        .setCta()
        .onClick(() => void this.apply()),
    );
  }

  private async apply(): Promise<void> {
    let ok = 0;
    let failed = 0;
    for (const i of [...this.selected].sort((a, b) => a - b)) {
      try {
        await applyFix(this.app, this.findings[i].fix!, this.effects);
        ok += 1;
      } catch (error) {
        failed += 1;
        new Notice(error instanceof Error ? error.message : String(error));
      }
    }
    this.close();
    new Notice(`Arreglos procesados: ${ok}; fallidos: ${failed}.`);
    await this.onDone();
  }
}

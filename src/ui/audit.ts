import { type App, Modal, Notice, Setting } from "obsidian";
import type { Finding, Fix } from "../jd/audit";
import { applyFix } from "../vault/audit";

function describeFix(fix: Fix): string {
  if (fix.type === "rename") return `${fix.from} → ${fix.to}`;
  if (fix.type === "folders") return `create ${fix.paths.map((p) => p.slice(p.lastIndexOf("/") + 1)).join(", ")}`;
  return Object.entries(fix.set)
    .map(([k, v]) => `${k}: "${v}"`)
    .join(", ");
}

/** Lists the findings that carry a mechanical fix and applies the ticked ones. */
export class FixFindingsModal extends Modal {
  private readonly findings: Finding[];
  private readonly onDone: () => Promise<void>;
  private readonly selected = new Set<number>();

  constructor(app: App, findings: Finding[], onDone: () => Promise<void>) {
    super(app);
    this.findings = findings.filter((f) => f.fix);
    this.findings.forEach((_, i) => this.selected.add(i));
    this.onDone = onDone;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle("Mechanical fixes");

    if (this.findings.length === 0) {
      contentEl.createEl("p", { text: "The last audit has no finding with a mechanical fix." });
      return;
    }

    contentEl.createEl("p", {
      text: `${this.findings.length} finding(s) can be fixed without judgement. Untick the ones to keep.`,
    });

    this.findings.forEach((finding, i) => {
      const fix = finding.fix!;
      new Setting(contentEl)
        .setName(finding.paths[0])
        .setDesc(describeFix(fix))
        .addToggle((toggle) =>
          toggle.setValue(true).onChange((value) => {
            if (value) this.selected.add(i);
            else this.selected.delete(i);
          }),
        );
    });

    new Setting(contentEl).addButton((button) =>
      button
        .setButtonText("Apply")
        .setCta()
        .onClick(() => void this.apply()),
    );
  }

  private async apply(): Promise<void> {
    let ok = 0;
    let failed = 0;
    for (const i of [...this.selected].sort((a, b) => a - b)) {
      try {
        await applyFix(this.app, this.findings[i].fix!);
        ok += 1;
      } catch (error) {
        failed += 1;
        new Notice(error instanceof Error ? error.message : String(error));
      }
    }
    this.close();
    new Notice(`Fixes applied: ${ok}; failed: ${failed}.`);
    await this.onDone();
  }
}

import { type App, Modal, Notice, Setting } from "obsidian";
import { FINDING_KINDS, type Finding, type Fix } from "../jd/audit";
import { t } from "./i18n";
import { trackModal } from "./modal-registry";
import type { JdexManagerSettings } from "../settings";
import type { Effect } from "../jd/journal";
import { applyFix } from "../vault/audit";

/** Creation first, then naming and metadata, moves, and finally trash. */
function fixOrder(fix: Fix): number {
  if (["create-note", "create-folder", "folders"].includes(fix.type)) return 0;
  if (["rename", "frontmatter"].includes(fix.type)) return 1;
  if (fix.type === "move") return 2;
  return 3;
}

/** What a non-frontmatter fix will do, in the interface language (the report keeps `describeFix`). */
function fixSummary(fix: Exclude<Fix, { type: "frontmatter" }>): string {
  if (fix.type === "rename") return `${fix.from} → ${fix.to}`;
  if (fix.type === "move") return fix.items.map(({ from, to }) => `${from} → ${to}`).join("; ");
  if (fix.type === "trash") return t().fixTrash(fix.path);
  if (fix.type === "create-note" || fix.type === "create-folder") return t().fixCreate(fix.path);
  return t().fixCreate(fix.paths.map((p) => p.slice(p.lastIndexOf("/") + 1)).join(", "));
}

/** Offers audit fixes, selecting only mechanical frontmatter fields by default. */
export class FixFindingsModal extends Modal {
  private readonly findings: Finding[];
  private readonly onDone: () => Promise<void>;
  private readonly refreshFindings?: () => Promise<Finding[]>;
  private readonly settings?: JdexManagerSettings;
  private readonly selected = new Set<number>();
  /**
   * What the applied fixes did, for the undo journal. The caller may replace it with a recording
   * list (`JdexManagerPlugin.journalOperation`) so each effect is saved as soon as it happens.
   */
  effects: Effect[] = [];

  constructor(app: App, findings: Finding[], onDone: () => Promise<void>, refreshFindings?: () => Promise<Finding[]>, settings?: JdexManagerSettings) {
    super(app);
    this.findings = findings.filter((f) => f.fix);
    this.findings.forEach((finding, i) => {
      if (finding.kind === "frontmatter-mismatch" && finding.fix?.type === "frontmatter" &&
        Object.keys(finding.fix.set).every((key) => ["jd", "tipo", "area", "categoria"].includes(key))) this.selected.add(i);
    });
    this.onDone = onDone;
    this.refreshFindings = refreshFindings;
    this.settings = settings;
  }

  onOpen(): void {
    trackModal(this);
    const { contentEl } = this;
    contentEl.empty();
    const s = t();
    this.setTitle(s.cmdRepair);

    if (this.findings.length === 0) {
      contentEl.createEl("p", { text: s.repairNone });
      return;
    }

    contentEl.createEl("p", {
      text: s.repairIntro(this.findings.length),
    });
    const selectionSummary = contentEl.createEl("p");
    let updateSelection: (() => void) | undefined;

    for (const kind of FINDING_KINDS) {
      const indices = this.findings.flatMap((finding, i) => finding.kind === kind ? [i] : []);
      if (indices.length === 0) continue;
      contentEl.createEl("h3", { text: `${s.kindTitles[kind]} (${indices.length})` });
      for (const i of indices) {
        const finding = this.findings[i];
        const fix = finding.fix!;
        new Setting(contentEl)
        .setName(finding.message)
        .setDesc(fix.type === "frontmatter" ? fix.path : fixSummary(fix))
        .addToggle((toggle) =>
          toggle.setValue(this.selected.has(i)).onChange((value) => {
            if (value) this.selected.add(i);
            else this.selected.delete(i);
            updateSelection?.();
          }),
        );
      }
    }

    new Setting(contentEl).addButton((button) => {
      updateSelection = () => {
        button.setButtonText(s.repairApply(this.selected.size)).setDisabled(this.selected.size === 0);
        selectionSummary.textContent = this.selected.size === 0
          ? s.repairSelect
          : s.repairSelected(this.selected.size);
      };
      updateSelection();
      button
        .setCta()
        .onClick(() => void this.apply());
    });
  }

  private async apply(): Promise<void> {
    if (this.selected.size === 0) {
      new Notice(t().repairSelect);
      return;
    }
    let ok = 0;
    let failed = 0;
    for (const i of [...this.selected].sort((a, b) => fixOrder(this.findings[a].fix!) - fixOrder(this.findings[b].fix!) || a - b)) {
      try {
        const finding = this.findings[i];
        if (this.refreshFindings) {
          const current = await this.refreshFindings();
          if (!current.some((candidate) => candidate.kind === finding.kind && JSON.stringify(candidate.fix) === JSON.stringify(finding.fix))) {
            throw new Error(t().repairChanged(finding.paths[0]));
          }
        }
        const before = this.effects.length;
        await applyFix(this.app, finding.fix!, this.effects, this.settings);
        if (this.effects.length > before) ok += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        new Notice(error instanceof Error ? error.message : String(error));
      }
    }
    this.close();
    new Notice(t().repairDone(ok, failed));
    await this.onDone();
  }
}

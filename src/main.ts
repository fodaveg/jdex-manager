import { type App, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import { type JdexManagerSettings, type JdexNoteType, mergeSettings } from "./settings";
import { countProblems, type Finding } from "./jd/audit";
import { FixFindingsModal } from "./ui/audit";
import { CategorySuggestModal, CreateIdModal, createId } from "./ui/create-id";
import { runAudit } from "./vault/audit";
import { applyDetection } from "./vault/detect";
import { scanVault } from "./vault/scan";
import { writeBuiltinTemplates } from "./vault/templates";

export default class JdexManagerPlugin extends Plugin {
  settings: JdexManagerSettings = mergeSettings(null);
  /** Findings of the last audit run in this session. */
  lastFindings: Finding[] | null = null;
  private statusBar: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new JdexManagerSettingTab(this.app, this));

    // The status bar does not exist on mobile; addStatusBarItem is a no-op there.
    this.statusBar = this.addStatusBarItem();
    this.statusBar.addClass("mod-clickable");
    // eslint-disable-next-line obsidianmd/ui/sentence-case
    this.statusBar.setText("JD: not audited");
    this.registerDomEvent(this.statusBar, "click", () => void this.audit());

    // Folders are only known once the vault has loaded; detect then, and only into empty fields.
    this.app.workspace.onLayoutReady(() => {
      void (async () => {
        await this.detectFolders(false);
        if (this.settings.auditOnStartup) await this.audit(false);
      })();
    });

    this.addCommand({
      id: "audit",
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      name: "Audit JD system",
      callback: () => void this.audit(),
    });

    this.addCommand({
      id: "apply-fixes",
      name: "Apply mechanical fixes from last audit",
      callback: () => void this.applyFixes(),
    });

    this.addRibbonIcon("file-plus-2", "Create ID", () => void this.createIdFlow());

    this.addCommand({
      id: "create-id",
      name: "Create ID",
      callback: () => void this.createIdFlow(),
    });

    this.addCommand({
      id: "detect-folders",
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      name: "Detect JDex folders",
      callback: () => void this.detectFolders(true),
    });

    this.addCommand({
      id: "create-templates",
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      name: "Create JDex templates in the templates folder",
      callback: () => void this.createTemplates(),
    });
  }

  async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<JdexManagerSettings> | null;
    this.settings = mergeSettings(stored);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Fills empty folder settings from the vault. `announce` shows a Notice with the outcome. */
  async detectFolders(announce: boolean): Promise<void> {
    const { detected, changed } = applyDetection(this.app, this.settings);
    if (changed) await this.saveSettings();
    if (!announce) return;
    const found = [detected.jdex, detected.reports, detected.templates].filter(Boolean).length;
    if (found === 0) new Notice("No 00.00, 00.02 or 00.03 folders found under 00-09/00. Check the system root.");
    else if (changed) new Notice(`Detected ${found} folder(s); empty settings filled.`);
    else new Notice(`Detected ${found} folder(s); settings already set, nothing changed.`);
  }

  /** Runs the audit, writes the report, updates the status bar and opens the report when asked. */
  async audit(openReport = true): Promise<void> {
    if (this.settings.jdexFolder === "") await this.detectFolders(false);
    if (this.settings.jdexFolder === "") {
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      new Notice("Set the JDex folder in the plugin settings first.");
      return;
    }
    try {
      const { findings, reportPath } = await runAudit(this.app, this.settings);
      this.lastFindings = findings;
      const problems = countProblems(findings);
      this.statusBar?.setText(`JD: ${problems} finding${problems === 1 ? "" : "s"}`);
      new Notice(`Audit: ${problems} finding${problems === 1 ? "" : "s"}.`);
      if (openReport && reportPath) {
        const file = this.app.vault.getAbstractFileByPath(reportPath);
        if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
      }
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  async applyFixes(): Promise<void> {
    if (!this.lastFindings) {
      await this.audit(false);
      if (!this.lastFindings) return;
    }
    new FixFindingsModal(this.app, this.lastFindings, () => this.audit(false)).open();
  }

  async createTemplates(): Promise<void> {
    if (this.settings.templatesFolder === "") {
      new Notice("Set the templates folder first (00.03 by convention).");
      return;
    }
    const { created, skipped } = await writeBuiltinTemplates(this.app, this.settings);
    new Notice(`Templates: ${created} created, ${skipped} already existed.`);
  }

  async createIdFlow(): Promise<void> {
    if (this.settings.jdexFolder === "") {
      await this.detectFolders(false);
    }
    if (this.settings.jdexFolder === "") {
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      new Notice("Set the JDex folder in the plugin settings first.");
      return;
    }
    const index = scanVault(this.app, this.settings);
    if (index.categories.length === 0) {
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      new Notice("No categories found. Check the system root and the JDex folder.");
      return;
    }
    new CategorySuggestModal(this.app, index, (category) => {
      new CreateIdModal(this.app, index, category, this.settings, async (request) => {
        await this.saveSettings();
        try {
          const note = await createId(this.app, this.settings, index, category, request);
          new Notice(`Created ${note.basename}.`);
          await this.app.workspace.getLeaf(false).openFile(note);
        } catch (error) {
          new Notice(error instanceof Error ? error.message : String(error));
        }
      }).open();
    }).open();
  }
}

class JdexManagerSettingTab extends PluginSettingTab {
  private readonly plugin: JdexManagerPlugin;

  constructor(app: App, plugin: JdexManagerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // `getSettingDefinitions` arrived in Obsidian 1.13; this plugin supports 1.4.16, so it renders the tab itself.
  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.folderSetting(
      "JDex folder",
      "Folder that holds one note per ID (00.00 by convention).",
      () => this.plugin.settings.jdexFolder,
      (v) => (this.plugin.settings.jdexFolder = v),
    );
    this.folderSetting(
      "System root",
      "Folder that holds the area folders. Leave empty for the vault root.",
      () => this.plugin.settings.systemRoot,
      (v) => (this.plugin.settings.systemRoot = v),
      "Empty = vault root",
    );
    this.folderSetting(
      "Templates folder",
      "Folder that holds the note templates (00.03 by convention).",
      () => this.plugin.settings.templatesFolder,
      (v) => (this.plugin.settings.templatesFolder = v),
    );
    this.folderSetting(
      "Reports folder",
      "Folder where audit reports are written (00.02 by convention).",
      () => this.plugin.settings.reportsFolder,
      (v) => (this.plugin.settings.reportsFolder = v),
    );

    new Setting(containerEl)
      .setName("Detect folders")
      .setDesc("Looks for 00.00, 00.02 and 00.03 under 00-09/00 and fills the empty fields above.")
      .addButton((button) =>
        button.setButtonText("Detect").onClick(async () => {
          await this.plugin.detectFolders(true);
          // Re-render so the filled fields show up (see the note on `display` above).
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          this.display();
        }),
      );

    new Setting(containerEl).setName("Templates").setHeading();

    const labels: Record<JdexNoteType, string> = {
      id: "Template for IDs",
      cabecera: "Template for headers",
      categoria: "Template for categories",
      area: "Template for areas",
    };
    for (const type of Object.keys(labels) as JdexNoteType[]) {
      new Setting(containerEl)
        .setName(labels[type])
        .setDesc("Note name inside the templates folder. The built-in template is used when the note is missing.")
        .addText((text) =>
          text.setValue(this.plugin.settings.templateNames[type]).onChange(async (value) => {
            this.plugin.settings.templateNames[type] = value.trim();
            await this.plugin.saveSettings();
          }),
        );
    }

    new Setting(containerEl)
      .setName("Write built-in templates")
      .setDesc("Creates the four built-in templates in the templates folder so you can edit them. Existing notes are kept.")
      .addButton((button) => button.setButtonText("Write").onClick(() => void this.plugin.createTemplates()));

    new Setting(containerEl).setName("Audit").setHeading();

    new Setting(containerEl)
      .setName("Audit on startup")
      .setDesc("Runs the audit when the vault has loaded and writes the report without opening it.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.auditOnStartup).onChange(async (value) => {
          this.plugin.settings.auditOnStartup = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Notes without a folder count as findings")
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setDesc("Off by default: a JDex note without a system folder is listed for information only.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.noteWithoutFolderIsFinding).onChange(async (value) => {
          this.plugin.settings.noteWithoutFolderIsFinding = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName("Create ID").setHeading();

    new Setting(containerEl)
      .setName("Create the folder by default")
      .setDesc("Initial state of the checkbox in the dialog that creates an ID. The dialog remembers your last choice.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.createFolderByDefault).onChange(async (value) => {
          this.plugin.settings.createFolderByDefault = value;
          await this.plugin.saveSettings();
        }),
      );
  }

  private folderSetting(
    name: string,
    desc: string,
    get: () => string,
    set: (value: string) => void,
    placeholder = "Path inside the vault",
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) =>
        text
          .setPlaceholder(placeholder)
          .setValue(get())
          .onChange(async (value) => {
            set(value.trim().replace(/^\/+|\/+$/g, ""));
            await this.plugin.saveSettings();
          }),
      );
  }
}

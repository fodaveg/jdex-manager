import { type App, Notice, Plugin, PluginSettingTab, Setting, type TAbstractFile, TFile, TFolder } from "obsidian";
import { type JdexManagerSettings, type JdexNoteType, mergeSettings } from "./settings";
import { auditSystem, countProblems, type Finding } from "./jd/audit";
import { relativeTo } from "./jd/detect";
import type { IdEntry } from "./jd/index";
import { pairAction } from "./jd/pair";
import { extractJdPrefix } from "./jd/parse";
import { FixFindingsModal } from "./ui/audit";
import { CategorySuggestModal, CreateIdModal, createId } from "./ui/create-id";
import { AreaSuggestModal, CreateAreaModal, CreateCategoryModal, CreateChildModal, CreateHeaderModal } from "./ui/create-structure";
import { IdSuggestModal, openEntry } from "./ui/go-to-id";
import { ProcessInboxModal } from "./ui/inbox";
import { categoryOfPath, isDatable, locate, zeroOf } from "./jd/files";
import { dateFile, inboxFiles, moveInto } from "./vault/files";
import { applyFix, jdexNoteMetas, runAudit } from "./vault/audit";
import { confirm } from "./ui/confirm";
import { headersToMigrate, updateHeaders } from "./vault/headers";
import { applyDetection } from "./vault/detect";
import { scanVault } from "./vault/scan";
import { writeBuiltinTemplates } from "./vault/templates";

export default class JdexManagerPlugin extends Plugin {
  settings: JdexManagerSettings = mergeSettings(null);
  /** Findings of the last audit run in this session. */
  lastFindings: Finding[] | null = null;
  private statusBar: HTMLElement | null = null;
  private inboxBar: HTMLElement | null = null;
  private whereBar: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new JdexManagerSettingTab(this.app, this));

    // The status bar does not exist on mobile; addStatusBarItem is a no-op there.
    this.statusBar = this.addStatusBarItem();
    this.statusBar.addClass("mod-clickable");
    // eslint-disable-next-line obsidianmd/ui/sentence-case
    this.statusBar.setText("JD: not audited");
    this.registerDomEvent(this.statusBar, "click", () => void this.audit());
    this.inboxBar = this.addStatusBarItem();
    this.inboxBar.addClass("mod-clickable");
    this.registerDomEvent(this.inboxBar, "click", () => void this.processInbox());
    this.whereBar = this.addStatusBarItem();
    this.whereBar.addClass("mod-clickable");
    this.registerDomEvent(this.whereBar, "click", () => void this.toggleNoteAndFolder());
    this.registerEvent(this.app.workspace.on("file-open", () => this.refreshWhere()));

    // Folders are only known once the vault has loaded; detect then, and only into empty fields.
    this.app.workspace.onLayoutReady(() => {
      void (async () => {
        await this.detectFolders(false);
        this.refreshInboxCount();
        this.refreshWhere();
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

    this.addCommand({
      id: "normalize-frontmatter-active",
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      name: "Normalize JDex frontmatter of the active note",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || this.settings.jdexFolder === "") return false;
        const rel = relativeTo(this.settings.jdexFolder, file.path);
        if (rel === null || rel === "" || rel.includes("/")) return false;
        if (!checking) void this.normalizeFrontmatter(file);
        return true;
      },
    });

    this.addCommand({
      id: "normalize-frontmatter-all",
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      name: "Normalize JDex frontmatter of every note",
      callback: () => void this.normalizeFrontmatter(null),
    });

    this.addCommand({
      id: "update-headers",
      name: "Update header lists",
      callback: () => void this.refreshHeaders(undefined, true),
    });

    this.addCommand({
      id: "wrap-header-lists",
      name: "Wrap existing header lists in markers",
      callback: () => void this.migrateHeaders(),
    });

    this.addCommand({ id: "create-category", name: "Create category", callback: () => void this.createCategoryFlow() });
    this.addCommand({ id: "create-area", name: "Create area", callback: () => void this.createAreaFlow() });
    this.addCommand({ id: "create-header", name: "Create header", callback: () => void this.createHeaderFlow() });
    this.addCommand({
      id: "create-child",
      name: "Create child ID (+) of the active note",
      checkCallback: (checking) => {
        const entry = this.activeIdEntry();
        if (!entry) return false;
        if (!checking) void this.createChildFlow(entry);
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        const entry = this.entryFor(file);
        if (!entry) return;
        menu.addItem((item) =>
          item
            .setTitle(`Create child ID (${entry.id}+)`)
            .setIcon("git-branch-plus")
            .onClick(() => void this.createChildFlow(entry)),
        );
      }),
    );

    this.addCommand({
      id: "send-to-inbox",
      name: "Send active file to its inbox (.01)",
      checkCallback: (checking) => this.fileCommand(checking, (file) => this.sendToZero(file, "01")),
    });
    this.addCommand({
      id: "archive",
      name: "Archive active file (.09, dated)",
      checkCallback: (checking) => this.fileCommand(checking, (file) => this.sendToZero(file, "09")),
    });
    this.addCommand({
      id: "date-file",
      name: "Date file name with its creation date",
      checkCallback: (checking) => this.fileCommand(checking, (file) => this.dateActive(file)),
    });
    this.addCommand({ id: "process-inbox", name: "Process inboxes", callback: () => void this.processInbox() });
    this.addCommand({
      id: "where-am-i",
      name: "Show where the active file lives",
      checkCallback: (checking) =>
        this.fileCommand(checking, async (file) => {
          const loc = locate(scanVault(this.app, this.settings), this.settings, file.path);
          new Notice(loc ? loc.text : "The active file is not inside an ID.");
        }),
    });
    this.addCommand({
      id: "toggle-note-folder",
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      name: "Toggle between JDex note and folder",
      checkCallback: (checking) => this.fileCommand(checking, () => this.toggleNoteAndFolder()),
    });
    this.addCommand({
      id: "go-to-id",
      name: "Go to ID",
      callback: () => {
        if (!this.ready()) return;
        const index = scanVault(this.app, this.settings);
        new IdSuggestModal(this.app, index, (entry, openFolder) => {
          void openEntry(this.app, entry, openFolder).then((msg) => msg && new Notice(msg));
        }).open();
      },
    });

    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => void this.onRename(file, oldPath)));
    this.registerEvent(this.app.vault.on("delete", () => this.refreshInboxCount()));
    this.registerEvent(this.app.vault.on("create", (file) => void this.onCreate(file)));

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

  /** Frontmatter fixes for one note or for the whole JDex, with the checklist modal as preview. */
  async normalizeFrontmatter(only: TFile | null): Promise<void> {
    if (this.settings.jdexFolder === "") {
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      new Notice("Set the JDex folder in the plugin settings first.");
      return;
    }
    const index = scanVault(this.app, this.settings);
    const notes = jdexNoteMetas(this.app, this.settings).filter((n) => !only || n.path === only.path);
    const findings = auditSystem({ index, notes, filePaths: [] }).filter((f) => f.kind === "frontmatter-mismatch");
    if (findings.length === 0) {
      new Notice(only ? "Frontmatter already matches the name and position." : "Every JDex note already matches.");
      return;
    }
    new FixFindingsModal(this.app, findings, async () => {
      await this.refreshHeaders(undefined, false);
    }).open();
  }

  /** Regenerates header lists; with `announce` it reports how many notes changed. */
  async refreshHeaders(onlyCategory: string | undefined, announce: boolean): Promise<void> {
    if (this.settings.jdexFolder === "") return;
    const index = scanVault(this.app, this.settings);
    const changed = await updateHeaders(this.app, index, onlyCategory);
    if (announce) new Notice(`Header lists updated in ${changed} note(s).`);
  }

  async migrateHeaders(): Promise<void> {
    if (this.settings.jdexFolder === "") return;
    const index = scanVault(this.app, this.settings);
    const todo = await headersToMigrate(this.app, index);
    if (todo.length === 0) {
      new Notice("Every header note already has markers, or has no list to wrap.");
      return;
    }
    const ok = await confirm(
      this.app,
      "Wrap header lists in markers",
      [
        `${todo.length} header note(s) have a list of links without markers. The first list of each will be wrapped in <!-- jdex:hijos --> markers; nothing else changes.`,
        ...todo.slice(0, 12).map((t) => t.file.basename),
        ...(todo.length > 12 ? [`… and ${todo.length - 12} more`] : []),
      ],
      "Wrap",
    );
    if (!ok) return;
    for (const t of todo) await this.app.vault.modify(t.file, t.next);
    new Notice(`Markers added to ${todo.length} note(s).`);
    await this.refreshHeaders(undefined, true);
  }

  private renaming = false;

  /** Rename in pairs, the "never renumber" warning and the moved-category warning. */
  async onRename(file: TAbstractFile, oldPath: string): Promise<void> {
    if (this.renaming || this.settings.jdexFolder === "") return;
    const index = scanVault(this.app, this.settings);
    const action = pairAction({ oldPath, newPath: file.path, isFolder: file instanceof TFolder }, index, this.settings);
    if (action.type === "renumbered") {
      new Notice(`${action.oldId} → ${action.newId}: an ID is never renumbered. Create a new ID and archive the old one instead.`, 10000);
      return;
    }
    if (action.type === "moved") {
      new Notice(`${action.id} moved from ${action.from} to ${action.to}. An ID keeps its number; create a new ID in the destination and archive this one.`, 10000);
      return;
    }
    if (action.type === "rename-partner") {
      const isNote = action.partnerPath.endsWith(".md");
      const ok =
        this.settings.renamePairsWithoutAsking ||
        (await confirm(
          this.app,
          isNote ? "Rename the JDex note too?" : "Rename the folder too?",
          [`${action.partnerPath}`, `→ ${action.newPartnerPath}`],
          "Rename",
        ));
      if (ok) {
        this.renaming = true;
        try {
          await applyFix(this.app, { type: "rename", from: action.partnerPath, to: action.newPartnerPath });
        } catch (error) {
          new Notice(error instanceof Error ? error.message : String(error));
        } finally {
          this.renaming = false;
        }
      }
    }
    if (this.settings.liveHeaders) {
      const parsed = extractJdPrefix(file.name);
      if (parsed?.number.kind === "id") await this.refreshHeaders(parsed.number.category, false);
    }
    this.refreshInboxCount();
  }

  private fileCommand(checking: boolean, run: (file: TFile) => Promise<void>): boolean {
    const file = this.app.workspace.getActiveFile();
    if (!file || this.settings.jdexFolder === "") return false;
    if (!checking) void run(file);
    return true;
  }

  /** Moves the file to the `.01` or `.09` of its category (00 when it lives outside the system). */
  async sendToZero(file: TFile, zero: "01" | "09"): Promise<void> {
    const index = scanVault(this.app, this.settings);
    let category = categoryOfPath(this.settings.systemRoot, file.path);
    if (category === null) {
      const pick = await new Promise<string | null>((resolve) => {
        const modal = new CategorySuggestModal(this.app, index, (c) => resolve(c.number));
        modal.onClose = () => resolve(null);
        modal.open();
      });
      if (pick === null) return;
      category = pick;
    }
    const target = zeroOf(index, category, zero);
    if (!target?.folderPath) {
      new Notice(`${category}.${zero} has no folder. Create the category zeros first (Create category, or make the folder by hand).`, 8000);
      return;
    }
    try {
      const to = await moveInto(
        this.app,
        file,
        target.folderPath,
        zero === "09" ? { when: new Date(file.stat.ctime), format: this.settings.dateFormat } : undefined,
      );
      new Notice(`Moved to ${to}.`);
      this.refreshInboxCount();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  async dateActive(file: TFile): Promise<void> {
    const index = scanVault(this.app, this.settings);
    if (!isDatable(index, this.settings, file.path)) {
      new Notice("Only files inside a content ID folder are dated; JDex notes and management files are left alone.");
      return;
    }
    try {
      const to = await dateFile(this.app, file, this.settings.dateFormat);
      new Notice(to ? `Renamed to ${to.slice(to.lastIndexOf("/") + 1)}.` : "Already dated.");
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  async processInbox(): Promise<void> {
    if (!this.ready()) return;
    const index = scanVault(this.app, this.settings);
    const files = inboxFiles(this.app, index);
    if (files.length === 0) {
      new Notice("Every inbox is empty.");
      this.refreshInboxCount();
      return;
    }
    new ProcessInboxModal(this.app, files, { index, systemRoot: this.settings.systemRoot, dateFormat: this.settings.dateFormat }, async () => {
      this.refreshInboxCount();
    }).open();
  }

  refreshWhere(): void {
    if (!this.whereBar) return;
    const file = this.app.workspace.getActiveFile();
    if (!file || this.settings.jdexFolder === "") {
      this.whereBar.setText("");
      return;
    }
    const loc = locate(scanVault(this.app, this.settings), this.settings, file.path);
    this.whereBar.setText(loc ? loc.text : "");
  }

  /** From the JDex note, opens the first note of the ID folder; from inside the folder, opens the JDex note. */
  async toggleNoteAndFolder(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || !this.ready()) return;
    const loc = locate(scanVault(this.app, this.settings), this.settings, file.path);
    if (!loc) {
      new Notice("The active file is not inside an ID.");
      return;
    }
    const msg = await openEntry(this.app, loc.entry, loc.atNote);
    if (msg) new Notice(msg);
  }

  refreshInboxCount(): void {
    if (!this.inboxBar) return;
    if (this.settings.jdexFolder === "") {
      this.inboxBar.setText("");
      return;
    }
    const n = inboxFiles(this.app, scanVault(this.app, this.settings)).length;
    this.inboxBar.setText(n === 0 ? "Inbox: empty" : `Inbox: ${n}`);
  }

  async onCreate(file: TAbstractFile): Promise<void> {
    // Obsidian fires "create" for every file while the vault loads; only react to files created afterwards.
    if (!this.app.workspace.layoutReady) return;
    if (this.settings.jdexFolder === "" || !(file instanceof TFile)) return;
    this.refreshInboxCount();
    if (this.settings.dateOnCreate) {
      const index = scanVault(this.app, this.settings);
      if (isDatable(index, this.settings, file.path)) {
        try {
          await dateFile(this.app, file, this.settings.dateFormat);
        } catch {
          // A clash on the dated name is not worth a notice at creation time.
        }
      }
    }
    if (!this.settings.liveHeaders) return;
    const rel = relativeTo(this.settings.jdexFolder, file.path);
    if (rel === null || rel === "" || rel.includes("/")) return;
    const parsed = extractJdPrefix(file.basename);
    if (parsed?.number.kind === "id") await this.refreshHeaders(parsed.number.category, false);
  }

  /** Index entry of the ID a file or folder IS: a JDex ID note or an ID folder (not a `+` child). */
  entryFor(file: TAbstractFile | null): IdEntry | null {
    if (!file || this.settings.jdexFolder === "") return null;
    const parsed = extractJdPrefix(file.name);
    if (!parsed || parsed.number.kind !== "id" || parsed.number.extension) return null;
    const id = parsed.number.id;
    const index = scanVault(this.app, this.settings);
    const entry = index.ids.find((e) => e.id === id);
    if (!entry) return null;
    const isNote = file instanceof TFile && entry.notePath === file.path;
    const isFolder = file instanceof TFolder && entry.folderPath === file.path;
    return isNote || isFolder ? entry : null;
  }

  activeIdEntry(): IdEntry | null {
    return this.entryFor(this.app.workspace.getActiveFile());
  }

  private ready(): boolean {
    if (this.settings.jdexFolder !== "") return true;
    // eslint-disable-next-line obsidianmd/ui/sentence-case
    new Notice("Set the JDex folder in the plugin settings first.");
    return false;
  }

  async createCategoryFlow(): Promise<void> {
    if (!this.ready()) return;
    const index = scanVault(this.app, this.settings);
    if (index.areas.length === 0) {
      new Notice("No areas found. Create an area first.");
      return;
    }
    new AreaSuggestModal(this.app, index, (area) => {
      new CreateCategoryModal(this.app, index, area, this.settings, () => this.refreshHeaders(undefined, false)).open();
    }).open();
  }

  async createAreaFlow(): Promise<void> {
    if (!this.ready()) return;
    const index = scanVault(this.app, this.settings);
    new CreateAreaModal(this.app, index, this.settings, async () => {}).open();
  }

  async createHeaderFlow(): Promise<void> {
    if (!this.ready()) return;
    const index = scanVault(this.app, this.settings);
    if (index.categories.length === 0) {
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      new Notice("No categories found. Check the system root and the JDex folder.");
      return;
    }
    new CategorySuggestModal(this.app, index, (category) => {
      new CreateHeaderModal(this.app, index, category, this.settings, () => this.refreshHeaders(category.number, false)).open();
    }).open();
  }

  async createChildFlow(parent: { id: string }): Promise<void> {
    if (!this.ready()) return;
    const index = scanVault(this.app, this.settings);
    const entry = index.ids.find((e) => e.id === parent.id);
    if (!entry) return;
    new CreateChildModal(this.app, index, entry, this.settings, async () => {}).open();
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

    new Setting(containerEl).setName("Coherence").setHeading();

    new Setting(containerEl)
      .setName("Rename pairs without asking")
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setDesc("When a JDex note or an ID folder is renamed, rename its partner at once instead of showing a confirmation.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.renamePairsWithoutAsking).onChange(async (value) => {
          this.plugin.settings.renamePairsWithoutAsking = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Live header lists")
      .setDesc("Regenerate the children list between the jdex:hijos markers of header notes when an ID is created or renamed.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.liveHeaders).onChange(async (value) => {
          this.plugin.settings.liveHeaders = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName("Files").setHeading();

    new Setting(containerEl)
      .setName("Date format")
      .setDesc("Prefix added when dating a file name and when archiving.")
      .addDropdown((d) =>
        d
          // eslint-disable-next-line obsidianmd/ui/sentence-case
          .addOption("YYYY-MM-DD", "YYYY-MM-DD")
          // eslint-disable-next-line obsidianmd/ui/sentence-case
          .addOption("YYYY-MM", "YYYY-MM")
          .setValue(this.plugin.settings.dateFormat)
          .onChange(async (value) => {
            this.plugin.settings.dateFormat = value === "YYYY-MM" ? "YYYY-MM" : "YYYY-MM-DD";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Date files when they are created inside an ID")
      .setDesc("Off by default. Never touches JDex notes or management folders (.00 to .09).")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.dateOnCreate).onChange(async (value) => {
          this.plugin.settings.dateOnCreate = value;
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

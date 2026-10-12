import { Notice, normalizePath, Plugin, type TAbstractFile, TFile, TFolder } from "obsidian";
import { healthFileName, renderHealthReport } from "./jd/health";
import { todayIso } from "./jd/template";
import { writeDailyReport } from "./vault/report-write";
import { openGlobalSearch, pathQuery } from "./vault/search";
import type { Effect, OperationKind } from "./jd/journal";
import { deviceIdentity, discardLastOperation, PluginDataFile, type RecordingEffects, UndoShield, undoLastOperation } from "./vault/journal-store";
import { movedIdentity } from "./vault/journal";
import { type JdexManagerSettings, mergeSettings, namePrefix } from "./settings";
import { auditSystem, countProblems, type Finding } from "./jd/audit";
import { relativeTo } from "./jd/detect";
import type { IdEntry } from "./jd/index";
import { isRepeatedId, repeatedIdMessage, selectCreationSystem, sameSystem, systemKey } from "./jd/index";
import { pairAction, renumberMessage } from "./jd/pair";
import { extractJdPrefix } from "./jd/parse";
import { FixFindingsModal } from "./ui/audit";
import { CategorySuggestModal, CreateIdModal, createId } from "./ui/create-id";
import { AreaSuggestModal, CreateAreaModal, CreateCategoryModal, CreateChildModal, CreateHeaderModal } from "./ui/create-structure";
import { IdSuggestModal, openEntry } from "./ui/go-to-id";
import { ProcessInboxModal } from "./ui/inbox";
import { IdEditorSuggest } from "./ui/autocomplete";
import { ID_PANEL_VIEW, IdPanelView } from "./ui/id-panel";
import type { JdIndex } from "./jd/index";
import { categoryOfPath, isDatable, locate } from "./jd/files";
import { dateFile, inboxFiles } from "./vault/files";
import { applyFix, collectAuditFindings, jdexNoteMetas, runAudit } from "./vault/audit";
import { confirm } from "./ui/confirm";
import { applyHeaderWraps, headersToMigrate, updateHeaders } from "./vault/headers";
import { createMissingStructureNotes, missingStructureNotes, updateSystemIndex } from "./vault/structure";
import { retireId } from "./vault/retire";
import { applyDetection } from "./vault/detect";
import { registerReadingLinks } from "./vault/reading-links";
import { scanVault } from "./vault/scan";
import { writeBuiltinTemplates } from "./vault/templates";
import { maintainSystem } from "./vault/maintenance";
import { DebugLogWriter, isDebugLogPath } from "./vault/debug-log";
import { MaintenanceGate, onceNotifier } from "./vault/maintenance-gate";
import { createSystemReport } from "./vault/system-report";
import { renamedFolderSettings } from "./vault/settings-paths";
import { closeTrackedModals } from "./ui/modal-registry";
import { JdexManagerSettingTab } from "./ui/settings-tab";
import { type FlowPorts, moveToId, sendToZero } from "./vault/flows";

export default class JdexManagerPlugin extends Plugin {
  settings: JdexManagerSettings = mergeSettings(null);
  /** Findings of the last audit run in this session. */
  lastFindings: Finding[] | null = null;
  private statusBar: HTMLElement | null = null;
  private inboxBar: HTMLElement | null = null;
  private whereBar: HTMLElement | null = null;
  private indexCache: { systemRoot: string; jdexFolder: string; index: JdIndex } | null = null;
  private dataFile?: PluginDataFile;
  private shield?: UndoShield;

  /**
   * Settings and undo journal in `data.json` (`src/vault/journal-store.ts`). `onload` loads it
   * first; created on first use so an instance that skipped `onload` still journals and merges on save.
   */
  private get data(): PluginDataFile {
    return (this.dataFile ??= new PluginDataFile({ load: () => this.loadData(), save: (data) => this.saveData(data) }, this.settings, deviceIdentity(this.app), (message) => new Notice(message, 10000)));
  }

  /** Paths the last undo restored, kept away from automatic writes until they change again. */
  private get undoShield(): UndoShield {
    return (this.shield ??= new UndoShield());
  }
  private maintenanceTimer: ReturnType<typeof activeWindow.setTimeout> | null = null;
  private maintenanceRunning = false;
  private maintenanceGate = new MaintenanceGate();
  private maintenanceWarn = onceNotifier((message) => void new Notice(message));
  /** Listeners of «index changed», called after the cache is invalidated. */
  private indexListeners?: Set<() => void>;
  /** Set on unload: in-flight passes and renames stop before their next write. */
  private unloaded = false;

  /** Subscribes to «index changed»; returns the unsubscribe. */
  onIndexChanged(listener: () => void): () => void {
    (this.indexListeners ??= new Set()).add(listener);
    return () => void this.indexListeners?.delete(listener);
  }

  private debugWriter?: DebugLogWriter;

  /** Adds an error to the optional debug log; nothing happens while the setting is off. */
  logError(where: string, error: unknown, path?: string): void {
    this.debugWriter ??= new DebugLogWriter(this.app);
    void this.debugWriter.record(this.settings, where, error, path);
  }

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
    // Renaming the active ID (or any index change) updates the «where» bar too.
    this.register(this.onIndexChanged(() => this.refreshWhere()));
    this.register(() => {
      if (this.maintenanceTimer !== null) window.clearTimeout(this.maintenanceTimer);
      this.maintenanceTimer = null;
    });

    this.registerView(ID_PANEL_VIEW, (leaf) => new IdPanelView(leaf, { index: () => this.cachedIndex(), settings: () => this.settings, onIndexChanged: (listener) => this.onIndexChanged(listener) }));
    this.addRibbonIcon("hash", "Open ID panel", () => void this.openPanel());
    this.addCommand({ id: "open-id-panel", name: "Open ID panel", callback: () => void this.openPanel() });

    this.registerEditorSuggest(
      new IdEditorSuggest(
        this.app,
        () => this.cachedIndex(),
        () => this.settings.autocompleteInsert,
        () => this.settings.autocomplete && this.settings.jdexFolder !== "",
      ),
    );
    registerReadingLinks(this, {
      index: () => this.cachedIndex(),
      enabled: () => this.settings.readingLinks && this.settings.jdexFolder !== "",
      choose: (entries) =>
        new Promise<IdEntry | null>((resolve) => {
          const modal = new IdSuggestModal(this.app, { ...this.cachedIndex(), ids: entries }, (e) => resolve(e), "Which one?");
          modal.setInstructions([{ command: "↵", purpose: "open the note" }]);
          modal.onClose = () => resolve(null);
          modal.open();
        }),
    });

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
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      name: "Reparar JDex",
      callback: () => void this.applyFixes(),
    });
    // eslint-disable-next-line obsidianmd/ui/sentence-case
    this.addRibbonIcon("wrench", "Reparar JDex", () => void this.applyFixes());

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

    this.addCommand({
      id: "create-structure-notes",
      name: "Create missing category and area notes",
      callback: () => void this.createStructureNotes(),
    });
    this.addCommand({
      id: "update-system-index",
      name: "Update system index note",
      callback: () => void this.refreshSystemIndex(true),
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
        if (this.settings.jdexFolder === "") return;
        const index = this.cachedIndex();
        const loc = locate(index, this.settings, file.path);
        if (file instanceof TFile && !loc?.atNote) {
          menu.addItem((item) =>
            item
              .setTitle("Move to an ID…")
              .setIcon("folder-input")
              .onClick(() => void this.moveToIdFlow(file)),
          );
        }
        if (!loc) return;
        if (loc.atNote && loc.entry.folderPath) {
          menu.addItem((item) =>
            item
              .setTitle(`Open folder of ${loc.entry.id}`)
              .setIcon("folder-open")
              .onClick(() => { if (!this.refuseRepeated(index, loc.entry)) void openEntry(this.app, loc.entry, true).then((msg) => msg && new Notice(msg)); }),
          );
        }
        if (!loc.atNote && loc.entry.notePath) {
          menu.addItem((item) =>
            item
              .setTitle(`Open JDex note of ${loc.entry.id}`)
              .setIcon("book-open")
              .onClick(() => { if (!this.refuseRepeated(index, loc.entry)) void openEntry(this.app, loc.entry, false).then((msg) => msg && new Notice(msg)); }),
          );
        }
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
      id: "retire-id",
      name: "Retire the active ID (archive its folder, keep the note)",
      checkCallback: (checking) => {
        const entry = this.activeIdEntry();
        if (!entry) return false;
        const note = entry.notePath ? this.app.vault.getAbstractFileByPath(entry.notePath) : null;
        if (note instanceof TFile && this.app.metadataCache.getFileCache(note)?.frontmatter?.tipo === "archivado") return false;
        if (!checking) void this.retireFlow(entry);
        return true;
      },
    });
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
          const loc = locate(this.cachedIndex(), this.settings, file.path);
          new Notice(loc ? loc.text : "The active file is not inside an ID.");
        }),
    });
    this.addCommand({
      id: "copy-id",
      name: "Copy ID of the active file",
      checkCallback: (checking) =>
        this.fileCommand(checking, async (file) => {
          const loc = locate(this.cachedIndex(), this.settings, file.path);
          if (!loc) {
            new Notice("The active file is not inside an ID.");
            return;
          }
          await navigator.clipboard.writeText(loc.entry.id);
          new Notice(`Copied ${loc.entry.id}.`);
        }),
    });
    this.addCommand({
      id: "copy-jd-path",
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      name: "Copy JD path of the active file",
      checkCallback: (checking) =>
        this.fileCommand(checking, async (file) => {
          const loc = locate(this.cachedIndex(), this.settings, file.path);
          if (!loc) {
            new Notice("The active file is not inside an ID.");
            return;
          }
          await navigator.clipboard.writeText(loc.text);
          new Notice(`Copied ${loc.text}.`);
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
        const index = this.cachedIndex();
        new IdSuggestModal(this.app, index, (entry, openFolder) => {
          if (this.refuseRepeated(index, entry)) return;
          void openEntry(this.app, entry, openFolder).then((msg) => msg && new Notice(msg));
        }).open();
      },
    });

    this.addCommand({
      id: "move-to-id",
      name: "Move active file to an ID",
      checkCallback: (checking) => this.fileCommand(checking, (file) => this.moveToIdFlow(file)),
    });
    this.addCommand({
      id: "search-in-id",
      name: "Search inside the active ID",
      checkCallback: (checking) => {
        const entry = this.activeIdEntry();
        if (!entry?.folderPath) return false;
        if (!checking) this.searchIn(entry.folderPath, entry.label);
        return true;
      },
    });
    this.addCommand({
      id: "search-in-category",
      name: "Search inside the active category",
      checkCallback: (checking) => {
        const folder = this.activeCategoryFolder();
        if (!folder) return false;
        if (!checking) this.searchIn(folder.path, folder.label);
        return true;
      },
    });
    this.addCommand({ id: "health-report", name: "System health report", callback: () => void this.healthReport() });
    this.addCommand({ id: "system-report", name: "Informe del sistema", callback: () => void this.systemReport() });
    this.addCommand({
      id: "undo-last",
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      name: "Undo last JDex operation",
      callback: () => void this.undoLast(),
    });
    this.addCommand({
      id: "discard-last",
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      name: "Discard last JDex journal entry (no file changes)",
      callback: () => void discardLastOperation({ data: this.data, confirm: (title, lines, action) => confirm(this.app, title, lines, action), notice: (message) => new Notice(message, 10000) }),
    });

    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      this.undoShield.observe(file.path, oldPath);
      this.invalidateIndex();
      void this.onRename(file, oldPath);
      this.queueMaintenance(file, oldPath);
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      this.undoShield.observe(file.path);
      this.invalidateIndex();
      this.refreshInboxCount();
      void this.onDelete(file);
      this.queueMaintenance(file);
    }));
    // The index is built from paths only, so a modify never invalidates it.
    this.registerEvent(this.app.vault.on("modify", (file) => {
      this.undoShield.observe(file.path);
      this.queueMaintenance(file);
    }));
    this.registerEvent(this.app.vault.on("create", (file) => {
      this.undoShield.observe(file.path);
      this.invalidateIndex();
      void this.onCreate(file);
      this.queueMaintenance(file);
    }));

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

  onunload(): void {
    this.unloaded = true;
    // The timer is cleared by `this.register` (same `window` that created it).
    closeTrackedModals();
  }

  /** A deleted JDex ID note leaves its header list (live headers on, the default). */
  async onDelete(file: TAbstractFile): Promise<void> {
    if (this.unloaded || !this.settings.liveHeaders || this.settings.jdexFolder === "" || !(file instanceof TFile)) return;
    const rel = relativeTo(this.settings.jdexFolder, file.path);
    if (rel === null || rel === "" || rel.includes("/")) return;
    const parsed = extractJdPrefix(rel.replace(/\.md$/, ""));
    if (parsed?.number.kind === "id") await this.refreshHeaders(parsed.number.category, false);
  }

  /**
   * Coalesces vault changes; the pass's own writes never enqueue another pass, foreign ones during
   * it enqueue one. Events of an undo (while it runs and while they settle) never enqueue a pass.
   */
  private queueMaintenance(file: TAbstractFile, oldPath?: string): void {
    if (!this.settings.automaticMaintenance || !this.app.workspace.layoutReady) return;
    // The debug log is written by the plugin itself: its modify must not start a pass.
    if (isDebugLogPath(this.settings, file.path) || isDebugLogPath(this.settings, oldPath)) return;
    if (this.undoShield.settling && (this.undoShield.protects(file.path) || (oldPath !== undefined && this.undoShield.protects(oldPath)))) return;
    const relevant = (path: string) => relativeTo(this.settings.systemRoot, path) !== null || relativeTo(this.settings.jdexFolder, path) !== null;
    if (!relevant(file.path) && !(oldPath && relevant(oldPath))) return;
    if (this.maintenanceRunning) {
      this.maintenanceGate.observe(file.path, oldPath);
      return;
    }
    this.scheduleMaintenance();
  }

  private scheduleMaintenance(): void {
    if (this.unloaded) return;
    // `window`, not `activeWindow`: unload clears it on the same window even if the active
    // window changed in between (pop-out windows).
    if (this.maintenanceTimer !== null) window.clearTimeout(this.maintenanceTimer);
    this.maintenanceTimer = window.setTimeout(() => {
      this.maintenanceTimer = null;
      void this.maintainAutomatically();
    }, 200);
  }

  /**
   * Records each maintenance step as it happens, including a partial pass. Runs in the journal's
   * exclusive queue, so it waits for an undo in progress, and leaves alone what that undo restored.
   */
  async maintainAutomatically(): Promise<void> {
    if (!this.settings.automaticMaintenance || this.maintenanceRunning || this.unloaded) return;
    this.maintenanceRunning = true;
    this.maintenanceGate.begin();
    let again = false;
    try {
      // Waits for an undo in progress; leaves alone what that undo restored.
      await this.data.journal.exclusive(async () => {
        const effects = this.journalOperation("fix", "Automatic JDex maintenance");
        try {
          // An unload during the pass stops it before its next write.
          await maintainSystem(this.app, this.settings, effects, this.maintenanceWarn, (path) => this.undoShield.protects(path), () => this.unloaded);
        } catch (error) {
          this.logError("maintainAutomatically", error);
          new Notice(`Automatic maintenance stopped: ${String(error)}`);
        }
        await effects.flush().catch(() => undefined);
        again = await this.maintenanceGate.finish(effects, async (path) => {
          const f = this.app.vault.getAbstractFileByPath(path);
          return f instanceof TFile ? await this.app.vault.read(f) : null;
        });
      });
    } finally {
      this.maintenanceRunning = false;
    }
    if (again) this.scheduleMaintenance();
  }

  /** Runs only on command; each report contains audit, health and changes since the previous. */
  async systemReport(): Promise<void> {
    if (!this.ready()) return;
    const effects = this.journalOperation("fix", "Create system report");
    try {
      const note = await createSystemReport(this.app, this.settings, effects);
      await this.app.workspace.getLeaf(false).openFile(note);
    } catch (error) {
      this.logError("systemReport", error);
      new Notice(error instanceof Error ? error.message : String(error));
    } finally { await effects.flush().catch(() => undefined); }
  }

  async loadSettings(): Promise<void> {
    for (const message of await this.data.load()) new Notice(message, 10000);
  }

  /** Settings and the undo journal share `data.json`; a save re-reads it and keeps what changed elsewhere. */
  async saveSettings(): Promise<void> {
    await this.data.save();
  }

  /** `data.json` changed outside this window (Sync or another device): adopt it, joining the journals. */
  async onExternalSettingsChange(): Promise<void> {
    await this.data.reload();
    this.invalidateIndex();
    this.refreshInboxCount();
  }

  /** Records an operation in the undo journal (the last 20) and persists it. */
  async record(kind: OperationKind, label: string, effects: Effect[]): Promise<void> {
    if (effects.length === 0) return;
    const sink = this.data.journal.begin(kind, label);
    sink.push(...effects);
    await sink.flush();
  }

  /** An effects list that records each effect in the journal, and saves it, as it happens. */
  journalOperation(kind: OperationKind, label: string): RecordingEffects {
    return this.data.journal.begin(kind, label);
  }

  /** Shows what undoing the last operation will do, then does exactly that operation. */
  async undoLast(): Promise<void> {
    await undoLastOperation({
      app: this.app,
      data: this.data,
      shield: this.undoShield,
      confirm: (title, lines, action) => confirm(this.app, title, lines, action),
      notice: (message) => new Notice(message, 10000),
      setRenaming: (value) => { this.renaming = value; },
    });
    // Header lists are not regenerated here: that would rewrite what the undo just restored.
    this.refreshInboxCount();
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
      this.logError("audit", error);
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  async applyFixes(): Promise<void> {
    this.lastFindings = null;
    await this.audit(false);
    if (!this.lastFindings) return;
    const effects = this.journalOperation("fix", "Reparar JDex");
    const modal = new FixFindingsModal(this.app, this.lastFindings, async () => {
      await effects.flush().catch(() => undefined);
      await this.audit(false);
    }, () => collectAuditFindings(this.app, this.settings), this.settings);
    modal.effects = effects;
    modal.open();
  }

  async openPanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(ID_PANEL_VIEW)[0];
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: ID_PANEL_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  /** The in-memory index stays valid until vault paths, JDex notes or root settings change. */
  cachedIndex(): JdIndex {
    const { systemRoot, jdexFolder } = this.settings;
    if (this.indexCache?.systemRoot === systemRoot && this.indexCache.jdexFolder === jdexFolder) {
      return this.indexCache.index;
    }
    const index = scanVault(this.app, this.settings);
    this.indexCache = { systemRoot, jdexFolder, index };
    return index;
  }

  /** Vault events invalidate before any callback can consume the changed paths. */
  private invalidateIndex(): void {
    this.indexCache = null;
    // After invalidating: listeners (ID panel, «where» bar) repaint against the new index.
    for (const listener of [...(this.indexListeners ?? [])]) listener();
  }

  /** Frontmatter fixes for one note or for the whole JDex, with the checklist modal as preview. */
  async normalizeFrontmatter(only: TFile | null): Promise<void> {
    if (this.settings.jdexFolder === "") {
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      new Notice("Set the JDex folder in the plugin settings first.");
      return;
    }
    const index = scanVault(this.app, this.settings);
    const notes = (await jdexNoteMetas(this.app, this.settings)).filter((n) => !only || n.path === only.path);
    const findings = auditSystem({ index, notes, filePaths: [] }).filter((f) => f.kind === "frontmatter-mismatch");
    if (findings.length === 0) {
      new Notice(only ? "Frontmatter already matches the name and position." : "Every JDex note already matches.");
      return;
    }
    const effects = this.journalOperation("fix", "Normalize JDex frontmatter");
    const modal = new FixFindingsModal(this.app, findings, async () => {
      await effects.flush().catch(() => undefined);
      await this.refreshHeaders(undefined, false);
    });
    modal.effects = effects;
    modal.open();
  }

  /**
   * Regenerates header lists as one journal operation; with `announce` it reports how many notes
   * changed. Header notes an undo just restored are left alone until they change again.
   */
  async refreshHeaders(onlyCategory: string | undefined, announce: boolean): Promise<void> {
    if (this.settings.jdexFolder === "") return;
    const index = scanVault(this.app, this.settings);
    const effects = this.journalOperation("fix", onlyCategory ? `Update header lists of ${onlyCategory}` : "Update header lists");
    const changed = await updateHeaders(this.app, index, onlyCategory, effects, (path) => this.undoShield.protects(path));
    await effects.flush().catch(() => undefined);
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
    const wrapped = await applyHeaderWraps(this.app, todo);
    await this.record("fix", "Wrap header lists in markers", wrapped.effects);
    new Notice(wrapped.skipped.length === 0
      ? `Markers added to ${wrapped.written.length} note(s).`
      : `Markers added to ${wrapped.written.length} note(s). Skipped ${wrapped.skipped.length} edited after the preview: ${wrapped.skipped.join(", ")}`, 10000);
    await this.refreshHeaders(undefined, true);
  }

  private renaming = false;
  private followingSettingPaths?: Set<string>;

  /** Actions that pick "the" note or folder of a number refuse a repeated one (two devices
   *  created it offline): they would mix two IDs. Returns whether it refused. */
  private refuseRepeated(index: JdIndex, entry: { id: string; system?: string; title: string }): boolean {
    if (!isRepeatedId(index, entry)) return false;
    new Notice(repeatedIdMessage(entry), 10000);
    return true;
  }

  /** A renamed folder (or ancestor) that a folder setting points at: propose following it.
   *  Declining keeps the old path, which the audit then reports as missing. */
  private async followRenamedFolderSettings(oldPath: string, newPath: string): Promise<void> {
    const pending = (this.followingSettingPaths ??= new Set());
    const renamed = renamedFolderSettings(this.settings, oldPath, newPath).filter((entry) => !pending.has(entry.from));
    if (renamed.length === 0) return;
    for (const entry of renamed) pending.add(entry.from);
    try {
      const ok = await confirm(this.app, "Update folder settings?", [
        "A folder used by the plugin settings was renamed or moved:",
        ...renamed.map((entry) => `${entry.label}: ${entry.from} → ${entry.to}`),
      ], "Update");
      if (!ok) return;
      for (const entry of renamed) if (this.settings[entry.key] === entry.from) this.settings[entry.key] = entry.to;
      this.invalidateIndex();
      await this.saveSettings();
      this.refreshInboxCount();
      this.refreshWhere();
    } finally {
      for (const entry of renamed) pending.delete(entry.from);
    }
  }

  /** Renames the plugin itself performs for a pair (old path to new path); only these are ignored. */
  private ownRenames?: Map<string, string>;
  private renameQueue?: Promise<void>;

  private isOwnRename(oldPath: string, newPath: string): boolean {
    for (const [from, to] of this.ownRenames ?? []) {
      if (oldPath === from ? newPath === to : oldPath.startsWith(`${from}/`) && newPath === `${to}${oldPath.slice(from.length)}`) return true;
    }
    return false;
  }

  /** Renames are handled one at a time, so a foreign one during a pair's prompt is not lost or mixed up. */
  async onRename(file: TAbstractFile, oldPath: string): Promise<void> {
    if (this.renaming || this.isOwnRename(oldPath, file.path)) return;
    const run = (this.renameQueue ?? Promise.resolve()).then(() => this.handleRename(file, oldPath));
    this.renameQueue = run.catch(() => undefined);
    return run;
  }

  /** Rename in pairs, the "never renumber" warning and the moved-category warning. */
  private async handleRename(file: TAbstractFile, oldPath: string): Promise<void> {
    if (this.renaming || this.unloaded) return;
    if (file instanceof TFolder) await this.followRenamedFolderSettings(oldPath, file.path);
    if (this.settings.jdexFolder === "") return;
    if (this.undoShield.settling && (this.undoShield.protects(file.path) || this.undoShield.protects(oldPath))) return;
    const index = scanVault(this.app, this.settings);
    const action = pairAction({ oldPath, newPath: file.path, isFolder: file instanceof TFolder }, index, this.settings);
    if (action.type === "unnumbered" || action.type === "renumbered") {
      const message = `${renumberMessage(action, "did")} Deshacer.`;
      new Notice(message, 10000);
      await this.record("move", message, [{ kind: "moved", from: oldPath, to: file.path, ...movedIdentity(file) }]);
      return;
    }
    if (action.type === "moved") {
      new Notice(`${action.id} moved from ${action.from} to ${action.to}. An ID keeps its number; create a new ID in the destination and archive this one.`, 10000);
      return;
    }
    const newName = file.path.slice(file.path.lastIndexOf("/") + 1);
    const renamed = extractJdPrefix(file instanceof TFile ? newName.replace(/\.md$/, "") : newName);
    if (action.type === "rename-partner" && renamed?.number.kind === "id" &&
      this.refuseRepeated(index, { id: renamed.number.extension ? `${renamed.number.id}+` : renamed.number.id, system: renamed.number.system, title: renamed.title })) {
      // Renaming "the" partner of a repeated number would rename the other ID's file.
    } else if (action.type === "rename-partner") {
      const isNote = action.partnerPath.endsWith(".md");
      const ok =
        this.settings.renamePairsWithoutAsking ||
        (await confirm(
          this.app,
          isNote ? "Rename the JDex note too?" : "Rename the folder too?",
          [`${action.partnerPath}`, `→ ${action.newPartnerPath}`],
          "Rename",
        ));
      // Unloaded while the confirmation was open: no write.
      if (ok && !this.unloaded) {
        (this.ownRenames ??= new Map()).set(action.partnerPath, action.newPartnerPath);
        const effects = this.journalOperation("move", `Rename ${action.partnerPath} with its pair`);
        try {
          await applyFix(this.app, { type: "rename", from: action.partnerPath, to: action.newPartnerPath }, effects);
        } catch (error) {
          this.logError("handleRename", error);
          new Notice(error instanceof Error ? error.message : String(error));
        } finally {
          this.ownRenames?.delete(action.partnerPath);
          await effects.flush().catch(() => undefined);
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

  /** The flows' choices and side effects, wired to Obsidian's modals (`src/vault/flows.ts`). */
  private flowPorts(): FlowPorts {
    return {
      app: this.app,
      settings: this.settings,
      pickEntry: (index, placeholder, purpose) => new Promise<IdEntry | null>((resolve) => {
        const modal = new IdSuggestModal(this.app, index, (e) => resolve(e), placeholder);
        modal.setInstructions([{ command: "↵", purpose }]);
        modal.onClose = () => resolve(null);
        modal.open();
      }),
      pickCategory: (index) => new Promise<string | null>((resolve) => {
        const modal = new CategorySuggestModal(this.app, index, (c) => resolve(systemKey(c.number, c.system)));
        modal.onClose = () => resolve(null);
        modal.open();
      }),
      confirm: (title, lines, action) => confirm(this.app, title, lines, action),
      notice: (message, timeout) => void new Notice(message, timeout),
      journal: (kind, label) => this.journalOperation(kind, label),
      record: (kind, label, effects) => this.record(kind, label, effects),
      logError: (where, error) => this.logError(where, error),
      refreshInbox: () => this.refreshInboxCount(),
    };
  }

  /** Moves the file to the `.01` or `.09` of its category (00 when it lives outside the system). */
  async sendToZero(file: TFile, zero: "01" | "09"): Promise<void> {
    await sendToZero(this.flowPorts(), file, zero);
  }

  /** Picks an ID and moves the file into its folder, creating the folder first when the ID has none. */
  async moveToIdFlow(file: TFile): Promise<void> {
    if (!this.ready()) return;
    await moveToId(this.flowPorts(), file);
  }

  /** Folder and label of the category the active file lives in, from the system folders. */
  private activeCategoryFolder(): { path: string; label: string } | null {
    const file = this.app.workspace.getActiveFile();
    if (!file || this.settings.jdexFolder === "") return null;
    const number = categoryOfPath(this.settings.systemRoot, file.path);
    if (number === null) return null;
    const category = this.cachedIndex().categories.find((c) => systemKey(c.number, c.system) === number);
    return category?.path ? { path: category.path, label: category.label } : null;
  }

  /** Opens the global search restricted to `folder`; copies the query when the core search plugin is not reachable. */
  private searchIn(folder: string, label: string): void {
    const query = pathQuery(folder);
    if (openGlobalSearch(this.app, query)) return;
    void navigator.clipboard.writeText(query).then(
      () => new Notice(`Search is not available; the query for ${label} was copied to the clipboard.`, 8000),
      () => new Notice(`Search is not available. Query for ${label}: ${query}`, 10000),
    );
  }

  /** Writes `Salud JD - YYYY-MM-DD.md` in the reports folder and opens it. */
  async healthReport(): Promise<void> {
    if (!this.ready()) return;
    if (this.settings.reportsFolder === "") {
      new Notice("Set the reports folder first (00.02 by convention).");
      return;
    }
    const index = scanVault(this.app, this.settings);
    const filePaths = this.app.vault.getFiles().map((f) => f.path);
    const date = todayIso();
    const content = renderHealthReport(index, filePaths, date, { maxFiles: this.settings.healthMaxFiles, nearlyFull: 70 });
    const path = normalizePath(`${this.settings.reportsFolder}/${healthFileName(date)}`);
    const effects = this.journalOperation("fix", "Create health report");
    try {
      // A health report of the day edited by hand is kept; the new one goes to «(2)».
      const { file } = await writeDailyReport(this.app, this.settings.reportsFolder, path, content, effects);
      await this.app.workspace.getLeaf(false).openFile(file);
    } catch (error) {
      this.logError("healthReport", error);
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
      const to = await this.datedRename(file);
      new Notice(to ? `Renamed to ${to.slice(to.lastIndexOf("/") + 1)}.` : "Already dated.");
    } catch (error) {
      this.logError("dateActive", error);
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  /** Dates `file` in place and records the rename for undo. */
  private async datedRename(file: TFile): Promise<string | null> {
    const from = file.path;
    const identity = movedIdentity(file);
    const to = await dateFile(this.app, file, this.settings.dateFormat);
    if (to) await this.record("move", `Date ${from.slice(from.lastIndexOf("/") + 1)}`, [{ kind: "moved", from, to, ...identity }]);
    return to;
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
    new ProcessInboxModal(this.app, files, { index, systemRoot: this.settings.systemRoot, dateFormat: this.settings.dateFormat, journal: (kind, label) => this.journalOperation(kind, label) }, async () => {
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
    const loc = locate(this.cachedIndex(), this.settings, file.path);
    this.whereBar.setText(loc ? loc.text : "");
  }

  /** From the JDex note, opens the first note of the ID folder; from inside the folder, opens the JDex note. */
  async toggleNoteAndFolder(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || !this.ready()) return;
    const index = this.cachedIndex();
    const loc = locate(index, this.settings, file.path);
    if (!loc) {
      new Notice("The active file is not inside an ID.");
      return;
    }
    if (this.refuseRepeated(index, loc.entry)) return;
    const msg = await openEntry(this.app, loc.entry, loc.atNote);
    if (msg) new Notice(msg);
  }

  refreshInboxCount(): void {
    if (!this.inboxBar) return;
    if (this.settings.jdexFolder === "") {
      this.inboxBar.setText("");
      return;
    }
    const n = inboxFiles(this.app, this.cachedIndex()).length;
    this.inboxBar.setText(n === 0 ? "Inbox: empty" : `Inbox: ${n}`);
  }

  async onCreate(file: TAbstractFile): Promise<void> {
    // Obsidian fires "create" for every file while the vault loads; only react to files created afterwards.
    if (!this.app.workspace.layoutReady) return;
    if (this.settings.jdexFolder === "" || !(file instanceof TFile)) return;
    this.refreshInboxCount();
    // A note an undo restores is not new: it is not dated, indexed or listed again.
    if (this.undoShield.settling && this.undoShield.protects(file.path)) return;
    if (this.settings.dateOnCreate) {
      const index = scanVault(this.app, this.settings);
      if (isDatable(index, this.settings, file.path)) {
        try {
          await this.datedRename(file);
        } catch {
          // A clash on the dated name is not worth a notice at creation time.
        }
      }
    }
    if (this.settings.updateSystemIndexOnCreate) {
      const inJdex = relativeTo(this.settings.jdexFolder, file.path);
      if (inJdex !== null && inJdex !== "" && !inJdex.includes("/") && extractJdPrefix(file.basename)) {
        await this.refreshSystemIndex(false);
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
    const index = this.cachedIndex();
    return index.ids.find((entry) => entry.id === id && sameSystem(entry, parsed.number) && (
      (file instanceof TFile && entry.notePath === file.path) ||
      (file instanceof TFolder && entry.folderPath === file.path)
    )) ?? null;
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

  async createStructureNotes(): Promise<void> {
    if (!this.ready()) return;
    const index = scanVault(this.app, this.settings);
    const missing = missingStructureNotes(index);
    const total = missing.areas.length + missing.categories.length;
    if (total === 0) {
      new Notice("Every area and category folder already has a note.");
      return;
    }
    const names = [...missing.areas.map((a) => a.label), ...missing.categories.map((c) => c.label)];
    const ok = await confirm(
      this.app,
      "Create missing category and area notes",
      [`${total} note(s) will be created in the JDex folder from the templates:`, ...names.slice(0, 15), ...(names.length > 15 ? [`… and ${names.length - 15} more`] : [])],
      "Create",
    );
    if (!ok) return;
    try {
      const effects = this.journalOperation("create-structure", "Create missing category and area notes");
      const created = await createMissingStructureNotes(this.app, this.settings, index, effects);
      await effects.flush().catch(() => undefined);
      new Notice(`${created} note(s) created.`);
    } catch (error) {
      this.logError("createStructureNotes", error);
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  /** Regenerates the system index note. With `announce`, adds the markers when missing and reports. */
  async refreshSystemIndex(announce: boolean): Promise<void> {
    if (this.settings.jdexFolder === "") return;
    const index = scanVault(this.app, this.settings);
    const effects = this.journalOperation("fix", "Update the system index");
    const changed = await updateSystemIndex(this.app, this.settings, index, announce, effects);
    await effects.flush().catch(() => undefined);
    if (announce) new Notice(changed ? "System index updated." : "System index unchanged.");
  }

  async createCategoryFlow(): Promise<void> {
    if (!this.ready()) return;
    const index = selectCreationSystem(scanVault(this.app, this.settings), namePrefix(this.settings));
    if (index.areas.length === 0) {
      new Notice("No areas found. Create an area first.");
      return;
    }
    new AreaSuggestModal(this.app, index, (area) => {
      new CreateCategoryModal(this.app, index, area, this.settings, () => this.refreshHeaders(undefined, false), this.journalOperation("create-structure", `Create category in ${area.label}`)).open();
    }).open();
  }

  async createAreaFlow(): Promise<void> {
    if (!this.ready()) return;
    const index = selectCreationSystem(scanVault(this.app, this.settings), namePrefix(this.settings));
    new CreateAreaModal(this.app, index, this.settings, async () => {}, this.journalOperation("create-structure", "Create area")).open();
  }

  async createHeaderFlow(): Promise<void> {
    if (!this.ready()) return;
    const index = selectCreationSystem(scanVault(this.app, this.settings), namePrefix(this.settings));
    if (index.categories.length === 0) {
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      new Notice("No categories found. Check the system root and the JDex folder.");
      return;
    }
    new CategorySuggestModal(this.app, index, (category) => {
      new CreateHeaderModal(this.app, index, category, this.settings, () => this.refreshHeaders(category.number, false), this.journalOperation("create-id", `Create header in ${category.label}`)).open();
    }).open();
  }

  async retireFlow(parent: { id: string; system?: string }): Promise<void> {
    if (!this.ready()) return;
    const index = scanVault(this.app, this.settings);
    const entry = index.ids.find((e) => e.id === parent.id && sameSystem(e, parent));
    if (!entry) return;
    if (this.refuseRepeated(index, entry)) return;
    const lines = [
      `${entry.label} keeps its number forever: the JDex note stays, marked tipo: archivado, with a line saying when and where.`,
      entry.folderPath ? `Its folder moves to ${entry.category}.09 with today's date as prefix.` : "It has no folder.",
      "Nothing is deleted.",
    ];
    const ok = await confirm(this.app, `Retire ${entry.id}?`, lines, "Retire");
    if (!ok) return;
    // Each step is journaled as it happens, so a partial retirement stays undoable.
    const effects = this.journalOperation("retire", `Retire ${entry.id}`);
    try {
      const done = await retireId(this.app, index, entry, undefined, effects);
      await effects.flush();
      new Notice(done.join(" · "), 8000);
      await this.refreshHeaders(entry.category, false);
    } catch (error) {
      this.logError("retireFlow", error);
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  async createChildFlow(parent: { id: string; system?: string }): Promise<void> {
    if (!this.ready()) return;
    const index = scanVault(this.app, this.settings);
    const entry = index.ids.find((e) => e.id === parent.id && sameSystem(e, parent));
    if (!entry) return;
    new CreateChildModal(this.app, index, entry, this.settings, async () => {}, this.journalOperation("create-id", `Create child of ${entry.label}`)).open();
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
    const index = selectCreationSystem(scanVault(this.app, this.settings), namePrefix(this.settings));
    if (index.categories.length === 0) {
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      new Notice("No categories found. Check the system root and the JDex folder.");
      return;
    }
    new CategorySuggestModal(this.app, index, (category) => {
      new CreateIdModal(this.app, index, category, this.settings, async (request) => {
        await this.saveSettings();
        try {
          // Journaled effect by effect: a failure after creating the note keeps it undoable.
          const effects = this.journalOperation("create-id", `Create ${request.id} ${request.title.trim()}`);
          const note = await createId(this.app, this.settings, index, category, request, effects);
          await effects.flush();
          new Notice(`Created ${note.basename}.`);
          if (request.createFolder && this.settings.afterCreateOpen === "folder" && category.path) {
            // No public API reveals a folder in the explorer: open the note and say where the folder is.
            await this.app.workspace.getLeaf(false).openFile(note);
            new Notice(`Folder: ${category.path}/${note.basename}`, 8000);
          } else {
            await this.app.workspace.getLeaf(false).openFile(note);
          }
        } catch (error) {
          this.logError("createIdFlow", error);
          new Notice(error instanceof Error ? error.message : String(error));
        }
      }).open();
    }).open();
  }
}

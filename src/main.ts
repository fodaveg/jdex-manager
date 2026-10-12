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
import { isRepeatedId, selectCreationSystem, sameSystem, systemKey } from "./jd/index";
import { pairAction, pairBlockedByRepeat } from "./jd/pair";
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
import { pickFromModal } from "./ui/suggest-pick";
import { folderSettingName, t, uiLanguage } from "./ui/i18n";
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
    this.statusBar.setText(t().statusNotAudited);
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
    this.addRibbonIcon("hash", t().cmdOpenIdPanel, () => void this.openPanel());
    this.addCommand({ id: "open-id-panel", name: t().cmdOpenIdPanel, callback: () => void this.openPanel() });

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
        pickFromModal<IdEntry>((choose) => {
          const modal = new IdSuggestModal(this.app, { ...this.cachedIndex(), ids: entries }, (e) => choose(e), t().whichOne);
          modal.setInstructions([{ command: "↵", purpose: t().hintOpenNote }]);
          return modal;
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
      name: t().cmdAudit,
      callback: () => void this.audit(),
    });

    this.addCommand({
      id: "apply-fixes",
      name: t().cmdRepair,
      callback: () => void this.applyFixes(),
    });
    this.addRibbonIcon("wrench", t().cmdRepair, () => void this.applyFixes());

    this.addCommand({
      id: "normalize-frontmatter-active",
      name: t().cmdNormalizeActive,
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
      name: t().cmdNormalizeAll,
      callback: () => void this.normalizeFrontmatter(null),
    });

    this.addCommand({
      id: "update-headers",
      name: t().cmdUpdateHeaders,
      callback: () => void this.refreshHeaders(undefined, true),
    });

    this.addCommand({
      id: "wrap-header-lists",
      name: t().cmdWrapHeaders,
      callback: () => void this.migrateHeaders(),
    });

    this.addCommand({
      id: "create-structure-notes",
      name: t().cmdCreateStructureNotes,
      callback: () => void this.createStructureNotes(),
    });
    this.addCommand({
      id: "update-system-index",
      name: t().cmdUpdateSystemIndex,
      callback: () => void this.refreshSystemIndex(true),
    });
    this.addCommand({ id: "create-category", name: t().cmdCreateCategory, callback: () => void this.createCategoryFlow() });
    this.addCommand({ id: "create-area", name: t().cmdCreateArea, callback: () => void this.createAreaFlow() });
    this.addCommand({ id: "create-header", name: t().cmdCreateHeader, callback: () => void this.createHeaderFlow() });
    this.addCommand({
      id: "create-child",
      name: t().cmdCreateChild,
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
              .setTitle(t().menuMoveToId)
              .setIcon("folder-input")
              .onClick(() => void this.moveToIdFlow(file)),
          );
        }
        if (!loc) return;
        if (loc.atNote && loc.entry.folderPath) {
          menu.addItem((item) =>
            item
              .setTitle(t().menuOpenFolder(loc.entry.id))
              .setIcon("folder-open")
              .onClick(() => { if (!this.refuseRepeated(index, loc.entry)) void openEntry(this.app, loc.entry, true).then((msg) => msg && new Notice(msg)); }),
          );
        }
        if (!loc.atNote && loc.entry.notePath) {
          menu.addItem((item) =>
            item
              .setTitle(t().menuOpenNote(loc.entry.id))
              .setIcon("book-open")
              .onClick(() => { if (!this.refuseRepeated(index, loc.entry)) void openEntry(this.app, loc.entry, false).then((msg) => msg && new Notice(msg)); }),
          );
        }
        const entry = this.entryFor(file);
        if (!entry) return;
        menu.addItem((item) =>
          item
            .setTitle(t().menuCreateChild(entry.id))
            .setIcon("git-branch-plus")
            .onClick(() => void this.createChildFlow(entry)),
        );
      }),
    );

    this.addCommand({
      id: "retire-id",
      name: t().cmdRetire,
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
      name: t().cmdSendToInbox,
      checkCallback: (checking) => this.fileCommand(checking, (file) => this.sendToZero(file, "01")),
    });
    this.addCommand({
      id: "archive",
      name: t().cmdArchive,
      checkCallback: (checking) => this.fileCommand(checking, (file) => this.sendToZero(file, "09")),
    });
    this.addCommand({
      id: "date-file",
      name: t().cmdDateFile,
      checkCallback: (checking) => this.fileCommand(checking, (file) => this.dateActive(file)),
    });
    this.addCommand({ id: "process-inbox", name: t().cmdProcessInbox, callback: () => void this.processInbox() });
    this.addCommand({
      id: "where-am-i",
      name: t().cmdWhereAmI,
      checkCallback: (checking) =>
        this.fileCommand(checking, async (file) => {
          const loc = locate(this.cachedIndex(), this.settings, file.path);
          new Notice(loc ? loc.text : t().notInsideId);
        }),
    });
    this.addCommand({
      id: "copy-id",
      name: t().cmdCopyId,
      checkCallback: (checking) =>
        this.fileCommand(checking, async (file) => {
          const loc = locate(this.cachedIndex(), this.settings, file.path);
          if (!loc) {
            new Notice(t().notInsideId);
            return;
          }
          await navigator.clipboard.writeText(loc.entry.id);
          new Notice(t().copied(loc.entry.id));
        }),
    });
    this.addCommand({
      id: "copy-jd-path",
      name: t().cmdCopyJdPath,
      checkCallback: (checking) =>
        this.fileCommand(checking, async (file) => {
          const loc = locate(this.cachedIndex(), this.settings, file.path);
          if (!loc) {
            new Notice(t().notInsideId);
            return;
          }
          await navigator.clipboard.writeText(loc.text);
          new Notice(t().copied(loc.text));
        }),
    });
    this.addCommand({
      id: "toggle-note-folder",
      name: t().cmdToggleNoteFolder,
      checkCallback: (checking) => this.fileCommand(checking, () => this.toggleNoteAndFolder()),
    });
    this.addCommand({
      id: "go-to-id",
      name: t().cmdGoToId,
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
      name: t().cmdMoveToId,
      checkCallback: (checking) => this.fileCommand(checking, (file) => this.moveToIdFlow(file)),
    });
    this.addCommand({
      id: "search-in-id",
      name: t().cmdSearchInId,
      checkCallback: (checking) => {
        const entry = this.activeIdEntry();
        if (!entry?.folderPath) return false;
        if (!checking) this.searchIn(entry.folderPath, entry.label);
        return true;
      },
    });
    this.addCommand({
      id: "search-in-category",
      name: t().cmdSearchInCategory,
      checkCallback: (checking) => {
        const folder = this.activeCategoryFolder();
        if (!folder) return false;
        if (!checking) this.searchIn(folder.path, folder.label);
        return true;
      },
    });
    this.addCommand({ id: "health-report", name: t().cmdHealthReport, callback: () => void this.healthReport() });
    this.addCommand({ id: "system-report", name: t().cmdSystemReport, callback: () => void this.systemReport() });
    this.addCommand({
      id: "undo-last",
      name: t().cmdUndoLast,
      callback: () => void this.undoLast(),
    });
    this.addCommand({
      id: "discard-last",
      name: t().cmdDiscardLast,
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

    this.addRibbonIcon("file-plus-2", t().cmdCreateId, () => void this.createIdFlow());

    this.addCommand({
      id: "create-id",
      name: t().cmdCreateId,
      callback: () => void this.createIdFlow(),
    });

    this.addCommand({
      id: "detect-folders",
      name: t().cmdDetectFolders,
      callback: () => void this.detectFolders(true),
    });

    this.addCommand({
      id: "create-templates",
      name: t().cmdCreateTemplates,
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
    // A note an undo trashes (undoing «Create ID»): its header lists are the undo's to restore.
    if (this.undoShield.settling && this.undoShield.protects(file.path)) return;
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
        const effects = this.journalOperation("fix", t().labelMaintenance, true);
        try {
          // An unload during the pass stops it before its next write.
          await maintainSystem(this.app, this.settings, effects, this.maintenanceWarn, (path) => this.undoShield.protects(path), () => this.unloaded);
        } catch (error) {
          this.logError("maintainAutomatically", error);
          new Notice(t().maintenanceStopped(String(error)));
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
    const effects = this.journalOperation("fix", t().labelSystemReport);
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
  async record(kind: OperationKind, label: string, effects: Effect[], auto = false): Promise<void> {
    if (effects.length === 0) return;
    const sink = this.data.journal.begin(kind, label, auto);
    sink.push(...effects);
    await sink.flush();
  }

  /** An effects list that records each effect in the journal, and saves it, as it happens. `auto`: written by the plugin on its own (own quota in the journal). */
  journalOperation(kind: OperationKind, label: string, auto = false): RecordingEffects {
    return this.data.journal.begin(kind, label, auto);
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
    if (found === 0) new Notice(t().noFoldersFound);
    else if (changed) new Notice(t().foldersFilled(found));
    else new Notice(t().foldersUnchanged(found));
  }

  /** Runs the audit, writes the report, updates the status bar and opens the report when asked. */
  async audit(openReport = true): Promise<void> {
    if (this.settings.jdexFolder === "") await this.detectFolders(false);
    if (this.settings.jdexFolder === "") {
      new Notice(t().setJdexFolderFirst);
      return;
    }
    try {
      const { findings, reportPath } = await runAudit(this.app, this.settings, uiLanguage());
      this.lastFindings = findings;
      const problems = countProblems(findings);
      this.statusBar?.setText(t().statusFindings(problems));
      new Notice(t().auditFindings(problems));
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
    const effects = this.journalOperation("fix", t().cmdRepair);
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
      new Notice(t().setJdexFolderFirst);
      return;
    }
    const index = scanVault(this.app, this.settings);
    const notes = (await jdexNoteMetas(this.app, this.settings)).filter((n) => !only || n.path === only.path);
    const findings = auditSystem({ index, notes, filePaths: [] }).filter((f) => f.kind === "frontmatter-mismatch");
    if (findings.length === 0) {
      new Notice(only ? t().frontmatterAlreadyMatches : t().everyNoteMatches);
      return;
    }
    const effects = this.journalOperation("fix", t().labelNormalize);
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
    if (this.unloaded || this.settings.jdexFolder === "") return;
    const index = scanVault(this.app, this.settings);
    const effects = this.journalOperation("fix", onlyCategory ? t().labelHeadersOf(onlyCategory) : t().cmdUpdateHeaders, !announce);
    const changed = await updateHeaders(this.app, index, onlyCategory, effects, (path) => this.undoShield.protects(path), () => this.unloaded);
    await effects.flush().catch(() => undefined);
    if (announce) new Notice(t().headerListsUpdated(changed));
  }

  async migrateHeaders(): Promise<void> {
    if (this.settings.jdexFolder === "") return;
    const index = scanVault(this.app, this.settings);
    const todo = await headersToMigrate(this.app, index);
    if (todo.length === 0) {
      new Notice(t().nothingToWrap);
      return;
    }
    const ok = await confirm(
      this.app,
      t().wrapTitle,
      [
        t().wrapBody(todo.length),
        ...todo.slice(0, 12).map((item) => item.file.basename),
        ...(todo.length > 12 ? [t().andMore(todo.length - 12)] : []),
      ],
      t().wrapAction,
    );
    if (!ok) return;
    const wrapped = await applyHeaderWraps(this.app, todo);
    await this.record("fix", t().wrapTitle, wrapped.effects);
    new Notice(wrapped.skipped.length === 0
      ? t().markersAdded(wrapped.written.length)
      : t().markersAddedSkipped(wrapped.written.length, wrapped.skipped.length, wrapped.skipped.join(", ")), 10000);
    await this.refreshHeaders(undefined, true);
  }

  private renaming = false;
  private followingSettingPaths?: Set<string>;
  /** Folder-setting updates the user declined this session (setting, old path, new path). */
  private declinedSettingRenames?: Set<string>;

  /** Actions that pick "the" note or folder of a number refuse a repeated one (two devices
   *  created it offline): they would mix two IDs. Returns whether it refused. */
  private refuseRepeated(index: JdIndex, entry: { id: string; system?: string; title: string }): boolean {
    if (!isRepeatedId(index, entry)) return false;
    new Notice(t().repeatedId(entry), 10000);
    return true;
  }

  /** A renamed folder (or ancestor) that a folder setting points at: propose following it.
   *  Declining keeps the old path, which the audit then reports as missing. */
  private async followRenamedFolderSettings(oldPath: string, newPath: string): Promise<void> {
    const pending = (this.followingSettingPaths ??= new Set());
    // Obsidian emits one rename per descendant: a declined update is not asked again this session.
    const declined = (this.declinedSettingRenames ??= new Set());
    const declineKey = (entry: { key: string; from: string; to: string }) => `${entry.key}\n${entry.from}\n${entry.to}`;
    const renamed = renamedFolderSettings(this.settings, oldPath, newPath).filter((entry) => !pending.has(entry.from) && !declined.has(declineKey(entry)));
    if (renamed.length === 0) return;
    for (const entry of renamed) pending.add(entry.from);
    try {
      const ok = await confirm(this.app, t().followSettingsTitle, [
        t().followSettingsBody,
        ...renamed.map((entry) => `${folderSettingName(entry.key)}: ${entry.from} → ${entry.to}`),
      ], t().update);
      if (!ok) {
        for (const entry of renamed) declined.add(declineKey(entry));
        return;
      }
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
      // Obsidian has no clickable «Deshacer» like Hebra: the notice names the undo command.
      const message = t().renumberNotice(action);
      new Notice(message, 10000);
      await this.record("move", message, [{ kind: "moved", from: oldPath, to: file.path, ...movedIdentity(file) }]);
      return;
    }
    if (action.type === "moved") {
      new Notice(t().movedNotice(action), 10000);
      return;
    }
    const newName = file.path.slice(file.path.lastIndexOf("/") + 1);
    const renamed = extractJdPrefix(file instanceof TFile ? newName.replace(/\.md$/, "") : newName);
    const pairEvent = { oldPath, newPath: file.path, isFolder: file instanceof TFolder };
    if ((action.type === "rename-partner" || (action.type === "none" && pairBlockedByRepeat(pairEvent, index, this.settings))) && renamed?.number.kind === "id" &&
      this.refuseRepeated(index, { id: renamed.number.extension ? `${renamed.number.id}+` : renamed.number.id, system: renamed.number.system, title: renamed.title })) {
      // Renaming "the" partner of a repeated number would rename the other ID's file.
    } else if (action.type === "rename-partner") {
      const isNote = action.partnerPath.endsWith(".md");
      const ok =
        this.settings.renamePairsWithoutAsking ||
        (await confirm(
          this.app,
          isNote ? t().renameNoteTooTitle : t().renameFolderTooTitle,
          [`${action.partnerPath}`, `→ ${action.newPartnerPath}`],
          t().rename,
        ));
      // Unloaded while the confirmation was open: no write.
      if (ok && !this.unloaded) {
        (this.ownRenames ??= new Map()).set(action.partnerPath, action.newPartnerPath);
        const effects = this.journalOperation("move", t().labelRenamePair(action.partnerPath));
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
      pickEntry: (index, placeholder, purpose) => pickFromModal<IdEntry>((choose) => {
        const modal = new IdSuggestModal(this.app, index, (e) => choose(e), placeholder);
        modal.setInstructions([{ command: "↵", purpose }]);
        return modal;
      }),
      pickCategory: (index) => pickFromModal<string>((choose) => new CategorySuggestModal(this.app, index, (c) => choose(systemKey(c.number, c.system)))),
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
      () => new Notice(t().searchCopied(label), 8000),
      () => new Notice(t().searchUnavailable(label, query), 10000),
    );
  }

  /** Writes `Salud JD - YYYY-MM-DD.md` in the reports folder and opens it. */
  async healthReport(): Promise<void> {
    if (!this.ready()) return;
    if (this.settings.reportsFolder === "") {
      new Notice(t().setReportsFolderFirst);
      return;
    }
    const index = scanVault(this.app, this.settings);
    const filePaths = this.app.vault.getFiles().map((f) => f.path);
    const date = todayIso();
    const content = renderHealthReport(index, filePaths, date, { maxFiles: this.settings.healthMaxFiles, nearlyFull: 70 });
    const path = normalizePath(`${this.settings.reportsFolder}/${healthFileName(date)}`);
    const effects = this.journalOperation("fix", t().labelHealthReport);
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
      new Notice(t().onlyContentDated);
      return;
    }
    try {
      const to = await this.datedRename(file);
      new Notice(to ? t().renamedTo(to.slice(to.lastIndexOf("/") + 1)) : t().alreadyDated);
    } catch (error) {
      this.logError("dateActive", error);
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  /** Dates `file` in place and records the rename for undo. */
  private async datedRename(file: TFile, auto = false): Promise<string | null> {
    const from = file.path;
    const identity = movedIdentity(file);
    const to = await dateFile(this.app, file, this.settings.dateFormat);
    if (to) await this.record("move", t().labelDate(from.slice(from.lastIndexOf("/") + 1)), [{ kind: "moved", from, to, ...identity }], auto);
    return to;
  }

  async processInbox(): Promise<void> {
    if (!this.ready()) return;
    const index = scanVault(this.app, this.settings);
    const files = inboxFiles(this.app, index);
    if (files.length === 0) {
      new Notice(t().inboxesEmpty);
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
      new Notice(t().notInsideId);
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
    this.inboxBar.setText(n === 0 ? t().inboxBarEmpty : t().inboxBarCount(n));
  }

  async onCreate(file: TAbstractFile): Promise<void> {
    // Obsidian fires "create" for every file while the vault loads; only react to files created afterwards.
    if (!this.app.workspace.layoutReady || this.unloaded) return;
    if (this.settings.jdexFolder === "" || !(file instanceof TFile)) return;
    this.refreshInboxCount();
    // A note an undo restores is not new: it is not dated, indexed or listed again.
    if (this.undoShield.settling && this.undoShield.protects(file.path)) return;
    if (this.settings.dateOnCreate) {
      const index = scanVault(this.app, this.settings);
      if (isDatable(index, this.settings, file.path)) {
        try {
          await this.datedRename(file, true);
        } catch {
          // A clash on the dated name is not worth a notice at creation time.
        }
      }
    }
    // Unloaded while awaiting: no further write.
    if (this.unloaded) return;
    if (this.settings.updateSystemIndexOnCreate) {
      const inJdex = relativeTo(this.settings.jdexFolder, file.path);
      if (inJdex !== null && inJdex !== "" && !inJdex.includes("/") && extractJdPrefix(file.basename)) {
        await this.refreshSystemIndex(false);
      }
    }
    if (!this.settings.liveHeaders || this.unloaded) return;
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
    new Notice(t().setJdexFolderFirst);
    return false;
  }

  async createStructureNotes(): Promise<void> {
    if (!this.ready()) return;
    const index = scanVault(this.app, this.settings);
    const missing = missingStructureNotes(index);
    const total = missing.areas.length + missing.categories.length;
    if (total === 0) {
      new Notice(t().structureComplete);
      return;
    }
    const names = [...missing.areas.map((a) => a.label), ...missing.categories.map((c) => c.label)];
    const ok = await confirm(
      this.app,
      t().cmdCreateStructureNotes,
      [t().structureBody(total), ...names.slice(0, 15), ...(names.length > 15 ? [t().andMore(names.length - 15)] : [])],
      t().create,
    );
    if (!ok) return;
    try {
      const effects = this.journalOperation("create-structure", t().cmdCreateStructureNotes);
      const created = await createMissingStructureNotes(this.app, this.settings, index, effects);
      await effects.flush().catch(() => undefined);
      new Notice(t().notesCreated(created));
    } catch (error) {
      this.logError("createStructureNotes", error);
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  /** Regenerates the system index note. With `announce`, adds the markers when missing and reports. */
  async refreshSystemIndex(announce: boolean): Promise<void> {
    if (this.settings.jdexFolder === "") return;
    const index = scanVault(this.app, this.settings);
    const effects = this.journalOperation("fix", t().labelSystemIndex, !announce);
    const changed = await updateSystemIndex(this.app, this.settings, index, announce, effects);
    await effects.flush().catch(() => undefined);
    if (announce) new Notice(changed ? t().systemIndexUpdated : t().systemIndexUnchanged);
  }

  async createCategoryFlow(): Promise<void> {
    if (!this.ready()) return;
    const index = selectCreationSystem(scanVault(this.app, this.settings), namePrefix(this.settings));
    if (index.areas.length === 0) {
      new Notice(t().noAreas);
      return;
    }
    new AreaSuggestModal(this.app, index, (area) => {
      new CreateCategoryModal(this.app, index, area, this.settings, () => this.refreshHeaders(undefined, false), this.journalOperation("create-structure", t().labelCategoryIn(area.label))).open();
    }).open();
  }

  async createAreaFlow(): Promise<void> {
    if (!this.ready()) return;
    const index = selectCreationSystem(scanVault(this.app, this.settings), namePrefix(this.settings));
    new CreateAreaModal(this.app, index, this.settings, async () => {}, this.journalOperation("create-structure", t().cmdCreateArea)).open();
  }

  async createHeaderFlow(): Promise<void> {
    if (!this.ready()) return;
    const index = selectCreationSystem(scanVault(this.app, this.settings), namePrefix(this.settings));
    if (index.categories.length === 0) {
      new Notice(t().noCategories);
      return;
    }
    new CategorySuggestModal(this.app, index, (category) => {
      new CreateHeaderModal(this.app, index, category, this.settings, () => this.refreshHeaders(category.number, false), this.journalOperation("create-id", t().labelHeaderIn(category.label))).open();
    }).open();
  }

  async retireFlow(parent: { id: string; system?: string }): Promise<void> {
    if (!this.ready()) return;
    const index = scanVault(this.app, this.settings);
    const entry = index.ids.find((e) => e.id === parent.id && sameSystem(e, parent));
    if (!entry) return;
    if (this.refuseRepeated(index, entry)) return;
    const lines = [
      t().retireKeepsNumber(entry.label),
      entry.folderPath ? t().retireFolderMoves(entry.category) : t().retireNoFolder,
      t().nothingDeleted,
    ];
    const ok = await confirm(this.app, t().retireTitle(entry.id), lines, t().retireAction);
    if (!ok) return;
    // Each step is journaled as it happens, so a partial retirement stays undoable.
    const effects = this.journalOperation("retire", t().labelRetire(entry.id));
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
    new CreateChildModal(this.app, index, entry, this.settings, async () => {}, this.journalOperation("create-id", t().labelChildOf(entry.label))).open();
  }

  async createTemplates(): Promise<void> {
    if (this.settings.templatesFolder === "") {
      new Notice(t().setTemplatesFolderFirst);
      return;
    }
    const { created, skipped } = await writeBuiltinTemplates(this.app, this.settings);
    new Notice(t().templatesWritten(created, skipped));
  }

  async createIdFlow(): Promise<void> {
    if (this.settings.jdexFolder === "") {
      await this.detectFolders(false);
    }
    if (this.settings.jdexFolder === "") {
      new Notice(t().setJdexFolderFirst);
      return;
    }
    const index = selectCreationSystem(scanVault(this.app, this.settings), namePrefix(this.settings));
    if (index.categories.length === 0) {
      new Notice(t().noCategories);
      return;
    }
    new CategorySuggestModal(this.app, index, (category) => {
      new CreateIdModal(this.app, index, category, this.settings, async (request) => {
        await this.saveSettings();
        try {
          // Journaled effect by effect: a failure after creating the note keeps it undoable.
          const effects = this.journalOperation("create-id", t().labelCreateId(request.id, request.title.trim()));
          const note = await createId(this.app, this.settings, index, category, request, effects);
          await effects.flush();
          new Notice(t().createdNote(note.basename));
          if (request.createFolder && this.settings.afterCreateOpen === "folder" && category.path) {
            // No public API reveals a folder in the explorer: open the note and say where the folder is.
            await this.app.workspace.getLeaf(false).openFile(note);
            new Notice(t().folderAt(`${category.path}/${note.basename}`), 8000);
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

import { type App, Notice, type Plugin, PluginSettingTab, Setting } from "obsidian";
import { normalizeSystemId } from "../jd/parse";
import { formatCategoryPatterns, parseCategoryPatterns } from "../jd/patterns";
import type { JdexManagerSettings, JdexNoteType } from "../settings";
import { FolderSuggest } from "./folder-suggest";
import { t } from "./i18n";

/** What the settings tab needs from the plugin: its settings and the actions of its buttons. */
export interface SettingsHost {
  settings: JdexManagerSettings;
  saveSettings(): Promise<void>;
  detectFolders(announce: boolean): Promise<void>;
  createTemplates(): Promise<void>;
}

export class JdexManagerSettingTab extends PluginSettingTab {
  private readonly plugin: SettingsHost;

  constructor(app: App, plugin: Plugin & SettingsHost) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // `getSettingDefinitions` arrived in Obsidian 1.13; manifest.json minAppVersion is 1.7.2 (checked by npm run check:min-app), so it renders the tab itself.
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = t();

    this.folderSetting(
      s.setJdexFolder,
      s.setJdexFolderDesc,
      () => this.plugin.settings.jdexFolder,
      (v) => (this.plugin.settings.jdexFolder = v),
    );
    this.folderSetting(
      s.setSystemRoot,
      s.setSystemRootDesc,
      () => this.plugin.settings.systemRoot,
      (v) => (this.plugin.settings.systemRoot = v),
      s.setSystemRootPlaceholder,
    );
    this.folderSetting(
      s.setTemplatesFolder,
      s.setTemplatesFolderDesc,
      () => this.plugin.settings.templatesFolder,
      (v) => (this.plugin.settings.templatesFolder = v),
    );
    this.folderSetting(
      s.setReportsFolder,
      s.setReportsFolderDesc,
      () => this.plugin.settings.reportsFolder,
      (v) => (this.plugin.settings.reportsFolder = v),
    );

    new Setting(containerEl)
      .setName(s.setDetect)
      .setDesc(s.setDetectDesc)
      .addButton((button) =>
        button.setButtonText(s.setDetectButton).onClick(async () => {
          await this.plugin.detectFolders(true);
          // Re-render so the filled fields show up (see the note on `display` above).
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          this.display();
        }),
      );

    new Setting(containerEl).setName(s.setSeveralSystems).setHeading();

    new Setting(containerEl)
      .setName(s.setSystemId)
      .setDesc(s.setSystemIdDesc)
      .addText((text) => {
        // Typing `D01` passes through `D` and `D0`: saving on each keystroke is silent, and the
        // warning waits until the field loses focus, once.
        text
          .setPlaceholder(s.setSystemIdPlaceholder)
          .setValue(this.plugin.settings.systemId)
          .onChange(async (value) => {
            const id = normalizeSystemId(value);
            if (id === null) return;
            this.plugin.settings.systemId = id;
            await this.plugin.saveSettings();
          });
        text.inputEl.addEventListener("blur", () => {
          if (normalizeSystemId(text.getValue()) === null) {
            new Notice(s.setSystemIdInvalid);
          }
        });
      });

    new Setting(containerEl)
      .setName(s.setPrefixNames)
      .setDesc(s.setPrefixNamesDesc)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.prefixNamesWithSystem).onChange(async (value) => {
          this.plugin.settings.prefixNamesWithSystem = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName(s.setTemplates).setHeading();

    const labels: Record<JdexNoteType, string> = s.setTemplateFor;
    for (const type of Object.keys(labels) as JdexNoteType[]) {
      new Setting(containerEl)
        .setName(labels[type])
        .setDesc(s.setTemplateDesc)
        .addText((text) =>
          text.setValue(this.plugin.settings.templateNames[type]).onChange(async (value) => {
            this.plugin.settings.templateNames[type] = value.trim();
            await this.plugin.saveSettings();
          }),
        );
    }

    new Setting(containerEl)
      .setName(s.setWriteTemplates)
      .setDesc(s.setWriteTemplatesDesc)
      .addButton((button) => button.setButtonText(s.setWriteButton).onClick(() => void this.plugin.createTemplates()));

    new Setting(containerEl).setName(s.setAudit).setHeading();

    new Setting(containerEl)
      .setName(s.setMaintenance)
      .setDesc(s.setMaintenanceDesc)
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.automaticMaintenance).onChange(async (value) => {
        this.plugin.settings.automaticMaintenance = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName(s.setInboxAge)
      .setDesc(s.setInboxAgeDesc)
      .addText((text) => text.setValue(String(this.plugin.settings.inboxStaleDays)).onChange(async (value) => {
        const days = Number(value);
        if (!Number.isInteger(days) || days < 1) return;
        this.plugin.settings.inboxStaleDays = days;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName(s.setAuditOnStartup)
      .setDesc(s.setAuditOnStartupDesc)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.auditOnStartup).onChange(async (value) => {
          this.plugin.settings.auditOnStartup = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(s.setHealthMaxFiles)
      .setDesc(s.setHealthMaxFilesDesc)
      .addText((text) =>
        text.setValue(String(this.plugin.settings.healthMaxFiles)).onChange(async (value) => {
          const n = Number.parseInt(value, 10);
          if (!Number.isFinite(n) || n < 1) return;
          this.plugin.settings.healthMaxFiles = n;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(s.setNoteWithoutFolder)
      .setDesc(s.setNoteWithoutFolderDesc)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.noteWithoutFolderIsFinding).onChange(async (value) => {
          this.plugin.settings.noteWithoutFolderIsFinding = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(s.setDescriptionFinding)
      .setDesc(s.setDescriptionFindingDesc)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.descriptionIsFinding).onChange(async (value) => {
          this.plugin.settings.descriptionIsFinding = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(s.setStructureFinding)
      .setDesc(s.setStructureFindingDesc)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.structureNotesAreFindings).onChange(async (value) => {
          this.plugin.settings.structureNotesAreFindings = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(s.setDebugLog)
      .setDesc(s.setDebugLogDesc)
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.debugLog).onChange(async (value) => {
        this.plugin.settings.debugLog = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl).setName(s.setSystemIndex).setHeading();

    new Setting(containerEl)
      .setName(s.setIndexNote)
      .setDesc(s.setIndexNoteDesc)
      .addText((text) =>
        text
          .setPlaceholder(s.setIndexNotePlaceholder)
          .setValue(this.plugin.settings.systemIndexNote)
          .onChange(async (value) => {
            this.plugin.settings.systemIndexNote = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(s.setIndexOnCreate)
      .setDesc(s.setIndexOnCreateDesc)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.updateSystemIndexOnCreate).onChange(async (value) => {
          this.plugin.settings.updateSystemIndexOnCreate = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName(s.setEditor).setHeading();

    new Setting(containerEl)
      .setName(s.setAutocomplete)
      .setDesc(s.setAutocompleteDesc)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autocomplete).onChange(async (value) => {
          this.plugin.settings.autocomplete = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(s.setAutocompleteInserts)
      .setDesc(s.setAutocompleteInsertsDesc)
      .addDropdown((d) =>
        d
          .addOption("link", s.setInsertLink)
          .addOption("number", s.setInsertNumber)
          .setValue(this.plugin.settings.autocompleteInsert)
          .onChange(async (value) => {
            this.plugin.settings.autocompleteInsert = value === "number" ? "number" : "link";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(s.setReadingLinks)
      .setDesc(s.setReadingLinksDesc)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.readingLinks).onChange(async (value) => {
          this.plugin.settings.readingLinks = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName(s.setCoherence).setHeading();

    new Setting(containerEl)
      .setName(s.setRenamePairs)
      .setDesc(s.setRenamePairsDesc)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.renamePairsWithoutAsking).onChange(async (value) => {
          this.plugin.settings.renamePairsWithoutAsking = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(s.setLiveHeaders)
      .setDesc(s.setLiveHeadersDesc)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.liveHeaders).onChange(async (value) => {
          this.plugin.settings.liveHeaders = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName(s.setFiles).setHeading();

    new Setting(containerEl)
      .setName(s.setDateFormat)
      .setDesc(s.setDateFormatDesc)
      .addDropdown((d) =>
        d
          // A date format, the same in every language.
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
      .setName(s.setDateOnCreate)
      .setDesc(s.setDateOnCreateDesc)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.dateOnCreate).onChange(async (value) => {
          this.plugin.settings.dateOnCreate = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(s.setDateOnMove)
      .setDesc(s.setDateOnMoveDesc(s.cmdMoveToId))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.dateOnMove).onChange(async (value) => {
          this.plugin.settings.dateOnMove = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName(s.setPattern).setHeading();

    new Setting(containerEl)
      .setName(s.setDefaultPattern)
      .setDesc(s.setDefaultPatternDesc)
      .addTextArea((text) =>
        text.setValue(this.plugin.settings.subfolderPattern).onChange(async (value) => {
          this.plugin.settings.subfolderPattern = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(s.setCategoryPattern)
      .setDesc(s.setCategoryPatternDesc)
      .addTextArea((text) =>
        text.setValue(formatCategoryPatterns(this.plugin.settings.subfolderPatternsByCategory)).onChange(async (value) => {
          this.plugin.settings.subfolderPatternsByCategory = parseCategoryPatterns(value);
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName(s.cmdCreateId).setHeading();

    new Setting(containerEl)
      .setName(s.setAfterCreate)
      .setDesc(s.setAfterCreateDesc)
      .addDropdown((d) =>
        d
          .addOption("note", s.setOpenNote)
          .addOption("folder", s.setOpenNoteAndFolder)
          .setValue(this.plugin.settings.afterCreateOpen)
          .onChange(async (value) => {
            this.plugin.settings.afterCreateOpen = value === "folder" ? "folder" : "note";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(s.setFolderByDefault)
      .setDesc(s.setFolderByDefaultDesc)
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
    placeholder = t().setFolderPlaceholder,
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) => {
        // The suggestions are a help; the field stays free text.
        new FolderSuggest(this.app, text.inputEl);
        return text
          .setPlaceholder(placeholder)
          .setValue(get())
          .onChange(async (value) => {
            set(value.trim().replace(/^\/+|\/+$/g, ""));
            await this.plugin.saveSettings();
          });
      });
  }
}

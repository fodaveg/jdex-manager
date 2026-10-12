import { type App, Notice, type Plugin, PluginSettingTab, Setting } from "obsidian";
import { normalizeSystemId } from "../jd/parse";
import { formatCategoryPatterns, parseCategoryPatterns } from "../jd/patterns";
import type { JdexManagerSettings, JdexNoteType } from "../settings";
import { FolderSuggest } from "./folder-suggest";

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

    new Setting(containerEl).setName("Several systems").setHeading();

    new Setting(containerEl)
      .setName("System identifier")
      .setDesc("Only with several Johnny.Decimal systems: a letter and two digits (D01). Names like D01.21.22 are then understood. Empty = single system.")
      .addText((text) => {
        // Typing `D01` passes through `D` and `D0`: saving on each keystroke is silent, and the
        // warning waits until the field loses focus, once.
        text
          .setPlaceholder("Empty = single system")
          .setValue(this.plugin.settings.systemId)
          .onChange(async (value) => {
            const id = normalizeSystemId(value);
            if (id === null) return;
            this.plugin.settings.systemId = id;
            await this.plugin.saveSettings();
          });
        text.inputEl.addEventListener("blur", () => {
          if (normalizeSystemId(text.getValue()) === null) {
            // eslint-disable-next-line obsidianmd/ui/sentence-case
            new Notice("A system identifier is a capital letter and two digits, like D01. The value was not saved.");
          }
        });
      });

    new Setting(containerEl)
      .setName("Prefix new names with the system identifier")
      .setDesc("New notes and folders are named D01.21.22 Title instead of 21.22 Title.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.prefixNamesWithSystem).onChange(async (value) => {
          this.plugin.settings.prefixNamesWithSystem = value;
          await this.plugin.saveSettings();
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
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        .setDesc("Note name inside the templates folder. A note named with a category or area suffix (JDex - id - 21, JDex - id - 20-29) wins for that scope; the built-in template is used when none exists.")
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
      .setName("Automatic maintenance")
      .setDesc("After system changes, updates derived properties, header lists and the system index, with undo history.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.automaticMaintenance).onChange(async (value) => {
        this.plugin.settings.automaticMaintenance = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Inbox age in days")
      .setDesc("Notes created more than this many days ago in an inbox appear as informative findings.")
      .addText((text) => text.setValue(String(this.plugin.settings.inboxStaleDays)).onChange(async (value) => {
        const days = Number(value);
        if (!Number.isInteger(days) || days < 1) return;
        this.plugin.settings.inboxStaleDays = days;
        await this.plugin.saveSettings();
      }));

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
      .setName("Health report: files per ID")
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setDesc("IDs holding more files than this are listed in the health report as candidates for a + child or subfolders.")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.healthMaxFiles)).onChange(async (value) => {
          const n = Number.parseInt(value, 10);
          if (!Number.isFinite(n) || n < 1) return;
          this.plugin.settings.healthMaxFiles = n;
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

    new Setting(containerEl)
      .setName("Empty descriptions count as findings")
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setDesc("The audit lists JDex notes whose descripcion is empty and proposes the first sentence of the body.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.descriptionIsFinding).onChange(async (value) => {
          this.plugin.settings.descriptionIsFinding = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Areas and categories without a note count as findings")
      .setDesc("Off by default. Turn it on once the missing category and area notes have been created.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.structureNotesAreFindings).onChange(async (value) => {
          this.plugin.settings.structureNotesAreFindings = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Debug log")
      .setDesc("Off by default. Writes the date, place, path, error name and a sanitized stack of each error to a note in the reports folder (last 200 lines, no note content). Useful to report a failure on a phone.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.debugLog).onChange(async (value) => {
        this.plugin.settings.debugLog = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl).setName("System index").setHeading();

    new Setting(containerEl)
      .setName("Index note")
      .setDesc("Note that holds the whole system between jdex:indice markers. Empty = the note of 00.00.")
      .addText((text) =>
        text
          .setPlaceholder("Empty = note of 00.00")
          .setValue(this.plugin.settings.systemIndexNote)
          .onChange(async (value) => {
            this.plugin.settings.systemIndexNote = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Update the index when an ID is created")
      .setDesc("Regenerates the block after a new note appears in the index folder.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.updateSystemIndexOnCreate).onChange(async (value) => {
          this.plugin.settings.updateSystemIndexOnCreate = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName("Editor").setHeading();

    new Setting(containerEl)
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setName("Autocomplete IDs while typing")
      .setDesc("Typing 21.2 offers the IDs that start with it.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autocomplete).onChange(async (value) => {
          this.plugin.settings.autocomplete = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Autocomplete inserts")
      .setDesc("Enter inserts a link to the JDex note or the bare number; Shift+Enter always inserts the number.")
      .addDropdown((d) =>
        d
          // eslint-disable-next-line obsidianmd/ui/sentence-case
          .addOption("link", "Link to the JDex note")
          .addOption("number", "Number only")
          .setValue(this.plugin.settings.autocompleteInsert)
          .onChange(async (value) => {
            this.plugin.settings.autocompleteInsert = value === "number" ? "number" : "link";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Clickable numbers in reading view")
      .setDesc("A bare 21.22 in reading view links to its JDex note. The file is not modified.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.readingLinks).onChange(async (value) => {
          this.plugin.settings.readingLinks = value;
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

    new Setting(containerEl)
      .setName("Date files when moving them to an ID")
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setDesc("Off by default. Applies to \"Move active file to an ID\" when the target is a content ID.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.dateOnMove).onChange(async (value) => {
          this.plugin.settings.dateOnMove = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName("Subfolder pattern").setHeading();

    new Setting(containerEl)
      .setName("Default pattern")
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setDesc("Folders created inside a new ID, one per line (for example 70 Adjuntos). Empty = none.")
      .addTextArea((text) =>
        text.setValue(this.plugin.settings.subfolderPattern).onChange(async (value) => {
          this.plugin.settings.subfolderPattern = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Pattern per category")
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setDesc("One line per category: 21: 40 Audits y revisiones, 70 Adjuntos. Overrides the default for that category.")
      .addTextArea((text) =>
        text.setValue(formatCategoryPatterns(this.plugin.settings.subfolderPatternsByCategory)).onChange(async (value) => {
          this.plugin.settings.subfolderPatternsByCategory = parseCategoryPatterns(value);
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName("Create ID").setHeading();

    new Setting(containerEl)
      .setName("After creating an ID with its folder")
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setDesc("Open the JDex note, or the note plus a notice with the folder path (Obsidian has no API to reveal a folder).")
      .addDropdown((d) =>
        d
          .addOption("note", "Open the note")
          .addOption("folder", "Open the note and show the folder path")
          .setValue(this.plugin.settings.afterCreateOpen)
          .onChange(async (value) => {
            this.plugin.settings.afterCreateOpen = value === "folder" ? "folder" : "note";
            await this.plugin.saveSettings();
          }),
      );

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

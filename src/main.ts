import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_SETTINGS, type JdexManagerSettings } from "./settings";

export default class JdexManagerPlugin extends Plugin {
  settings: JdexManagerSettings = { ...DEFAULT_SETTINGS };

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new JdexManagerSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<JdexManagerSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

class JdexManagerSettingTab extends PluginSettingTab {
  private readonly plugin: JdexManagerPlugin;

  constructor(app: App, plugin: JdexManagerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      // "JDex" is a proper noun (Johnny.Decimal index), not a sentence-case slip.
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setName("JDex folder")
      .setDesc("Folder that holds one note per ID (for example 00-09 System/00 System/00.00 JDex).")
      .addText((text) =>
        text
          .setPlaceholder("Path inside the vault")
          .setValue(this.plugin.settings.jdexFolder)
          .onChange(async (value) => {
            this.plugin.settings.jdexFolder = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("System root")
      .setDesc("Folder that holds the area folders. Leave empty for the vault root.")
      .addText((text) =>
        text
          .setPlaceholder("Empty = vault root")
          .setValue(this.plugin.settings.systemRoot)
          .onChange(async (value) => {
            this.plugin.settings.systemRoot = value.trim();
            await this.plugin.saveSettings();
          }),
      );
  }
}

import { type App, Modal, Notice, normalizePath, Setting, SuggestModal, type TFile } from "obsidian";
import { areaCode, type AreaEntry, type CategoryEntry, findId, type IdEntry, type JdIndex } from "../jd/index";
import { jdexNoteName, nextFreeCategory, parseJdNumber } from "../jd/parse";
import { managementCategoryName, nextFreeArea, nextFreeHeader, parseNewArea, standardZeroNames, validateNewCategory } from "../jd/structure";
import type { JdexManagerSettings } from "../settings";
import { createJdexNote, ensureFolder } from "../vault/create";

export class AreaSuggestModal extends SuggestModal<AreaEntry> {
  private readonly areas: AreaEntry[];
  private readonly onPick: (area: AreaEntry) => void;

  constructor(app: App, index: JdIndex, onPick: (area: AreaEntry) => void) {
    super(app);
    this.areas = index.areas;
    this.onPick = onPick;
    this.setPlaceholder("Area for the new category");
  }

  getSuggestions(query: string): AreaEntry[] {
    const q = query.trim().toLowerCase();
    return q === "" ? this.areas : this.areas.filter((a) => a.label.toLowerCase().includes(q));
  }

  renderSuggestion(area: AreaEntry, el: HTMLElement): void {
    el.createDiv({ text: area.label });
  }

  onChooseSuggestion(area: AreaEntry): void {
    this.onPick(area);
  }
}

/** Shared skeleton: a number field with live validation, a title, optional toggles, a Create button. */
abstract class StructureModal extends Modal {
  protected number = "";
  protected title = "";
  protected readonly toggles: Record<string, boolean> = {};
  private errorEl: HTMLElement | null = null;
  private submitButton: HTMLButtonElement | null = null;

  protected abstract heading(): string;
  protected abstract numberDesc(): string;
  protected abstract validate(): string | null;
  protected abstract toggleDefs(): { key: string; name: string; desc: string; initial: boolean }[];
  protected abstract perform(): Promise<TFile | null>;

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle(this.heading());
    new Setting(contentEl)
      .setName("Number")
      .setDesc(this.numberDesc())
      .addText((text) =>
        text.setValue(this.number).onChange((v) => {
          this.number = v.trim();
          this.refresh();
        }),
      );
    new Setting(contentEl).setName("Title").addText((text) => {
      text.onChange((v) => {
        this.title = v;
        this.refresh();
      });
      window.setTimeout(() => text.inputEl.focus(), 0);
    });
    for (const def of this.toggleDefs()) {
      this.toggles[def.key] = def.initial;
      new Setting(contentEl)
        .setName(def.name)
        .setDesc(def.desc)
        .addToggle((t) => t.setValue(def.initial).onChange((v) => (this.toggles[def.key] = v)));
    }
    this.errorEl = contentEl.createDiv({ cls: "jdex-validation" });
    new Setting(contentEl).addButton((b) => {
      this.submitButton = b.buttonEl;
      b.setButtonText("Create")
        .setCta()
        .onClick(() => void this.submit());
    });
    this.refresh();
  }

  protected currentError(): string | null {
    const e = this.validate();
    if (e) return e;
    if (this.title.trim() === "") return "Give it a title.";
    return null;
  }

  private refresh(): void {
    const e = this.currentError();
    this.errorEl?.setText(e ?? "");
    if (this.submitButton) this.submitButton.disabled = e !== null;
  }

  private async submit(): Promise<void> {
    if (this.currentError()) return;
    this.close();
    try {
      const file = await this.perform();
      if (file) await this.app.workspace.getLeaf(false).openFile(file);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }
}

export class CreateCategoryModal extends StructureModal {
  constructor(
    app: App,
    private readonly index: JdIndex,
    private readonly area: AreaEntry,
    private readonly settings: JdexManagerSettings,
    private readonly afterCreate: () => Promise<void>,
  ) {
    super(app);
    this.number = nextFreeCategory(area.number, index.categories.map((c) => c.number)) ?? "";
  }
  protected heading(): string {
    return `New category in ${this.area.label}`;
  }
  protected numberDesc(): string {
    return this.number === "" ? "No free category left in this area." : "Next free category; edit if you need another.";
  }
  protected validate(): string | null {
    return validateNewCategory(this.index, this.area.number, this.number);
  }
  protected toggleDefs(): { key: string; name: string; desc: string; initial: boolean }[] {
    return [
      { key: "folder", name: "Also create the folder", desc: "Inside the area folder of the system root.", initial: this.settings.createFolderByDefault },
      { key: "inbox", name: "Create the inbox (.01)", desc: standardZeroNames("AC").inbox.title.replace("AC", this.number || "AC"), initial: true },
      { key: "archive", name: "Create the archive (.09)", desc: standardZeroNames("AC").archive.title.replace("AC", this.number || "AC"), initial: true },
    ];
  }
  protected async perform(): Promise<TFile | null> {
    const category = this.number;
    const name = jdexNoteName(category, this.title);
    const vars = { id: category, title: this.title.trim(), area: areaCode(this.area.number), areaTitle: this.area.label, category, categoryTitle: name };
    const note = await createJdexNote(this.app, this.settings, "categoria", name, vars);
    let folderPath: string | null = null;
    if (this.toggles.folder) {
      if (!this.area.path) new Notice(`No folder for ${this.area.label} in the system root; category folder not created.`);
      else {
        folderPath = normalizePath(`${this.area.path}/${name}`);
        await ensureFolder(this.app, folderPath);
      }
    }
    const zeros = standardZeroNames(category);
    for (const [key, zero] of [
      ["inbox", zeros.inbox],
      ["archive", zeros.archive],
    ] as const) {
      if (!this.toggles[key]) continue;
      const zeroName = jdexNoteName(zero.id, zero.title);
      if (!findId(this.index, zero.id)) {
        await createJdexNote(this.app, this.settings, "id", zeroName, { ...vars, id: zero.id, title: zero.title });
      }
      if (folderPath) await ensureFolder(this.app, `${folderPath}/${zeroName}`);
    }
    await this.afterCreate();
    return note;
  }
}

export class CreateAreaModal extends StructureModal {
  constructor(
    app: App,
    private readonly index: JdIndex,
    private readonly settings: JdexManagerSettings,
    private readonly afterCreate: () => Promise<void>,
  ) {
    super(app);
    const next = nextFreeArea(index);
    this.number = next === null ? "" : areaCode(next);
  }
  protected heading(): string {
    return "New area";
  }
  protected numberDesc(): string {
    return this.number === "" ? "No free area left." : "Next free area; edit if you need another.";
  }
  protected validate(): string | null {
    const r = parseNewArea(this.index, this.number);
    return "error" in r ? r.error : null;
  }
  protected toggleDefs(): { key: string; name: string; desc: string; initial: boolean }[] {
    return [
      { key: "folder", name: "Also create the folder", desc: "In the system root.", initial: this.settings.createFolderByDefault },
      { key: "management", name: "Create the management category (A0)", desc: "Gestión del área A0-A9.", initial: true },
    ];
  }
  protected async perform(): Promise<TFile | null> {
    const r = parseNewArea(this.index, this.number);
    if ("error" in r) throw new Error(r.error);
    const code = areaCode(r.area);
    const name = jdexNoteName(code, this.title);
    const vars = { id: code, title: this.title.trim(), area: code, areaTitle: name, category: "", categoryTitle: "" };
    const note = await createJdexNote(this.app, this.settings, "area", name, vars);
    let folderPath: string | null = null;
    if (this.toggles.folder) {
      folderPath = normalizePath(this.settings.systemRoot === "" ? name : `${this.settings.systemRoot}/${name}`);
      await ensureFolder(this.app, folderPath);
    }
    if (this.toggles.management) {
      const m = managementCategoryName(r.area);
      const mName = jdexNoteName(m.number, m.title);
      await createJdexNote(this.app, this.settings, "categoria", mName, { ...vars, id: m.number, title: m.title, category: m.number, categoryTitle: mName });
      if (folderPath) await ensureFolder(this.app, `${folderPath}/${mName}`);
    }
    await this.afterCreate();
    return note;
  }
}

export class CreateHeaderModal extends StructureModal {
  private emoji = "";
  constructor(
    app: App,
    private readonly index: JdIndex,
    private readonly category: CategoryEntry,
    private readonly settings: JdexManagerSettings,
    private readonly afterCreate: () => Promise<void>,
  ) {
    super(app);
    this.number = nextFreeHeader(index, category.number) ?? "";
  }
  protected heading(): string {
    return `New header in ${this.category.label}`;
  }
  protected numberDesc(): string {
    return this.number === "" ? "All nine headers exist already." : "Next free X0; edit if you need another.";
  }
  onOpen(): void {
    super.onOpen();
    const emojiSetting = new Setting(this.contentEl).setName("Emoji").setDesc("Optional, shown after the black square.");
    emojiSetting.addText((t) => t.onChange((v) => (this.emoji = v.trim())));
    // Put the emoji field right after the number field.
    this.contentEl.insertBefore(emojiSetting.settingEl, this.contentEl.children[1] ?? null);
  }
  protected validate(): string | null {
    const n = parseJdNumber(this.number);
    if (!n || n.kind !== "id" || n.extension) return "Type a header number like 14.20.";
    if (n.category !== this.category.number) return `The header must belong to category ${this.category.number}.`;
    const last = Number(n.id.split(".")[1]);
    if (last === 0 || last % 10 !== 0) return "A header ends in 0 (X0), from .10 to .90.";
    const used = findId(this.index, n.id);
    if (used) return `Already used by ${used.label}.`;
    return null;
  }
  protected toggleDefs(): { key: string; name: string; desc: string; initial: boolean }[] {
    return [];
  }
  protected async perform(): Promise<TFile | null> {
    const n = parseJdNumber(this.number);
    const id = n && n.kind === "id" ? n.id : this.number;
    const title = `${this.emoji ? this.emoji + " " : ""}${this.title.trim()}`;
    const name = jdexNoteName(id, `■ ${title}`);
    const area = this.index.areas.find((a) => a.number === this.category.areaNumber);
    const note = await createJdexNote(this.app, this.settings, "cabecera", name, {
      id,
      title,
      area: areaCode(this.category.areaNumber),
      areaTitle: area?.label ?? areaCode(this.category.areaNumber),
      category: this.category.number,
      categoryTitle: this.category.label,
    });
    await this.afterCreate();
    return note;
  }
}

export class CreateChildModal extends StructureModal {
  constructor(
    app: App,
    private readonly index: JdIndex,
    private readonly parent: IdEntry,
    private readonly settings: JdexManagerSettings,
    private readonly afterCreate: () => Promise<void>,
  ) {
    super(app);
    this.number = `${parent.id}+`;
  }
  protected heading(): string {
    return `New child of ${this.parent.label}`;
  }
  protected numberDesc(): string {
    return "Children share the parent number with a plus sign.";
  }
  protected validate(): string | null {
    if (this.number !== `${this.parent.id}+`) return `The number is fixed: ${this.parent.id}+.`;
    const taken = this.index.ids.some((e) => e.id === this.number && e.title === this.title.trim());
    if (taken) return "A child with that title exists already.";
    return null;
  }
  protected toggleDefs(): { key: string; name: string; desc: string; initial: boolean }[] {
    return [
      {
        key: "folder",
        name: "Also create the folder",
        desc: "A `+ Title` folder inside the parent ID folder, as the documentation suggests for file systems.",
        initial: this.settings.createFolderByDefault,
      },
    ];
  }
  protected async perform(): Promise<TFile | null> {
    const title = this.title.trim();
    const name = jdexNoteName(this.number, title);
    const category = this.index.categories.find((c) => c.number === this.parent.category);
    const area = category ? this.index.areas.find((a) => a.number === category.areaNumber) : undefined;
    const parentNote = this.parent.notePath ? this.parent.notePath.slice(this.parent.notePath.lastIndexOf("/") + 1, -3) : this.parent.label;
    const note = await createJdexNote(
      this.app,
      this.settings,
      "id",
      name,
      {
        id: this.number,
        title,
        area: category ? areaCode(category.areaNumber) : "",
        areaTitle: area?.label ?? "",
        category: this.parent.category,
        categoryTitle: category?.label ?? "",
      },
      `\n## Padre\n\n- [[${parentNote}]]\n`,
    );
    if (this.toggles.folder) {
      if (!this.parent.folderPath) new Notice(`${this.parent.label} has no folder; child folder not created.`);
      else await ensureFolder(this.app, `${this.parent.folderPath}/${jdexNoteName("+", title)}`);
    }
    await this.afterCreate();
    return note;
  }
}

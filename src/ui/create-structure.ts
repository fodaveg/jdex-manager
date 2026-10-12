import { type App, Modal, Notice, normalizePath, Setting, SuggestModal, type TFile } from "obsidian";
import { areaCode, type AreaEntry, type CategoryEntry, findId, selectCreationSystem, sameSystem, type IdEntry, type JdIndex } from "../jd/index";
import { jdexNoteName, nextFreeCategory, parseJdNumber } from "../jd/parse";
import { managementCategoryName, nextFreeArea, nextFreeHeader, parseNewArea, standardZeroNames, validateNewCategory } from "../jd/structure";
import { type JdexManagerSettings, namePrefix } from "../settings";
import { titleForCompare } from "../jd/title";
import { scanVault } from "../vault/scan";
import { createJdexNote, ensureFolder } from "../vault/create";
import { trackModal } from "./modal-registry";
import type { Effect } from "../jd/journal";
import { t, uiLanguage } from "./i18n";

export class AreaSuggestModal extends SuggestModal<AreaEntry> {
  private readonly areas: AreaEntry[];
  private readonly onPick: (area: AreaEntry) => void;

  constructor(app: App, index: JdIndex, onPick: (area: AreaEntry) => void) {
    super(app);
    this.areas = index.areas;
    this.onPick = onPick;
    this.setPlaceholder(t().areaPlaceholder);
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
  protected prepareSubmit(): void {}

  protected abstract perform(): Promise<TFile | null>;

  onOpen(): void {
    trackModal(this);
    const { contentEl } = this;
    contentEl.empty();
    const s = t();
    this.setTitle(this.heading());
    new Setting(contentEl)
      .setName(s.number)
      .setDesc(this.numberDesc())
      .addText((text) =>
        text.setValue(this.number).onChange((v) => {
          this.number = v.trim();
          this.refresh();
        }),
      );
    new Setting(contentEl).setName(s.title).addText((text) => {
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
    this.errorEl = contentEl.createDiv({ cls: "jdex-validation", attr: { role: "alert" } });
    new Setting(contentEl).addButton((b) => {
      this.submitButton = b.buttonEl;
      b.setButtonText(s.create)
        .setCta()
        .onClick(() => void this.submit());
    });
    this.refresh();
  }

  protected currentError(): string | null {
    const e = this.validate();
    if (e) return e;
    if (this.title.trim() === "") return t().giveTitle;
    return null;
  }

  private refresh(): void {
    const e = this.currentError();
    if (this.errorEl && this.errorEl.textContent !== (e ?? "")) this.errorEl.setText(e ?? "");
    if (this.submitButton) this.submitButton.disabled = e !== null;
  }

  private async submit(): Promise<void> {
    try { this.prepareSubmit(); } catch (error) {
      this.refresh();
      this.errorEl?.setText(error instanceof Error ? error.message : String(error));
      return;
    }
    if (this.currentError()) { this.refresh(); return; }
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
    private index: JdIndex,
    private readonly area: AreaEntry,
    private readonly settings: JdexManagerSettings,
    private readonly afterCreate: () => Promise<void>,
    /** Undo journal operation of this creation; a recording list saves each effect as it happens. */
    private readonly effects: Effect[] = [],
  ) {
    super(app);
    this.number = nextFreeCategory(area.number, index.categories.map((c) => c.number)) ?? "";
  }
  /** Re-reads the vault at confirm time: another device may have created this category. */
  protected prepareSubmit(): void {
    this.index = selectCreationSystem(scanVault(this.app, this.settings), namePrefix(this.settings));
    if (this.index.categories.some((c) => c.number === this.number)) {
      this.number = nextFreeCategory(this.area.number, this.index.categories.map((c) => c.number)) ?? "";
      const input = this.contentEl.querySelector<HTMLInputElement>("input");
      if (input) input.value = this.number;
      throw new Error(t().numberTaken(this.number || t().none));
    }
  }
  protected heading(): string {
    return t().newCategoryIn(this.area.label);
  }
  protected numberDesc(): string {
    return this.number === "" ? t().noFreeCategory : t().nextFreeCategory;
  }
  protected validate(): string | null {
    return validateNewCategory(this.index, this.area.number, this.number, uiLanguage());
  }
  protected toggleDefs(): { key: string; name: string; desc: string; initial: boolean }[] {
    return [
      { key: "folder", name: t().alsoCreateFolder, desc: t().categoryFolderDesc, initial: this.settings.createFolderByDefault },
      // The descriptions are the zero names written into the vault: system content, not translated.
      { key: "inbox", name: t().createInbox, desc: standardZeroNames("AC").inbox.title.replace("AC", this.number || "AC"), initial: true },
      { key: "archive", name: t().createArchive, desc: standardZeroNames("AC").archive.title.replace("AC", this.number || "AC"), initial: true },
    ];
  }
  protected async perform(): Promise<TFile | null> {
    const category = this.number;
    const name = jdexNoteName(category, this.title, namePrefix(this.settings));
    const vars = { id: category, title: this.title.trim(), area: areaCode(this.area.number), areaTitle: this.area.label, category, categoryTitle: name };
    const note = await createJdexNote(this.app, this.settings, "categoria", name, vars, "", this.effects);
    let folderPath: string | null = null;
    if (this.toggles.folder) {
      if (!this.area.path) new Notice(t().noAreaFolder(this.area.label));
      else {
        folderPath = normalizePath(`${this.area.path}/${name}`);
        await ensureFolder(this.app, folderPath, this.effects);
      }
    }
    const zeros = standardZeroNames(category);
    for (const [key, zero] of [
      ["inbox", zeros.inbox],
      ["archive", zeros.archive],
    ] as const) {
      if (!this.toggles[key]) continue;
      const zeroName = jdexNoteName(zero.id, zero.title, namePrefix(this.settings));
      if (!findId(this.index, zero.id)) {
        await createJdexNote(this.app, this.settings, "id", zeroName, { ...vars, id: zero.id, title: zero.title }, "", this.effects);
      }
      if (folderPath) await ensureFolder(this.app, `${folderPath}/${zeroName}`, this.effects);
    }
    await this.afterCreate();
    return note;
  }
}

export class CreateAreaModal extends StructureModal {
  constructor(
    app: App,
    private index: JdIndex,
    private readonly settings: JdexManagerSettings,
    private readonly afterCreate: () => Promise<void>,
    /** Undo journal operation of this creation; a recording list saves each effect as it happens. */
    private readonly effects: Effect[] = [],
  ) {
    super(app);
    const next = nextFreeArea(index);
    this.number = next === null ? "" : areaCode(next);
  }
  /** Re-reads the vault at confirm time: another device may have created this area. */
  protected prepareSubmit(): void {
    this.index = selectCreationSystem(scanVault(this.app, this.settings), namePrefix(this.settings));
    const r = parseNewArea(this.index, this.number, uiLanguage());
    if ("error" in r && /already exists|ya existe/.test(r.error)) {
      const next = nextFreeArea(this.index);
      this.number = next === null ? "" : areaCode(next);
      const input = this.contentEl.querySelector<HTMLInputElement>("input");
      if (input) input.value = this.number;
      throw new Error(t().numberTaken(this.number || t().none));
    }
  }
  protected heading(): string {
    return t().newArea;
  }
  protected numberDesc(): string {
    return this.number === "" ? t().noFreeArea : t().nextFreeArea;
  }
  protected validate(): string | null {
    const r = parseNewArea(this.index, this.number, uiLanguage());
    return "error" in r ? r.error : null;
  }
  protected toggleDefs(): { key: string; name: string; desc: string; initial: boolean }[] {
    return [
      { key: "folder", name: t().alsoCreateFolder, desc: t().areaFolderDesc, initial: this.settings.createFolderByDefault },
      // The description is the name of the note it creates: system content, not translated.
      { key: "management", name: t().createManagement, desc: `${managementCategoryName(0).title.replace(areaCode(0), "A0-A9")}.`, initial: true },
    ];
  }
  protected async perform(): Promise<TFile | null> {
    const r = parseNewArea(this.index, this.number, uiLanguage());
    if ("error" in r) throw new Error(r.error);
    const code = areaCode(r.area);
    const name = jdexNoteName(code, this.title, namePrefix(this.settings));
    const vars = { id: code, title: this.title.trim(), area: code, areaTitle: name, category: "", categoryTitle: "" };
    const note = await createJdexNote(this.app, this.settings, "area", name, vars, "", this.effects);
    let folderPath: string | null = null;
    if (this.toggles.folder) {
      folderPath = normalizePath(this.settings.systemRoot === "" ? name : `${this.settings.systemRoot}/${name}`);
      await ensureFolder(this.app, folderPath, this.effects);
    }
    if (this.toggles.management) {
      const m = managementCategoryName(r.area);
      const mName = jdexNoteName(m.number, m.title, namePrefix(this.settings));
      await createJdexNote(this.app, this.settings, "categoria", mName, { ...vars, id: m.number, title: m.title, category: m.number, categoryTitle: mName }, "", this.effects);
      if (folderPath) await ensureFolder(this.app, `${folderPath}/${mName}`, this.effects);
    }
    await this.afterCreate();
    return note;
  }
}

export class CreateHeaderModal extends StructureModal {
  private emoji = "";
  constructor(
    app: App,
    private index: JdIndex,
    private readonly category: CategoryEntry,
    private readonly settings: JdexManagerSettings,
    private readonly afterCreate: () => Promise<void>,
    /** Undo journal operation of this creation; a recording list saves each effect as it happens. */
    private readonly effects: Effect[] = [],
  ) {
    super(app);
    this.number = nextFreeHeader(index, category.number, category.system) ?? "";
  }
  protected prepareSubmit(): void {
    this.index = selectCreationSystem(scanVault(this.app, this.settings), this.category.system ?? namePrefix(this.settings));
    if (findId(this.index, this.number)) {
      this.number = nextFreeHeader(this.index, this.category.number) ?? "";
      const input = this.contentEl.querySelector<HTMLInputElement>("input");
      if (input) input.value = this.number;
      throw new Error(t().numberTaken(this.number || t().none));
    }
  }
  protected heading(): string {
    return t().newHeaderIn(this.category.label);
  }
  protected numberDesc(): string {
    return this.number === "" ? t().allHeadersExist : t().nextFreeHeader;
  }
  onOpen(): void {
    super.onOpen();
    const emojiSetting = new Setting(this.contentEl).setName(t().emoji).setDesc(t().emojiDesc);
    emojiSetting.addText((t) => t.onChange((v) => (this.emoji = v.trim())));
    // Put the emoji field right after the number field.
    this.contentEl.insertBefore(emojiSetting.settingEl, this.contentEl.children[1] ?? null);
  }
  protected validate(): string | null {
    const s = t();
    const n = parseJdNumber(this.number);
    if (!n || n.kind !== "id" || n.extension) return s.typeHeader;
    if (n.system && n.system !== (this.category.system ?? "")) return s.prefixMismatch;
    if (n.category !== this.category.number) return s.headerCategory(this.category.number);
    const last = Number(n.id.split(".")[1]);
    if (last === 0 || last % 10 !== 0) return s.headerEndsInZero;
    const used = findId(this.index, n.id, this.category.system);
    if (used) return s.alreadyUsedBy(used.label);
    return null;
  }
  protected toggleDefs(): { key: string; name: string; desc: string; initial: boolean }[] {
    return [];
  }
  protected async perform(): Promise<TFile | null> {
    const n = parseJdNumber(this.number);
    const id = n && n.kind === "id" ? n.id : this.number;
    const title = `${this.emoji ? this.emoji + " " : ""}${this.title.trim()}`;
    const name = jdexNoteName(id, `■ ${title}`, this.category.system ?? namePrefix(this.settings));
    const area = this.index.areas.find((a) => a.number === this.category.areaNumber);
    const note = await createJdexNote(this.app, this.settings, "cabecera", name, {
      id,
      title,
      area: areaCode(this.category.areaNumber),
      areaTitle: area?.label ?? areaCode(this.category.areaNumber),
      category: this.category.number,
      categoryTitle: this.category.label,
    }, "", this.effects);
    await this.afterCreate();
    return note;
  }
}

export class CreateChildModal extends StructureModal {
  constructor(
    app: App,
    private index: JdIndex,
    private readonly parent: IdEntry,
    private readonly settings: JdexManagerSettings,
    private readonly afterCreate: () => Promise<void>,
    /** Undo journal operation of this creation; a recording list saves each effect as it happens. */
    private readonly effects: Effect[] = [],
  ) {
    super(app);
    this.number = `${parent.id}+`;
  }
  protected prepareSubmit(): void {
    this.index = selectCreationSystem(scanVault(this.app, this.settings), this.parent.system ?? "");
  }
  protected heading(): string {
    return t().newChildOf(this.parent.label);
  }
  protected numberDesc(): string {
    return t().childNumberDesc;
  }
  protected validate(): string | null {
    if (this.number !== `${this.parent.id}+`) return t().childNumberFixed(this.parent.id);
    const taken = this.index.ids.some((e) => e.id === this.number && sameSystem(e, this.parent) && titleForCompare(e.title) === titleForCompare(jdexNoteName("", this.title).trim()));
    if (taken) return t().childExists;
    return null;
  }
  protected toggleDefs(): { key: string; name: string; desc: string; initial: boolean }[] {
    return [
      {
        key: "folder",
        name: t().alsoCreateFolder,
        desc: t().childFolderDesc,
        initial: this.settings.createFolderByDefault,
      },
    ];
  }
  protected async perform(): Promise<TFile | null> {
    const title = this.title.trim();
    const name = jdexNoteName(this.number, title, this.parent.system ?? "");
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
      this.effects,
    );
    if (this.toggles.folder) {
      if (!this.parent.folderPath) new Notice(t().parentHasNoFolder(this.parent.label));
      else await ensureFolder(this.app, `${this.parent.folderPath}/${jdexNoteName("+", title)}`, this.effects);
    }
    await this.afterCreate();
    return note;
  }
}

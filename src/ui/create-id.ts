import { type App, Modal, Notice, normalizePath, Setting, SuggestModal, TFile, TFolder } from "obsidian";
import { areaCode, areaOfCategory, type CategoryEntry, categoryUsage, findId, selectCreationSystem, type JdIndex, knownIds } from "../jd/index";
import { isReserved, jdexNoteName, nextFreeId, parseJdNumber } from "../jd/parse";
import { trackModal } from "./modal-registry";
import { renderTemplate, todayIso } from "../jd/template";
import { type JdexManagerSettings, namePrefix } from "../settings";
import { resolveTemplate } from "../vault/templates";
import { patternFor } from "../jd/patterns";
import { assertJdexFolderExists, ensureFolder } from "../vault/create";
import { scanVault } from "../vault/scan";
import type { Effect } from "../jd/journal";
import { t } from "./i18n";

/** Picks a category from the index, ordered by number. */
export class CategorySuggestModal extends SuggestModal<CategoryEntry> {
  private readonly index: JdIndex;
  private readonly categories: CategoryEntry[];
  private readonly onPick: (category: CategoryEntry) => void;

  constructor(app: App, index: JdIndex, onPick: (category: CategoryEntry) => void, placeholder = t().categoryPlaceholder) {
    super(app);
    this.index = index;
    this.categories = index.categories;
    this.onPick = onPick;
    this.setPlaceholder(placeholder);
  }

  getSuggestions(query: string): CategoryEntry[] {
    const q = query.trim().toLowerCase();
    if (q === "") return this.categories;
    return this.categories.filter((c) => c.label.toLowerCase().includes(q));
  }

  renderSuggestion(category: CategoryEntry, el: HTMLElement): void {
    el.createDiv({ text: category.label });
    const usage = categoryUsage(this.index, category.number, category.system);
    const s = t();
    const next = usage.next ? s.categoryNext(usage.next) : s.categoryFull;
    el.createDiv({ text: s.categoryUsage(areaCode(category.areaNumber), usage.used, usage.total, next), cls: "jdex-suggestion-note" });
  }

  onChooseSuggestion(category: CategoryEntry): void {
    this.onPick(category);
  }
}

export interface CreateIdRequest {
  id: string;
  title: string;
  createFolder: boolean;
  createPattern: boolean;
}

/** Why an ID typed by the user cannot be used, or null when it can. */
export function validateNewId(index: JdIndex, category: string, raw: string, system = index.system ?? ""): string | null {
  const s = t();
  const n = parseJdNumber(raw);
  if (!n || n.kind !== "id") return s.typeId;
  if (n.system && n.system !== system) return s.prefixMismatch;
  if (n.extension) return s.extensionFromParent;
  if (n.category !== category) return s.idCategory(category);
  if (isReserved(n)) return s.reservedNumbers;
  if (Number(n.id.split(".")[1]) % 10 === 0) return s.headersEndInZero;
  const used = findId(index, n.id, system);
  if (used) return s.alreadyUsedBy(used.label);
  return null;
}

/** Asks for number, title and whether to create the folder, then calls `onSubmit`. */
export class CreateIdModal extends Modal {
  private index: JdIndex;
  private readonly category: CategoryEntry;
  private readonly settings: JdexManagerSettings;
  private readonly onSubmit: (request: CreateIdRequest) => Promise<void>;

  private id: string;
  private title = "";
  private createFolder: boolean;
  private createPattern: boolean;
  private errorEl: HTMLElement | null = null;
  private submitButton: HTMLButtonElement | null = null;

  constructor(
    app: App,
    index: JdIndex,
    category: CategoryEntry,
    settings: JdexManagerSettings,
    onSubmit: (request: CreateIdRequest) => Promise<void>,
  ) {
    super(app);
    this.index = index;
    this.category = category;
    this.settings = settings;
    this.onSubmit = onSubmit;
    this.id = nextFreeId(category.number, knownIds(index, category.system)) ?? "";
    this.createFolder = settings.createFolderByDefault;
    this.createPattern = settings.createPatternByDefault;
  }

  onOpen(): void {
    trackModal(this);
    const { contentEl } = this;
    contentEl.empty();
    const s = t();
    this.setTitle(s.newIdIn(this.category.label));

    new Setting(contentEl)
      .setName(s.number)
      .setDesc(this.id === "" ? s.noFreeNumber : s.nextFreeNumber)
      .addText((text) => {
        text.setValue(this.id).onChange((value) => {
          this.id = value.trim();
          this.refreshValidation();
        });
        text.inputEl.addClass("jdex-id-input");
      });

    new Setting(contentEl).setName(s.title).addText((text) => {
      text.setPlaceholder(s.titlePlaceholder).onChange((value) => {
        this.title = value;
        this.refreshValidation();
      });
      text.inputEl.addClass("jdex-title-input");
      window.setTimeout(() => text.inputEl.focus(), 0);
    });

    new Setting(contentEl)
      .setName(s.alsoCreateFolder)
      .setDesc(s.idFolderDesc)
      .addToggle((toggle) => toggle.setValue(this.createFolder).onChange((value) => (this.createFolder = value)));

    const pattern = patternFor(this.settings, this.category.number);
    if (pattern.length > 0) {
      new Setting(contentEl)
        .setName(s.alsoCreatePattern)
        .setDesc(pattern.join(", "))
        .addToggle((toggle) => toggle.setValue(this.createPattern).onChange((value) => (this.createPattern = value)));
    }

    this.errorEl = contentEl.createDiv({ cls: "jdex-validation", attr: { role: "alert" } });

    new Setting(contentEl).addButton((button) => {
      this.submitButton = button.buttonEl;
      button
        .setButtonText(s.create)
        .setCta()
        .onClick(() => void this.submit());
    });

    contentEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing && this.submitButton && !this.submitButton.disabled) {
        event.preventDefault();
        void this.submit();
      }
    });

    this.refreshValidation();
  }

  private currentError(): string | null {
    const idError = validateNewId(this.index, this.category.number, this.id, this.category.system);
    if (idError) return idError;
    if (jdexNoteName(this.id, this.title) === this.id) return t().giveIdTitle;
    return null;
  }

  private refreshValidation(): void {
    const error = this.currentError();
    // Only on a change: a live region re-reads whatever is written into it.
    if (this.errorEl && this.errorEl.textContent !== (error ?? "")) this.errorEl.setText(error ?? "");
    if (this.submitButton) this.submitButton.disabled = error !== null;
  }

  private async submit(): Promise<void> {
    this.index = selectCreationSystem(scanVault(this.app, this.settings), this.category.system ?? namePrefix(this.settings));
    const conflict = this.currentError();
    if (conflict !== null) {
      this.id = nextFreeId(this.category.number, knownIds(this.index)) ?? "";
      const input = this.contentEl.querySelector<HTMLInputElement>(".jdex-id-input");
      if (input) input.value = this.id;
      this.refreshValidation();
      this.errorEl?.setText(t().nextFree(conflict, this.id || t().none));
      return;
    }
    const parsed = parseJdNumber(this.id);
    if (!parsed || parsed.kind !== "id") return;
    this.settings.createFolderByDefault = this.createFolder;
    this.settings.createPatternByDefault = this.createPattern;
    this.close();
    await this.onSubmit({ id: parsed.id, title: this.title, createFolder: this.createFolder, createPattern: this.createPattern });
  }
}

/**
 * Creates the JDex note for a new ID and, optionally, its folder. Never overwrites anything.
 * Returns the created note.
 */
export async function createId(
  app: App,
  settings: JdexManagerSettings,
  index: JdIndex,
  category: CategoryEntry,
  request: CreateIdRequest,
  effects: Effect[] = [],
): Promise<TFile> {
  const system = category.system ?? namePrefix(settings);
  index = selectCreationSystem(scanVault(app, settings), system);
  const error = validateNewId(index, category.number, request.id, system);
  if (error) throw new Error(error);
  const name = jdexNoteName(request.id, request.title, system);
  const notePath = normalizePath(`${settings.jdexFolder}/${name}.md`);
  const existing = findId(index, request.id, system);
  if (existing) throw new Error(t().idUsedBy(request.id, existing.label));
  if (app.vault.getAbstractFileByPath(notePath)) throw new Error(t().pathExists(notePath));
  assertJdexFolderExists(app, settings);

  const area = index.areas.find((a) => a.number === areaOfCategory(category.number));
  const template = await resolveTemplate(app, settings, "id", { category: category.number, area: areaCode(category.areaNumber) });
  const content = renderTemplate(template, {
    id: request.id,
    title: request.title.trim(),
    area: areaCode(category.areaNumber),
    areaTitle: area?.label ?? areaCode(category.areaNumber),
    category: category.number,
    categoryTitle: category.label,
    date: todayIso(),
  });

  const taken = findId(scanVault(app, settings), request.id, system);
  if (taken) throw new Error(t().idUsedBy(request.id, taken.label));
  const note = await app.vault.create(notePath, content);
  effects.push({ kind: "created-note", path: notePath, content });

  if (request.createFolder) {
    if (!category.path) {
      new Notice(t().noCategoryFolder(category.number));
    } else {
      const folderPath = normalizePath(`${category.path}/${name}`);
      const present = app.vault.getAbstractFileByPath(folderPath);
      if (present instanceof TFolder) new Notice(t().folderExisted(folderPath));
      else if (present) new Notice(t().notAFolder(folderPath));
      else {
        await app.vault.createFolder(folderPath);
        effects.push({ kind: "created-folder", path: folderPath });
      }
      if (request.createPattern && !(present && !(present instanceof TFolder))) {
        for (const sub of patternFor(settings, category.number)) {
          const subPath = normalizePath(`${folderPath}/${sub}`);
          if (await ensureFolder(app, subPath)) effects.push({ kind: "created-folder", path: subPath });
        }
      }
    }
  }

  return note;
}

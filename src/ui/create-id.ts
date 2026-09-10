import { type App, Modal, Notice, normalizePath, Setting, SuggestModal, TFile, TFolder } from "obsidian";
import { areaCode, areaOfCategory, type CategoryEntry, categoryUsage, findId, type JdIndex, knownIds } from "../jd/index";
import { isReserved, jdexNoteName, nextFreeId, parseJdNumber } from "../jd/parse";
import { renderTemplate, todayIso } from "../jd/template";
import type { JdexManagerSettings } from "../settings";
import { resolveTemplate } from "../vault/templates";
import { patternFor } from "../jd/patterns";
import { ensureFolder } from "../vault/create";

/** Picks a category from the index, ordered by number. */
export class CategorySuggestModal extends SuggestModal<CategoryEntry> {
  private readonly index: JdIndex;
  private readonly categories: CategoryEntry[];
  private readonly onPick: (category: CategoryEntry) => void;

  constructor(app: App, index: JdIndex, onPick: (category: CategoryEntry) => void, placeholder = "Category for the new ID") {
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
    const usage = categoryUsage(this.index, category.number);
    const next = usage.next ? ` · next ${usage.next}` : " · full";
    el.createDiv({ text: `${areaCode(category.areaNumber)} · ${usage.used} of ${usage.total} used${next}`, cls: "jdex-suggestion-note" });
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
export function validateNewId(index: JdIndex, category: string, raw: string): string | null {
  const n = parseJdNumber(raw);
  if (!n || n.kind !== "id") return "Type an ID like 21.23.";
  if (n.extension) return "Extensions (+) are created from their parent ID.";
  if (n.category !== category) return `The ID must belong to category ${category}.`;
  if (isReserved(n)) return ".00 to .09 are reserved for managing the category.";
  if (Number(n.id.split(".")[1]) % 10 === 0) return "IDs ending in 0 are headers.";
  const used = findId(index, n.id);
  if (used) return `Already used by ${used.label}.`;
  return null;
}

/** Asks for number, title and whether to create the folder, then calls `onSubmit`. */
export class CreateIdModal extends Modal {
  private readonly index: JdIndex;
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
    this.id = nextFreeId(category.number, knownIds(index)) ?? "";
    this.createFolder = settings.createFolderByDefault;
    this.createPattern = settings.createPatternByDefault;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle(`New ID in ${this.category.label}`);

    new Setting(contentEl)
      .setName("Number")
      .setDesc(this.id === "" ? "No free number left in this category." : "Next free number; edit if you need another.")
      .addText((text) => {
        text.setValue(this.id).onChange((value) => {
          this.id = value.trim();
          this.refreshValidation();
        });
        text.inputEl.addClass("jdex-id-input");
      });

    new Setting(contentEl).setName("Title").addText((text) => {
      text.setPlaceholder("What this ID is about").onChange((value) => {
        this.title = value;
        this.refreshValidation();
      });
      text.inputEl.addClass("jdex-title-input");
      window.setTimeout(() => text.inputEl.focus(), 0);
    });

    new Setting(contentEl)
      .setName("Also create the folder")
      .setDesc("Creates the ID folder inside its category in the system root.")
      .addToggle((toggle) => toggle.setValue(this.createFolder).onChange((value) => (this.createFolder = value)));

    const pattern = patternFor(this.settings, this.category.number);
    if (pattern.length > 0) {
      new Setting(contentEl)
        .setName("Also create the subfolder pattern")
        .setDesc(pattern.join(", "))
        .addToggle((toggle) => toggle.setValue(this.createPattern).onChange((value) => (this.createPattern = value)));
    }

    this.errorEl = contentEl.createDiv({ cls: "jdex-validation" });

    new Setting(contentEl).addButton((button) => {
      this.submitButton = button.buttonEl;
      button
        .setButtonText("Create")
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
    const idError = validateNewId(this.index, this.category.number, this.id);
    if (idError) return idError;
    if (jdexNoteName(this.id, this.title) === this.id) return "Give the ID a title.";
    return null;
  }

  private refreshValidation(): void {
    const error = this.currentError();
    if (this.errorEl) this.errorEl.setText(error ?? "");
    if (this.submitButton) this.submitButton.disabled = error !== null;
  }

  private async submit(): Promise<void> {
    if (this.currentError() !== null) return;
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
): Promise<TFile> {
  const name = jdexNoteName(request.id, request.title);
  const notePath = normalizePath(`${settings.jdexFolder}/${name}.md`);
  const existing = findId(index, request.id);
  if (existing) throw new Error(`${request.id} is already used by ${existing.label}.`);
  if (app.vault.getAbstractFileByPath(notePath)) throw new Error(`${notePath} already exists.`);

  const area = index.areas.find((a) => a.number === areaOfCategory(category.number));
  const template = await resolveTemplate(app, settings, "id");
  const content = renderTemplate(template, {
    id: request.id,
    title: request.title.trim(),
    area: areaCode(category.areaNumber),
    areaTitle: area?.label ?? areaCode(category.areaNumber),
    category: category.number,
    categoryTitle: category.label,
    date: todayIso(),
  });

  const note = await app.vault.create(notePath, content);

  if (request.createFolder) {
    if (!category.path) {
      new Notice(`Note created. No folder for category ${category.number} in the system root, so the ID folder was not created.`);
    } else {
      const folderPath = normalizePath(`${category.path}/${name}`);
      const present = app.vault.getAbstractFileByPath(folderPath);
      if (present instanceof TFolder) new Notice(`Folder ${folderPath} already existed.`);
      else if (present) new Notice(`${folderPath} exists and is not a folder; left untouched.`);
      else await app.vault.createFolder(folderPath);
      if (request.createPattern && !(present && !(present instanceof TFolder))) {
        for (const sub of patternFor(settings, category.number)) await ensureFolder(app, `${folderPath}/${sub}`);
      }
    }
  }

  return note;
}

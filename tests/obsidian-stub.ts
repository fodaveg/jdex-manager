/* eslint-disable obsidianmd/prefer-create-el, obsidianmd/prefer-active-doc -- the stub and its DOM helpers run outside Obsidian: there is no activeDocument or createEl yet. */
/*
 * Stand-in for the `obsidian` package so plugin code can be tested in Node.
 *
 * Rule: this stub is LOUD. What a test needs is modelled; everything else a real class has
 * throws `obsidian-stub: Class.member is not implemented`, so a test can never pass by silently
 * calling an API nobody modelled. Tests that replace a member (`Object.assign(plugin, {...})`,
 * `vi.spyOn`, a subclass override) keep working, because the throwing members are plain writable
 * prototype methods. The in-memory vault lives in tests/support/fake-obsidian-vault.ts.
 */
import { parse } from "yaml";

/** Obsidian 1.14.4's `parseYaml` is the `yaml` package's `parse` with default options. */
export function parseYaml(text: string): unknown {
  return parse(text) as unknown;
}
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

/** Defines prototype methods that throw: the loud default for every API not modelled below. */
function unmodelled(cls: { prototype: object; name: string }, names: readonly string[]): void {
  for (const name of names) {
    Object.defineProperty(cls.prototype, name, {
      value() {
        throw new Error(`obsidian-stub: ${cls.name}.${name} is not implemented`);
      },
      writable: true,
      configurable: true,
    });
  }
}

/** An `HTMLElement` when the test runs in a DOM environment (`// @vitest-environment happy-dom`), else it throws on use. */
function domElement(owner: string, member: string): HTMLElement {
  if (typeof document === "undefined") {
    throw new Error(`obsidian-stub: ${owner}.${member} needs a DOM; add "// @vitest-environment happy-dom" to the test`);
  }
  return document.createElement("div");
}

/** A property that creates its element on first read and can be replaced by a test. */
function lazyElement(cls: { prototype: object; name: string }, member: string): void {
  const key = Symbol(member);
  Object.defineProperty(cls.prototype, member, {
    get(this: Record<symbol, HTMLElement | undefined>) {
      return (this[key] ??= domElement(cls.name, member));
    },
    set(this: Record<symbol, HTMLElement | undefined>, value: HTMLElement) {
      this[key] = value;
    },
    configurable: true,
  });
}

export class App {}

export class Component {
  /** Lifecycle hooks are modelled as no-ops: a subclass overrides them. */
  load(): void {}
  onload(): void {}
  unload(): void {}
  onunload(): void {}
  /** Events handed to `registerEvent`, so a test can see what a view or plugin subscribed to. */
  declare registeredEvents: unknown[] | undefined;
  registerEvent(ref: unknown): void {
    (this.registeredEvents ??= []).push(ref);
  }
}
unmodelled(Component, ["addChild", "removeChild", "register", "registerDomEvent", "registerInterval"]);

export class Plugin extends Component {
  app: unknown;
  manifest: unknown;
  constructor(app?: unknown, manifest?: unknown) {
    super();
    this.app = app;
    this.manifest = manifest;
  }
  onUserEnable(): void {}
  onExternalSettingsChange(): void {}
}
unmodelled(Plugin, [
  "addCommand", "removeCommand", "addSettingTab", "addRibbonIcon", "addStatusBarItem", "registerView",
  "registerExtensions", "registerMarkdownPostProcessor", "registerMarkdownCodeBlockProcessor",
  "registerEditorExtension", "registerObsidianProtocolHandler", "registerEditorSuggest", "registerHoverLinkSource",
  "loadData", "saveData",
]);

export class Modal {
  isOpen = false;
  title = "";
  declare contentEl: HTMLElement;
  declare titleEl: HTMLElement;
  declare modalEl: HTMLElement;
  declare containerEl: HTMLElement;
  constructor(readonly app: unknown) {}
  /** Opens like Obsidian does: `onOpen` runs once. */
  open(): void {
    this.isOpen = true;
    this.onOpen();
  }
  /** Closes like Obsidian does: `onClose` runs once, and only when it was open. */
  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.onClose();
  }
  onOpen(): void {}
  onClose(): void {}
  setTitle(title: string): this {
    this.title = title;
    this.titleEl.textContent = title;
    return this;
  }
}
lazyElement(Modal, "contentEl");
lazyElement(Modal, "titleEl");
lazyElement(Modal, "modalEl");
lazyElement(Modal, "containerEl");
unmodelled(Modal, ["setContent", "setCloseCallback", "onHistoryBack"]);

export class SuggestModal<T> extends Modal {
  placeholder = "";
  instructions: unknown[] = [];
  setPlaceholder(text: string): void {
    this.placeholder = text;
  }
  setInstructions(instructions: unknown[]): void {
    this.instructions = instructions;
  }
  declare getSuggestions: (query: string) => T[] | Promise<T[]>;
  declare renderSuggestion: (value: T, el: HTMLElement) => void;
  declare onChooseSuggestion: (item: T, evt: MouseEvent | KeyboardEvent) => void;
}
unmodelled(SuggestModal, ["getSuggestions", "renderSuggestion", "onChooseSuggestion", "selectSuggestion", "onNoSuggestion"]);

/** One control added to a `Setting`; tests read and drive it like the user would. */
export class TextComponent {
  value = "";
  placeholder = "";
  private listener: ((value: string) => unknown) | null = null;
  getValue(): string { return this.value; }
  setValue(value: string): this { this.value = value; return this; }
  setPlaceholder(text: string): this { this.placeholder = text; return this; }
  onChange(callback: (value: string) => unknown): this { this.listener = callback; return this; }
  /** What typing does: updates the value and fires `onChange`. */
  type(value: string): unknown { this.value = value; return this.listener?.(value); }
}
unmodelled(TextComponent, ["setDisabled"]);
export class ToggleComponent {
  value = false;
  private listener: ((value: boolean) => unknown) | null = null;
  getValue(): boolean { return this.value; }
  setValue(value: boolean): this { this.value = value; return this; }
  onChange(callback: (value: boolean) => unknown): this { this.listener = callback; return this; }
  /** What a click does: flips the value and fires `onChange`. */
  toggle(): unknown { this.value = !this.value; return this.listener?.(this.value); }
}
unmodelled(ToggleComponent, ["setDisabled", "setTooltip"]);
export class DropdownComponent {
  value = "";
  options: Record<string, string> = {};
  private listener: ((value: string) => unknown) | null = null;
  addOption(value: string, display: string): this { this.options[value] = display; return this; }
  addOptions(options: Record<string, string>): this { Object.assign(this.options, options); return this; }
  getValue(): string { return this.value; }
  setValue(value: string): this { this.value = value; return this; }
  onChange(callback: (value: string) => unknown): this { this.listener = callback; return this; }
  choose(value: string): unknown { this.value = value; return this.listener?.(value); }
}
unmodelled(DropdownComponent, ["setDisabled"]);
export class ButtonComponent {
  text = "";
  cta = false;
  warning = false;
  disabled = false;
  private listener: (() => unknown) | null = null;
  setButtonText(text: string): this { this.text = text; return this; }
  setCta(): this { this.cta = true; return this; }
  setWarning(): this { this.warning = true; return this; }
  setDisabled(disabled: boolean): this { this.disabled = disabled; return this; }
  onClick(callback: () => unknown): this { this.listener = callback; return this; }
  /** What a click does; a disabled button does nothing, as in the app. */
  click(): unknown { return this.disabled ? undefined : this.listener?.(); }
}
unmodelled(ButtonComponent, ["setIcon", "setTooltip", "setClass", "removeCta"]);

export class Setting {
  name = "";
  desc = "";
  heading = false;
  readonly controls: Array<TextComponent | ToggleComponent | DropdownComponent | ButtonComponent> = [];
  /** Every `Setting` built since the test emptied this list, so a test can find the controls a modal created. */
  static created: Setting[] = [];
  constructor(readonly containerEl: unknown) {
    Setting.created.push(this);
  }
  setName(name: string): this { this.name = name; return this; }
  setDesc(desc: string): this { this.desc = desc; return this; }
  setHeading(): this { this.heading = true; return this; }
  private add<C extends Setting["controls"][number]>(control: C, callback: (control: C) => unknown): this {
    this.controls.push(control);
    callback(control);
    return this;
  }
  addText(callback: (component: TextComponent) => unknown): this { return this.add(new TextComponent(), callback); }
  addToggle(callback: (component: ToggleComponent) => unknown): this { return this.add(new ToggleComponent(), callback); }
  addDropdown(callback: (component: DropdownComponent) => unknown): this { return this.add(new DropdownComponent(), callback); }
  addButton(callback: (component: ButtonComponent) => unknown): this { return this.add(new ButtonComponent(), callback); }
}
unmodelled(Setting, ["addTextArea", "addSlider", "addColorPicker", "addExtraButton", "addSearch", "addProgressBar", "addMomentFormat", "setClass", "setDisabled", "setTooltip"]);

export class TAbstractFile {}
export class TFolder extends TAbstractFile {}
export class TFile extends TAbstractFile {}
export class Notice {
  /** Every message shown since the last `Notice.messages.length = 0`. */
  static messages: string[] = [];
  constructor(message: string) {
    Notice.messages.push(message);
  }
}
unmodelled(Notice, ["hide", "setMessage"]);

export class PluginSettingTab {
  declare containerEl: HTMLElement;
  constructor(readonly app: unknown, readonly plugin: unknown) {}
  display(): void {}
  hide(): void {}
}
lazyElement(PluginSettingTab, "containerEl");


export class EditorSuggest<T> {
  context: unknown = null;
  instructions: unknown[] = [];
  constructor(readonly app: unknown) {}
  setInstructions(instructions: unknown[]): void {
    this.instructions = instructions;
  }
  declare getSuggestions: (context: unknown) => T[] | Promise<T[]>;
  declare onTrigger: (cursor: unknown, editor: unknown, file: unknown) => unknown;
  declare renderSuggestion: (value: T, el: HTMLElement) => void;
  declare selectSuggestion: (value: T, evt: MouseEvent | KeyboardEvent) => void;
}
unmodelled(EditorSuggest, ["getSuggestions", "onTrigger", "renderSuggestion", "selectSuggestion", "open", "close"]);

export class ItemView extends Component {
  declare contentEl: HTMLElement;
  readonly app: unknown;
  constructor(readonly leaf: { app?: unknown }) {
    super();
    this.app = leaf?.app;
  }
  onOpen(): Promise<void> { return Promise.resolve(); }
  onClose(): Promise<void> { return Promise.resolve(); }
}
lazyElement(ItemView, "contentEl");
unmodelled(ItemView, ["getViewType", "getDisplayText", "getIcon", "getState", "setState", "addAction"]);

export const Platform = { isMobile: false, isMacOS: false };
export class AbstractInputSuggest<T> {
  constructor(readonly app: unknown, readonly textInputEl: unknown) {}
  /** Closes the suggestion popup; the stub only records that it happened. */
  closed = 0;
  close(): void { this.closed += 1; }
  declare getSuggestions: (query: string) => T[] | Promise<T[]>;
  declare renderSuggestion: (value: T, el: HTMLElement) => void;
  declare selectSuggestion: (value: T, evt: MouseEvent | KeyboardEvent) => void;
}
unmodelled(AbstractInputSuggest, ["getSuggestions", "renderSuggestion", "selectSuggestion", "setValue", "getValue", "onSelect", "open"]);

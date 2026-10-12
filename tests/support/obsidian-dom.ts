/* eslint-disable obsidianmd/prefer-create-el, obsidianmd/prefer-active-doc -- the stub and its DOM helpers run outside Obsidian: there is no activeDocument or createEl yet. */
/*
 * The DOM helpers Obsidian adds to every element and to the global scope (`createEl`, `empty`,
 * `addClass`, `setText`...), for UI tests that run under `// @vitest-environment happy-dom`.
 *
 * Only the subset the plugin's UI uses is modelled; anything else is simply absent and fails with
 * a TypeError on first use. Behaviour follows the documented API: `createEl(tag, { text, cls, attr })`
 * appends the new element to the receiver.
 */

interface ElementInfo {
  text?: string;
  cls?: string | string[];
  attr?: Record<string, string | number | boolean | null>;
  title?: string;
  value?: string;
  type?: string;
  placeholder?: string;
  href?: string;
}

function create(tag: string, info?: string | ElementInfo, callback?: (el: HTMLElement) => void): HTMLElement {
  const el = document.createElement(tag);
  const options: ElementInfo = typeof info === "string" ? { cls: info } : info ?? {};
  if (options.text !== undefined) el.textContent = options.text;
  if (options.cls !== undefined) el.classList.add(...(Array.isArray(options.cls) ? options.cls : options.cls.split(" ").filter((name) => name !== "")));
  for (const [name, value] of Object.entries(options.attr ?? {})) if (value !== null) el.setAttribute(name, String(value));
  if (options.title !== undefined) el.title = options.title;
  if (options.href !== undefined) el.setAttribute("href", options.href);
  if (options.type !== undefined) el.setAttribute("type", options.type);
  if (options.placeholder !== undefined) el.setAttribute("placeholder", options.placeholder);
  if (options.value !== undefined) (el as HTMLInputElement).value = options.value;
  callback?.(el);
  return el;
}

/** Installs the helpers once per test file; safe to call again. */
export function installObsidianDom(): void {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  const append = (parent: Element, tag: string, info?: string | ElementInfo, callback?: (el: HTMLElement) => void) => {
    const el = create(tag, info, callback);
    parent.appendChild(el);
    return el;
  };
  proto.createEl = function (this: Element, tag: string, info?: string | ElementInfo, callback?: (el: HTMLElement) => void) { return append(this, tag, info, callback); };
  proto.createDiv = function (this: Element, info?: string | ElementInfo, callback?: (el: HTMLElement) => void) { return append(this, "div", info, callback); };
  proto.createSpan = function (this: Element, info?: string | ElementInfo, callback?: (el: HTMLElement) => void) { return append(this, "span", info, callback); };
  proto.empty = function (this: Element) { this.replaceChildren(); };
  proto.addClass = function (this: Element, ...names: string[]) { this.classList.add(...names); };
  proto.removeClass = function (this: Element, ...names: string[]) { this.classList.remove(...names); };
  proto.hasClass = function (this: Element, name: string) { return this.classList.contains(name); };
  proto.setText = function (this: Element, text: string) { this.textContent = text; };
  proto.setAttr = function (this: Element, name: string, value: string | number | boolean | null) { if (value === null) this.removeAttribute(name); else this.setAttribute(name, String(value)); };
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.createEl = (tag: string, info?: string | ElementInfo, callback?: (el: HTMLElement) => void) => create(tag, info, callback);
  globals.createDiv = (info?: string | ElementInfo, callback?: (el: HTMLElement) => void) => create("div", info, callback);
  globals.createSpan = (info?: string | ElementInfo, callback?: (el: HTMLElement) => void) => create("span", info, callback);
}

/* Minimal stand-in for the `obsidian` package so pure logic can be tested in Node. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}
export class App {}
export class Plugin {}
export class Modal {}
export class SuggestModal<T> {
  setPlaceholder(_text: string): void {}
  getSuggestions(_query: string): T[] {
    return [];
  }
}
export class Setting {}
export class TAbstractFile {}
export class TFolder extends TAbstractFile {}
export class TFile extends TAbstractFile {}
export class Notice {
  constructor(_message: string) {}
}
export class PluginSettingTab {}

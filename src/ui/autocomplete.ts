import {
  type App,
  type Editor,
  EditorSuggest,
  type EditorPosition,
  type EditorSuggestContext,
  type EditorSuggestTriggerInfo,
  type TFile,
} from "obsidian";
import type { IdEntry, JdIndex } from "../jd/index";

export type InsertMode = "link" | "number";

/** Typing `21.2` anywhere offers the IDs that start with it; Enter inserts a wikilink to the JDex note. */
export class IdEditorSuggest extends EditorSuggest<IdEntry> {
  private readonly getIndex: () => JdIndex;
  private readonly getMode: () => InsertMode;
  private readonly enabled: () => boolean;

  constructor(app: App, getIndex: () => JdIndex, getMode: () => InsertMode, enabled: () => boolean) {
    super(app);
    this.getIndex = getIndex;
    this.getMode = getMode;
    this.enabled = enabled;
    this.setInstructions([
      { command: "↵", purpose: "insert" },
      { command: "⇧ ↵", purpose: "insert the number only" },
    ]);
  }

  onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
    if (!this.enabled()) return null;
    const before = editor.getLine(cursor.line).slice(0, cursor.ch);
    const m = /(?:^|[\s([])(\[\[)?(\d{2}\.\d{0,2})$/.exec(before);
    if (!m) return null;
    const matched = (m[1] ?? "") + m[2];
    return { start: { line: cursor.line, ch: cursor.ch - matched.length }, end: cursor, query: m[2] };
  }

  getSuggestions(context: EditorSuggestContext): IdEntry[] {
    const q = context.query;
    return this.getIndex()
      .ids.filter((e) => e.id.startsWith(q) && !e.id.endsWith("+"))
      .slice(0, 30);
  }

  renderSuggestion(entry: IdEntry, el: HTMLElement): void {
    el.createDiv({ text: entry.label });
    el.createDiv({ text: entry.notePath ? "note" : "folder only", cls: "jdex-suggestion-note" });
  }

  selectSuggestion(entry: IdEntry, evt: MouseEvent | KeyboardEvent): void {
    const ctx = this.context;
    if (!ctx) return;
    const numberOnly = evt.shiftKey || this.getMode() === "number" || !entry.notePath;
    const name = entry.notePath ? entry.notePath.slice(entry.notePath.lastIndexOf("/") + 1, -3) : entry.label;
    const hadBrackets = ctx.editor.getRange(ctx.start, ctx.end).startsWith("[[");
    const text = numberOnly ? (hadBrackets ? `[[${name}]]` : entry.id) : `[[${name}]]`;
    ctx.editor.replaceRange(text, ctx.start, ctx.end);
    const pos = { line: ctx.start.line, ch: ctx.start.ch + text.length };
    ctx.editor.setCursor(pos);
  }
}

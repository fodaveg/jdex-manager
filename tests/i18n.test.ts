// @vitest-environment happy-dom
/*
 * Interface language of the Obsidian plugin (Lumbre 9d8cdcd8, decision of 12 Oct 2026): English by
 * default, Spanish when Obsidian runs in Spanish. System content written into notes stays Spanish.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type App, Setting, TextComponent } from "obsidian";
import { managementCategoryName, standardZeroNames } from "../src/jd/structure";
import type { RenumberAction } from "../src/jd/pair";
import { DEFAULT_SETTINGS } from "../src/settings";
import { languageOf, setUiLanguage, t, UI_STRINGS, uiLanguage, type UiStrings } from "../src/ui/i18n";
import { JdexManagerSettingTab, type SettingsHost } from "../src/ui/settings-tab";
import { installObsidianDom } from "./support/obsidian-dom";
import { notices, resetStub, settings, textFields } from "./support/obsidian-stub-api";

installObsidianDom();
afterEach(() => setUiLanguage(null));

/** Every string a table can produce: plain values, nested records, and functions called with sample arguments. */
function values(table: UiStrings): string[] {
  const out: string[] = [];
  const sample: RenumberAction = { type: "renumbered", oldId: "21.11", newId: "21.12" };
  for (const value of Object.values(table) as unknown[]) {
    if (typeof value === "string") out.push(value);
    else if (typeof value === "function") {
      const fn = value as (...args: unknown[]) => string;
      out.push(fn.length > 0 && fn.toString().includes("action") ? fn(sample) : fn(...Array.from({ length: fn.length }, (_, i) => (i === 0 ? { id: "21.11", label: "x" } : 1))));
    } else out.push(...Object.values(value as Record<string, string>));
  }
  return out;
}

describe("the two interface tables", () => {
  it("have the same keys, nested keys and arities", () => {
    const { en, es } = UI_STRINGS;
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as (keyof UiStrings)[]) {
      const a: unknown = en[key];
      const b: unknown = es[key];
      expect(typeof b, key).toBe(typeof a);
      if (typeof a === "function") expect((b as () => string).length, key).toBe((a as () => string).length);
      if (typeof a === "object") expect(Object.keys(b as object).sort(), key).toEqual(Object.keys(a as object).sort());
      if (typeof a === "string") expect(a.trim() === "" || (b as string).trim() === "", key).toBe(false);
    }
  });

  it("keep system content out: zero names and management categories are not interface strings", () => {
    const content = [standardZeroNames("21").inbox.title, standardZeroNames("21").archive.title, managementCategoryName(20).title, "Inbox de la categoría", "Archivo de la categoría", "Gestión del área"];
    for (const language of ["en", "es"] as const) {
      const all = values(UI_STRINGS[language]).join("\n");
      for (const name of content) expect(all, `${language}: ${name}`).not.toContain(name);
    }
  });
});

describe("the interface language follows Obsidian's", () => {
  it("is Spanish for any Spanish locale and English for anything else", () => {
    for (const locale of ["es", "es-ES", "es-419", "ES", "es_MX"]) expect(languageOf(locale), locale).toBe("es");
    for (const locale of ["en", "en-gb", "de", "et", "eu", "", undefined, null]) expect(languageOf(locale), String(locale)).toBe("en");
  });

  it("reads moment's locale (English in the stub) unless a language is forced", () => {
    expect(uiLanguage()).toBe("en");
    setUiLanguage("es");
    expect(uiLanguage()).toBe("es");
    expect(t()).toBe(UI_STRINGS.es);
  });
});

describe("the notices whose wording matters (Lumbre a7a27bfb)", () => {
  const unnumbered: RenumberAction = { type: "unnumbered", oldId: "21.11" };
  const moved: RenumberAction = { type: "moved", id: "21.11", from: "21 A", to: "22 B" };

  it("the renumber notice names the undo command instead of a clickable «Deshacer»", () => {
    expect(UI_STRINGS.en.renumberNotice(unnumbered)).toBe("21.11 lost its number: an ID is never renumbered (johnnydecimal.com). Run «Undo last JDex operation» to put it back.");
    expect(UI_STRINGS.es.renumberNotice(unnumbered)).toBe("«21.11» ha perdido su número: un ID nunca se renumera (johnnydecimal.com). Usa «Deshacer la última operación de JDex» para recuperarlo.");
    for (const language of ["en", "es"] as const) {
      const text = UI_STRINGS[language].renumberNotice(unnumbered);
      expect(text).not.toMatch(/Deshacer\.$/);
      expect(text).toContain(`«${UI_STRINGS[language].cmdUndoLast}»`);
    }
  });

  it("the moved notice and the repeated-number notice exist in both languages", () => {
    expect(UI_STRINGS.en.movedNotice(moved)).toBe("21.11 moved to another category or area, from 21 A to 22 B. An ID keeps its number; create a new ID in the destination and archive this one.");
    expect(UI_STRINGS.es.movedNotice(moved)).toBe("«21.11» ha cambiado de categoría o área, de «21 A» a «22 B». Un ID conserva su número: crea un ID nuevo en el destino y archiva este.");
    expect(UI_STRINGS.en.repeatedId({ id: "21.23", system: "D01" })).toBe("D01.21.23 is repeated: resolve the repeated number first (audit report, section «IDs duplicados»). Nothing was changed.");
    expect(UI_STRINGS.es.repeatedId({ id: "21.23" })).toBe("21.23 está repetido: resuelve antes el número repetido (Auditoría › IDs duplicados). No se ha cambiado nada.");
  });

  it("the Repair command and modal share one name per language", () => {
    expect([UI_STRINGS.en.cmdRepair, UI_STRINGS.es.cmdRepair]).toEqual(["Repair JDex", "Reparar JDex"]);
    expect(UI_STRINGS.en.repairChanged("a.md")).toContain("open Repair JDex again");
    expect(UI_STRINGS.es.repairChanged("a.md")).toContain("vuelve a abrir Reparar JDex");
  });
});

describe("the settings tab", () => {
  beforeEach(() => {
    resetStub();
    // The stub leaves addTextArea unmodelled; the tab's two text areas behave like text fields here.
    vi.spyOn(Setting.prototype, "addTextArea").mockImplementation(function (this: Setting, callback) {
      return this.addText(callback as unknown as (component: TextComponent) => unknown);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  function render(): void {
    const host: SettingsHost = { settings: { ...DEFAULT_SETTINGS }, saveSettings: vi.fn(async () => {}), detectFolders: vi.fn(async () => {}), createTemplates: vi.fn(async () => {}) };
    const tab = new JdexManagerSettingTab({ vault: { getAllLoadedFiles: () => [] } } as unknown as App, host as unknown as ConstructorParameters<typeof JdexManagerSettingTab>[1]);
    // The tab renders itself with `display` because minAppVersion 1.7.2 predates getSettingDefinitions.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    tab.display();
  }

  it("renders every name and description in Spanish, with no English left, when Obsidian is in Spanish", () => {
    setUiLanguage("es");
    render();
    const english = new Set(values(UI_STRINGS.en));
    const shown = settings().flatMap((s) => [s.name, s.desc]).filter((text) => text !== "");
    expect(shown.length).toBeGreaterThan(50);
    expect(shown.filter((text) => english.has(text))).toEqual(["Editor"]);
    expect(shown).toContain("Registro de depuración");
    expect(shown).toContain("Desactivado por defecto. Se aplica a «Mover el fichero activo a un ID» cuando el destino es un ID de contenido.");
  });

  it("renders in English by default", () => {
    render();
    const names = settings().map((s) => s.name);
    expect(names).toContain("JDex folder");
    expect(names).toContain("Debug log");
  });

  it("warns about an invalid system identifier in the interface language, once, on blur", () => {
    setUiLanguage("es");
    render();
    const field = textFields().find((f) => f.placeholder === UI_STRINGS.es.setSystemIdPlaceholder)!;
    field.type("D");
    field.inputEl.dispatchEvent(new Event("blur"));
    expect(notices()).toEqual([UI_STRINGS.es.setSystemIdInvalid]);
  });
});

/*
 * No interface text is written outside the tables in the files that use them. A literal counts as
 * interface text when it has two words, or when it is handed straight to a UI call (name, title,
 * button, notice, placeholder, dropdown label). Comments, imports and the tables are not scanned.
 */
describe("no loose interface text in the migrated files", () => {
  // vitest runs from the repository root (as tests/min-app-version.test.ts relies on).
  const root = cwd();
  const files = ["src/main.ts", "src/vault/flows.ts", ...readdirSync(join(root, "src/ui")).filter((f) => f.endsWith(".ts") && f !== "i18n.ts").map((f) => `src/ui/${f}`)];
  const SINKS = new Set(["setName", "setDesc", "setTitle", "setButtonText", "setPlaceholder", "setText", "addRibbonIcon", "addOption", "confirm", "notice", "setInstructions"]);
  const PROPS = new Set(["name", "desc", "purpose", "text", "title", "placeholder"]);
  /** Literals that are not prose: formats, CSS, markers, note content written into the vault. */
  const ALLOWED = [/^YYYY-MM(-DD)?$/, /^\n## Padre\n\n- \[\[$/, /^\]\]\n$/];

  function loose(path: string, content = readFileSync(join(root, path), "utf8")): string[] {
    const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
      let text: string | null = null;
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
      else if (ts.isTemplateExpression(node)) text = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(" ");
      const literal = text;
      if (literal !== null && !ALLOWED.some((re) => re.test(literal))) {
        text = literal;
        const parent = node.parent;
        const callee = ts.isCallExpression(parent) || ts.isNewExpression(parent) ? parent.expression : null;
        const calleeName = callee ? (ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "") : "";
        const inSink = (calleeName !== "" && (SINKS.has(calleeName) || calleeName === "Notice") && /\p{L}{2}/u.test(text) && !(calleeName === "addOption" && (parent as ts.CallExpression).arguments[0] === node) && !(calleeName === "addRibbonIcon" && (parent as ts.CallExpression).arguments[0] === node))
          || (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name) && PROPS.has(parent.name.text) && /\p{L}{2}/u.test(text));
        if (inSink || /\p{L}{2,}[ ,.;:]+\p{L}{2,}/u.test(text)) found.push(`${path}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${JSON.stringify(text)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
  }

  it.each(files)("%s", (file) => {
    expect(loose(file)).toEqual([]);
  });

  it("catches a literal left behind (the scan itself works)", () => {
    const probe = [
      'new Notice(`Moved to ${to}.`);',
      'x.setName("Detect");',
      'd.addOption("link", "Links");',
      'm.setInstructions([{ command: "↵", purpose: "insert" }]);',
      'const cls = "jdex-panel"; this.addRibbonIcon("hash", t().cmdOpenIdPanel, run);',
      "// a comment with several words is not scanned",
    ].join("\n");
    expect(loose("probe.ts", probe).map((line) => line.split(": ").slice(1).join(": "))).toEqual(['"Moved to  ."', '"Detect"', '"Links"', '"insert"']);
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as pub from "../src/jd/public";

const JD_DIR = fileURLToPath(new URL("../src/jd", import.meta.url));

const FORBIDDEN_GLOBALS = ["Buffer", "process", "window", "document", "require", "globalThis", "navigator", "localStorage"];

/**
 * Blank out comments and the contents of string / template literals, keeping
 * the quotes and every newline so line numbers stay intact. Import specifiers
 * are kept separately (see `findImportSpecifiers`), so they read the raw text.
 */
function stripNoise(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  const blank = (c: string) => (c === "\n" ? "\n" : " ");
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") { out += " "; i++; }
    } else if (c === "/" && next === "*") {
      out += "  "; i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { out += blank(src[i]); i++; }
      if (i < n) { out += "  "; i += 2; }
    } else if (c === "'" || c === '"' || c === "`") {
      out += c; i++;
      while (i < n && src[i] !== c) {
        if (src[i] === "\\" && i + 1 < n) { out += " " + blank(src[i + 1]); i += 2; continue; }
        out += blank(src[i]); i++;
      }
      if (i < n) { out += c; i++; }
    } else {
      out += c; i++;
    }
  }
  return out;
}

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

/** Every module specifier pulled in by import / export-from / import() / require(), with its line. */
function findImportSpecifiers(src: string): { spec: string; line: number }[] {
  // Comments blanked, strings kept: only the specifier text matters here.
  const noComments = src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
  const found: { spec: string; line: number }[] = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?(["'])([^"']+)\1/g,
    /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+(["'])([^"']+)\1/g,
    /\bimport\s*\(\s*(["'])([^"']+)\1/g,
    /\brequire\s*\(\s*(["'])([^"']+)\1/g,
  ];
  for (const re of patterns) {
    for (const m of noComments.matchAll(re)) found.push({ spec: m[2], line: lineOf(noComments, m.index ?? 0) });
  }
  return found;
}

/** Violations of the purity contract in one source text, as `line N: message`. */
export function findViolations(src: string): string[] {
  const problems: string[] = [];
  for (const { spec, line } of findImportSpecifiers(src)) {
    if (!spec.startsWith("./")) problems.push(`line ${line}: imports "${spec}" (only "./" specifiers allowed)`);
  }
  const clean = stripNoise(src);
  const re = new RegExp(`(?<![\\w$.])(${FORBIDDEN_GLOBALS.join("|")})(?![\\w$])`, "g");
  for (const m of clean.matchAll(re)) problems.push(`line ${lineOf(clean, m.index ?? 0)}: uses global "${m[1]}"`);
  return problems;
}

describe("src/jd purity", () => {
  const files = readdirSync(JD_DIR).filter((f) => f.endsWith(".ts"));

  it("finds the engine modules", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("detector catches forbidden imports and globals", () => {
    const sample = [
      'import { App } from "obsidian";',
      "export const x = window.x;",
      'import fs from "node:fs";',
      'import { a } from "../settings";',
      'export * from "path";',
      'const m = await import("electron");',
      "// window in a comment is fine",
      'const s = "document in a string is fine";',
      "const y = foo.process;",
    ].join("\n");
    const found = findViolations(sample).join("\n");
    expect(found).toContain('line 1: imports "obsidian"');
    expect(found).toContain('line 2: uses global "window"');
    expect(found).toContain('line 3: imports "node:fs"');
    expect(found).toContain('line 4: imports "../settings"');
    expect(found).toContain('line 5: imports "path"');
    expect(found).toContain('line 6: imports "electron"');
    expect(found).not.toContain("line 7");
    expect(found).not.toContain("line 8");
    expect(found).not.toContain("line 9");
  });

  it("detector accepts clean code", () => {
    expect(findViolations('import { a } from "./parse";\nexport type { B } from "./x";\nconst z = 1;')).toEqual([]);
  });

  for (const file of files) {
    it(`${file} depends only on src/jd and standard JS`, () => {
      const problems = findViolations(readFileSync(join(JD_DIR, file), "utf8")).map((p) => `${file} ${p}`);
      expect(problems).toEqual([]);
    });
  }
});

describe("src/jd/public.ts", () => {
  it("re-exports a representative function of each module", () => {
    const names = [
      "parseJdNumber", // parse
      "buildIndex", // index
      "auditSystem", // audit
      "expectedFrontmatter", // audit
      "countProblems", // audit
      "renderReport", // audit-report
      "firstSentence", // description
      "detectFolders", // detect
      "locate", // files
      "inboxFolders", // files
      "idFolderOfPath", // files
      "categoryOfPath", // files
      "childrenOf", // headers
      "measureHealth", // health
      "pushOperation", // journal
      "pairAction", // pair
      "patternFor", // patterns
      "findJdNumbers", // reading-links
      "retirePlan", // retire
      "nextFreeArea", // structure
      "renderSystemIndex", // system-index
      "renderTemplate", // template
    ];
    const exported = pub as Record<string, unknown>;
    for (const name of names) expect(typeof exported[name], name).toBe("function");
  });

  it("has no export name defined by two modules", () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const file of readdirSync(JD_DIR).filter((f) => f.endsWith(".ts") && f !== "public.ts")) {
      const src = readFileSync(join(JD_DIR, file), "utf8");
      for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+([\w$]+)/gm)) {
        const prev = seen.get(m[1]);
        if (prev) dupes.push(`${m[1]} in ${prev} and ${file}`);
        else seen.set(m[1], file);
      }
    }
    expect(dupes).toEqual([]);
  });
});

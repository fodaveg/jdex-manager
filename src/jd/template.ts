/**
 * JDex note templates: variable substitution and the built-in defaults.
 * No Obsidian imports. The defaults copy the note shape of a real JDex vault.
 */

/** The four kinds of JDex note a template can target. */
export type JdexNoteType = "id" | "cabecera" | "categoria" | "area";

export interface TemplateVars {
  /** `21.22` for an ID, `21` for a category, `20-29` for an area. */
  id: string;
  title: string;
  /** Area number, `20-29`. */
  area: string;
  /** Full area folder name, `20-29 Trabajo y productos`. */
  areaTitle: string;
  /** Category number, `21`. */
  category: string;
  /** Full category folder name, `21 Productos de software propios`. */
  categoryTitle: string;
  /** `YYYY-MM-DD`. */
  date: string;
}

const VARIABLE = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;
const VARIABLE_AT = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/y;

function lookup(vars: Partial<TemplateVars>, name: string): string | undefined {
  return (vars as Record<string, string | undefined>)[name];
}

function renderLiteral(text: string, vars: Partial<TemplateVars>): string {
  return text.replace(VARIABLE, (whole, name: string) => lookup(vars, name) ?? whole);
}

/**
 * Whether `value` reads back as the same text when written as a plain (unquoted) YAML
 * scalar. Conservative: anything that could end the scalar, start another node or be
 * read as a number, boolean or null is not plain-safe. Inside a flow collection,
 * `, [ ] { }` also end the scalar.
 */
function plainSafe(value: string, flow: boolean): boolean {
  if (value === "") return true;
  if (/^\s|\s$|[\r\n\t]/u.test(value)) return false;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/u.test(value)) return false;
  if (/:(?:\s|$)|\s#/u.test(value)) return false;
  if (flow && /[,[\]{}]/u.test(value)) return false;
  if (/^(?:true|false|yes|no|on|off|y|n|null|~)$/iu.test(value)) return false;
  if (/^[-+]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$|^0x[\da-f]+$|^0o[0-7]+$|^[-+]?\.(?:inf|nan)$/iu.test(value)) return false;
  return true;
}

/** Substitutes each variable of a YAML fragment according to the quotes around it. */
function renderQuoteAware(text: string, vars: Partial<TemplateVars>, flow: boolean): string {
  let out = "";
  let state: "plain" | "double" | "single" = "plain";
  let i = 0;
  while (i < text.length) {
    VARIABLE_AT.lastIndex = i;
    const match = VARIABLE_AT.exec(text);
    if (match) {
      const value = lookup(vars, match[1]);
      if (value === undefined) out += match[0];
      else if (state === "double") out += JSON.stringify(value).slice(1, -1);
      else if (state === "single") out += value.replace(/'/gu, "''");
      else out += plainSafe(value, flow) ? value : JSON.stringify(value);
      i += match[0].length;
      continue;
    }
    const char = text[i];
    out += char;
    if (state === "plain") {
      if (char === '"') state = "double";
      else if (char === "'") state = "single";
    } else if (state === "double") {
      if (char === "\\" && i + 1 < text.length) {
        out += text[i + 1];
        i += 1;
      } else if (char === '"') state = "plain";
    } else if (char === "'") {
      if (text[i + 1] === "'") {
        out += "'";
        i += 1;
      } else state = "plain";
    }
    i += 1;
  }
  return out;
}

/** One line of the frontmatter block: `key: value`, `- item` or anything else. */
function renderYamlLine(line: string, vars: Partial<TemplateVars>): string {
  VARIABLE.lastIndex = 0;
  if (!VARIABLE.test(line)) return line;
  const cr = line.endsWith("\r") ? "\r" : "";
  const body = cr ? line.slice(0, -1) : line;
  const parts = /^([ \t]*(?:-[ \t]+)*(?:[\p{L}_][^:#{}"']*?[ \t]*:(?:[ \t]+|$))?)(.*)$/u.exec(body)!;
  const [, prefix, rest] = parts;
  const startsNode = /^["'[{|>]/u.test(rest);
  if (prefix.trim() === "" || rest === "" || startsNode) {
    return prefix + renderQuoteAware(rest, vars, rest.startsWith("[") || rest.startsWith("{")) + cr;
  }
  // A plain scalar: render it whole and quote it whole if it no longer reads back as
  // the same text. A trailing ` # comment` of the template stays a comment.
  const comment = /[ \t]#/u.exec(rest);
  const valuePart = comment ? rest.slice(0, comment.index) : rest;
  const tail = comment ? rest.slice(comment.index) : "";
  const value = renderLiteral(valuePart, vars);
  if (value === valuePart || plainSafe(value, false)) return prefix + value + tail + cr;
  return prefix + JSON.stringify(value) + tail + cr;
}

/** End of the opening `---` line and start of the closing delimiter, when `text` starts with frontmatter. */
function frontmatterSpan(text: string): { open: number; close: number } | null {
  const opening = /^---\r?\n/u.exec(text);
  if (!opening) return null;
  let cursor = opening[0].length;
  while (cursor < text.length) {
    const newline = text.indexOf("\n", cursor);
    const to = newline < 0 ? text.length : newline + 1;
    const line = text.slice(cursor, to).replace(/\r?\n$/u, "");
    if (line === "---" || line === "...") return { open: opening[0].length, close: cursor };
    cursor = to;
  }
  return null;
}

/**
 * Replaces `{{name}}` with `vars[name]`. Unknown variables are left untouched.
 * Inside the frontmatter block at the start, each value is written so the YAML still
 * reads back as the same text: escaped inside `"…"` or `'…'`, and a plain scalar that
 * would break (or change type) is quoted whole. Outside it, substitution is literal.
 */
export function renderTemplate(text: string, vars: Partial<TemplateVars>): string {
  const span = frontmatterSpan(text);
  if (!span) return renderLiteral(text, vars);
  const block = text
    .slice(span.open, span.close)
    .split("\n")
    .map((line) => renderYamlLine(line, vars))
    .join("\n");
  return text.slice(0, span.open) + block + renderLiteral(text.slice(span.close), vars);
}

/** Where a note is being created, so a template can be picked per category or area. */
export interface TemplateScope {
  /** `21`. */
  category?: string;
  /** `20-29`. */
  area?: string;
}

/**
 * Note names to try, most specific first: `JDex - id - 21`, then `JDex - id - 20-29`, then `JDex - id`.
 * The caller reads the first one that exists and falls back to the built-in template.
 */
export function templateNameCandidates(base: string, scope: TemplateScope = {}): string[] {
  const out: string[] = [];
  if (scope.category) out.push(`${base} - ${scope.category}`);
  if (scope.area) out.push(`${base} - ${scope.area}`);
  out.push(base);
  return out;
}

/** Today as `YYYY-MM-DD` in local time. */
export function todayIso(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const CONTENT_SECTION = `## Contenido

\`\`\`dataview
LIST
WHERE contains(file.folder, this.jd + " ")
SORT file.name ASC
\`\`\`
`;

export const BUILTIN_TEMPLATES: Record<JdexNoteType, string> = {
  id: `---
jd: "{{id}}"
tipo: id
descripcion: ""
area: "{{areaTitle}}"
categoria: "{{categoryTitle}}"
---
# {{id}} {{title}}

${CONTENT_SECTION}
## Dónde vive

## Relacionado

`,
  cabecera: `---
jd: "{{id}}"
tipo: cabecera
descripcion: ""
area: "{{areaTitle}}"
categoria: "{{categoryTitle}}"
---
# {{id}} ■ {{title}}
Cabecera del JDex: agrupa los IDs de este bloque y no contiene archivos.

<!-- jdex:hijos -->
<!-- /jdex:hijos -->

`,
  categoria: `---
jd: "{{category}}"
tipo: categoria
descripcion: ""
area: "{{areaTitle}}"
---
# {{category}} {{title}}

${CONTENT_SECTION}
## Relacionado

`,
  area: `---
jd: "{{area}}"
tipo: area
descripcion: ""
---
# {{area}} {{title}}

${CONTENT_SECTION}
## Relacionado

`,
};

export const TEMPLATE_TYPES: JdexNoteType[] = ["id", "cabecera", "categoria", "area"];

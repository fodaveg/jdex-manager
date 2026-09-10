/**
 * JDex note templates: variable substitution and the built-in defaults.
 * No Obsidian imports. The defaults copy the note shape of a real JDex vault.
 */

import type { JdexNoteType } from "../settings";

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

/** Replaces `{{name}}` with `vars[name]`. Unknown variables are left untouched. */
export function renderTemplate(text: string, vars: Partial<TemplateVars>): string {
  return text.replace(VARIABLE, (whole, name: string) => {
    const value = (vars as Record<string, string | undefined>)[name];
    return value === undefined ? whole : value;
  });
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

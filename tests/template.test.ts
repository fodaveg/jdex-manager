import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { BUILTIN_TEMPLATES, renderTemplate, TEMPLATE_TYPES, todayIso } from "../src/jd/template";

const VARS = {
  id: "21.23",
  title: "Prueba",
  area: "20-29",
  areaTitle: "20-29 Trabajo y productos",
  category: "21",
  categoryTitle: "21 Productos de software propios",
  date: "2026-09-10",
};

describe("renderTemplate", () => {
  it("substitutes every variable, with or without inner spaces", () => {
    const text = "{{id}}|{{title}}|{{area}}|{{areaTitle}}|{{category}}|{{ categoryTitle }}|{{date}}";
    expect(renderTemplate(text, VARS)).toBe(
      "21.23|Prueba|20-29|20-29 Trabajo y productos|21|21 Productos de software propios|2026-09-10",
    );
  });

  it("leaves unknown variables and partial braces untouched", () => {
    expect(renderTemplate("{{nope}} {{id}} {id} {{", VARS)).toBe("{{nope}} 21.23 {id} {{");
    expect(renderTemplate("{{title}}", {})).toBe("{{title}}");
  });
});

describe("built-in templates", () => {
  it("renders the id template with the vault's frontmatter", () => {
    const out = renderTemplate(BUILTIN_TEMPLATES.id, VARS);
    expect(out.startsWith("---\n")).toBe(true);
    expect(out).toContain('jd: "21.23"\n');
    expect(out).toContain("tipo: id\n");
    expect(out).toContain('area: "20-29 Trabajo y productos"\n');
    expect(out).toContain('categoria: "21 Productos de software propios"\n');
    expect(out).toContain("\n# 21.23 Prueba\n");
    expect(out).toContain('WHERE contains(file.folder, this.jd + " ")');
    expect(out).toContain("## Dónde vive");
    expect(out).toContain("## Relacionado");
    expect(out).not.toContain("{{");
  });

  it("has one template per type and none leaves a variable unrendered", () => {
    expect(TEMPLATE_TYPES).toEqual(["id", "cabecera", "categoria", "area"]);
    for (const type of TEMPLATE_TYPES) {
      expect(renderTemplate(BUILTIN_TEMPLATES[type], VARS), type).not.toContain("{{");
    }
    expect(renderTemplate(BUILTIN_TEMPLATES.cabecera, VARS)).toContain("tipo: cabecera");
    expect(renderTemplate(BUILTIN_TEMPLATES.cabecera, VARS)).toContain("# 21.23 ■ Prueba");
    expect(renderTemplate(BUILTIN_TEMPLATES.categoria, VARS)).toContain('jd: "21"');
    expect(renderTemplate(BUILTIN_TEMPLATES.area, VARS)).toContain('jd: "20-29"');
  });
});

describe("todayIso", () => {
  it("formats local dates with zero padding", () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(todayIso(new Date(2026, 8, 10))).toBe("2026-09-10");
  });
});

describe("renderTemplate escapes variables inside the frontmatter by context", () => {
  const frontmatterOf = (text: string) => parseYaml(/^---\n([\s\S]*?)\n---/u.exec(text)![1]) as Record<string, unknown>;

  it("the built-in id template stays readable with quotes and backslashes in folder names", () => {
    const out = renderTemplate(BUILTIN_TEMPLATES.id, { ...VARS, categoryTitle: '21 Software "propio"', areaTitle: "C:\\x" });
    const fm = frontmatterOf(out);
    expect(fm.categoria).toBe('21 Software "propio"');
    expect(fm.area).toBe("C:\\x");
    expect(fm.jd).toBe("21.23");
  });

  it("a user template with a plain titulo: {{title}} quotes a value that would break YAML", () => {
    const out = renderTemplate("---\ntitulo: {{title}}\n---\n# {{title}}\n", { title: "Plan: fase 1" });
    expect(frontmatterOf(out).titulo).toBe("Plan: fase 1");
    // Outside the frontmatter the substitution stays literal.
    expect(out.endsWith("\n# Plan: fase 1\n")).toBe(true);
  });

  it("quotes the whole plain scalar and keeps a trailing comment", () => {
    const out = renderTemplate("---\ntitulo: Proyecto {{title}} # nota mía\n---\n", { title: "Plan: fase 1" });
    expect(out).toContain("# nota mía");
    expect(frontmatterOf(out).titulo).toBe("Proyecto Plan: fase 1");
  });

  it("escapes inside single quotes and list items", () => {
    const out = renderTemplate("---\nalias: '{{title}}'\nlista:\n  - {{title}}\n---\n", { title: "it's #1: yes" });
    const fm = frontmatterOf(out);
    expect(fm.alias).toBe("it's #1: yes");
    expect(fm.lista).toEqual(["it's #1: yes"]);
  });

  it("escapes inside a flow sequence", () => {
    const out = renderTemplate('---\naliases: [{{title}}, "{{title}}"]\n---\n', { title: 'a, "b"' });
    expect(frontmatterOf(out).aliases).toEqual(['a, "b"', 'a, "b"']);
  });

  it("a plain value that would change type is quoted, a date-like plain value is not", () => {
    const out = renderTemplate("---\njd: {{id}}\nfecha: {{date}}\n---\n", { id: "21.20", date: "2026-10-12" });
    expect(out).toContain('jd: "21.20"');
    expect(out).toContain("fecha: 2026-10-12");
    expect(frontmatterOf(out).jd).toBe("21.20");
  });

  it("control: ordinary names render exactly as before", () => {
    const out = renderTemplate(BUILTIN_TEMPLATES.id, VARS);
    expect(out.startsWith('---\njd: "21.23"\ntipo: id\ndescripcion: ""\narea: "20-29 Trabajo y productos"\ncategoria: "21 Productos de software propios"\n---\n# 21.23 Prueba\n')).toBe(true);
    expect(renderTemplate("---\ntitulo: {{title}}\n---\n", { title: "Plan de fase" })).toBe("---\ntitulo: Plan de fase\n---\n");
  });
});

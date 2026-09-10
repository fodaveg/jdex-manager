import { describe, expect, it } from "vitest";
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

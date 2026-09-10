import { describe, expect, it } from "vitest";
import { firstSentence, stripFrontmatter } from "../src/jd/description";
import { auditSystem } from "../src/jd/audit";
import { buildIndex } from "../src/jd/index";

const NOTE = `---
jd: "21.22"
tipo: id
descripcion: ""
---
# 21.22 JDex Manager

Plugin de Obsidian hecho en casa que trata el [[00.00 JDex del sistema|JDex]] como lo que es: el **sistema**. Segunda frase.

## Contenido

\`\`\`dataview
LIST
\`\`\`
`;

describe("firstSentence", () => {
  it("skips frontmatter, headings and code, cleans links and cuts at the first full stop", () => {
    expect(stripFrontmatter(NOTE).startsWith("# 21.22")).toBe(true);
    expect(firstSentence(NOTE)).toBe("Plugin de Obsidian hecho en casa que trata el JDex como lo que es: el sistema.");
  });

  it("returns null when there is no prose", () => {
    expect(firstSentence("# Solo título\n\n- lista\n- otra\n")).toBeNull();
    expect(firstSentence("")).toBeNull();
  });

  it("caps very long paragraphs", () => {
    const long = "# T\n\n" + "palabra ".repeat(80);
    expect(firstSentence(long)!.length).toBeLessThanOrEqual(200);
    expect(firstSentence(long)!.endsWith("…")).toBe(true);
  });
});

describe("audit: missing description", () => {
  const index = buildIndex({ systemRoot: "", folderPaths: [], jdexFolder: "JDex", notePaths: ["JDex/21.22 A.md", "JDex/21.23 B.md", "JDex/21.24 C.md"] });
  const findings = auditSystem({
    index,
    filePaths: [],
    notes: [
      { path: "JDex/21.22 A.md", frontmatter: { jd: "21.22", tipo: "id", descripcion: "" }, body: NOTE },
      { path: "JDex/21.23 B.md", frontmatter: { jd: "21.23", tipo: "id" }, body: "# 21.23 B\n\n- nada\n" },
      { path: "JDex/21.24 C.md", frontmatter: { jd: "21.24", tipo: "id", descripcion: "ya tiene" } },
    ],
  }).filter((f) => f.kind === "missing-description");

  it("proposes a description when the body has prose, otherwise just reports", () => {
    expect(findings.map((f) => f.paths[0])).toEqual(["JDex/21.22 A.md", "JDex/21.23 B.md"]);
    expect(findings[0].fix).toEqual({
      type: "frontmatter",
      path: "JDex/21.22 A.md",
      set: { descripcion: "Plugin de Obsidian hecho en casa que trata el JDex como lo que es: el sistema." },
    });
    expect(findings[1].fix).toBeUndefined();
    expect(findings[0].informative).toBe(false);
  });
});

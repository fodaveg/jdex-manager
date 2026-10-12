/*
 * Texts the pure engine words for a host's interface take an optional `MessageLanguage`
 * (Lumbre 9d8cdcd8). Omitted, every text is exactly the one Hebra has always shown.
 */
import { describe, expect, it } from "vitest";
import { auditSystem, missingConfiguredFolders } from "../src/jd/audit";
import { buildIndex, findId } from "../src/jd/index";
import { staleInboxFindings } from "../src/jd/inbox-stale";
import { describeUndo, undoWarnings, type Operation } from "../src/jd/journal";
import { retirePlan } from "../src/jd/retire";
import { parseNewArea, validateNewCategory } from "../src/jd/structure";

const index = buildIndex({
  systemRoot: "",
  jdexFolder: "J",
  folderPaths: ["20-29 A", "20-29 A/21 C", "20-29 A/21 C/21.11 Algo", "20-29 A/21 C/21.12 Solo", "20-29 A/21 C/21.2 Mal", "20-29 A/21 C/21.01 Inbox"],
  notePaths: ["J/21.11 Algo.md", "J/21.11 Otro.md", "J/21.13 Nota.md"],
});

function messages(language?: "en" | "es"): string[] {
  return auditSystem({
    index,
    jdexFolder: "J",
    notes: [
      { path: "J/21.11 Algo.md", frontmatter: { descripcion: "x" } },
      { path: "J/21.13 Nota.md", frontmatter: null, body: "Una frase. Otra." },
    ],
    filePaths: [],
    ...(language ? { language } : {}),
  }).map((f) => f.message);
}

describe("audit findings", () => {
  it("keep their Spanish text when no language is given", () => {
    const out = messages();
    expect(out).toContain("La carpeta 21.12 Solo no tiene nota en el JDex.");
    expect(out).toContain("21.11 está repetido en 2 notas.");
    expect(out.some((m) => m.includes("debería ser «"))).toBe(true);
    expect(out).toContain("21.13 Nota: sin descripción; propuesta «Una frase.».");
    expect(out).toContain("21.2 Mal: el ID necesita dos dígitos después del punto.");
    expect(messages("es")).toEqual(out);
  });

  it("speak English when asked, finding by finding", () => {
    const out = messages("en");
    expect(out).toContain("The folder 21.12 Solo has no JDex note.");
    expect(out).toContain("21.11 is repeated in 2 notes.");
    expect(out.some((m) => m.includes("should be «") && m.includes("(it is «"))).toBe(true);
    expect(out).toContain("21.13 Nota: no description; proposed «Una frase.».");
    expect(out).toContain("21.2 Mal: the ID needs two digits after the dot.");
    expect(out.join("\n")).not.toMatch(/está|carpeta|debería|sin descripción|dos dígitos/);
  });

  it("only change the message: kinds, numbers, paths and fixes are the same in both languages", () => {
    const strip = (language?: "en" | "es") => auditSystem({ index, jdexFolder: "J", notes: [{ path: "J/21.13 Nota.md", frontmatter: null, body: "Una." }], filePaths: [], ...(language ? { language } : {}) }).map(({ message: _message, ...rest }) => rest);
    expect(strip("en")).toEqual(strip());
  });

  it("word a missing configured folder and a stale inbox note in the asked language", () => {
    expect(missingConfiguredFolders({ jdexFolder: "J" }, [])[0].message).toBe("La carpeta JDex configurada («J») no existe: revisa los ajustes.");
    expect(missingConfiguredFolders({ jdexFolder: "J" }, [], "en")[0].message).toBe("The JDex folder configured («J») does not exist: check the settings.");
    const old = [{ path: "20-29 A/21 C/21.01 Inbox/a.md", folderPath: "20-29 A/21 C/21.01 Inbox", createdAt: 1 }];
    expect(staleInboxFindings(index, old, 30, 10 ** 12)[0].message).toBe("20-29 A/21 C/21.01 Inbox/a.md: lleva más de 30 días en el inbox.");
    expect(staleInboxFindings(index, old, 30, 10 ** 12, "en")[0].message).toBe("20-29 A/21 C/21.01 Inbox/a.md: has been in the inbox for more than 30 days.");
  });
});

describe("category and area validation", () => {
  const withArea = buildIndex({ systemRoot: "", jdexFolder: "J", folderPaths: ["20-29 A", "20-29 A/21 C"], notePaths: [] });

  it("keep their English default and add Spanish", () => {
    expect(validateNewCategory(withArea, 20, "x")).toBe("Type a two-digit category like 22.");
    expect(validateNewCategory(withArea, 20, "x", "es")).toBe("Escribe una categoría de dos dígitos, como 22.");
    expect(validateNewCategory(withArea, 20, "35")).toBe("The category must be inside 20-29.");
    expect(validateNewCategory(withArea, 20, "35", "es")).toBe("La categoría debe estar dentro de 20-29.");
    expect(validateNewCategory(withArea, 20, "20", "es")).toBe("20 es la categoría de gestión del área.");
    expect(validateNewCategory(withArea, 20, "21")).toBe("21 already exists.");
    expect(validateNewCategory(withArea, 20, "21", "es")).toBe("21 ya existe.");
    expect(validateNewCategory(withArea, 20, "22", "es")).toBeNull();
  });

  it("do the same for areas", () => {
    expect(parseNewArea(withArea, "x")).toEqual({ error: "Type an area like 20-29." });
    expect(parseNewArea(withArea, "x", "es")).toEqual({ error: "Escribe un área como 20-29." });
    expect(parseNewArea(withArea, "00")).toEqual({ error: "00-09 is the system area." });
    expect(parseNewArea(withArea, "00", "es")).toEqual({ error: "00-09 es el área del sistema." });
    expect(parseNewArea(withArea, "20")).toEqual({ error: "20-29 already exists." });
    expect(parseNewArea(withArea, "20", "es")).toEqual({ error: "20-29 ya existe." });
    expect(parseNewArea(withArea, "30", "es")).toEqual({ area: 30 });
  });
});

describe("undo preview lines", () => {
  const op: Operation = {
    kind: "fix",
    label: "x",
    at: "2026-10-12T00:00:00.000Z",
    effects: [
      { kind: "note-rewrite", path: "a.md", before: "", after: "x" },
      { kind: "frontmatter-block", path: "b.md", before: "", after: "x" },
      { kind: "created-note", path: "c.md", content: "" },
      { kind: "trashed-note", path: "d.md", content: "" },
      { kind: "created-folder", path: "e" },
      { kind: "moved", from: "f", to: "g" },
      { kind: "frontmatter", path: "h.md", previous: { tipo: "id" } },
      { kind: "frontmatter", path: "i.md", previous: {} },
      { kind: "line", path: "j.md", line: "L" },
    ],
  };

  it("keep the English default and translate every step to Spanish", () => {
    const en = describeUndo(op);
    expect(en).toEqual(describeUndo(op, "en"));
    expect(en[0]).toBe('Remove the line "L" from j.md.');
    expect(en).toContain("Restore the frontmatter of b.md.");
    const es = describeUndo(op, "es");
    expect(es).toHaveLength(en.length);
    expect(es).toEqual([
      "Quitar la línea «L» de j.md.",
      "Restaurar el frontmatter de i.md (claves desconocidas).",
      "Restaurar tipo en el frontmatter de h.md.",
      "Devolver g a f.",
      "Mover la carpeta e a la papelera.",
      "Restaurar la nota de la papelera d.md.",
      "Mover c.md a la papelera.",
      "Restaurar el frontmatter de b.md.",
      "Restaurar los bloques gestionados de a.md.",
    ]);
  });

  it("do the same for the warnings about old entries", () => {
    const old: Operation = {
      kind: "fix",
      label: "x",
      at: "2026-10-12T00:00:00.000Z",
      effects: [
        { kind: "frontmatter", path: "h.md", previous: { tipo: "id" } },
        { kind: "frontmatter", path: "k.md", previous: {} },
        { kind: "moved", from: "f", to: "g" },
        { kind: "from-the-future" } as never,
      ],
    };
    const en = undoWarnings(old);
    expect(en).toEqual(undoWarnings(old, "en"));
    expect(en.join("\n")).toContain('A step of kind "from-the-future" comes from another version');
    const es = undoWarnings(old, "es");
    expect(es).toHaveLength(en.length);
    expect(es.join("\n")).toContain("Un paso de tipo «from-the-future» viene de otra versión");
    expect(es.join("\n")).toContain("El movimiento de g viene de una versión anterior");
    expect(es.join("\n")).not.toMatch(/comes from|Confirm only/);
  });
});

describe("retire plan errors", () => {
  const entry = findId(index, "21.13")!;

  it("keep the wording Hebra shows when no language is given, and follow the language otherwise", () => {
    expect(retirePlan(index, entry, "2026-10-12", undefined, "2026-09-01")).toEqual({ error: "Ya retirado el 2026-09-01." });
    expect(retirePlan(index, entry, "2026-10-12", undefined, "2026-09-01", "en")).toEqual({ error: "Already retired on 2026-09-01." });
    expect(retirePlan(index, entry, "2026-10-12", undefined, "", "en")).toEqual({ error: "This ID is already retired." });
    expect(retirePlan(index, entry, "2026-10-12", undefined, "", "es")).toEqual({ error: "Este ID ya está retirado." });
    const noNote = { ...entry, notePath: undefined };
    expect(retirePlan(index, noNote, "2026-10-12")).toEqual({ error: "21.13 Nota has no JDex note; there is nothing to mark as retired." });
    expect(retirePlan(index, noNote, "2026-10-12", undefined, undefined, "es")).toEqual({ error: "21.13 Nota no tiene nota JDex; no hay nada que marcar como retirado." });
  });

  it("never translates the line written into the note", () => {
    const plan = retirePlan(index, entry, "2026-10-12", undefined, undefined, "en");
    expect("line" in plan && plan.line).toBe("Retirado el 2026-10-12.");
  });
});

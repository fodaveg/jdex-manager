// @vitest-environment happy-dom
/*
 * The vault layer speaks the interface language (Lumbre 9d8cdcd8): Repair findings, undo preview and
 * results, journal notices and errors. What it writes into notes (the audit report) stays Spanish.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { mergeSettings } from "../src/jd/settings";
import type { Operation } from "../src/jd/journal";
import { setUiLanguage } from "../src/ui/i18n";
import { collectAuditFindings, runAudit } from "../src/vault/audit";
import { ensureFolder } from "../src/vault/create";
import { undoOperation } from "../src/vault/journal";
import { type UndoContext, undoLastOperation } from "../src/vault/journal-store";
import { FakeObsidianVault } from "./support/fake-obsidian-vault";
import { installObsidianDom } from "./support/obsidian-dom";
import { resetStub } from "./support/obsidian-stub-api";

installObsidianDom();
beforeEach(resetStub);
afterEach(() => setUiLanguage(null));

function fixture() {
  const v = new FakeObsidianVault();
  for (const path of ["J", "Reports", "20-29 Area/21 Cat/21.11 Solo"]) v.folder(path);
  v.file("J/21.12 Otro.md", "---\ndescripcion: x\n---\n# 21.12 Otro\n");
  return { v, settings: mergeSettings({ jdexFolder: "J", reportsFolder: "Reports" }) };
}

describe("Repair findings and the written report", () => {
  it("show the interface language in the dialog while the report note stays Spanish", async () => {
    const { v, settings } = fixture();
    const { findings, reportPath } = await runAudit(v.app, settings, "en");
    expect(findings.map((f) => f.message)).toContain("The folder 21.11 Solo has no JDex note.");
    expect(findings.map((f) => f.message).join("\n")).not.toMatch(/no tiene nota/);
    const report = v.bodies.get(reportPath!)!;
    expect(report).toContain("La carpeta 21.11 Solo no tiene nota en el JDex.");
    expect(report).not.toContain("has no JDex note");
  });

  it("default to Spanish, and Repair asks for the language it needs", async () => {
    const { v, settings } = fixture();
    expect((await collectAuditFindings(v.app, settings)).map((f) => f.message)).toContain("La carpeta 21.11 Solo no tiene nota en el JDex.");
    expect((await collectAuditFindings(v.app, settings, "en")).map((f) => f.message)).toContain("The folder 21.11 Solo has no JDex note.");
  });
});

describe("undo in Spanish", () => {
  it("words the step results and the refusals", async () => {
    setUiLanguage("es");
    const v = new FakeObsidianVault();
    v.file("a.md", "x");
    v.folder("d");
    const op: Operation = { kind: "fix", label: "x", at: "2026-10-12T00:00:00.000Z", effects: [{ kind: "created-folder", path: "d" }, { kind: "moved", from: "b.md", to: "a.md" }] };
    const done = await undoOperation(v.app, op);
    expect(done).toEqual(["a.md devuelto a b.md.", "Carpeta vacía d enviada a la papelera."]);
    const gone: Operation = { kind: "fix", label: "x", at: "2026-10-12T00:00:00.000Z", effects: [{ kind: "note-rewrite", path: "nope.md", before: "", after: "y" }] };
    await expect(undoOperation(v.app, gone)).rejects.toThrow("nope.md ya no es una nota.");
  });

  it("previews and confirms the last operation in the interface language", async () => {
    setUiLanguage("es");
    const confirm = vi.fn(async (_title: string, _lines: string[], _action: string) => false);
    const empty = { journal: { last: () => undefined } };
    const notice = vi.fn();
    await undoLastOperation({ app: {} as App, data: empty, notice, confirm } as unknown as UndoContext);
    expect(notice).toHaveBeenCalledWith("Nada que deshacer: el diario está vacío.");
    const op: Operation = { id: "1", device: "d", kind: "fix", label: "Reparar JDex", at: "2026-10-12T00:00:00.000Z", effects: [{ kind: "moved", from: "b.md", to: "a.md" }], rev: 0 };
    const data = { journal: { last: () => op, undoRefusal: () => null } };
    await undoLastOperation({ app: {} as App, data, notice, confirm } as unknown as UndoContext);
    expect(confirm).toHaveBeenCalledWith(
      "¿Deshacer «Reparar JDex»?",
      ["Devolver a.md a b.md.", "El movimiento de a.md viene de una versión anterior y no puede comprobar que sea el mismo elemento.", "No se borra nada de forma definitiva: las notas y carpetas van a la papelera."],
      "Deshacer",
    );
  });

  it("keeps English when Obsidian is in English", async () => {
    const confirm = vi.fn(async (_title: string, _lines: string[], _action: string) => false);
    const op: Operation = { id: "1", device: "d", kind: "fix", label: "Repair JDex", at: "2026-10-12T00:00:00.000Z", effects: [{ kind: "moved", from: "b.md", to: "a.md", type: "file" }], rev: 0 };
    const data = { journal: { last: () => op, undoRefusal: () => null } };
    await undoLastOperation({ app: {} as App, data, notice: vi.fn(), confirm } as unknown as UndoContext);
    expect(confirm).toHaveBeenCalledWith('Undo "Repair JDex"?', ["Move a.md back to b.md.", "Nothing is deleted outright: notes and folders go to the trash."], "Undo");
  });
});

describe("vault errors in Spanish", () => {
  it("name a path that is a file", async () => {
    setUiLanguage("es");
    const v = new FakeObsidianVault();
    v.file("x", "text");
    await expect(ensureFolder(v.app, "x")).rejects.toThrow("x existe y es un fichero.");
  });
});

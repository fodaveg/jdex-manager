import { describe, expect, it } from "vitest";
import {
  BUILTIN_TEMPLATES,
  DEFAULT_SETTINGS,
  applyPlan,
  jdexNoteName,
  loadLibraryState,
  planNewId,
  renderTemplate,
  resolveSettings,
  todayIso,
  type EnsureResult,
  type LibraryPort,
  type NewIdPlan,
  type PortFolder,
  type PortNote,
} from "../src/jd/public";

interface MemNote extends PortNote {
  folderId: string;
  body: string;
}

/** In-memory `LibraryPort`: folders by id, notes by folder, a set of hidden categories. */
class MemoryPort implements LibraryPort {
  folders: PortFolder[] = [];
  notes: MemNote[] = [];
  hidden = new Set<string>();
  /** Throw on the Nth `ensureNote` call (1-based) to simulate dying half way. */
  dieOnEnsureNote: number | null = null;
  ensureNoteCalls = 0;
  writes = 0;
  #seq = 0;

  folder(id: string, parentId: string | null, name: string): this {
    this.folders.push({ id, parentId, name });
    return this;
  }
  note(folderId: string, title: string, body = ""): this {
    this.notes.push({ id: `n${++this.#seq}`, folderId, title, body });
    return this;
  }
  async listFolders(): Promise<PortFolder[]> {
    return this.folders.map((f) => ({ ...f }));
  }
  async listNotes(folderId: string): Promise<PortNote[]> {
    return this.notes.filter((n) => n.folderId === folderId).map((n) => ({ id: n.id, title: n.title }));
  }
  async readNote(id: string): Promise<{ body: string }> {
    return { body: this.notes.find((n) => n.id === id)!.body };
  }
  async ensureFolder(parentId: string | null, name: string): Promise<EnsureResult> {
    const wanted = name.trim().toLowerCase();
    const found = this.folders.find((f) => f.parentId === parentId && f.name.trim().toLowerCase() === wanted);
    if (found) return { id: found.id, created: false };
    this.writes++;
    const id = `f${++this.#seq}`;
    this.folders.push({ id, parentId, name });
    return { id, created: true };
  }
  async ensureNote(folderId: string, title: string, body: string): Promise<EnsureResult> {
    if (++this.ensureNoteCalls === this.dieOnEnsureNote) throw new Error("died");
    const found = this.notes.find((n) => n.folderId === folderId && n.title === title);
    if (found) return { id: found.id, created: false };
    this.writes++;
    const id = `n${++this.#seq}`;
    this.notes.push({ id, folderId, title, body });
    return { id, created: true };
  }
  async hasHidden(category: string): Promise<boolean> {
    return this.hidden.has(category);
  }
}

/** A small system: JDex and templates under 00-09, category 21 with 21.11 (note + folder) and a
 *  folder-only 21.22, category 23 up to 23.19 (next must skip the 23.20 header), category 24 empty. */
function library(): MemoryPort {
  const port = new MemoryPort();
  port
    .folder("a00", null, "00-09 Sistema")
    .folder("c00", "a00", "00 Gestión")
    .folder("jdex", "c00", "00.00 JDex")
    .folder("tpl", "c00", "00.03 Plantillas")
    .folder("a20", null, "20-29 Productos")
    .folder("c21", "a20", "21 Productos de software")
    .folder("i2111", "c21", "21.11 Hebra")
    .folder("i2122", "c21", "21.22 JDex Manager")
    .folder("c23", "a20", "23 Otros")
    .folder("i2319", "c23", "23.19 Algo")
    .folder("c24", "a20", "24 Vacía");
  port
    .note("jdex", "20-29 Productos")
    .note("jdex", "21 Productos de software")
    .note("jdex", "23 Otros")
    .note("jdex", "24 Vacía")
    .note("jdex", "21.11 Hebra")
    .note("jdex", "23.19 Algo");
  return port;
}

async function plan(port: MemoryPort, category: string, title: string, extra: Partial<Parameters<typeof planNewId>[2]> = {}) {
  const resolved = await resolveSettings(port);
  if (!resolved.ok) throw new Error(resolved.code);
  const state = await loadLibraryState(port, resolved.value);
  return planNewId(port, state, { category, title, ...extra });
}

async function okPlan(port: MemoryPort, category: string, title: string, extra: Partial<Parameters<typeof planNewId>[2]> = {}): Promise<NewIdPlan> {
  const result = await plan(port, category, title, extra);
  if (!result.ok) throw new Error(result.code);
  return result.value;
}

describe("resolveSettings", () => {
  it("detects the JDex and templates folders", async () => {
    const result = await resolveSettings(library());
    expect(result.ok && result.value.jdex).toEqual({ id: "jdex", name: "00.00 JDex", path: "00-09 Sistema/00 Gestión/00.00 JDex" });
    expect(result.ok && result.value.templates?.id).toBe("tpl");
    expect(result.ok && result.value.settings.templateNames).toEqual(DEFAULT_SETTINGS.templateNames);
  });

  it("fails with jdex_not_found when there is no 00.00", async () => {
    const port = new MemoryPort().folder("a20", null, "20-29 Productos");
    const result = await resolveSettings(port);
    expect(result).toMatchObject({ ok: false, code: "jdex_not_found" });
  });

  it("lets explicit ids override the detected folders", async () => {
    const port = library().folder("other", null, "Otra carpeta");
    const result = await resolveSettings(port, { jdexFolderId: "other", templatesFolderId: "other" });
    expect(result.ok && result.value.jdex.id).toBe("other");
    expect(result.ok && result.value.templates?.id).toBe("other");
    expect(await resolveSettings(port, { jdexFolderId: "nope" })).toMatchObject({ ok: false, code: "jdex_not_found" });
  });
});

describe("planNewId", () => {
  it("picks the next free number after the highest in use", async () => {
    const result = await okPlan(library(), "21", "Nuevo módulo");
    // 21.22 is only a folder: it still counts.
    expect(result.id).toBe("21.23");
    expect(result.noteName).toBe("21.23 Nuevo módulo");
    expect(result.folderName).toBe("21.23 Nuevo módulo");
  });

  it("skips the header number and starts at .11 in an empty category", async () => {
    expect((await okPlan(library(), "23", "X")).id).toBe("23.21");
    expect((await okPlan(library(), "24", "X")).id).toBe("24.11");
  });

  it("refuses a category with hidden content without naming a number", async () => {
    const port = library();
    port.hidden.add("21");
    const result = await plan(port, "21", "X");
    expect(result).toMatchObject({ ok: false, code: "category_has_hidden" });
    expect(JSON.stringify(result)).not.toMatch(/21\.\d\d/);
  });

  it("rejects an unknown category and an empty title", async () => {
    expect(await plan(library(), "99", "X")).toMatchObject({ ok: false, code: "category_not_found" });
    expect(await plan(library(), "21", "  ")).toMatchObject({ ok: false, code: "invalid_title" });
  });

  it("uses the built-in template when 00.03 has none, and the 00.03 note when it has one", async () => {
    const builtin = await okPlan(library(), "21", "Plantilla");
    expect(builtin.template).toEqual({ source: "builtin" });
    const w = builtin.writes[0];
    expect(w.kind === "ensure_note" && w.body).toBe(
      renderTemplate(BUILTIN_TEMPLATES.id, { id: "21.23", title: "Plantilla", area: "20-29", areaTitle: "20-29 Productos", category: "21", categoryTitle: "21 Productos de software", date: todayIso() }),
    );

    const port = library().note("tpl", "JDex - id", "---\njd: \"{{id}}\"\n---\nMía {{title}}\n");
    const custom = await okPlan(port, "21", "Plantilla");
    expect(custom.template).toMatchObject({ source: "templates-folder", noteName: "JDex - id" });
    const cw = custom.writes[0];
    expect(cw.kind === "ensure_note" && cw.body).toContain("Mía Plantilla");
    // A category-scoped template wins over the generic one.
    const scoped = library().note("tpl", "JDex - id", "generic").note("tpl", "JDex - id - 21", "scoped");
    const scopedPlan = await okPlan(scoped, "21", "X");
    expect(scopedPlan.template.noteName).toBe("JDex - id - 21");
  });

  it("plans the folder after the note, with the category folder as parent", async () => {
    const result = await okPlan(library(), "21", "Con carpeta");
    expect(result.writes.map((w) => w.kind)).toEqual(["ensure_note", "ensure_folder"]);
    expect(result.writes[1]).toMatchObject({ parent: { folderId: "c21" }, name: "21.23 Con carpeta" });
    expect(result.outputs).toEqual([
      { kind: "note", parentId: "jdex", name: "21.23 Con carpeta" },
      { kind: "folder", parentId: "c21", name: "21.23 Con carpeta" },
    ]);
  });
});

describe("applyPlan", () => {
  it("creates the note and folder and reports what it created", async () => {
    const port = library();
    const result = await applyPlan(port, await okPlan(port, "21", "Nuevo"));
    expect(result).toMatchObject({ ok: true, value: { existing: [] } });
    expect(result.ok && result.value.created.map((c) => c.kind)).toEqual(["note", "folder"]);
    expect(port.notes.some((n) => n.folderId === "jdex" && n.title === "21.23 Nuevo")).toBe(true);
    expect(port.folders.some((f) => f.parentId === "c21" && f.name === "21.23 Nuevo")).toBe(true);
  });

  it("returns plan_stale and writes nothing when someone took the number", async () => {
    const port = library();
    const planned = await okPlan(port, "21", "Nuevo");
    port.folder("other", "c21", "21.23 Y");
    const result = await applyPlan(port, planned);
    expect(result).toMatchObject({ ok: false, code: "plan_stale" });
    expect(port.writes).toBe(0);
  });

  it("returns plan_stale when the category became hidden or the folder vanished", async () => {
    const hidden = library();
    const p1 = await okPlan(hidden, "21", "Nuevo");
    hidden.hidden.add("21");
    expect(await applyPlan(hidden, p1)).toMatchObject({ ok: false, code: "plan_stale" });
    const gone = library();
    const p2 = await okPlan(gone, "21", "Nuevo");
    gone.folders = gone.folders.filter((f) => f.id !== "c21");
    expect(await applyPlan(gone, p2)).toMatchObject({ ok: false, code: "plan_stale" });
    expect(hidden.writes + gone.writes).toBe(0);
  });

  it("completes a retry after dying with only the folder created, without duplicating", async () => {
    const port = library();
    const planned = await okPlan(port, "21", "Nuevo", { createPattern: false });
    // As if the process died after creating the folder and before the note.
    port.folder("half", "c21", "21.23 Nuevo");
    const retry = await applyPlan(port, planned);
    expect(retry.ok).toBe(true);
    expect(retry.ok && retry.value.created.map((c) => c.kind)).toEqual(["note"]);
    expect(retry.ok && retry.value.existing).toEqual([{ kind: "folder", id: "half", name: "21.23 Nuevo" }]);
    expect(port.folders.filter((f) => f.name === "21.23 Nuevo")).toHaveLength(1);
    expect(port.notes.filter((n) => n.title === "21.23 Nuevo")).toHaveLength(1);
  });

  it("completes a retry after a crash half way and a second apply creates nothing", async () => {
    const port = library();
    const planned = await okPlan(port, "21", "Nuevo");
    port.dieOnEnsureNote = 1;
    await expect(applyPlan(port, planned)).rejects.toThrow("died");
    expect(port.notes.some((n) => n.title === "21.23 Nuevo")).toBe(false);
    const retry = await applyPlan(port, planned);
    expect(retry.ok && retry.value.created.map((c) => c.kind)).toEqual(["note", "folder"]);
    const again = await applyPlan(port, planned);
    expect(again.ok && again.value.created).toEqual([]);
    expect(again.ok && again.value.existing.map((c) => c.kind)).toEqual(["note", "folder"]);
    expect(port.notes.filter((n) => n.title === "21.23 Nuevo")).toHaveLength(1);
    expect(port.folders.filter((f) => f.name === "21.23 Nuevo")).toHaveLength(1);
  });

  it("returns plan_stale when only a folder with another name holds the number", async () => {
    const port = library();
    const planned = await okPlan(port, "21", "Nuevo");
    port.folder("half", "c21", "21.23 Nuevo");
    port.folder("other", "c21", "21.23 Y");
    expect(await applyPlan(port, planned)).toMatchObject({ ok: false, code: "plan_stale" });
    expect(port.writes).toBe(0);
  });

  it("returns plan_stale when the same folder name sits under another parent", async () => {
    const port = library();
    const planned = await okPlan(port, "21", "Nuevo");
    port.folder("moved", "c23", "21.23 Nuevo");
    expect(await applyPlan(port, planned)).toMatchObject({ ok: false, code: "plan_stale" });
  });

  it("creates the subfolder pattern nested under the ID folder", async () => {
    const port = library();
    const planned = await okPlan(port, "21", "Con patrón", { createPattern: true });
    expect(planned.writes).toHaveLength(2); // no pattern configured: nothing extra
    const patterned = await resolveSettings(port);
    if (!patterned.ok) throw new Error("no");
    patterned.value.settings.subfolderPatternsByCategory = { "21": "40 Audits\n70 Adjuntos/Imágenes" };
    const state = await loadLibraryState(port, patterned.value);
    const withPattern = await planNewId(port, state, { category: "21", title: "Con patrón", createPattern: true });
    if (!withPattern.ok) throw new Error(withPattern.code);
    expect(withPattern.value.writes.map((w) => w.kind)).toEqual(["ensure_note", "ensure_folder", "ensure_folder", "ensure_folder", "ensure_folder"]);
    await applyPlan(port, withPattern.value);
    const idFolder = port.folders.find((f) => f.name === "21.23 Con patrón")!;
    const adjuntos = port.folders.find((f) => f.parentId === idFolder.id && f.name === "70 Adjuntos")!;
    expect(port.folders.some((f) => f.parentId === adjuntos.id && f.name === "Imágenes")).toBe(true);
    expect(jdexNoteName("21.23", "Con patrón")).toBe(idFolder.name);
  });
});

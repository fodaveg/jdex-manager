import { describe, expect, it } from "vitest";
import {
  applyMovePlan,
  applyPlan,
  applyUndoMovePlan,
  loadLibraryState,
  planMoveIntoId,
  planNewId,
  planUndoMove,
  resolveSettings,
  type EnsureResult,
  type JdLibraryErrorCode,
  type LibraryMovePort,
  type MovePlan,
  type MoveRequest,
  type PortFolder,
  type PortNote,
} from "../src/jd/public";

interface MemNote extends PortNote {
  folderId: string;
  body: string;
}
interface MemFile {
  id: string;
  folderId: string;
  name: string;
}

const key = (s: string) => s.trim().toLowerCase();

/** In-memory `LibraryMovePort`. */
class MemoryPort implements LibraryMovePort {
  folders: PortFolder[] = [];
  notes: MemNote[] = [];
  files: MemFile[] = [];
  hidden = new Set<string>();
  hiddenFolders = new Set<string>();
  /** Throw on the Nth move call (1-based). */
  dieOnMove: number | null = null;
  /** Answer `{ ok: false }` to every move. */
  refuseMoves = false;
  moveCalls = 0;
  writes = 0;
  #seq = 0;

  folder(id: string, parentId: string | null, name: string): this {
    this.folders.push({ id, parentId, name });
    return this;
  }
  note(folderId: string, title: string, id = `n${++this.#seq}`): this {
    this.notes.push({ id, folderId, title, body: "" });
    return this;
  }
  file(folderId: string, name: string, id = `x${++this.#seq}`): this {
    this.files.push({ id, folderId, name });
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
    const found = this.folders.find((f) => f.parentId === parentId && key(f.name) === key(name));
    if (found) return { id: found.id, created: false };
    this.writes++;
    const id = `f${++this.#seq}`;
    this.folders.push({ id, parentId, name });
    return { id, created: true };
  }
  async ensureNote(folderId: string, title: string, body: string): Promise<EnsureResult> {
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
  async listFiles(folderId: string): Promise<{ id: string; name: string }[]> {
    return this.files.filter((f) => f.folderId === folderId).map((f) => ({ id: f.id, name: f.name }));
  }
  async hiddenInside(folderId: string): Promise<boolean> {
    return this.hiddenFolders.has(folderId);
  }
  #move(): boolean {
    if (++this.moveCalls === this.dieOnMove) throw new Error("died");
    return !this.refuseMoves;
  }
  async moveNote(id: string, expected: { folderId: string; title: string }, to: { folderId: string; title?: string }): Promise<{ ok: boolean }> {
    if (!this.#move()) return { ok: false };
    const note = this.notes.find((n) => n.id === id);
    if (!note || note.folderId !== expected.folderId || note.title !== expected.title) return { ok: false };
    note.folderId = to.folderId;
    if (to.title !== undefined) note.title = to.title;
    this.writes++;
    return { ok: true };
  }
  async moveFile(id: string, expected: { folderId: string; name: string }, to: { folderId: string; name?: string }): Promise<{ ok: boolean }> {
    if (!this.#move()) return { ok: false };
    const file = this.files.find((f) => f.id === id);
    if (!file || file.folderId !== expected.folderId || file.name !== expected.name) return { ok: false };
    file.folderId = to.folderId;
    if (to.name !== undefined) file.name = to.name;
    this.writes++;
    return { ok: true };
  }
  async moveFolder(id: string, expected: { parentId: string; name: string }, to: { parentId: string; name?: string }): Promise<{ ok: boolean }> {
    if (!this.#move()) return { ok: false };
    const folder = this.folders.find((f) => f.id === id);
    if (!folder || folder.parentId !== expected.parentId || folder.name !== expected.name) return { ok: false };
    folder.parentId = to.parentId;
    if (to.name !== undefined) folder.name = to.name;
    this.writes++;
    return { ok: true };
  }
}

/** JDex with 21.11 (folder + note), 21.22 (folder only), 21.34 (note only, category 21 has a folder) and
 *  23.12 (note only, category 23 has a folder). A 00.01 inbox holds a note, a file and a subfolder. */
function library(): MemoryPort {
  const port = new MemoryPort();
  port
    .folder("a00", null, "00-09 Sistema")
    .folder("c00", "a00", "00 Gestión")
    .folder("jdex", "c00", "00.00 JDex")
    .folder("inbox", "c00", "00.01 Entrada")
    .folder("a20", null, "20-29 Productos")
    .folder("c21", "a20", "21 Productos de software")
    .folder("i2111", "c21", "21.11 Hebra")
    .folder("i2122", "c21", "21.22 JDex Manager")
    .folder("c23", "a20", "23 Otros")
    .folder("sub", "inbox", "Pendiente");
  port
    .note("jdex", "20-29 Productos")
    .note("jdex", "21 Productos de software")
    .note("jdex", "23 Otros")
    .note("jdex", "21.11 Hebra")
    .note("jdex", "21.34 Contabilidad")
    .note("jdex", "23.12 Sin carpeta");
  port.note("inbox", "Factura de octubre", "nota1").file("inbox", "extracto.pdf", "file1");
  return port;
}

async function plan(port: MemoryPort, request: MoveRequest) {
  const resolved = await resolveSettings(port);
  if (!resolved.ok) throw new Error(resolved.code);
  const state = await loadLibraryState(port, resolved.value);
  return planMoveIntoId(port, state, request);
}

async function okPlan(port: MemoryPort, request: MoveRequest): Promise<MovePlan> {
  const result = await plan(port, request);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.value;
}

const note = (toId: string, extra: Partial<MoveRequest> = {}): MoveRequest => ({ source: { kind: "note", id: "nota1" }, toId, ...extra });

describe("planMoveIntoId: refusals", () => {
  const cases: [string, (port: MemoryPort) => void, MoveRequest, JdLibraryErrorCode][] = [
    ["the ID is not in the JDex", () => {}, note("21.99"), "id_not_found"],
    ["the ID only has a folder (no JDex note)", () => {}, note("21.22"), "id_not_found"],
    ["the ID is not a number", () => {}, note("hola"), "id_not_found"],
    ["the source does not exist", () => {}, { source: { kind: "note", id: "nope" }, toId: "21.11" }, "source_not_found"],
    ["the source folder does not exist", () => {}, { source: { kind: "folder", id: "nope" }, toId: "21.11" }, "source_not_found"],
    ["a note with that title is already there", (p) => p.note("i2111", "factura DE octubre"), note("21.11"), "destination_taken"],
    ["a file with that name is already there", (p) => p.file("i2111", "EXTRACTO.pdf"), { source: { kind: "file", id: "file1" }, toId: "21.11" }, "destination_taken"],
    ["a folder with that name is already there", (p) => p.folder("dup", "i2111", "pendiente"), { source: { kind: "folder", id: "sub" }, toId: "21.11" }, "destination_taken"],
    ["`as` collides in the destination", (p) => p.note("i2111", "Otro"), note("21.11", { as: "otro" }), "destination_taken"],
    ["the destination is inside the folder to move", () => {}, { source: { kind: "folder", id: "c21" }, toId: "21.11" }, "destination_inside_source"],
    ["the destination IS the folder to move", () => {}, { source: { kind: "folder", id: "i2111" }, toId: "21.11" }, "destination_inside_source"],
    ["a folder would go into the ID folder to be created under itself", () => {}, { source: { kind: "folder", id: "c23" }, toId: "23.12" }, "destination_inside_source"],
    ["the thing is already in the destination", (p) => { p.notes.find((n) => n.id === "nota1")!.folderId = "i2111"; }, note("21.11", { subfolder: undefined }), "already_in_destination"],
    ["the folder to move has hidden content", (p) => p.hiddenFolders.add("sub"), { source: { kind: "folder", id: "sub" }, toId: "21.11" }, "folder_has_hidden"],
    ["the category has hidden content and the ID folder is missing", (p) => p.hidden.add("23"), note("23.12"), "category_has_hidden"],
    ["the category has no folder", (p) => { p.folders = p.folders.filter((f) => f.id !== "c23"); }, note("23.12"), "category_folder_not_found"],
    ["the subfolder has a slash", () => {}, note("21.11", { subfolder: "a/b" }), "invalid_subfolder"],
    ["the subfolder is ..", () => {}, note("21.11", { subfolder: ".." }), "invalid_subfolder"],
    ["the new name is empty", () => {}, note("21.11", { as: "  " }), "invalid_name"],
    ["a file's new name has a slash", () => {}, { source: { kind: "file", id: "file1" }, toId: "21.11", as: "a/b.pdf" }, "invalid_name"],
  ];
  it.each(cases)("%s", async (_name, arrange, request, code) => {
    const port = library();
    arrange(port);
    const before = JSON.stringify([port.folders, port.notes, port.files]);
    const result = await plan(port, request);
    expect(result).toMatchObject({ ok: false, code });
    expect(port.writes).toBe(0);
    expect(JSON.stringify([port.folders, port.notes, port.files])).toBe(before);
  });

  it("does not tell what is hidden", async () => {
    const port = library();
    port.hidden.add("23");
    port.hiddenFolders.add("sub");
    const a = await plan(port, note("23.12"));
    const b = await plan(port, { source: { kind: "folder", id: "sub" }, toId: "21.11" });
    for (const r of [a, b]) expect(r.ok === false && /oculto|hidden|secreto|privad/iu.test(r.message)).toBe(false);
  });
});

describe("planMoveIntoId and applyMovePlan", () => {
  it("moves a note into an existing ID folder with a flat JSON plan", async () => {
    const port = library();
    const p = await okPlan(port, note("21.11"));
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
    expect(p.writes).toEqual([]);
    expect(p.moves).toEqual([{ kind: "note", id: "nota1", from: { parentId: "inbox", name: "Factura de octubre" }, to: { parentId: "i2111", name: "Factura de octubre" } }]);
    const result = await applyMovePlan(port, p);
    expect(result).toMatchObject({ ok: true, value: { moved: p.moves, alreadyDone: [], created: [] } });
    expect(port.notes.find((n) => n.id === "nota1")).toMatchObject({ folderId: "i2111", title: "Factura de octubre" });
  });

  it("moves a loose file", async () => {
    const port = library();
    const p = await okPlan(port, { source: { kind: "file", id: "file1", folderId: "inbox" }, toId: "21.11" });
    expect(p.moves[0]).toMatchObject({ kind: "file", from: { parentId: "inbox", name: "extracto.pdf" }, to: { parentId: "i2111", name: "extracto.pdf" } });
    expect((await applyMovePlan(port, p)).ok).toBe(true);
    expect(port.files[0].folderId).toBe("i2111");
  });

  it("moves a whole folder", async () => {
    const port = library();
    const p = await okPlan(port, { source: { kind: "folder", id: "sub" }, toId: "21.11" });
    expect(p.preconditions).toContainEqual({ kind: "no_hidden_inside", folderId: "sub" });
    expect((await applyMovePlan(port, p)).ok).toBe(true);
    expect(port.folders.find((f) => f.id === "sub")).toMatchObject({ parentId: "i2111", name: "Pendiente" });
  });

  it("renames with `as` (title for a note)", async () => {
    const port = library();
    const p = await okPlan(port, note("21.11", { as: "Factura 10" }));
    expect(p.moves[0].to.name).toBe("Factura 10");
    await applyMovePlan(port, p);
    expect(port.notes.find((n) => n.id === "nota1")!.title).toBe("Factura 10");
  });

  it("never dates the name", async () => {
    const port = library();
    const p = await okPlan(port, note("21.11"));
    expect(p.moves[0].to.name).toBe("Factura de octubre");
  });

  it("creates the subfolder when missing and reuses it when there", async () => {
    const port = library();
    const p = await okPlan(port, note("21.11", { subfolder: "Extractos" }));
    expect(p.writes).toEqual([{ kind: "ensure_folder", parent: { folderId: "i2111" }, name: "Extractos" }]);
    expect(p.moves[0].to.parentId).toEqual({ write: 0 });
    const result = await applyMovePlan(port, p);
    expect(result).toMatchObject({ ok: true, value: { created: [{ kind: "folder", name: "Extractos" }] } });
    const created = port.folders.find((f) => f.name === "Extractos")!;
    expect(created.parentId).toBe("i2111");
    expect(port.notes.find((n) => n.id === "nota1")!.folderId).toBe(created.id);
    // Second file into the existing subfolder: no write for it.
    port.note("inbox", "Otra", "nota2");
    const again = await okPlan(port, { source: { kind: "note", id: "nota2" }, toId: "21.11", subfolder: "extractos" });
    expect(again.writes).toEqual([]);
    expect(again.moves[0].to.parentId).toBe(created.id);
  });

  it("creates the ID folder under the category with the name planNewId gives it", async () => {
    const port = library();
    const p = await okPlan(port, note("23.12", { subfolder: "Extractos" }));
    expect(p.writes).toEqual([
      { kind: "ensure_folder", parent: { folderId: "c23" }, name: "23.12 Sin carpeta" },
      { kind: "ensure_folder", parent: { write: 0 }, name: "Extractos" },
    ]);
    expect(p.preconditions).toContainEqual({ kind: "not_hidden", category: "23" });
    const result = await applyMovePlan(port, p);
    expect(result.ok && result.value.created.map((c) => c.name)).toEqual(["23.12 Sin carpeta", "Extractos"]);
    const idFolder = port.folders.find((f) => f.name === "23.12 Sin carpeta")!;
    const sub = port.folders.find((f) => f.name === "Extractos")!;
    expect(sub.parentId).toBe(idFolder.id);
    expect(port.notes.find((n) => n.id === "nota1")!.folderId).toBe(sub.id);
  });

  it("names a created ID folder like planNewId", async () => {
    const port = library();
    const created = await (async () => {
      const resolved = await resolveSettings(port);
      if (!resolved.ok) throw new Error();
      const state = await loadLibraryState(port, resolved.value);
      const r = await planNewId(port, state, { category: "23", title: "Sin carpeta", id: "23.13" });
      if (!r.ok) throw new Error(r.code);
      return r.value.folderName;
    })();
    expect(created).toBe("23.13 Sin carpeta");
  });

  it("returns plan_stale without writing when the source moved", async () => {
    const port = library();
    const p = await okPlan(port, note("21.11"));
    port.notes.find((n) => n.id === "nota1")!.folderId = "i2122";
    expect(await applyMovePlan(port, p)).toMatchObject({ ok: false, code: "plan_stale" });
    expect(port.writes).toBe(0);
  });

  it("returns plan_stale without writing when the destination name got taken", async () => {
    const port = library();
    const p = await okPlan(port, note("23.12"));
    port.folders.push({ id: "idf", parentId: "c23", name: "23.12 Sin carpeta" });
    port.note("idf", "factura de octubre");
    expect(await applyMovePlan(port, p)).toMatchObject({ ok: false, code: "plan_stale" });
    expect(port.moveCalls).toBe(0);
  });

  it("returns plan_stale without writing when a precondition changed (hidden, folder gone, folder content)", async () => {
    const port = library();
    const p = await okPlan(port, note("23.12"));
    port.hidden.add("23");
    expect(await applyMovePlan(port, p)).toMatchObject({ ok: false, code: "plan_stale" });
    port.hidden.clear();
    const folderPlan = await okPlan(port, { source: { kind: "folder", id: "sub" }, toId: "21.11" });
    port.hiddenFolders.add("sub");
    expect(await applyMovePlan(port, folderPlan)).toMatchObject({ ok: false, code: "plan_stale" });
    port.hiddenFolders.clear();
    const idPlan = await okPlan(port, note("21.11"));
    port.folders = port.folders.filter((f) => f.id !== "i2111");
    expect(await applyMovePlan(port, idPlan)).toMatchObject({ ok: false, code: "plan_stale" });
    expect(port.writes).toBe(0);
  });

  it("turns {ok:false} from the port into plan_stale", async () => {
    const port = library();
    const p = await okPlan(port, note("21.11"));
    port.refuseMoves = true;
    expect(await applyMovePlan(port, p)).toMatchObject({ ok: false, code: "plan_stale" });
  });

  it("lets a port exception through", async () => {
    const port = library();
    const p = await okPlan(port, note("21.11"));
    port.dieOnMove = 1;
    await expect(applyMovePlan(port, p)).rejects.toThrow("died");
  });

  it("completes after a failure half way: the folders and the moves already done count", async () => {
    const port = library();
    port.note("inbox", "Segunda", "nota2");
    // Two moves in one plan, as a host composing several would: the second dies.
    const p = await okPlan(port, note("23.12", { subfolder: "Extractos" }));
    const second = await okPlan(port, { source: { kind: "note", id: "nota2" }, toId: "23.12", subfolder: "Extractos" });
    const both: MovePlan = { ...p, moves: [...p.moves, ...second.moves] };
    port.dieOnMove = 2;
    await expect(applyMovePlan(port, both)).rejects.toThrow("died");
    expect(port.notes.find((n) => n.id === "nota1")!.folderId).not.toBe("inbox");
    expect(port.notes.find((n) => n.id === "nota2")!.folderId).toBe("inbox");
    const foldersAfterFailure = port.folders.length;
    port.dieOnMove = null;
    const retry = await applyMovePlan(port, both);
    expect(retry).toMatchObject({ ok: true, value: { created: [] } });
    expect(retry.ok && retry.value.alreadyDone.map((m) => m.id)).toEqual(["nota1"]);
    expect(retry.ok && retry.value.moved.map((m) => m.id)).toEqual(["nota2"]);
    expect(port.folders.length).toBe(foldersAfterFailure);
    expect(port.notes.filter((n) => n.title === "Factura de octubre")).toHaveLength(1);
  });
});

describe("planUndoMove and applyUndoMovePlan", () => {
  it("is pure and puts every piece back, keeping the created folders", async () => {
    const port = library();
    const p = await okPlan(port, note("23.12", { subfolder: "Extractos", as: "Factura 10" }));
    const frozen = JSON.stringify(p);
    const undo = planUndoMove(p);
    expect(JSON.stringify(p)).toBe(frozen);
    expect(JSON.parse(JSON.stringify(undo))).toEqual(undo);
    await applyMovePlan(port, p);
    const folders = port.folders.length;
    const result = await applyUndoMovePlan(port, undo);
    expect(result).toMatchObject({ ok: true, value: { skipped: [], alreadyRestored: [] } });
    expect(port.notes.find((n) => n.id === "nota1")).toMatchObject({ folderId: "inbox", title: "Factura de octubre" });
    expect(port.folders.length).toBe(folders);
  });

  it("undoes a file and a folder with their old names", async () => {
    const port = library();
    const f = await okPlan(port, { source: { kind: "file", id: "file1" }, toId: "21.11", as: "nuevo.pdf" });
    const d = await okPlan(port, { source: { kind: "folder", id: "sub" }, toId: "21.11", as: "Hecho" });
    await applyMovePlan(port, f);
    await applyMovePlan(port, d);
    await applyUndoMovePlan(port, planUndoMove(f));
    await applyUndoMovePlan(port, planUndoMove(d));
    expect(port.files[0]).toMatchObject({ folderId: "inbox", name: "extracto.pdf" });
    expect(port.folders.find((x) => x.id === "sub")).toMatchObject({ parentId: "inbox", name: "Pendiente" });
  });

  it("skips a piece someone else moved or renamed, without a global plan_stale", async () => {
    const port = library();
    const p = await okPlan(port, note("21.11"));
    await applyMovePlan(port, p);
    port.notes.find((n) => n.id === "nota1")!.folderId = "i2122";
    const moved = await applyUndoMovePlan(port, planUndoMove(p));
    expect(moved).toMatchObject({ ok: true, value: { restored: [], skipped: [{ reason: "not_where_left" }] } });
    expect(port.notes.find((n) => n.id === "nota1")!.folderId).toBe("i2122");

    const q = await okPlan(port, { source: { kind: "file", id: "file1" }, toId: "21.11", as: "nuevo.pdf" });
    await applyMovePlan(port, q);
    port.files[0].name = "otro.pdf";
    expect(await applyUndoMovePlan(port, planUndoMove(q))).toMatchObject({ ok: true, value: { skipped: [{ reason: "not_where_left" }] } });
  });

  it("skips when the old place is taken, and counts a piece already back", async () => {
    const port = library();
    const p = await okPlan(port, note("21.11"));
    await applyMovePlan(port, p);
    port.note("inbox", "Factura de octubre");
    expect(await applyUndoMovePlan(port, planUndoMove(p))).toMatchObject({ value: { skipped: [{ reason: "destination_taken" }] } });
    port.notes.find((n) => n.id === "nota1")!.folderId = "inbox";
    port.notes.find((n) => n.id !== "nota1" && n.folderId === "inbox")!.folderId = "i2122";
    expect(await applyUndoMovePlan(port, planUndoMove(p))).toMatchObject({ value: { restored: [], alreadyRestored: [{ id: "nota1" }] } });
  });

  it("skips a piece the port refuses", async () => {
    const port = library();
    const p = await okPlan(port, note("21.11"));
    await applyMovePlan(port, p);
    port.refuseMoves = true;
    expect(await applyUndoMovePlan(port, planUndoMove(p))).toMatchObject({ ok: true, value: { skipped: [{ reason: "refused" }] } });
  });
});

describe("planNewId is unchanged", () => {
  it("still plans and applies a new ID with applyPlan", async () => {
    const port = library();
    const resolved = await resolveSettings(port);
    if (!resolved.ok) throw new Error();
    const state = await loadLibraryState(port, resolved.value);
    const r = await planNewId(port, state, { category: "21", title: "Nuevo" }, new Date("2026-10-19T12:00:00"));
    if (!r.ok) throw new Error(r.code);
    expect(r.value.folderName).toBe(r.value.noteName);
    expect(r.value.writes.map((w) => w.kind)).toEqual(["ensure_note", "ensure_folder"]);
    const applied = await applyPlan(port, r.value);
    expect(applied.ok && applied.value.created.map((c) => c.name)).toEqual([r.value.noteName, r.value.noteName]);
  });
});

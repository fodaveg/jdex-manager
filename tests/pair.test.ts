import { describe, expect, it } from "vitest";
import { buildIndex } from "../src/jd/index";
import { pairAction, pairBlockedByRepeat } from "../src/jd/pair";
import { FOLDERS, JDEX, NOTES } from "./fixtures";

const settings = { jdexFolder: JDEX, systemRoot: "" };
const CAT = "20-29 Trabajo y productos/21 Productos de software propios";

describe("pairAction for + children uses the same sanitised names", () => {
  const parent = `${CAT}/21.22 JDex Manager`;
  it("renaming a child note to a name a folder cannot take proposes a sanitised folder", () => {
    const index = buildIndex({ systemRoot: "", folderPaths: [...FOLDERS, `${parent}/+ A`], jdexFolder: JDEX, notePaths: [...NOTES, `${JDEX}/21.22+ A.md`] });
    expect(pairAction({ oldPath: `${JDEX}/21.22+ A.md`, newPath: `${JDEX}/21.22+ Z? #tag.md`, isFolder: false }, index, settings)).toMatchObject({
      type: "rename-partner", partnerPath: `${parent}/+ A`, newPartnerPath: `${parent}/+ Z`,
    });
  });
});

describe("pairAction", () => {
  const parent = `${CAT}/21.22 JDex Manager`;
  const folders = [...FOLDERS, `${parent}/+ A`, `${parent}/+ B`];
  const children = [`${JDEX}/21.22+ A #jd-ayuda.md`, `${JDEX}/21.22+ B.md`];

  it.each([false, true])("renames only A's + folder with the index before/after the note rename (after=%s)", (after) => {
    const oldPath = children[0];
    const newPath = `${JDEX}/21.22+ Z #jd-ayuda.md`;
    const index = buildIndex({ systemRoot: "", folderPaths: folders, jdexFolder: JDEX, notePaths: [...NOTES, after ? newPath : oldPath, children[1]] });
    expect(pairAction({ oldPath, newPath, isFolder: false }, index, settings)).toEqual({
      type: "rename-partner", id: "21.22+", partnerPath: `${parent}/+ A`, newPartnerPath: `${parent}/+ Z`,
    });
  });

  it.each([false, true])("renames only A's child note and preserves tags before/after the folder rename (after=%s)", (after) => {
    const oldPath = `${parent}/+ A`;
    const newPath = `${parent}/+ Z`;
    const index = buildIndex({ systemRoot: "", folderPaths: folders.map((p) => after && p === oldPath ? newPath : p), jdexFolder: JDEX, notePaths: [...NOTES, ...children] });
    expect(pairAction({ oldPath, newPath, isFolder: true }, index, settings)).toEqual({
      type: "rename-partner", id: "21.22+", partnerPath: children[0], newPartnerPath: `${JDEX}/21.22+ Z #jd-ayuda.md`,
    });
  });

  it("does not borrow another child's folder when the renamed child has none", () => {
    const index = buildIndex({ systemRoot: "", folderPaths: folders.filter((p) => p !== `${parent}/+ A`), jdexFolder: JDEX, notePaths: [...NOTES, ...children] });
    expect(pairAction({ oldPath: children[0], newPath: `${JDEX}/21.22+ Z.md`, isFolder: false }, index, settings)).toEqual({ type: "none" });
    expect(pairAction({ oldPath: children[1], newPath: `${JDEX}/21.22+ B #nuevo.md`, isFolder: false }, index, settings)).toEqual({ type: "none" });
  });

  it.each([
    ["", ""], ["D01.", "D01."],
  ])("keeps each regular partner's existing system prefix (note=%s, folder=%s)", (notePrefix, folderPrefix) => {
    const folderPath = `${CAT}/${folderPrefix}21.22 Antes`;
    const oldNote = `${JDEX}/${notePrefix}21.22 Antes #ayuda.md`;
    const newNote = `${JDEX}/${notePrefix}21.22 Después #ayuda.md`;
    const index = buildIndex({ systemRoot: "", folderPaths: [...FOLDERS.filter((p) => p !== parent), folderPath], jdexFolder: JDEX, notePaths: [newNote] });
    expect(pairAction({ oldPath: oldNote, newPath: newNote, isFolder: false }, index, settings)).toMatchObject({
      type: "rename-partner", partnerPath: folderPath, newPartnerPath: `${CAT}/${folderPrefix}21.22 Después`,
    });
    const renamedFolder = `${CAT}/${folderPrefix}21.22 Después`;
    const folderIndex = buildIndex({ systemRoot: "", folderPaths: [...FOLDERS.filter((p) => p !== parent), renamedFolder], jdexFolder: JDEX, notePaths: [oldNote] });
    expect(pairAction({ oldPath: folderPath, newPath: renamedFolder, isFolder: true }, folderIndex, settings)).toMatchObject({
      type: "rename-partner", partnerPath: oldNote, newPartnerPath: newNote,
    });
  });

  it("keeps a prefixed parent's child folder convention and its note's prefix and tags", () => {
    const prefixedParent = `${CAT}/D01.21.22 JDex Manager`;
    const child = `${prefixedParent}/+ A`;
    const note = `${JDEX}/D01.21.22+ A #ayuda.md`;
    const index = buildIndex({ systemRoot: "", folderPaths: [...FOLDERS.filter((p) => p !== parent), prefixedParent, child], jdexFolder: JDEX, notePaths: [note] });
    expect(pairAction({ oldPath: note, newPath: `${JDEX}/D01.21.22+ Z #ayuda.md`, isFolder: false }, index, settings)).toMatchObject({
      type: "rename-partner", partnerPath: child, newPartnerPath: `${prefixedParent}/+ Z`,
    });
    expect(pairAction({ oldPath: child, newPath: `${prefixedParent}/+ Z`, isFolder: true }, index, settings)).toMatchObject({
      type: "rename-partner", partnerPath: note, newPartnerPath: `${JDEX}/D01.21.22+ Z #ayuda.md`,
    });
  });

  it("renaming the note proposes renaming the folder", () => {
    const index = buildIndex({
      systemRoot: "",
      folderPaths: FOLDERS,
      jdexFolder: JDEX,
      notePaths: NOTES.map((p) => (p.endsWith("21.22 JDex Manager.md") ? `${JDEX}/21.22 Gestor del JDex.md` : p)),
    });
    const action = pairAction(
      { oldPath: `${JDEX}/21.22 JDex Manager.md`, newPath: `${JDEX}/21.22 Gestor del JDex.md`, isFolder: false },
      index,
      settings,
    );
    expect(action).toEqual({
      type: "rename-partner",
      id: "21.22",
      partnerPath: `${CAT}/21.22 JDex Manager`,
      newPartnerPath: `${CAT}/21.22 Gestor del JDex`,
    });
  });

  it("renaming the folder proposes renaming the note", () => {
    const index = buildIndex({
      systemRoot: "",
      folderPaths: FOLDERS.map((p) => (p === `${CAT}/21.22 JDex Manager` ? `${CAT}/21.22 Gestor` : p)),
      jdexFolder: JDEX,
      notePaths: NOTES,
    });
    const action = pairAction({ oldPath: `${CAT}/21.22 JDex Manager`, newPath: `${CAT}/21.22 Gestor`, isFolder: true }, index, settings);
    expect(action).toEqual({
      type: "rename-partner",
      id: "21.22",
      partnerPath: `${JDEX}/21.22 JDex Manager.md`,
      newPartnerPath: `${JDEX}/21.22 Gestor.md`,
    });
  });

  const index = buildIndex({ systemRoot: "", folderPaths: FOLDERS, jdexFolder: JDEX, notePaths: NOTES });

  it("refuses to renumber", () => {
    expect(pairAction({ oldPath: `${JDEX}/21.22 JDex Manager.md`, newPath: `${JDEX}/21.23 JDex Manager.md`, isFolder: false }, index, settings)).toEqual({
      type: "renumbered",
      oldId: "21.22",
      newId: "21.23",
    });
  });

  it("warns when a folder moves to another category", () => {
    const action = pairAction(
      { oldPath: `${CAT}/21.22 JDex Manager`, newPath: "20-29 Trabajo y productos/22 Sitios web y publicación/21.22 JDex Manager", isFolder: true },
      index,
      settings,
    );
    expect(action).toEqual({ type: "moved", id: "21.22", from: CAT, to: "20-29 Trabajo y productos/22 Sitios web y publicación" });
  });

  describe("a renamed parent is not a move of the ID", () => {
    const AREA = "20-29 Trabajo y productos";
    const folder = "21.22 JDex Manager";

    it("renaming the category or the area gives none, moving to another category still gives moved (probe control)", () => {
      expect(pairAction({ oldPath: `${CAT}/${folder}`, newPath: `${AREA}/21 Productos renombrados/${folder}`, isFolder: true }, index, settings)).toEqual({ type: "none" });
      expect(pairAction({ oldPath: `${CAT}/${folder}`, newPath: `20-29 Trabajo/21 Productos de software propios/${folder}`, isFolder: true }, index, settings)).toEqual({ type: "none" });
      expect(pairAction({ oldPath: `${CAT}/${folder}`, newPath: `${AREA}/22 Sitios web y publicación/${folder}`, isFolder: true }, index, settings)).toMatchObject({ type: "moved" });
    });

    it.each([["D01."], ["D02."]])("compares the system prefix: %s parents rename freely, a change of system is a move", (prefix) => {
      const oldCat = `${prefix}10-19 Area/${prefix}21 Categoría`;
      const id = `${prefix}21.22 JDex Manager`;
      const old = `${oldCat}/${id}`;
      expect(pairAction({ oldPath: old, newPath: `${prefix}10-19 Otra area/${prefix}21 Categoría nueva/${id}`, isFolder: true }, index, settings)).toEqual({ type: "none" });
      const other = prefix === "D01." ? "D02." : "D01.";
      expect(pairAction({ oldPath: old, newPath: `${other}10-19 Area/${other}21 Categoría/${id}`, isFolder: true }, index, settings)).toMatchObject({ type: "moved" });
    });

    it("an unprefixed system differs from D01", () => {
      expect(pairAction({ oldPath: `10-19 Area/21 Categoría/${folder}`, newPath: `D01.10-19 Area/D01.21 Categoría/${folder}`, isFolder: true }, index, settings)).toMatchObject({ type: "moved" });
    });

    it("covers the parents of + children: a renamed ID folder or category is not a move, another category is", () => {
      const parentId = `${CAT}/${folder}`;
      const nested = (cat: string, idFolder: string) => `${AREA}/${cat}/${idFolder}/+ A`;
      const nestedIndex = buildIndex({ systemRoot: "", folderPaths: [...FOLDERS, `${parentId}/+ A`], jdexFolder: JDEX, notePaths: [...NOTES, `${JDEX}/21.22+ A.md`] });
      const old = `${parentId}/+ A`;
      expect(pairAction({ oldPath: old, newPath: nested("21 Productos de software propios", "21.22 Gestor"), isFolder: true }, nestedIndex, settings)).toEqual({ type: "none" });
      expect(pairAction({ oldPath: old, newPath: nested("21 Productos renombrados", folder), isFolder: true }, nestedIndex, settings)).toEqual({ type: "none" });
      expect(pairAction({ oldPath: old, newPath: nested("22 Sitios web y publicación", folder), isFolder: true }, nestedIndex, settings)).toMatchObject({ type: "moved", id: "21.22+" });
    });
  });

  it("does nothing for same title, non-JD names, notes outside the JDex or ids without a partner", () => {
    expect(pairAction({ oldPath: `${JDEX}/21.22 JDex Manager.md`, newPath: `${JDEX}/21.22 JDex Manager.md`, isFolder: false }, index, settings)).toEqual({ type: "none" });
    expect(pairAction({ oldPath: "Notas/Hola.md", newPath: "Notas/Adiós.md", isFolder: false }, index, settings)).toEqual({ type: "none" });
    expect(pairAction({ oldPath: "Otro/21.22 JDex Manager.md", newPath: "Otro/21.22 X.md", isFolder: false }, index, settings)).toEqual({ type: "none" });
    expect(pairAction({ oldPath: `${JDEX}/21.21 Temas de Obsidian.md`, newPath: `${JDEX}/21.21 Temas.md`, isFolder: false }, index, settings)).toEqual({ type: "none" });
  });
});

describe("pairAction on repeated numbers and empty titles", () => {
  const parent = `${CAT}/21.22 JDex Manager`;
  const oldPath = `${JDEX}/21.22+ A.md`;
  const newPath = `${JDEX}/21.22+ Z.md`;

  it("proposes nothing when the number is repeated (it could rename toward the other ID)", () => {
    const build = (folders: string[]) => buildIndex({ systemRoot: "", folderPaths: [...FOLDERS, ...folders], jdexFolder: JDEX, notePaths: [...NOTES, oldPath] });
    expect(pairAction({ oldPath, newPath, isFolder: false }, build([`${parent}/+ A`]), settings).type).toBe("rename-partner");
    // Two folders `+ A` under the same parent: the `+` identity is repeated.
    const repeated = buildIndex({ systemRoot: "", folderPaths: [...FOLDERS, `${parent}/+ A`, `${CAT}/21.22 JDex Manager/+ A`], jdexFolder: JDEX, notePaths: [...NOTES, oldPath, `${JDEX}/21.22+ A #otra.md`] });
    expect(pairAction({ oldPath, newPath, isFolder: false }, repeated, settings)).toEqual({ type: "none" });
    expect(pairBlockedByRepeat({ oldPath, newPath, isFolder: false }, repeated, settings)).toBe(true);
    expect(pairBlockedByRepeat({ oldPath, newPath, isFolder: false }, build([`${parent}/+ A`]), settings)).toBe(false);
  });

  it("proposes no `+` alone when the new title is empty", () => {
    const index = buildIndex({ systemRoot: "", folderPaths: [...FOLDERS, `${parent}/+ A`], jdexFolder: JDEX, notePaths: [...NOTES, oldPath] });
    expect(pairAction({ oldPath, newPath: `${JDEX}/21.22+ ----.md`, isFolder: false }, index, settings)).toEqual({ type: "none" });
  });
});

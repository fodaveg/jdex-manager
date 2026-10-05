import { describe, expect, it } from "vitest";
import { buildIndex } from "../src/jd/index";
import { pairAction } from "../src/jd/pair";
import { FOLDERS, JDEX, NOTES } from "./fixtures";

const settings = { jdexFolder: JDEX, systemRoot: "" };
const CAT = "20-29 Trabajo y productos/21 Productos de software propios";

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
    ["", ""], ["D01.", ""], ["", "D01."], ["D01.", "D01."],
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

  it("does nothing for same title, non-JD names, notes outside the JDex or ids without a partner", () => {
    expect(pairAction({ oldPath: `${JDEX}/21.22 JDex Manager.md`, newPath: `${JDEX}/21.22 JDex Manager.md`, isFolder: false }, index, settings)).toEqual({ type: "none" });
    expect(pairAction({ oldPath: "Notas/Hola.md", newPath: "Notas/Adiós.md", isFolder: false }, index, settings)).toEqual({ type: "none" });
    expect(pairAction({ oldPath: "Otro/21.22 JDex Manager.md", newPath: "Otro/21.22 X.md", isFolder: false }, index, settings)).toEqual({ type: "none" });
    expect(pairAction({ oldPath: `${JDEX}/21.21 Temas de Obsidian.md`, newPath: `${JDEX}/21.21 Temas.md`, isFolder: false }, index, settings)).toEqual({ type: "none" });
  });
});

import { describe, expect, it } from "vitest";
import { buildIndex } from "../src/jd/index";
import { pairAction } from "../src/jd/pair";
import { FOLDERS, JDEX, NOTES } from "./fixtures";

const settings = { jdexFolder: JDEX, systemRoot: "" };
const CAT = "20-29 Trabajo y productos/21 Productos de software propios";

describe("pairAction", () => {
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

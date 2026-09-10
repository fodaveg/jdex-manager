import { describe, expect, it } from "vitest";
import {
  CHILDREN_END,
  CHILDREN_START,
  childrenOf,
  headerEntries,
  headerRange,
  renderChildren,
  replaceChildrenBlock,
  wrapFirstLinkList,
} from "../src/jd/headers";
import { buildIndex } from "../src/jd/index";
import { FOLDERS, JDEX, NOTES } from "./fixtures";

const index = buildIndex({
  systemRoot: "",
  folderPaths: FOLDERS,
  jdexFolder: JDEX,
  notePaths: [...NOTES, `${JDEX}/11.14 Nueva.md`, `${JDEX}/11.13+ Hija.md`, `${JDEX}/11.20 ■ Otra.md`],
});

describe("headerRange", () => {
  it("covers X1 to X9 of the same category and rejects non-headers", () => {
    expect(headerRange("11.10")).toEqual({ category: "11", from: 11, to: 19 });
    expect(headerRange("11.20")).toEqual({ category: "11", from: 21, to: 29 });
    expect(headerRange("11.00")).toBeNull();
    expect(headerRange("11.11")).toBeNull();
    expect(headerRange("11.10+")).toBeNull();
  });
});

describe("childrenOf and renderChildren", () => {
  it("lists the ids in range, sorted, without extensions or other categories", () => {
    const kids = childrenOf(index, "11.10");
    expect(kids.map((k) => k.id)).toEqual(["11.11", "11.14"]);
    expect(renderChildren(kids)).toBe("- [[11.11 Identidad y documentos oficiales]]\n- [[11.14 Nueva]]");
  });

  it("lists children without a note as plain text", () => {
    const kids = childrenOf(index, "11.20");
    expect(kids).toEqual([]);
    expect(renderChildren([{ id: "12.31", category: "12", title: "Fiat Tipo", label: "12.31 Fiat Tipo" }])).toBe("- 12.31 Fiat Tipo");
  });

  it("finds header notes", () => {
    expect(headerEntries(index).map((h) => h.id)).toEqual(["11.10", "11.20"]);
  });
});

describe("replaceChildrenBlock", () => {
  it("replaces only what sits between the markers", () => {
    const note = `# 11.10 ■ Cabecera\nIntro.\n${CHILDREN_START}\n- viejo\n${CHILDREN_END}\nPie.`;
    expect(replaceChildrenBlock(note, "- [[nuevo]]")).toBe(
      `# 11.10 ■ Cabecera\nIntro.\n${CHILDREN_START}\n- [[nuevo]]\n${CHILDREN_END}\nPie.`,
    );
  });

  it("returns null without markers", () => {
    expect(replaceChildrenBlock("# 11.10\n- [[a]]", "- [[b]]")).toBeNull();
  });
});

describe("wrapFirstLinkList", () => {
  it("wraps the first contiguous list of wikilinks and nothing else", () => {
    const note = "# 11.10 ■ Cabecera\nTexto.\n\n- [[11.11 A]]\n- [[11.12 B]]\n\nOtra cosa\n- [[Suelto]]";
    expect(wrapFirstLinkList(note)).toBe(
      `# 11.10 ■ Cabecera\nTexto.\n\n${CHILDREN_START}\n- [[11.11 A]]\n- [[11.12 B]]\n${CHILDREN_END}\n\nOtra cosa\n- [[Suelto]]`,
    );
  });

  it("returns null when there is no list or markers already exist", () => {
    expect(wrapFirstLinkList("# 11.10\nSin lista.")).toBeNull();
    expect(wrapFirstLinkList(`${CHILDREN_START}\n- [[a]]\n${CHILDREN_END}`)).toBeNull();
  });
});

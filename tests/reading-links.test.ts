import { describe, expect, it } from "vitest";
import { findJdNumbers } from "../src/jd/reading-links";

const KNOWN = new Set(["21.22", "21.22+", "11.11"]);
const exists = (id: string): boolean => KNOWN.has(id);

describe("findJdNumbers", () => {
  it("finds a bare number that exists, with its offsets", () => {
    expect(findJdNumbers("ver 21.22 antes", exists)).toEqual([{ start: 4, end: 9, id: "21.22" }]);
  });

  it("finds extensions and several numbers in one text", () => {
    expect(findJdNumbers("21.22+ y 11.11.", exists)).toEqual([
      { start: 0, end: 6, id: "21.22+" },
      { start: 9, end: 14, id: "11.11" },
    ]);
  });

  it("keeps the system prefix apart from the id", () => {
    expect(findJdNumbers("D01.21.22", exists)).toEqual([{ start: 0, end: 9, id: "21.22", system: "D01" }]);
  });

  it("ignores numbers the index does not know", () => {
    expect(findJdNumbers("12.34 y 21.23", exists)).toEqual([]);
  });

  it("ignores things that only look like ids", () => {
    for (const text of ["12.5", "1.234", "2026.09", "2026.09.16", "v1.21.22", "21.223", "x21.22", "21.22x", "21.22.1"]) {
      expect(findJdNumbers(text, () => true), text).toEqual([]);
    }
  });

  it("is inert on a wiki link text (the DOM walker never reaches links anyway)", () => {
    expect(findJdNumbers("[[21.22 JDex Manager]]", exists)).toEqual([{ start: 2, end: 7, id: "21.22" }]);
  });

  it("returns nothing when there is nothing", () => {
    expect(findJdNumbers("", exists)).toEqual([]);
    expect(findJdNumbers("sin números", exists)).toEqual([]);
  });
});

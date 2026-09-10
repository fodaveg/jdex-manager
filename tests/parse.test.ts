import { describe, expect, it } from "vitest";
import {
  extractJdPrefix,
  isHeader,
  isReserved,
  jdexNoteName,
  nextFreeCategory,
  nextFreeId,
  parseJdNumber,
} from "../src/jd/parse";

describe("parseJdNumber", () => {
  it("parses areas", () => {
    expect(parseJdNumber("10-19")).toEqual({ kind: "area", area: 10 });
    expect(parseJdNumber("00-09")).toEqual({ kind: "area", area: 0 });
    expect(parseJdNumber("10-29")).toBeNull();
  });

  it("parses categories", () => {
    expect(parseJdNumber("11")).toEqual({ kind: "category", category: "11" });
    expect(parseJdNumber("10")).toEqual({ kind: "category", category: "10" });
  });

  it("parses ids and normalises one-digit ids", () => {
    expect(parseJdNumber("11.11")).toEqual({ kind: "id", category: "11", id: "11.11" });
    expect(parseJdNumber("11.1")).toEqual({ kind: "id", category: "11", id: "11.01" });
    expect(parseJdNumber(" 21.22 ")).toEqual({ kind: "id", category: "21", id: "21.22" });
  });

  it("parses the + extension", () => {
    expect(parseJdNumber("13.41+")).toEqual({ kind: "id", category: "13", id: "13.41", extension: "+" });
  });

  it("rejects what is not a JD number", () => {
    for (const bad of ["", "9", "9.5", "11.111", "D01.11.11", "11.11.01", "A11.01", "11.11 Title"]) {
      expect(parseJdNumber(bad), bad).toBeNull();
    }
  });
});

describe("extractJdPrefix", () => {
  it("splits number and title from folder and note names", () => {
    expect(extractJdPrefix("21.22 JDex Manager")).toEqual({
      number: { kind: "id", category: "21", id: "21.22" },
      title: "JDex Manager",
    });
    expect(extractJdPrefix("21.22 JDex Manager.md")?.title).toBe("JDex Manager");
    expect(extractJdPrefix("14.10 ■ 🖥️ Computers")?.title).toBe("■ 🖥️ Computers");
    expect(extractJdPrefix("13.41+ Ozito")).toEqual({
      number: { kind: "id", category: "13", id: "13.41", extension: "+" },
      title: "Ozito",
    });
    expect(extractJdPrefix("10-19 Life admin")).toEqual({ number: { kind: "area", area: 10 }, title: "Life admin" });
    expect(extractJdPrefix("11 Money")).toEqual({ number: { kind: "category", category: "11" }, title: "Money" });
    expect(extractJdPrefix("11_Money")?.title).toBe("Money");
    expect(extractJdPrefix("11")?.title).toBe("");
  });

  it("does not match numbers glued to text or plain names", () => {
    expect(extractJdPrefix("21.22JDex")).toBeNull();
    expect(extractJdPrefix("Home Panel")).toBeNull();
    expect(extractJdPrefix("2026-09-10 Audit")).toBeNull();
  });
});

describe("isReserved", () => {
  it("flags the standard zeros", () => {
    expect(isReserved({ kind: "area", area: 0 })).toBe(true);
    expect(isReserved({ kind: "area", area: 10 })).toBe(false);
    expect(isReserved({ kind: "category", category: "10" })).toBe(true);
    expect(isReserved({ kind: "category", category: "11" })).toBe(false);
    expect(isReserved({ kind: "id", category: "11", id: "11.01" })).toBe(true);
    expect(isReserved({ kind: "id", category: "11", id: "11.09" })).toBe(true);
    expect(isReserved({ kind: "id", category: "11", id: "11.11" })).toBe(false);
  });
});

describe("isHeader", () => {
  it("recognises ids ending in 0 and black-square titles", () => {
    expect(isHeader("14.10 ■ Computers")).toBe(true);
    expect(isHeader("14.20 Devices")).toBe(true);
    expect(isHeader("14.11 ■ Odd but explicit")).toBe(true);
    expect(isHeader("14.11 My computers")).toBe(false);
    expect(isHeader("11.00 JDex for 11")).toBe(false);
    expect(isHeader("11 Money")).toBe(false);
  });
});

describe("nextFreeId", () => {
  it("starts at .11 and skips the zeros", () => {
    expect(nextFreeId("11", [])).toBe("11.11");
    expect(nextFreeId("11", ["11.01", "11.09"])).toBe("11.11");
  });

  it("takes the highest in use plus one", () => {
    expect(nextFreeId("11", ["11.11", "11.15"])).toBe("11.16");
    expect(nextFreeId("11", ["11.11", "11.15+", "11.15+ Child"])).toBe("11.16");
  });

  it("skips header slots ending in 0", () => {
    expect(nextFreeId("14", ["14.10", "14.11", "14.12", "14.13", "14.14", "14.19"])).toBe("14.21");
  });

  it("ignores other categories and stops at .99", () => {
    expect(nextFreeId("11", ["12.50"])).toBe("11.11");
    expect(nextFreeId("11", ["11.99"])).toBeNull();
  });
});

describe("nextFreeCategory", () => {
  it("starts at A1 and takes the highest plus one", () => {
    expect(nextFreeCategory(10, [])).toBe("11");
    expect(nextFreeCategory(10, ["10", "11", "13"])).toBe("14");
    expect(nextFreeCategory(20, ["11", "21"])).toBe("22");
    expect(nextFreeCategory(0, [])).toBe("01");
  });

  it("stops at A9", () => {
    expect(nextFreeCategory(10, ["19"])).toBeNull();
  });
});

describe("jdexNoteName", () => {
  it("joins id and title", () => {
    expect(jdexNoteName("21.22", "JDex Manager")).toBe("21.22 JDex Manager");
  });

  it("makes the title safe for file systems and Obsidian Sync", () => {
    expect(jdexNoteName("11.11", "Planificación semanal: 3 enfoques")).toBe("11.11 Planificación semanal - 3 enfoques");
    expect(jdexNoteName("11.11", 'a*b?c"d<e>f|g/h\\i')).toBe("11.11 abcdefghi");
    expect(jdexNoteName("11.11", "  spaced   out  ")).toBe("11.11 spaced out");
    expect(jdexNoteName("11.11", "")).toBe("11.11");
  });
});

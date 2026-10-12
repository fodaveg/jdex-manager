import { describe, expect, it } from "vitest";
import { titleForCompare } from "../src/jd/title";

describe("titleForCompare", () => {
  it("removes consecutive trailing tags with Unicode and nested paths", () => {
    expect(titleForCompare("Viaje #claude #España/2026 #viaje-1 #nota_2")).toBe("Viaje");
  });

  it("keeps internal hashes and untagged titles", () => {
    expect(titleForCompare("Viaje #claude pendiente")).toBe("Viaje #claude pendiente");
    expect(titleForCompare("C# y F#")).toBe("C# y F#");
    expect(titleForCompare("Viaje")).toBe("Viaje");
  });

  it("keeps a title's own digits and words that only look like a Hebra suffix", () => {
    for (const title of ["Informe--2024", "Año--1999", "Plan--12345678", "Nota--ABCD", "Plan--12345678901234567890123456789012"]) {
      expect(titleForCompare(title)).toBe(title);
    }
  });

  it("removes the suffixes Hebra emits (4, 8, 12 or 32 lowercase hex digits of the note id)", () => {
    expect(titleForCompare("Informe--1a2b")).toBe("Informe");
    expect(titleForCompare("Informe--1a2b3c4d")).toBe("Informe");
    expect(titleForCompare("Informe--1a2b3c4d5e6f")).toBe("Informe");
    expect(titleForCompare("Informe--0190a2b3c4d54e6f8a1b2c3d4e5f6a7b")).toBe("Informe");
    expect(titleForCompare("Informe #tag--1a2b")).toBe("Informe");
  });
});

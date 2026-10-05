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
});

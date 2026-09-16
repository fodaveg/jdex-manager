import { describe, expect, it } from "vitest";
import { templateNameCandidates } from "../src/jd/template";

describe("templateNameCandidates", () => {
  it("tries the category, then the area, then the general name", () => {
    expect(templateNameCandidates("JDex - id", { category: "21", area: "20-29" })).toEqual(["JDex - id - 21", "JDex - id - 20-29", "JDex - id"]);
  });

  it("skips the levels it does not know", () => {
    expect(templateNameCandidates("JDex - id", { area: "20-29" })).toEqual(["JDex - id - 20-29", "JDex - id"]);
    expect(templateNameCandidates("JDex - id", { category: "21" })).toEqual(["JDex - id - 21", "JDex - id"]);
    expect(templateNameCandidates("JDex - id")).toEqual(["JDex - id"]);
  });
});

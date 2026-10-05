import { describe, expect, it } from "vitest";
import { filesByFolder } from "../src/jd/path-index";

describe("filesByFolder", () => {
  it("matches descendant prefix scans, preserving duplicates and all file types", () => {
    const paths = ["a", "a/x.md", "ab/y.pdf", "a/deep/z.png", "a/x.md", "/root.md", "a//raw.json", "área/archivo.base"];
    const before = [...paths];
    const map = filesByFolder(paths);
    const selected = filesByFolder(paths, ["a", "ab", "a/deep", "a/", "", "área", "missing", "a"]);
    for (const folder of ["a", "ab", "a/deep", "a/", "", "área", "missing"]) {
      expect(map.get(folder) ?? [], folder).toEqual(paths.filter((p) => p.startsWith(folder + "/")));
      expect(selected.get(folder), folder).toEqual(paths.filter((p) => p.startsWith(folder + "/")));
    }
    expect(paths).toEqual(before);
  });

  it("does not count a folder's own path or siblings with the same prefix", () => {
    const map = filesByFolder(["ID", "ID sibling/x.md", "ID/nested/a.pdf"]);
    expect(map.get("ID")).toEqual(["ID/nested/a.pdf"]);
    expect(filesByFolder([]).size).toBe(0);
  });
});

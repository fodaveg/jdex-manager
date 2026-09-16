import { describe, expect, it } from "vitest";
import { openGlobalSearch, pathQuery } from "../src/vault/search";

describe("pathQuery", () => {
  it("quotes the folder with a trailing slash so siblings with the same prefix are excluded", () => {
    expect(pathQuery("20-29 Trabajo/21 Productos/21.22 JDex Manager")).toBe('path:"20-29 Trabajo/21 Productos/21.22 JDex Manager/"');
  });
});

describe("openGlobalSearch", () => {
  it("calls the core search plugin when it is there", () => {
    const seen: string[] = [];
    const app = { internalPlugins: { getPluginById: () => ({ instance: { openGlobalSearch: (q: string) => seen.push(q) } }) } };
    expect(openGlobalSearch(app as never, "path:x")).toBe(true);
    expect(seen).toEqual(["path:x"]);
  });

  it("reports when the private API is missing", () => {
    expect(openGlobalSearch({} as never, "q")).toBe(false);
    expect(openGlobalSearch({ internalPlugins: { getPluginById: () => null } } as never, "q")).toBe(false);
  });
});

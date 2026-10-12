import { describe, expect, it, vi } from "vitest";
import { type App, TFile } from "obsidian";
import { fileDate, parseDateValue } from "../src/vault/file-date";
import { dateFile } from "../src/vault/files";

const CTIME = new Date(2026, 9, 12, 8, 0).getTime();

function fixture(frontmatter: Record<string, unknown> | undefined, extension = "md") {
  const file = Object.assign(new TFile(), { path: `Inbox/note.${extension}`, name: `note.${extension}`, extension, parent: { path: "Inbox" }, stat: { ctime: CTIME, mtime: CTIME } });
  const renameFile = vi.fn();
  const app = {
    metadataCache: { getFileCache: () => ({ frontmatter }) },
    vault: { getAbstractFileByPath: () => null },
    fileManager: { renameFile },
  } as unknown as App;
  return { app, file, renameFile };
}

describe("parseDateValue", () => {
  it.each([
    ["2026-03-04", [2026, 2, 4]],
    ["2026-03-04T10:00:00", [2026, 2, 4]],
    [" 2025-12-31 ", [2025, 11, 31]],
  ])("accepts %s", (value, [y, m, d]) => {
    const date = parseDateValue(value)!;
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([y, m, d]);
  });
  it.each([["2026-02-30"], ["2026-13-01"], ["March 4"], ["2026-03"], [20260304], [null], [undefined]])("rejects %s", (value) => {
    expect(parseDateValue(value)).toBeNull();
  });
});

describe("fileDate: the date a file is dated or archived with", () => {
  it("prefers a valid frontmatter date over ctime, in key order", () => {
    const { app, file } = fixture({ created: "2020-01-02", fecha: "2021-05-06" });
    expect(fileDate(app, file).getFullYear()).toBe(2021);
    expect(fileDate(app, file).getMonth()).toBe(4);
  });
  it("falls back to ctime without a usable date, and for non-Markdown files", () => {
    for (const { app, file } of [fixture(undefined), fixture({ fecha: "not a date" }), fixture({ fecha: "2021-05-06" }, "pdf")]) {
      expect(fileDate(app, file).getTime()).toBe(CTIME);
    }
  });
  it("dateFile names the file after the frontmatter date, not after ctime", async () => {
    const { app, file, renameFile } = fixture({ fecha: "2021-05-06" });
    expect(await dateFile(app, file, "YYYY-MM-DD")).toBe("Inbox/2021-05-06 note.md");
    expect(renameFile).toHaveBeenCalledWith(file, "Inbox/2021-05-06 note.md");
    const fallback = fixture({});
    expect(await dateFile(fallback.app, fallback.file, "YYYY-MM-DD")).toBe("Inbox/2026-10-12 note.md");
  });
});

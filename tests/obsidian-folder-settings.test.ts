/**
 * Audit 12 Oct 2026, finding 15 (Obsidian): renaming the JDex folder (or an ancestor)
 * proposes updating the setting, the audit reports a configured folder that does not
 * exist, and creating never recreates the old JDex folder.
 */
import { describe, expect, it, vi } from "vitest";
import { type App, TFile, TFolder } from "obsidian";
import JdexManagerPlugin from "../src/main";
import { mergeSettings } from "../src/jd/settings";
import { collectAudit } from "../src/vault/audit";
import { createJdexNote } from "../src/vault/create";
import { renamedFolderSettings } from "../src/vault/settings-paths";

const answer = vi.hoisted(() => ({ value: true, asked: 0 }));
vi.mock("../src/ui/confirm", () => ({
  confirm: async () => {
    answer.asked += 1;
    return answer.value;
  },
}));

function vault(folderPaths: string[], notePaths: string[]) {
  const folders = folderPaths.map((path) => Object.assign(new TFolder(), { path, name: path.slice(path.lastIndexOf("/") + 1) }));
  const files = notePaths.map((path) => Object.assign(new TFile(), { path, name: path.slice(path.lastIndexOf("/") + 1), basename: path.slice(path.lastIndexOf("/") + 1, -3), extension: "md", stat: { ctime: 1, mtime: 1 } }));
  const create = vi.fn();
  const app = {
    vault: {
      getAllLoadedFiles: () => [...folders, ...files],
      getMarkdownFiles: () => files,
      getAbstractFileByPath: (path: string) => [...folders, ...files].find((entry) => entry.path === path) ?? null,
      cachedRead: async () => "",
      create,
    },
    metadataCache: { getFileCache: () => ({ frontmatter: { descripcion: "x" } }) },
    workspace: { layoutReady: true, getActiveFile: () => null },
  } as unknown as App;
  return { app, folders, files, create };
}

describe("renamedFolderSettings (061b492e)", () => {
  const settings = { jdexFolder: "00-09 S/00 S/00.00 JDex", systemRoot: "", reportsFolder: "00-09 S/00 S/00.02 Informes", templatesFolder: "" };

  it("maps the JDex folder itself", () => {
    expect(renamedFolderSettings(settings, "00-09 S/00 S/00.00 JDex", "00-09 S/00 S/00.00 Índice")).toEqual([
      { key: "jdexFolder", label: "JDex folder", from: "00-09 S/00 S/00.00 JDex", to: "00-09 S/00 S/00.00 Índice" },
    ]);
  });

  it("maps every setting below a renamed ancestor", () => {
    expect(renamedFolderSettings(settings, "00-09 S/00 S", "00-09 S/00 Gestión").map((entry) => entry.to)).toEqual([
      "00-09 S/00 Gestión/00.00 JDex",
      "00-09 S/00 Gestión/00.02 Informes",
    ]);
  });

  it("ignores unrelated and prefix-sharing folders", () => {
    expect(renamedFolderSettings(settings, "00-09 S/00 S/00.00 JDe", "x")).toEqual([]);
    expect(renamedFolderSettings(settings, "20-29 A", "20-29 B")).toEqual([]);
  });
});

describe("Obsidian: the renamed JDex folder keeps the index (061b492e)", () => {
  function plugin(app: App, jdexFolder: string) {
    const saveData = vi.fn(async () => {});
    const instance = Object.assign(Object.create(JdexManagerPlugin.prototype) as object, {
      app, settings: mergeSettings({ jdexFolder }), journal: [], saveData, renaming: false, followingSettingPaths: new Set<string>(),
    }) as unknown as JdexManagerPlugin;
    return { instance, saveData };
  }

  it("accepting the proposal updates the setting and the index finds the notes again", async () => {
    answer.value = true;
    const { app, folders, files } = vault(["New JDex", "20-29 A", "20-29 A/21 C", "20-29 A/21 C/21.11 X"], ["New JDex/21.11 X.md"]);
    const { instance, saveData } = plugin(app, "Old JDex");
    await instance.onRename(folders[0], "Old JDex");
    expect(instance.settings.jdexFolder).toBe("New JDex");
    expect(saveData).toHaveBeenCalled();
    const { findings } = await collectAudit(app, instance.settings);
    expect(findings.filter((finding) => finding.kind === "folder-without-note" || finding.kind === "missing-folder")).toEqual([]);
    expect(files).toHaveLength(1);
  });

  it("declining keeps the old path and the audit reports the missing folder", async () => {
    answer.value = false;
    const { app, folders } = vault(["New JDex", "20-29 A", "20-29 A/21 C", "20-29 A/21 C/21.11 X"], ["New JDex/21.11 X.md"]);
    const { instance, saveData } = plugin(app, "Old JDex");
    await instance.onRename(folders[0], "Old JDex");
    expect(instance.settings.jdexFolder).toBe("Old JDex");
    expect(saveData).not.toHaveBeenCalled();
    const { findings } = await collectAudit(app, instance.settings);
    expect(findings.find((finding) => finding.kind === "missing-folder")?.message).toBe("La carpeta JDex configurada («Old JDex») no existe: revisa los ajustes.");
  });

  it("an existing configured folder is not a finding", async () => {
    const { app } = vault(["J"], ["J/21.11 X.md"]);
    const { findings } = await collectAudit(app, mergeSettings({ jdexFolder: "J" }));
    expect(findings.some((finding) => finding.kind === "missing-folder")).toBe(false);
  });

  it("creating a JDex note never recreates a missing JDex folder", async () => {
    const { app, create } = vault(["New JDex"], []);
    await expect(createJdexNote(app, mergeSettings({ jdexFolder: "Old JDex" }), "id", "21.11 X", {})).rejects.toThrow(/does not exist/);
    expect(create).not.toHaveBeenCalled();
  });
});

/* eslint-disable @typescript-eslint/unbound-method -- vi.fn members of the vault double are read as values to assert on. */
/*
 * Exports of src/vault/*.ts that no test exercised directly (measured with a script that compares the
 * exported names with the names the tests mention, then with v8 coverage of the focal run):
 * detect.ts, templates.ts, structure.ts, scan.ts, create.ts (ensureFolder), files.ts (inboxFiles) and
 * audit.ts (jdexNoteMetas, collectAuditFindings, runAudit). They run on the shared vault double.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { buildIndex } from "../src/jd/index";
import { BUILTIN_TEMPLATES, TEMPLATE_TYPES } from "../src/jd/template";
import type { Effect } from "../src/jd/journal";
import { DEFAULT_SETTINGS, type JdexManagerSettings } from "../src/settings";
import { collectAuditFindings, jdexNoteMetas, runAudit } from "../src/vault/audit";
import { ensureFolder } from "../src/vault/create";
import { applyDetection, detectInVault } from "../src/vault/detect";
import { inboxFiles } from "../src/vault/files";
import { allFolderPaths, allNotePaths, scanVault } from "../src/vault/scan";
import { createMissingStructureNotes, missingStructureNotes, systemIndexFile, updateSystemIndex } from "../src/vault/structure";
import { resolveTemplate, templatePath, writeBuiltinTemplates } from "../src/vault/templates";
import { FakeObsidianVault } from "./support/fake-obsidian-vault";
import { notices, resetStub } from "./support/obsidian-stub-api";

const settings = (over: Partial<JdexManagerSettings> = {}): JdexManagerSettings => ({ ...DEFAULT_SETTINGS, jdexFolder: "J", ...over });

beforeEach(resetStub);

describe("scan: paths from the live vault", () => {
  it("lists folders without the root and Markdown notes only", () => {
    const v = new FakeObsidianVault();
    v.folder("20-29 Area/21 Cat");
    v.file("J/21.11 Note.md");
    v.file("J/attachment.pdf");
    expect(allFolderPaths(v.app).sort()).toEqual(["20-29 Area", "20-29 Area/21 Cat", "J"]);
    expect(allNotePaths(v.app)).toEqual(["J/21.11 Note.md"]);
    const index = scanVault(v.app, settings());
    expect(index.areas.map((area) => area.path)).toEqual(["20-29 Area"]);
  });
});

describe("detect: the standard zeros in the live vault", () => {
  const zeros = ["00-09 Sistema/00 Gestion/00.00 JDex", "00-09 Sistema/00 Gestion/00.02 Informes", "00-09 Sistema/00 Gestion/00.03 Plantillas"];

  it("finds 00.00, 00.02 and 00.03", () => {
    const v = new FakeObsidianVault();
    zeros.forEach((path) => v.folder(path));
    expect(detectInVault(v.app, settings())).toEqual({ jdex: zeros[0], reports: zeros[1], templates: zeros[2] });
  });

  it("fills only the empty settings, once, and reports whether anything changed", () => {
    const v = new FakeObsidianVault();
    zeros.forEach((path) => v.folder(path));
    const mine = settings({ jdexFolder: "My JDex", reportsFolder: "", templatesFolder: "" });
    const first = applyDetection(v.app, mine);
    expect(first.changed).toBe(true);
    expect(mine).toMatchObject({ jdexFolder: "My JDex", reportsFolder: zeros[1], templatesFolder: zeros[2] });
    expect(applyDetection(v.app, mine).changed).toBe(false);
  });

  it("changes nothing in a vault without the zeros", () => {
    const v = new FakeObsidianVault();
    v.folder("Notes");
    const empty = settings({ jdexFolder: "", reportsFolder: "", templatesFolder: "" });
    expect(applyDetection(v.app, empty)).toMatchObject({ changed: false, detected: { jdex: null, reports: null, templates: null } });
    expect(empty.jdexFolder).toBe("");
  });
});

describe("templates", () => {
  const withFolder = settings({ templatesFolder: "00.03 Plantillas" });
  const nameOf = (type: (typeof TEMPLATE_TYPES)[number]) => withFolder.templateNames[type];

  it("templatePath is null without a templates folder and joins the configured name otherwise", () => {
    expect(templatePath(settings({ templatesFolder: "" }), "id")).toBeNull();
    expect(templatePath(withFolder, "id")).toBe(`00.03 Plantillas/${nameOf("id")}.md`);
  });

  it("resolveTemplate falls back to the built-in, prefers the user's note and then the category over the general one", async () => {
    const v = new FakeObsidianVault();
    v.folder("00.03 Plantillas");
    expect(await resolveTemplate(v.app, settings({ templatesFolder: "" }), "id")).toBe(BUILTIN_TEMPLATES.id);
    expect(await resolveTemplate(v.app, withFolder, "id")).toBe(BUILTIN_TEMPLATES.id);
    v.file(`00.03 Plantillas/${nameOf("id")}.md`, "GENERAL");
    expect(await resolveTemplate(v.app, withFolder, "id")).toBe("GENERAL");
    v.file(`00.03 Plantillas/${nameOf("id")} - 21.md`, "CATEGORY 21");
    expect(await resolveTemplate(v.app, withFolder, "id", { category: "21" })).toBe("CATEGORY 21");
    expect(await resolveTemplate(v.app, withFolder, "id", { category: "22" })).toBe("GENERAL");
  });

  it("writeBuiltinTemplates creates the missing notes, never overwrites and does nothing without a folder", async () => {
    const v = new FakeObsidianVault();
    v.folder("00.03 Plantillas");
    v.file(`00.03 Plantillas/${nameOf("id")}.md`, "MINE");
    const result = await writeBuiltinTemplates(v.app, withFolder);
    expect(result).toEqual({ created: TEMPLATE_TYPES.length - 1, skipped: 1 });
    expect(v.bodies.get(`00.03 Plantillas/${nameOf("id")}.md`)).toBe("MINE");
    expect(v.bodies.get(`00.03 Plantillas/${nameOf("area")}.md`)).toBe(BUILTIN_TEMPLATES.area);
    expect(await writeBuiltinTemplates(new FakeObsidianVault().app, settings({ templatesFolder: "" }))).toEqual({ created: 0, skipped: 0 });
  });
});

describe("create: ensureFolder", () => {
  it("creates once, records the effect, and refuses a file in the way", async () => {
    const v = new FakeObsidianVault();
    v.folder("A");
    v.file("A/file.md");
    const effects: Effect[] = [];
    expect(await ensureFolder(v.app, "A/new", effects)).toBe(true);
    expect(await ensureFolder(v.app, "A/new", effects)).toBe(false);
    expect(effects).toEqual([{ kind: "created-folder", path: "A/new" }]);
    await expect(ensureFolder(v.app, "A/file.md")).rejects.toThrow("exists and is a file");
  });
});

describe("files: inboxFiles", () => {
  it("lists what waits directly in each .01 inbox folder, not what is nested", () => {
    const v = new FakeObsidianVault();
    v.folder("20-29 Area/21 Cat/21.01 Inbox/sub");
    v.folder("20-29 Area/21 Cat/21.09 Archive");
    const waiting = v.file("20-29 Area/21 Cat/21.01 Inbox/scan.pdf");
    v.file("20-29 Area/21 Cat/21.01 Inbox/sub/deep.pdf");
    v.file("20-29 Area/21 Cat/21.09 Archive/old.pdf");
    const index = scanVault(v.app, settings());
    expect(inboxFiles(v.app, index)).toEqual([waiting]);
  });
});

describe("structure notes and the system index", () => {
  function vaultWithStructure() {
    const v = new FakeObsidianVault();
    v.folder("J");
    v.folder("20-29 Area/21 Cat/21.11 Project");
    v.file("J/21.11 Project.md", "---\ndescripcion: First project\n---\n# 21.11 Project\n");
    return v;
  }

  it("missingStructureNotes lists areas and categories whose folder has no JDex note", () => {
    const index = buildIndex({ systemRoot: "", jdexFolder: "J", folderPaths: ["20-29 Area", "20-29 Area/21 Cat"], notePaths: ["J/20-29 Area.md"] });
    const missing = missingStructureNotes(index);
    expect(missing.areas).toEqual([]);
    expect(missing.categories.map((c) => c.number)).toEqual(["21"]);
  });

  it("createMissingStructureNotes writes one note each, journals them and a rescan finds nothing missing", async () => {
    const v = vaultWithStructure();
    const index = scanVault(v.app, settings());
    expect(missingStructureNotes(index).areas).toHaveLength(1);
    const effects: Effect[] = [];
    expect(await createMissingStructureNotes(v.app, settings(), index, effects)).toBe(2);
    expect(effects.map((e) => e.kind)).toEqual(["created-note", "created-note"]);
    expect(v.exists("J/20-29 Area.md")).toBe(true);
    expect(v.exists("J/21 Cat.md")).toBe(true);
    const again = scanVault(v.app, settings());
    expect(missingStructureNotes(again)).toEqual({ areas: [], categories: [] });
    expect(await createMissingStructureNotes(v.app, settings(), again)).toBe(0);
  });

  it("systemIndexFile is the configured note, else the note of 00.00, else null", () => {
    const v = new FakeObsidianVault();
    v.folder("J");
    const configured = v.file("Elsewhere/Index.md");
    const zero = v.file("J/00.00 Index.md");
    const index = scanVault(v.app, settings());
    expect(systemIndexFile(v.app, settings({ systemIndexNote: "Elsewhere/Index.md" }), index)).toBe(configured);
    expect(systemIndexFile(v.app, settings(), index)).toBe(zero);
    expect(systemIndexFile(v.app, settings({ systemIndexNote: "Missing.md" }), index)).toBeNull();
    expect(systemIndexFile(v.app, settings(), scanVault(new FakeObsidianVault().app, settings()))).toBeNull();
  });

  it("updateSystemIndex warns without a note, warns without markers, adds them on request and is idempotent", async () => {
    const v = vaultWithStructure();
    const warnings: string[] = [];
    const warn = (message: string) => void warnings.push(message);
    expect(await updateSystemIndex(v.app, settings(), scanVault(v.app, settings()), false, undefined, warn)).toBe(false);
    expect(warnings.at(-1)).toContain("No note for the system index");

    v.file("J/00.00 Index.md", "# 00.00 Index\n");
    const index = scanVault(v.app, settings());
    expect(await updateSystemIndex(v.app, settings(), index, false, undefined, warn)).toBe(false);
    expect(warnings.at(-1)).toContain("has no <!-- jdex:indice --> markers");
    expect(v.bodies.get("J/00.00 Index.md")).toBe("# 00.00 Index\n");

    const effects: Effect[] = [];
    expect(await updateSystemIndex(v.app, settings(), index, true, effects, warn)).toBe(true);
    const written = v.bodies.get("J/00.00 Index.md")!;
    expect(written).toContain("<!-- jdex:indice -->");
    expect(written).toContain("21.11 Project");
    expect(written).toContain("First project");
    expect(effects).toEqual([{ kind: "note-rewrite", path: "J/00.00 Index.md", before: "# 00.00 Index\n", after: written }]);
    expect(await updateSystemIndex(v.app, settings(), index, true, effects, warn)).toBe(false);
    expect(effects).toHaveLength(1);
  });
});

describe("audit: notes, findings and the daily report", () => {
  function auditVault() {
    const v = new FakeObsidianVault();
    v.folder("20-29 Area/21 Cat/21.11 Project");
    v.file("J/21.11 Project.md", "---\ndescripcion: Has one\n---\n# 21.11 Project\n");
    v.file("J/21.12 Bare.md", "# 21.12 Bare\n");
    v.file("J/sub/21.13 Nested.md", "---\njd: 21.13\n---\n");
    v.folder("Reports");
    return v;
  }

  it("jdexNoteMetas covers only notes directly in the JDex folder and reads bodies just where needed", async () => {
    const v = auditVault();
    const metas = await jdexNoteMetas(v.app, settings());
    expect(metas.map((m) => m.path).sort()).toEqual(["J/21.11 Project.md", "J/21.12 Bare.md"]);
    const project = metas.find((m) => m.path === "J/21.11 Project.md")!;
    const bare = metas.find((m) => m.path === "J/21.12 Bare.md")!;
    expect(project.frontmatter).toEqual({ descripcion: "Has one" });
    expect(project.body).toBeUndefined(); // a description exists: the body is not read
    expect(bare.frontmatter).toBeNull();
    expect(bare.body).toBe("# 21.12 Bare\n");
    const duplicates = await jdexNoteMetas(v.app, settings(), new Set(["J/21.11 Project.md"]));
    expect(duplicates.find((m) => m.path === "J/21.11 Project.md")!.body).toContain("# 21.11 Project");
  });

  it("collectAuditFindings reports the note that disagrees with its folder tree", async () => {
    const v = auditVault();
    const findings = await collectAuditFindings(v.app, settings());
    expect(findings.some((f) => f.paths.includes("J/21.11 Project.md") && f.kind === "frontmatter-mismatch")).toBe(true);
    expect(findings.some((f) => f.paths.includes("J/21.12 Bare.md"))).toBe(true);
  });

  it("runAudit without a reports folder says so and writes nothing", async () => {
    const v = auditVault();
    const result = await runAudit(v.app, settings({ reportsFolder: "" }));
    expect(result.reportPath).toBeNull();
    expect(notices().join(" ")).toContain("No reports folder set");
    expect(v.app.vault.create).not.toHaveBeenCalled();
  });

  it("runAudit writes today's report in the reports folder and a second run overwrites it in place", async () => {
    const v = auditVault();
    const first = await runAudit(v.app, settings({ reportsFolder: "Reports" }));
    expect(first.reportPath).toMatch(/^Reports\/.*\d{4}-\d{2}-\d{2}\.md$/);
    expect(v.bodies.get(first.reportPath!)).toContain("21.12");
    const second = await runAudit(v.app, settings({ reportsFolder: "Reports" }));
    expect(second.reportPath).toBe(first.reportPath);
    expect([...v.bodies.keys()].filter((path) => path.startsWith("Reports/"))).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import { type App, TFile, TFolder } from "obsidian";
import { isUneditedReport, stampReport, writeDailyReport } from "../src/vault/report-write";

const FOLDER = "00.02 Informes";
const PATH = `${FOLDER}/Auditoría JD - 2026-10-12.md`;

/** An in-memory vault with folders and notes, enough for the report writer. */
function memoryVault() {
  const notes = new Map<string, string>();
  const folders = new Set<string>();
  const fileAt = (path: string) => Object.assign(new TFile(), { path, basename: path.slice(path.lastIndexOf("/") + 1, -3) });
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => (notes.has(path) ? fileAt(path) : folders.has(path) ? Object.assign(new TFolder(), { path }) : null),
      read: async (file: TFile) => notes.get(file.path)!,
      process: async (file: TFile, update: (current: string) => string) => {
        const next = update(notes.get(file.path)!);
        notes.set(file.path, next);
        return next;
      },
      create: async (path: string, content: string) => {
        if (notes.has(path)) throw new Error("exists");
        notes.set(path, content);
        return fileAt(path);
      },
      createFolder: async (path: string) => {
        folders.add(path);
      },
      modify: async () => {
        throw new Error("the report writer must not call vault.modify");
      },
    },
  } as unknown as App;
  return { app, notes };
}

describe("stamped daily reports", () => {
  it("a stamped body is recognised as unedited until someone changes it", () => {
    const stamped = stampReport("# Informe\n\nUn hallazgo.\n");
    expect(stamped.startsWith("# Informe\n\nUn hallazgo.\n")).toBe(true);
    expect(isUneditedReport(stamped)).toBe(true);
    expect(isUneditedReport(stamped.replace("Un hallazgo.", "Un hallazgo. Mi nota."))).toBe(false);
    expect(isUneditedReport("# Informe sin huella\n")).toBe(false);
  });

  it("keeps a report edited after it was generated and writes the new one to (2)", async () => {
    const { app, notes } = memoryVault();
    await writeDailyReport(app, FOLDER, PATH, "# Informe\n\nPrimera pasada.\n");
    notes.set(PATH, `${notes.get(PATH)!}\nMi comentario a mano.\n`);
    const result = await writeDailyReport(app, FOLDER, PATH, "# Informe\n\nSegunda pasada.\n");
    expect(result.path).toBe(`${FOLDER}/Auditoría JD - 2026-10-12 (2).md`);
    expect(notes.get(PATH)).toContain("Mi comentario a mano.");
    expect(notes.get(PATH)).toContain("Primera pasada.");
    expect(notes.get(result.path)).toContain("Segunda pasada.");
  });

  it("control: an unedited report of the day is overwritten in place, as before", async () => {
    const { app, notes } = memoryVault();
    await writeDailyReport(app, FOLDER, PATH, "# Informe\n\nPrimera pasada.\n");
    const result = await writeDailyReport(app, FOLDER, PATH, "# Informe\n\nSegunda pasada.\n");
    expect(result.path).toBe(PATH);
    expect(notes.get(PATH)).toContain("Segunda pasada.");
    expect(notes.size).toBe(1);
  });

  it("after an edited report, the next run overwrites its unedited (2) instead of piling up copies", async () => {
    const { app, notes } = memoryVault();
    await writeDailyReport(app, FOLDER, PATH, "# Uno\n");
    notes.set(PATH, "# Uno editado a mano\n");
    await writeDailyReport(app, FOLDER, PATH, "# Dos\n");
    const third = await writeDailyReport(app, FOLDER, PATH, "# Tres\n");
    expect(third.path).toBe(`${FOLDER}/Auditoría JD - 2026-10-12 (2).md`);
    expect(notes.get(third.path)).toContain("# Tres");
    expect(notes.size).toBe(2);
  });

  it("a report written before stamps existed is not overwritten", async () => {
    const { app, notes } = memoryVault();
    notes.set(PATH, "# Informe antiguo sin huella\n");
    const result = await writeDailyReport(app, FOLDER, PATH, "# Nuevo\n");
    expect(result.path).toBe(`${FOLDER}/Auditoría JD - 2026-10-12 (2).md`);
    expect(notes.get(PATH)).toBe("# Informe antiguo sin huella\n");
  });
});

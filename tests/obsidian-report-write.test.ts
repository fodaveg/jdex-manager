import { describe, expect, it } from "vitest";
import { FakeObsidianVault } from "./support/fake-obsidian-vault";
import { isUneditedReport, stampReport, writeDailyReport } from "../src/vault/report-write";

const FOLDER = "00.02 Informes";
const PATH = `${FOLDER}/Auditoría JD - 2026-10-12.md`;

/** The shared vault double; `notes` is the text of every file by path. */
function memoryVault() {
  const v = new FakeObsidianVault();
  return { app: v.app, notes: v.bodies, v };
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
    const { app, notes, v } = memoryVault();
    v.file(PATH, "# Informe antiguo sin huella\n"); // a file must exist for the double to find it
    const result = await writeDailyReport(app, FOLDER, PATH, "# Nuevo\n");
    expect(result.path).toBe(`${FOLDER}/Auditoría JD - 2026-10-12 (2).md`);
    expect(notes.get(PATH)).toBe("# Informe antiguo sin huella\n");
  });
});

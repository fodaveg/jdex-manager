import { type App, TFile } from "obsidian";
import type { IdEntry, JdIndex } from "../jd/index";
import { insertAfterH1, retirePlan } from "../jd/retire";
import { todayIso } from "../jd/template";
import type { Effect } from "../jd/journal";

/** Applies a retire plan: marks the live note, moves its folder, then writes the line. Records what it did in `effects`. */
export async function retireId(app: App, index: JdIndex, entry: IdEntry, successor?: string, effects: Effect[] = []): Promise<string[]> {
  const plan = retirePlan(index, entry, todayIso(), successor);
  if ("error" in plan) throw new Error(plan.error);
  const notes: string[] = [];
  const note = app.vault.getAbstractFileByPath(plan.notePath);
  if (!(note instanceof TFile)) throw new Error(`${plan.notePath} is not a note.`);
  const previous: Record<string, unknown> = {};
  // Read and reject an already retired ID inside the same frontmatter mutation.
  await app.fileManager.processFrontMatter(note, (fm: Record<string, unknown>) => {
    if (fm.tipo === "archivado") throw new Error(`Ya retirado el ${typeof fm.archivado === "string" ? fm.archivado : "fecha desconocida"}.`);
    for (const [key, value] of Object.entries(plan.frontmatter)) {
      previous[key] = fm[key];
      fm[key] = value;
    }
  });
  effects.push({ kind: "frontmatter", path: plan.notePath, previous });
  if (plan.move) {
    const folder = app.vault.getAbstractFileByPath(plan.move.from);
    if (!folder) throw new Error(`${plan.move.from} no longer exists.`);
    if (app.vault.getAbstractFileByPath(plan.move.to)) throw new Error(`${plan.move.to} already exists.`);
    await app.fileManager.renameFile(folder, plan.move.to);
    effects.push({ kind: "moved", from: plan.move.from, to: plan.move.to });
    notes.push(`Folder moved to ${plan.move.to}`);
  } else if (plan.moveProblem) notes.push(plan.moveProblem);
  await app.vault.process(note, (content) => insertAfterH1(content, plan.line));
  effects.push({ kind: "line", path: plan.notePath, line: plan.line });
  notes.push(`${entry.id} marked as retired`);
  return notes;
}

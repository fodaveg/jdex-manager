import { type App, TFile } from "obsidian";
import type { IdEntry, JdIndex } from "../jd/index";
import { insertAfterH1, retirePlan } from "../jd/retire";
import { todayIso } from "../jd/template";

/** Applies a retire plan: moves the folder to the archive, marks the note, writes the line. */
export async function retireId(app: App, index: JdIndex, entry: IdEntry, successor?: string): Promise<string[]> {
  const plan = retirePlan(index, entry, todayIso(), successor);
  if ("error" in plan) throw new Error(plan.error);
  const notes: string[] = [];
  if (plan.move) {
    const folder = app.vault.getAbstractFileByPath(plan.move.from);
    if (!folder) throw new Error(`${plan.move.from} no longer exists.`);
    if (app.vault.getAbstractFileByPath(plan.move.to)) throw new Error(`${plan.move.to} already exists.`);
    await app.fileManager.renameFile(folder, plan.move.to);
    notes.push(`Folder moved to ${plan.move.to}`);
  } else if (plan.moveProblem) notes.push(plan.moveProblem);
  const note = app.vault.getAbstractFileByPath(plan.notePath);
  if (!(note instanceof TFile)) throw new Error(`${plan.notePath} is not a note.`);
  await app.fileManager.processFrontMatter(note, (fm: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(plan.frontmatter)) fm[k] = v;
  });
  const content = await app.vault.read(note);
  await app.vault.modify(note, insertAfterH1(content, plan.line));
  notes.push(`${entry.id} marked as retired`);
  return notes;
}

import { type App, TFile } from "obsidian";
import type { IdEntry, JdIndex } from "../jd/index";
import { insertAfterH1, retirePlan } from "../jd/retire";
import { todayIso } from "../jd/template";
import type { Effect } from "../jd/journal";
import { patchFrontmatter, readFrontmatter } from "./frontmatter-lines";
import { frontmatterRewrite, movedIdentity } from "./journal";

/** Applies a retire plan: marks the live note, moves its folder, then writes the line. Records what it did in `effects`. */
export async function retireId(app: App, index: JdIndex, entry: IdEntry, successor?: string, effects: Effect[] = []): Promise<string[]> {
  const plan = retirePlan(index, entry, todayIso(), successor);
  if ("error" in plan) throw new Error(plan.error);
  const notes: string[] = [];
  const note = app.vault.getAbstractFileByPath(plan.notePath);
  if (!(note instanceof TFile)) throw new Error(`${plan.notePath} is not a note.`);
  let rewrite: Effect | null = null;
  // Read and reject an already retired ID inside the same write. Only the lines of the
  // plan's keys change (never `processFrontMatter`, which drops comments and turns an
  // unquoted `jd: 21.20` into `21.2`); a frontmatter that cannot be patched safely stops
  // here, before the folder is touched.
  await app.vault.process(note, (current) => {
    const fm = readFrontmatter(current) ?? {};
    if (fm.tipo === "archivado") throw new Error(`Ya retirado el ${typeof fm.archivado === "string" ? fm.archivado : "fecha desconocida"}.`);
    const patched = patchFrontmatter(current, plan.frontmatter);
    if (patched.refused.length > 0) {
      throw new Error(`${plan.notePath}: no se pudo escribir ${patched.refused.join(", ")} porque el frontmatter tiene una clave repetida o un formato que no se puede modificar sin riesgo. Corrígelo a mano y vuelve a intentarlo; la nota y la carpeta no se han tocado.`);
    }
    if (patched.body !== current) rewrite = frontmatterRewrite(plan.notePath, current, patched.body);
    return patched.body;
  });
  if (rewrite) effects.push(rewrite);
  if (plan.move) {
    const folder = app.vault.getAbstractFileByPath(plan.move.from);
    if (!folder) throw new Error(`${plan.move.from} no longer exists.`);
    if (app.vault.getAbstractFileByPath(plan.move.to)) throw new Error(`${plan.move.to} already exists.`);
    await app.fileManager.renameFile(folder, plan.move.to);
    effects.push({ kind: "moved", from: plan.move.from, to: plan.move.to, ...movedIdentity(folder) });
    notes.push(`Folder moved to ${plan.move.to}`);
  } else if (plan.moveProblem) notes.push(plan.moveProblem);
  await app.vault.process(note, (content) => insertAfterH1(content, plan.line));
  effects.push({ kind: "line", path: plan.notePath, line: plan.line });
  notes.push(`${entry.id} marked as retired`);
  return notes;
}

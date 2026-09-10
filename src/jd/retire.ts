/**
 * Retiring an ID: the number is never reused or renumbered (johnnydecimal.com), so the JDex note
 * stays and says where the content went. Pure plan; the vault layer applies it.
 */

import type { IdEntry, JdIndex } from "./index";
import { zeroOf } from "./files";

export interface RetirePlan {
  id: string;
  notePath: string;
  /** Folder move, when the ID has a folder and the archive of its category exists. */
  move?: { from: string; to: string };
  /** Why the folder cannot be moved, when it cannot. */
  moveProblem?: string;
  frontmatter: Record<string, string>;
  /** Line inserted after the H1. */
  line: string;
}

export function retirePlan(index: JdIndex, entry: IdEntry, date: string, successor?: string): RetirePlan | { error: string } {
  if (!entry.notePath) return { error: `${entry.label} has no JDex note; there is nothing to mark as retired.` };
  const frontmatter: Record<string, string> = { tipo: "archivado", archivado: date };
  let move: RetirePlan["move"];
  let moveProblem: string | undefined;
  if (entry.folderPath) {
    const archive = zeroOf(index, entry.category, "09");
    if (!archive?.folderPath) moveProblem = `${entry.category}.09 has no folder; the ID folder stays where it is.`;
    else {
      const name = entry.folderPath.slice(entry.folderPath.lastIndexOf("/") + 1);
      move = { from: entry.folderPath, to: `${archive.folderPath}/${date} ${name}` };
      frontmatter.destino = move.to;
    }
  }
  if (successor) frontmatter.reemplazado_por = successor;
  const where = move ? ` El contenido está en \`${move.to}\`.` : "";
  const by = successor ? ` Sustituido por [[${successor}]].` : "";
  return { id: entry.id, notePath: entry.notePath, move, moveProblem, frontmatter, line: `Retirado el ${date}.${where}${by}` };
}

/** Inserts `line` right after the first H1 (or at the top when there is none), after the frontmatter. */
export function insertAfterH1(content: string, line: string): string {
  const lines = content.split("\n");
  let i = 0;
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end !== -1) i = end + 1;
  }
  for (let k = i; k < lines.length; k += 1) {
    if (/^#\s/.test(lines[k])) {
      lines.splice(k + 1, 0, line);
      return lines.join("\n");
    }
  }
  lines.splice(i, 0, line);
  return lines.join("\n");
}

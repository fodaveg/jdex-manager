/**
 * Retiring an ID: the number is never reused or renumbered (johnnydecimal.com), so the JDex note
 * stays and says where the content went. Pure plan; the vault layer applies it.
 */

import type { IdEntry, JdIndex } from "./index";
import { zeroOf } from "./files";
import type { MessageLanguage } from "./pair";

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

/** `archivedAt` is supplied by the host after reading the live JDex note. An empty
 * string means it is archived but has no recorded date. */
export function retirePlan(index: JdIndex, entry: IdEntry, date: string, successor?: string, archivedAt?: string, language?: MessageLanguage): RetirePlan | { error: string } {
  // `language` omitted keeps the wording Hebra has always shown (English and Spanish mixed).
  // The line written into the note is system content and stays Spanish.
  const en = language === "en";
  const es = language === "es";
  if (!entry.notePath) return { error: es ? `${entry.label} no tiene nota JDex; no hay nada que marcar como retirado.` : `${entry.label} has no JDex note; there is nothing to mark as retired.` };
  if (archivedAt !== undefined) {
    if (en) return { error: archivedAt ? `Already retired on ${archivedAt}.` : "This ID is already retired." };
    return { error: archivedAt ? `Ya retirado el ${archivedAt}.` : 'Este ID ya está retirado.' };
  }
  const frontmatter: Record<string, string> = { tipo: "archivado", archivado: date };
  let move: RetirePlan["move"];
  let moveProblem: string | undefined;
  if (entry.folderPath) {
    const archive = zeroOf(index, entry.category, "09", entry.system);
    if (!archive?.folderPath) moveProblem = es ? `${entry.category}.09 no tiene carpeta; la carpeta del ID se queda donde está.` : `${entry.category}.09 has no folder; the ID folder stays where it is.`;
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

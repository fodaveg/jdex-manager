/**
 * System health report: not errors (that is the audit) but how full and how balanced the system is.
 * The yearly review of the librarian. Spanish, because it is a note in the user's vault. No Obsidian imports.
 */

import { categoryUsage, type JdIndex } from "./index";
import { filesByFolder } from "./path-index";

export interface HealthOptions {
  /** IDs holding more files than this are candidates for a `+` child or subfolders. Default 50. */
  maxFiles: number;
  /** Categories with more IDs used than this are close to their 81 slots. Default 70. */
  nearlyFull: number;
}

export const DEFAULT_HEALTH_OPTIONS: HealthOptions = { maxFiles: 50, nearlyFull: 70 };

export function healthFileName(date: string): string {
  return `Salud JD - ${date}.md`;
}

function noteLink(notePath: string | undefined, label: string): string {
  if (notePath?.endsWith(".md")) return `[[${notePath.slice(notePath.lastIndexOf("/") + 1, -3)}]]`;
  return label;
}

export interface CategoryHealth {
  number: string;
  label: string;
  used: number;
  total: number;
  next: string | null;
  files: number | null;
}

export interface IdHealth {
  id: string;
  label: string;
  notePath?: string;
  folderPath: string;
  files: number;
}

export interface Health {
  categories: CategoryHealth[];
  nearlyFull: CategoryHealth[];
  emptyIds: IdHealth[];
  crowdedIds: IdHealth[];
  idsWithFolder: number;
}

/** The numbers behind the report, so they can be tested and reused. */
export function measureHealth(index: JdIndex, filePaths: string[], options: HealthOptions = DEFAULT_HEALTH_OPTIONS): Health {
  const folderFiles = filesByFolder(filePaths);
  const categories: CategoryHealth[] = index.categories.map((c) => {
    const usage = categoryUsage(index, c.number, c.system);
    return { number: c.number, label: c.label, used: usage.used, total: usage.total, next: usage.next, files: c.path ? (folderFiles.get(c.path)?.length ?? 0) : null };
  });
  const nearlyFull = categories.filter((c) => c.used > options.nearlyFull);

  const emptyIds: IdHealth[] = [];
  const crowdedIds: IdHealth[] = [];
  let idsWithFolder = 0;
  for (const entry of index.ids) {
    if (!entry.folderPath) continue;
    // Management numbers (.00 to .09): an empty inbox or archive is healthy, not a finding.
    if (Number(entry.id.slice(3, 5)) < 10) continue;
    idsWithFolder += 1;
    const files = folderFiles.get(entry.folderPath)?.length ?? 0;
    const row: IdHealth = { id: entry.id, label: entry.label, notePath: entry.notePath, folderPath: entry.folderPath, files };
    if (files === 0) emptyIds.push(row);
    else if (files > options.maxFiles) crowdedIds.push(row);
  }
  crowdedIds.sort((a, b) => b.files - a.files);
  return { categories, nearlyFull, emptyIds, crowdedIds, idsWithFolder };
}

export function renderHealthReport(index: JdIndex, filePaths: string[], date: string, options: HealthOptions = DEFAULT_HEALTH_OPTIONS): string {
  const h = measureHealth(index, filePaths, options);
  const lines: string[] = [];
  lines.push("---");
  lines.push("tipo: salud");
  lines.push(`fecha: ${date}`);
  lines.push(`categorias: ${h.categories.length}`);
  lines.push(`ids: ${index.ids.length}`);
  lines.push("---");
  lines.push(`# Salud JD - ${date}`);
  lines.push("");
  lines.push(`${index.areas.length} áreas, ${h.categories.length} categorías y ${index.ids.length} IDs (${h.idsWithFolder} con carpeta).`);
  lines.push("");
  lines.push("## Ocupación por categoría");
  lines.push("");
  lines.push("| Categoría | IDs usados | Siguiente libre | Ficheros |");
  lines.push("|---|---|---|---|");
  for (const c of h.categories) {
    lines.push(`| ${c.label} | ${c.used} / ${c.total} | ${c.next ?? "ninguno"} | ${c.files ?? "sin carpeta"} |`);
  }
  lines.push("");

  lines.push(`## Categorías con más de ${options.nearlyFull} IDs usados`);
  lines.push("");
  if (h.nearlyFull.length === 0) lines.push("Ninguna.");
  for (const c of h.nearlyFull) lines.push(`- ${c.label}: ${c.used} de ${c.total}${c.next ? `, siguiente ${c.next}` : ", sin números libres"}`);
  lines.push("");

  lines.push("## IDs con la carpeta vacía");
  lines.push("");
  if (h.emptyIds.length === 0) lines.push("Ninguno.");
  for (const e of h.emptyIds) lines.push(`- ${noteLink(e.notePath, e.label)} · \`${e.folderPath}\``);
  lines.push("");

  lines.push(`## IDs con más de ${options.maxFiles} ficheros (candidatos a \`+\` o subcarpetas)`);
  lines.push("");
  if (h.crowdedIds.length === 0) lines.push("Ninguno.");
  for (const e of h.crowdedIds) lines.push(`- ${noteLink(e.notePath, e.label)}: ${e.files} ficheros`);
  lines.push("");
  return lines.join("\n");
}

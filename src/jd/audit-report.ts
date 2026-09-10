/**
 * Renders the audit findings as a Markdown note. Spanish, because it is a note in the user's vault.
 * No Obsidian imports.
 */

import { countProblems, FINDING_KINDS, type Finding, type FindingKind } from "./audit";

export const KIND_TITLES: Record<FindingKind, string> = {
  "folder-without-note": "Carpetas con ID sin nota en el JDex",
  "name-mismatch": "Nota y carpeta con nombre distinto",
  "frontmatter-mismatch": "Frontmatter que no coincide con el nombre o la posición",
  "duplicate-id": "IDs duplicados",
  "reserved-used-as-content": "Números de gestión (.00 a .08) con contenido",
  "header-with-files": "Cabeceras con ficheros dentro",
  "out-of-parent": "Números fuera de su padre",
  "note-without-folder": "Notas sin carpeta (informativo)",
};

export function reportFileName(date: string): string {
  return `Auditoría JD - ${date}.md`;
}

function link(path: string): string {
  if (path.endsWith(".md")) return `[[${path.slice(0, -3)}]]`;
  return `\`${path}\``;
}

export function renderReport(findings: Finding[], date: string): string {
  const problems = countProblems(findings);
  const lines: string[] = [];
  lines.push("---");
  lines.push("tipo: auditoria");
  lines.push(`fecha: ${date}`);
  lines.push(`hallazgos: ${problems}`);
  lines.push("---");
  lines.push(`# Auditoría JD - ${date}`);
  lines.push("");
  lines.push(
    problems === 0
      ? "Sin problemas. El sistema y el JDex coinciden."
      : `${problems} problema(s) que corregir. Los que tienen arreglo mecánico se aplican desde el comando «Apply mechanical fixes from last audit».`,
  );
  lines.push("");
  lines.push("| Tipo | Hallazgos |");
  lines.push("|---|---|");
  for (const kind of FINDING_KINDS) {
    const n = findings.filter((f) => f.kind === kind).length;
    lines.push(`| ${KIND_TITLES[kind]} | ${n} |`);
  }
  lines.push("");
  for (const kind of FINDING_KINDS) {
    lines.push(`## ${KIND_TITLES[kind]}`);
    lines.push("");
    const rows = findings.filter((f) => f.kind === kind);
    if (rows.length === 0) {
      lines.push("Ninguno.");
    } else {
      for (const f of rows) {
        const fix = f.fix ? " · arreglo mecánico disponible" : "";
        lines.push(`- ${f.message} ${f.paths.map(link).join(", ")}${fix}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Human report plus a small machine snapshot for comparing consecutive manual runs. */
import { countProblems, FINDING_KINDS, type Finding } from "./audit";
import { KIND_TITLES, renderReport } from "./audit-report";
import { measureHealth, renderHealthReport } from "./health";
import type { JdIndex } from "./index";

interface Snapshot {
  findings: Record<string, number>;
  problems: number;
  categories: number;
  ids: number;
  emptyIds: number;
  crowdedIds: number;
}

const MARKER = /<!-- jdex-system-snapshot:([^\s]+) -->/u;

export function systemReportName(date: string): string {
  return `Informe JD - ${date}.md`;
}

function snapshotOf(index: JdIndex, findings: readonly Finding[], paths: string[], maxFiles: number): Snapshot {
  const health = measureHealth(index, paths, { maxFiles, nearlyFull: 70 });
  return {
    findings: Object.fromEntries(FINDING_KINDS.map((kind) => [kind, findings.filter((finding) => finding.kind === kind).length])),
    problems: countProblems([...findings]),
    categories: health.categories.length,
    ids: index.ids.length,
    emptyIds: health.emptyIds.length,
    crowdedIds: health.crowdedIds.length,
  };
}

/** An absent or hand-edited snapshot is treated as no previous comparable report. */
export function previousSystemSnapshot(body: string | null): Snapshot | null {
  const encoded = body?.match(MARKER)?.[1];
  if (!encoded) return null;
  try {
    const value: unknown = JSON.parse(decodeURIComponent(encoded));
    if (!value || typeof value !== "object" || !("findings" in value) || !("problems" in value)) return null;
    const snapshot = value as Record<string, unknown>;
    const count = (entry: unknown): entry is number => typeof entry === "number" && Number.isSafeInteger(entry) && entry >= 0;
    if (!["problems", "categories", "ids", "emptyIds", "crowdedIds"].every((key) => count(snapshot[key]))) return null;
    if (!snapshot.findings || typeof snapshot.findings !== "object" || Array.isArray(snapshot.findings)) return null;
    if (!Object.values(snapshot.findings).every(count)) return null;
    return value as Snapshot;
  } catch { return null; }
}

/** Render audit, health, and numeric differences against the previous report. */
export function renderSystemReport(index: JdIndex, findings: Finding[], paths: string[], date: string, maxFiles: number, previousBody: string | null): string {
  const current = snapshotOf(index, findings, paths, maxFiles);
  const previous = previousSystemSnapshot(previousBody);
  const lines = ["---", "tipo: informe-jd", `fecha: ${date}`, `hallazgos: ${current.problems}`, "---", `# Informe JD - ${date}`, "", "## Diferencias frente al informe anterior", ""];
  if (!previous) lines.push("Primer informe comparable; todavía no hay diferencias.");
  else {
    const indicators: [string, number, number][] = [
      ["Problemas", previous.problems, current.problems],
      ["Categorías", previous.categories, current.categories],
      ["IDs", previous.ids, current.ids],
      ["IDs vacíos", previous.emptyIds, current.emptyIds],
      ["IDs con demasiados ficheros", previous.crowdedIds, current.crowdedIds],
      ...FINDING_KINDS.map((kind): [string, number, number] => [KIND_TITLES[kind], previous.findings[kind] ?? 0, current.findings[kind] ?? 0]),
    ];
    const rows = indicators.filter(([, before, after]) => before !== after);
    if (rows.length === 0) lines.push("Sin cambios en los indicadores del sistema.");
    else {
      lines.push("| Indicador | Anterior | Actual | Cambio |", "|---|---:|---:|---:|");
      for (const [name, before, after] of rows) lines.push(`| ${name} | ${before} | ${after} | ${after - before > 0 ? "+" : ""}${after - before} |`);
    }
  }
  const withoutFrontmatter = (body: string) => body.replace(/^---\n[\s\S]*?\n---\n/u, "").replace(/^# /u, "## ");
  lines.push("", withoutFrontmatter(renderReport(findings, date)), "", withoutFrontmatter(renderHealthReport(index, paths, date, { maxFiles, nearlyFull: 70 })), "", `<!-- jdex-system-snapshot:${encodeURIComponent(JSON.stringify(current))} -->`);
  return lines.join("\n");
}

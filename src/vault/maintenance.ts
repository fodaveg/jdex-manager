/** Optional maintenance writes only derived properties and existing managed blocks. */
import type { App } from "obsidian";
import type { Effect } from "../jd/journal";
import type { JdexManagerSettings } from "../settings";
import { applyFix, collectAudit } from "./audit";
import { updateHeaders } from "./headers";
import { systemIndexFile, updateSystemIndex } from "./structure";

/**
 * Caller owns serialization and persists effects even when a later step fails.
 * `skip` leaves out paths an undo just restored, so maintenance does not redo what was undone.
 */
export async function maintainSystem(app: App, settings: JdexManagerSettings, effects: Effect[], warn?: (message: string) => void, skip: (path: string) => boolean = () => false): Promise<void> {
  if (!settings.automaticMaintenance || settings.jdexFolder === "") return;
  const { index, findings } = await collectAudit(app, settings);
  const derived = new Set(["jd", "tipo", "area", "categoria"]);
  for (const finding of findings) {
    if (finding.kind !== "frontmatter-mismatch" || finding.fix?.type !== "frontmatter") continue;
    const fix = finding.fix;
    if (skip(fix.path)) continue;
    const set = Object.fromEntries(Object.entries(fix.set).filter(([key]) => derived.has(key)));
    if (Object.keys(set).length === 0) continue;
    const expected = fix.expected ? Object.fromEntries(Object.entries(fix.expected).filter(([key]) => derived.has(key))) : undefined;
    await applyFix(app, { ...fix, set, expected }, effects);
  }
  await updateHeaders(app, index, undefined, effects, skip);
  const indexNote = systemIndexFile(app, settings, index);
  if (!indexNote || !skip(indexNote.path)) await updateSystemIndex(app, settings, index, false, effects, warn);
}

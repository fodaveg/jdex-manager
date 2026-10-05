/** Optional maintenance writes only derived properties and existing managed blocks. */
import type { App } from "obsidian";
import type { Effect } from "../jd/journal";
import type { JdexManagerSettings } from "../settings";
import { applyFix, collectAudit } from "./audit";
import { updateHeaders } from "./headers";
import { updateSystemIndex } from "./structure";

/** Caller owns serialization and persists effects even when a later step fails. */
export async function maintainSystem(app: App, settings: JdexManagerSettings, effects: Effect[]): Promise<void> {
  if (!settings.automaticMaintenance || settings.jdexFolder === "") return;
  const { index, findings } = await collectAudit(app, settings);
  const derived = new Set(["jd", "tipo", "area", "categoria"]);
  for (const finding of findings) {
    if (finding.kind !== "frontmatter-mismatch" || finding.fix?.type !== "frontmatter") continue;
    const fix = finding.fix;
    const set = Object.fromEntries(Object.entries(fix.set).filter(([key]) => derived.has(key)));
    if (Object.keys(set).length === 0) continue;
    const expected = fix.expected ? Object.fromEntries(Object.entries(fix.expected).filter(([key]) => derived.has(key))) : undefined;
    await applyFix(app, { ...fix, set, expected }, effects);
  }
  await updateHeaders(app, index, undefined, effects);
  await updateSystemIndex(app, settings, index, false, effects);
}

/**
 * Flows that need the user's choice (a picker, a confirmation) on the way to a vault write. The
 * choices come through a port, so the flows run in tests without replacing modules: the plugin
 * passes ports that open Obsidian's modals, a test passes plain functions.
 */
import { type App, normalizePath, type TFile } from "obsidian";
import type { Effect, OperationKind } from "../jd/journal";
import type { IdEntry, JdIndex } from "../jd/index";
import { systemKey } from "../jd/index";
import { categoryOfPath, idFolderOfPath, planMoveToId, zeroOf } from "../jd/files";
import type { JdexManagerSettings } from "../settings";
import { ensureFolder } from "./create";
import { fileDate } from "./file-date";
import { moveInto } from "./files";
import { movedIdentity } from "./journal";
import { scanVault } from "./scan";
import { t } from "../ui/i18n";

/** An undo journal operation that records each effect as it happens. */
export type JournalSink = Effect[] & { flush(): Promise<void> };

export interface FlowPorts {
  app: App;
  settings: JdexManagerSettings;
  /** Picks an ID; `null` when the picker is dismissed. */
  pickEntry(index: JdIndex, placeholder: string, purpose: string): Promise<IdEntry | null>;
  /** Picks a category, as its system key (`D01.21`); `null` when dismissed. */
  pickCategory(index: JdIndex): Promise<string | null>;
  confirm(title: string, lines: string[], action: string): Promise<boolean>;
  notice(message: string, timeout?: number): void;
  /** Opens a journal operation recorded effect by effect. */
  journal(kind: OperationKind, label: string): JournalSink;
  /** Records a finished operation in one go. */
  record(kind: OperationKind, label: string, effects: Effect[]): Promise<void>;
  logError(where: string, error: unknown): void;
  /** The inbox count may have changed. */
  refreshInbox(): void;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Moves the file to the `.01` or `.09` of its category (00 when it lives outside the system). */
export async function sendToZero(ports: FlowPorts, file: TFile, zero: "01" | "09"): Promise<void> {
  const { app, settings } = ports;
  const index = scanVault(app, settings);
  const owner = idFolderOfPath(index, file.path);
  let category = owner ? systemKey(owner.category, owner.system) : categoryOfPath(settings.systemRoot, file.path);
  if (category === null) {
    const pick = await ports.pickCategory(index);
    if (pick === null) return;
    category = pick;
  }
  const target = zeroOf(index, category, zero);
  if (!target?.folderPath) {
    ports.notice(t().noZeroFolder(category, zero), 8000);
    return;
  }
  try {
    const from = file.path;
    const identity = movedIdentity(file);
    const to = await moveInto(
      app,
      file,
      target.folderPath,
      zero === "09" ? { when: fileDate(app, file), format: settings.dateFormat } : undefined,
    );
    if (to !== from) await ports.record("move", zero === "09" ? t().labelArchive(file.name) : t().labelSendToInbox(file.name), [{ kind: "moved", from, to, ...identity }]);
    ports.notice(t().movedTo(to));
    ports.refreshInbox();
  } catch (error) {
    ports.logError("sendToZero", error);
    ports.notice(message(error));
  }
}

/** Picks an ID and moves the file into its folder, creating the folder first when the ID has none. */
export async function moveToId(ports: FlowPorts, file: TFile): Promise<void> {
  const { app, settings } = ports;
  const index = scanVault(app, settings);
  const entry = await ports.pickEntry(index, t().moveToPlaceholder(file.name), t().moveHere);
  if (!entry) return;
  const effects = ports.journal("move", t().labelMoveTo(file.name, entry.id));
  const plan = planMoveToId(index, settings, entry, file.name, { createMissingFolder: true, dateOnMove: settings.dateOnMove });
  if (plan.type === "no-folder") {
    ports.notice(t().noFolderToCreateIn(entry.label, entry.category), 8000);
    return;
  }
  const folder = normalizePath(plan.folder);
  if (plan.type === "create-folder") {
    const ok = await ports.confirm(t().createFolderTitle(entry.id), [t().noFolderYet(entry.label), t().willBeCreatedAt(folder)], t().createAndMove);
    if (!ok) return;
    try {
      await ensureFolder(app, folder, effects);
    } catch (error) {
      ports.logError("moveToIdFlow", error);
      ports.notice(message(error));
      return;
    }
  }
  try {
    const date = plan.date ? { when: fileDate(app, file), format: settings.dateFormat } : undefined;
    const from = file.path;
    const identity = movedIdentity(file);
    const to = await moveInto(app, file, folder, date);
    if (to !== from) effects.push({ kind: "moved", from, to, ...identity });
    await effects.flush().catch(() => undefined);
    ports.notice(t().movedTo(to));
    ports.refreshInbox();
  } catch (error) {
    ports.logError("moveToIdFlow", error);
    ports.notice(message(error));
  }
}

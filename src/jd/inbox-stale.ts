/** Informative age audit for notes directly inside a management `.01` folder. */
import { inboxFolders } from "./files";
import type { Finding } from "./audit";
import type { JdIndex } from "./index";

export interface InboxAgeNote {
  path: string;
  folderPath: string;
  createdAt: number;
}

export function staleInboxFindings(index: JdIndex, notes: readonly InboxAgeNote[], days: number, now: number): Finding[] {
  if (!Number.isInteger(days) || days < 1 || !Number.isFinite(now)) return [];
  const folders = new Set(inboxFolders(index).map((entry) => entry.folderPath));
  const threshold = days * 24 * 60 * 60 * 1000;
  return notes.filter((note) =>
    folders.has(note.folderPath) && Number.isFinite(note.createdAt) && note.createdAt > 0 && now - note.createdAt > threshold
  ).map((note) => ({
    kind: "inbox-stale",
    paths: [note.path],
    message: `${note.path}: lleva más de ${days} días en el inbox.`,
    informative: true,
  }));
}

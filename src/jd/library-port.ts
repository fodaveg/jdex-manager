/**
 * Generic, id-based access to a library of folders and notes, so the engine can plan and
 * apply changes on a host that has no vault paths (Hebra, an MCP server). Pure types: the
 * host implements them, the engine never does I/O of its own.
 *
 * Everything is async and speaks ids. Paths are rebuilt by the engine from the
 * `parentId` chain (`create-id.ts`).
 */

export interface PortFolder {
  id: string;
  /** Null for a folder at the top of the library. */
  parentId: string | null;
  name: string;
}

export interface PortNote {
  id: string;
  title: string;
}

export interface EnsureResult {
  id: string;
  /** False when it already existed and was returned as is. */
  created: boolean;
}

export interface LibraryPort {
  /** Every folder the caller may see. */
  listFolders(): Promise<PortFolder[]>;
  /** The notes directly inside a folder (no subfolders). */
  listNotes(folderId: string): Promise<PortNote[]>;
  /** `body` is null for a note the host cannot show (a protected note): the engine skips it as a template. */
  readNote(id: string): Promise<{ body: string | null }>;
  /** Returns the sibling with that name (case-insensitive) with `created: false`, else creates it. */
  ensureFolder(parentId: string | null, name: string): Promise<EnsureResult>;
  /** Returns the note with that title in the folder with `created: false`, else creates it. */
  ensureNote(folderId: string, title: string, body: string): Promise<EnsureResult>;
  /**
   * Whether the category (`"21"`) holds anything the caller may not see. The host decides
   * what is hidden; the engine only ever receives this boolean. When the whole JDex folder
   * is hidden, the host answers true for every category.
   */
  hasHidden(category: string): Promise<boolean>;
}

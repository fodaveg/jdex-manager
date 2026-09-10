import type { DateFormat } from "./jd/files";

export type JdexNoteType = "id" | "cabecera" | "categoria" | "area";

export interface JdexManagerSettings {
  /** Vault path of the folder that holds one note per ID. Empty = not configured. */
  jdexFolder: string;
  /** Vault path of the folder that holds the area folders. Empty = vault root. */
  systemRoot: string;
  /** Vault path of the folder that holds the JDex note templates (00.03 by convention). */
  templatesFolder: string;
  /** Vault path of the folder where audit reports are written (00.02 by convention). */
  reportsFolder: string;
  /** Note name (without `.md`) of the template for each note type, looked up in `templatesFolder`. */
  templateNames: Record<JdexNoteType, string>;
  /** Last choice of the "also create the folder" checkbox in the Create ID dialog. */
  createFolderByDefault: boolean;
  /** Run the audit when the vault has loaded. */
  auditOnStartup: boolean;
  /** Count a JDex note without a folder as a problem instead of information. */
  noteWithoutFolderIsFinding: boolean;
  /** Rename the partner (note or folder) without asking when one side is renamed. */
  renamePairsWithoutAsking: boolean;
  /** Keep the children list of header notes up to date automatically. */
  liveHeaders: boolean;
  /** Prefix used by "Date file name" and when archiving. */
  dateFormat: DateFormat;
  /** Date new files inside an ID folder as they are created. */
  dateOnCreate: boolean;
  /** What to open after Create ID when the folder was created too. */
  afterCreateOpen: "note" | "folder";
  /** Count an empty `descripcion` as a problem in the audit. */
  descriptionIsFinding: boolean;
  /** Offer IDs while typing `21.2` in the editor. */
  autocomplete: boolean;
  /** What the autocomplete inserts by default. */
  autocompleteInsert: "link" | "number";
  /** Count a category or area folder without a JDex note as a problem. */
  structureNotesAreFindings: boolean;
  /** Note that holds the system index between markers. Empty = the note of 00.00. */
  systemIndexNote: string;
  /** Regenerate the system index after creating an ID, category or area. */
  updateSystemIndexOnCreate: boolean;
  /** Default subfolder pattern for new IDs, one folder name per line. Empty = none. */
  subfolderPattern: string;
  /** Pattern overrides per category number, one folder name per line each. */
  subfolderPatternsByCategory: Record<string, string>;
  /** Create the subfolder pattern by default when Create ID also creates the folder. */
  createPatternByDefault: boolean;
  /** Identifier of this system when there are several (`D01`). Empty = single system. */
  systemId: string;
  /** Put the system identifier in front of new note and folder names (`D01.21.22 Title`). */
  prefixNamesWithSystem: boolean;
}

export const DEFAULT_SETTINGS: JdexManagerSettings = {
  jdexFolder: "",
  systemRoot: "",
  templatesFolder: "",
  reportsFolder: "",
  templateNames: {
    id: "JDex - id",
    cabecera: "JDex - cabecera",
    categoria: "JDex - categoria",
    area: "JDex - area",
  },
  createFolderByDefault: false,
  auditOnStartup: false,
  noteWithoutFolderIsFinding: false,
  renamePairsWithoutAsking: false,
  liveHeaders: true,
  dateFormat: "YYYY-MM-DD",
  dateOnCreate: false,
  afterCreateOpen: "note",
  descriptionIsFinding: true,
  autocomplete: true,
  autocompleteInsert: "link",
  structureNotesAreFindings: false,
  systemIndexNote: "",
  updateSystemIndexOnCreate: false,
  subfolderPattern: "",
  subfolderPatternsByCategory: {},
  createPatternByDefault: true,
  systemId: "",
  prefixNamesWithSystem: false,
};

/** Merge stored data over the defaults, one level deep for `templateNames`. */
export function mergeSettings(stored: Partial<JdexManagerSettings> | null | undefined): JdexManagerSettings {
  const base = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  base.templateNames = { ...DEFAULT_SETTINGS.templateNames, ...(stored?.templateNames ?? {}) };
  base.subfolderPatternsByCategory = { ...(stored?.subfolderPatternsByCategory ?? {}) };
  return base;
}

/** The `SYS` prefix to use in new names, or empty. */
export function namePrefix(settings: Pick<JdexManagerSettings, "systemId" | "prefixNamesWithSystem">): string {
  return settings.prefixNamesWithSystem ? settings.systemId : "";
}

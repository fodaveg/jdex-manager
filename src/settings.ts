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
};

/** Merge stored data over the defaults, one level deep for `templateNames`. */
export function mergeSettings(stored: Partial<JdexManagerSettings> | null | undefined): JdexManagerSettings {
  const base = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  base.templateNames = { ...DEFAULT_SETTINGS.templateNames, ...(stored?.templateNames ?? {}) };
  return base;
}

export interface JdexManagerSettings {
  /** Vault path of the folder that holds one note per ID. Empty = not configured. */
  jdexFolder: string;
  /** Vault path of the folder that holds the area folders. Empty = vault root. */
  systemRoot: string;
}

export const DEFAULT_SETTINGS: JdexManagerSettings = {
  jdexFolder: "",
  systemRoot: "",
};

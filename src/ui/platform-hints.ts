import { Platform } from "obsidian";
import { t } from "./i18n";

export interface PlatformFlags {
  isMobile: boolean;
  isMacOS: boolean;
}

export interface Instruction {
  command: string;
  purpose: string;
}

/** What the running host is, read once per call so tests can pass their own. */
export function currentPlatform(): PlatformFlags {
  return { isMobile: Platform.isMobile, isMacOS: Platform.isMacOS };
}

/** Hints of "Go to ID": the folder shortcut is a modifier, which a touch keyboard does not have. */
export function gotoIdInstructions(platform: PlatformFlags): Instruction[] {
  const open = { command: "↵", purpose: t().hintOpenNote };
  if (platform.isMobile) return [open];
  return [open, { command: platform.isMacOS ? "⌘ ↵" : "Ctrl ↵", purpose: t().hintOpenFolder }];
}

/** Hints of the editor autocomplete: ⇧ ↵ (number only) does not exist on a touch keyboard. */
export function autocompleteInstructions(platform: PlatformFlags): Instruction[] {
  const insert = { command: "↵", purpose: t().hintInsert };
  if (platform.isMobile) return [insert];
  return [insert, { command: "⇧ ↵", purpose: t().hintInsertNumber }];
}

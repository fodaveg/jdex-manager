/*
 * Typed access to what tests/obsidian-stub.ts adds on top of the real `obsidian` typings:
 * the messages of every Notice, the controls of every Setting, and the way a user drives them.
 * `tsc` checks tests against the real package types, which know none of this, so the casts live
 * here once instead of in every test.
 */
import { ButtonComponent, DropdownComponent, Notice, Setting, TextComponent, ToggleComponent, type Modal } from "obsidian";

export interface DrivenToggle { value: boolean; toggle(): unknown }
export interface DrivenButton { text: string; cta: boolean; disabled: boolean; click(): unknown }
export interface DrivenText { value: string; placeholder: string; type(value: string): unknown }
export interface DrivenDropdown { value: string; options: Record<string, string>; choose(value: string): unknown }
interface StubSetting { name: string; desc: string; heading: boolean; controls: unknown[] }

const stubNotice = Notice as unknown as { messages: string[] };
const stubSetting = Setting as unknown as { created: StubSetting[] };

/** Every Notice message shown since `resetStub()`. */
export const notices = (): string[] => stubNotice.messages;

/** Empties the Notice log and the Setting registry; call it in `beforeEach`. */
export function resetStub(): void {
  stubNotice.messages.length = 0;
  stubSetting.created.length = 0;
}

/** The `Setting`s built since `resetStub()`, with their name, description and controls. */
export const settings = (): StubSetting[] => stubSetting.created;

const controlsOf = <C>(kind: abstract new (...args: never[]) => unknown): C[] =>
  stubSetting.created.flatMap((setting) => setting.controls).filter((control) => control instanceof kind) as C[];

export const toggles = (): DrivenToggle[] => controlsOf<DrivenToggle>(ToggleComponent);
export const buttons = (): DrivenButton[] => controlsOf<DrivenButton>(ButtonComponent);
export const textFields = (): DrivenText[] => controlsOf<DrivenText>(TextComponent);
export const dropdowns = (): DrivenDropdown[] => controlsOf<DrivenDropdown>(DropdownComponent);

/** Whether a modal is open (between `open()` and `close()`). */
export const isOpen = (modal: Modal): boolean => (modal as unknown as { isOpen: boolean }).isOpen;

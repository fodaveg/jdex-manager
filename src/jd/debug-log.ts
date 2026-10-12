/**
 * Optional debug log: the text of one rolling note that both hosts write when the
 * «debug log» setting is on. Pure: it only turns an error into one sanitized line and
 * keeps the last `DEBUG_LOG_MAX_LINES` lines of the note. Each host does its own writing.
 *
 * A line holds the date, where the plugin was, the path it was working on, the error name
 * and its stack with the file locations cut to `file:line:col`. It never holds the error
 * message (it may quote note content) nor any note content.
 */

/** Title of the log note; also its file name without `.md`. No character forbidden in file names. */
export const DEBUG_LOG_TITLE = "Registro de depuración JDex";

/** The note keeps at most this many entry lines. */
export const DEBUG_LOG_MAX_LINES = 200;

const MARKER = "<!-- jdex:registro -->";
const MAX_FRAMES = 6;
const MAX_FRAME_LENGTH = 120;
const MAX_PATH_LENGTH = 200;

const HEADER = [
  `# ${DEBUG_LOG_TITLE}`,
  "",
  `Este registro lo escribe JDex Manager solo mientras el ajuste «Registro de depuración» está activo. Guarda como máximo las últimas ${DEBUG_LOG_MAX_LINES} líneas: fecha, dónde falló, ruta, nombre del error y su stack saneado. No guarda el contenido de ninguna nota ni el mensaje del error. Puedes borrar líneas o desactivar el ajuste.`,
  "",
  MARKER,
].join("\n");

/**
 * Cuts every file location of a frame down to its file name (keeps `:line:col`). A location starts
 * at a token boundary with a scheme (`file://`, `app://`, `@capacitor://`), a drive (`C:\`) or a
 * root slash, and its directories may hold spaces (`/Users/Ana Lopez/My Vault/`): they run up to the
 * last separator before the file name, never across `(`, `)` or `@`, which delimit locations.
 */
const LOCATION = /(^|[\s(@])(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|[A-Za-z]:[\\/]|\/)[^()@]*[\\/]([^\s()@\\/:]+)/gu;

/** The frames of a V8 (`at …`) or JavaScriptCore (`fn@url:1:2`) stack, without the message line. */
export function sanitizeStack(stack: string | undefined | null): string {
  if (typeof stack !== "string") return "-";
  const frames: string[] = [];
  for (const raw of stack.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!/^at\s/u.test(line) && !line.includes("@")) continue;
    const frame = line.replace(LOCATION, "$1$2").replace(/\s+/gu, " ").replace(/\|/gu, "/");
    frames.push(frame.length > MAX_FRAME_LENGTH ? `${frame.slice(0, MAX_FRAME_LENGTH - 1)}…` : frame);
    if (frames.length === MAX_FRAMES) break;
  }
  return frames.length === 0 ? "-" : frames.join(" < ");
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/[\r\n\t|]+/gu, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** One entry line: `- date | where | path | error name | stack`. Never throws. */
export function formatDebugEntry(now: Date, where: string, error: unknown, path?: string): string {
  const name = error instanceof Error ? (/^[\w$.-]{1,60}$/u.test(error.name) ? error.name : "Error") : typeof error;
  const stack = error instanceof Error ? sanitizeStack(error.stack) : "-";
  return `- ${now.toISOString()} | ${oneLine(where, 60) || "-"} | ${oneLine(path ?? "", MAX_PATH_LENGTH) || "-"} | ${name} | ${stack}`;
}

/**
 * The note body after adding `entry`: the explanation and marker are kept (written if the
 * note is new or the marker was deleted) and only the last `DEBUG_LOG_MAX_LINES` lines remain.
 */
export function appendDebugEntry(current: string | null, entry: string): string {
  let head = HEADER;
  let lines: string[] = [];
  if (current !== null) {
    const at = current.indexOf(MARKER);
    if (at === -1) head = `${current.trimEnd()}\n\n${MARKER}`;
    else {
      head = current.slice(0, at + MARKER.length);
      lines = current.slice(at + MARKER.length).split(/\r?\n/u).filter((line) => line.trim() !== "");
    }
  }
  lines.push(entry);
  return `${head}\n${lines.slice(-DEBUG_LOG_MAX_LINES).join("\n")}\n`;
}

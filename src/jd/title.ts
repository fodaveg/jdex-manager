/** Hebra's file-name tie-break for two notes with the same title (`Title--1a2b.md`): `--` plus the
 *  first 4, 8 or 12 lowercase hex digits of the note id, or all 32 of them (with the UUID's version
 *  and variant nibbles, which a 32-digit number in a title will rarely have). Part of the technical
 *  name, not of the title. A short suffix with no letter (`--2024`, `--1999`) is read as a year or a
 *  number in the title and kept: leaving a real tie-break in place only makes the comparison stricter,
 *  while stripping a title's own digits would lose text. A suffix like `--beef` cannot be told apart
 *  from a title that really ends that way. */
const HEBRA_COLLISION_SUFFIX = /--(?:[0-9a-f]{12}[1-8][0-9a-f]{3}[89ab][0-9a-f]{15}|(?=[0-9]*[a-f])(?:[0-9a-f]{12}|[0-9a-f]{8}|[0-9a-f]{4}))$/u;

/** Title for folder comparison and proposals, without trailing note tags. */
export function titleForCompare(title: string): string {
  return title.replace(HEBRA_COLLISION_SUFFIX, "").replace(/(\s+#[\p{L}\p{N}_/-]+)+$/u, "");
}

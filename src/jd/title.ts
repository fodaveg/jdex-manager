/** Hebra's file-name tie-break for two notes with the same title (`Title--1a2b.md`, hex of
 *  the note id, 4/8/12/32 digits): part of the technical name, not of the title. */
const HEBRA_COLLISION_SUFFIX = /--(?:[0-9a-f]{32}|[0-9a-f]{12}|[0-9a-f]{8}|[0-9a-f]{4})$/u;

/** Title for folder comparison and proposals, without trailing note tags. */
export function titleForCompare(title: string): string {
  return title.replace(HEBRA_COLLISION_SUFFIX, "").replace(/(\s+#[\p{L}\p{N}_/-]+)+$/u, "");
}

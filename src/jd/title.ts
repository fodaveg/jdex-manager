/** Title for folder comparison and proposals, without trailing note tags. */
export function titleForCompare(title: string): string {
  return title.replace(/(\s+#[\p{L}\p{N}_/-]+)+$/u, "");
}

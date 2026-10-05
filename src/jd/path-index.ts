/** Descendant files by exact folder prefix, preserving input order and duplicates.
 * With selected folders, build only those buckets: audits query a small subset of IDs.
 */
export function filesByFolder(filePaths: readonly string[], selectedFolders?: readonly string[]): Map<string, string[]> {
  const folders = new Map<string, string[]>();
  if (selectedFolders) {
    const prefixes = [...new Set(selectedFolders)].map((folder) => ({ folder, prefix: folder + "/", files: [] as string[] }));
    for (const path of filePaths) {
      for (const entry of prefixes) if (path.startsWith(entry.prefix)) entry.files.push(path);
    }
    for (const entry of prefixes) folders.set(entry.folder, entry.files);
    return folders;
  }
  for (const path of filePaths) {
    for (let slash = path.indexOf("/"); slash !== -1; slash = path.indexOf("/", slash + 1)) {
      const folder = path.slice(0, slash);
      const files = folders.get(folder);
      if (files) files.push(path);
      else folders.set(folder, [path]);
    }
  }
  return folders;
}

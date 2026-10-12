// Guard: the Obsidian API the plugin touches must exist in `minAppVersion` (manifest.json).
//
// A list of names with `@since` is not enough: the same name exists on several classes (a
// method called `open` is old on one and new on another). So this resolves each use with the
// TypeScript checker and judges the DECLARATION it lands on: the member (property, method,
// accessor, constructor) and the TYPE that declares it (class or interface), both read from
// the `@since` tag in obsidian.d.ts. For a property access it also judges the type of the
// RECEIVER expression. A symbol with several declarations (overloads) passes if at least one
// of them is old enough.
//
// Limits, stated so nobody over-reads a green: this looks at the declared contract only. It
// does not prove behaviour in an old Obsidian (nothing was run on 1.7.2), and an API without a
// `@since` tag is assumed to be old.
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OBSIDIAN_DTS = `${sep}node_modules${sep}obsidian${sep}`;

/** `1.11.1` > `1.7.2`, numerically per component. */
export function isNewer(version, than) {
  const a = version.split('.').map(Number);
  const b = than.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

function sinceOf(declaration) {
  for (const tag of ts.getJSDocTags(declaration)) {
    if (tag.tagName.text === 'since' && typeof tag.comment === 'string') {
      const match = /\d+(\.\d+)*/.exec(tag.comment);
      if (match) return match[0];
    }
  }
  return null;
}

function isObsidianDeclaration(declaration) {
  return declaration.getSourceFile().fileName.split('/').join(sep).includes(OBSIDIAN_DTS);
}

/** Declared `@since` of a symbol's best declaration, plus its container's. Null = nothing newer. */
function newestRequired(symbol, minAppVersion) {
  const declarations = (symbol?.declarations ?? []).filter(isObsidianDeclaration);
  if (declarations.length === 0) return null;
  let worst = null;
  const verdicts = declarations.map((declaration) => {
    const own = sinceOf(declaration);
    const container = declaration.parent && ts.isClassLike(declaration.parent) || (declaration.parent && ts.isInterfaceDeclaration(declaration.parent))
      ? sinceOf(declaration.parent)
      : null;
    return { own, container, declaration };
  });
  // Any declaration old enough in BOTH member and container makes the use legal (overloads).
  for (const verdict of verdicts) {
    const tooNew = [verdict.own, verdict.container].filter((v) => v && isNewer(v, minAppVersion));
    if (tooNew.length === 0) return null;
    worst = worst ?? { since: tooNew.sort((x, y) => (isNewer(x, y) ? -1 : 1))[0], declaration: verdict.declaration };
  }
  return worst;
}

/**
 * Programs in `files` (or the whole tsconfig) -> list of `{file, line, text, since, via}`.
 * `overrides` maps an absolute path to source text, so a test can inject a file that does not
 * exist on disk.
 */
export function findTooNewApis(minAppVersion, { overrides = {}, tsconfig = join(ROOT, 'tsconfig.json') } = {}) {
  const config = ts.readConfigFile(tsconfig, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT);
  const options = { ...parsed.options, noEmit: true, skipLibCheck: true };
  const host = ts.createCompilerHost(options);
  const realRead = host.readFile.bind(host);
  const realExists = host.fileExists.bind(host);
  const realGetSource = host.getSourceFile.bind(host);
  host.readFile = (f) => (f in overrides ? overrides[f] : realRead(f));
  host.fileExists = (f) => f in overrides || realExists(f);
  host.getSourceFile = (f, lang, ...rest) =>
    f in overrides ? ts.createSourceFile(f, overrides[f], lang, true) : realGetSource(f, lang, ...rest);
  const roots = [...parsed.fileNames.filter((f) => f.startsWith(join(ROOT, 'src') + sep)), ...Object.keys(overrides)];
  const program = ts.createProgram(roots, options, host);
  const checker = program.getTypeChecker();
  const found = [];

  const report = (node, since, via) => {
    const sf = node.getSourceFile();
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
    found.push({ file: sf.fileName.replace(`${ROOT}${sep}`, ''), line: line + 1, text: node.getText().slice(0, 60), since, via });
  };

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || !roots.includes(sf.fileName)) continue;
    const visit = (node) => {
      if (ts.isIdentifier(node) && !ts.isImportSpecifier(node.parent)) {
        const symbol = checker.getSymbolAtLocation(node);
        const resolved = symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
        const hit = newestRequired(resolved, minAppVersion);
        if (hit) report(node, hit.since, 'member/type');
        // The receiver of `a.b`: judge the TYPE of `a` too.
        if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
          const receiver = checker.getTypeAtLocation(node.parent.expression);
          const receiverHit = newestRequired(receiver.getSymbol() ?? receiver.aliasSymbol, minAppVersion);
          if (receiverHit) report(node, receiverHit.since, 'receiver type');
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  // One report per place and cause.
  const seen = new Set();
  return found.filter((f) => {
    const key = `${f.file}:${f.line}:${f.text}:${f.since}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { minAppVersion } = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
  const found = findTooNewApis(minAppVersion);
  if (found.length > 0) {
    for (const f of found) {
      console.error(`check:min-app ${f.file}:${f.line} «${f.text}» needs Obsidian ${f.since} (${f.via}) > minAppVersion ${minAppVersion}`);
    }
    console.error('Raise minAppVersion on purpose (manifest.json, versions.json) or guard the call. Not changed automatically.');
    process.exit(1);
  }
  console.log(`check:min-app ok: nothing in src/ declares @since newer than ${minAppVersion}`);
}

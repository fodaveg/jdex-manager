// Justifies the CodeMirror minimums declared in hebra.json (SHARED_RANGES in build-hebra.mjs).
//
// Hebra lends its own @codemirror/state and @codemirror/view and refuses to load the plugin if
// the range is not satisfied. A range nobody tested is a guess, so:
//   1. list the VALUE symbols the Hebra plugin takes from each shared module, with the
//      members it reads off them (`EditorState.languageData`, `Decoration.none`, ...);
//   2. check each one exists in the type declarations of the MINIMUM version, which is
//      installed under an alias (`codemirror-state-min`, `codemirror-view-min`) pinned to
//      exactly the lower bound of the declared range.
// A symbol missing there is a plugin that would break on the oldest host it claims to support.
//
// Limit: existence of the declared name and static member, not behaviour. Types-only imports
// are ignored (erased at build time).
import ts from 'typescript';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** shared module -> package alias that holds its declared minimum version. */
export const MINIMUM_ALIASES = {
  '@codemirror/state': 'codemirror-state-min',
  '@codemirror/view': 'codemirror-view-min'
};

export function sourceFilesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFilesUnder(full));
    else if (/\.ts$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

/** `{ '@codemirror/view': Set('EditorView', 'EditorView.domEventHandlers', ...) }` */
export function usedSharedSymbols(sources) {
  const used = Object.fromEntries(Object.keys(MINIMUM_ALIASES).map((m) => [m, new Set()]));
  for (const [file, text] of Object.entries(sources)) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2020, true);
    const locals = new Map(); // local name -> {module, exported}
    for (const statement of sf.statements) {
      if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
      const module = statement.moduleSpecifier.text;
      if (!(module in used)) continue;
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      for (const element of bindings.elements) {
        if (element.isTypeOnly) continue;
        const exported = (element.propertyName ?? element.name).text;
        locals.set(element.name.text, { module, exported });
        used[module].add(exported);
      }
    }
    const visit = (node) => {
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
        const local = locals.get(node.expression.text);
        if (local) used[local.module].add(`${local.exported}.${node.name.text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return used;
}

/** Symbols in `used[module]` that the declarations of the minimum version do not have. */
export function missingInMinimum(used, aliasFor = MINIMUM_ALIASES, root = ROOT) {
  const missing = [];
  for (const [module, symbols] of Object.entries(used)) {
    const entry = join(root, 'node_modules', aliasFor[module], 'dist', 'index.d.ts');
    const program = ts.createProgram([entry], { noEmit: true, skipLibCheck: true, types: [] });
    const checker = program.getTypeChecker();
    const moduleSymbol = checker.getSymbolAtLocation(program.getSourceFile(entry));
    const exports = new Map(checker.getExportsOfModule(moduleSymbol).map((s) => [s.name, s]));
    for (const symbol of [...symbols].sort()) {
      const [name, member] = symbol.split('.');
      const exported = exports.get(name);
      if (!exported) {
        missing.push(`${module}: ${symbol}`);
        continue;
      }
      if (member) {
        const target = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
        if (!checker.getTypeOfSymbol(target).getProperty(member)) missing.push(`${module}: ${symbol}`);
      }
    }
  }
  return missing;
}

export function hebraSources(root = ROOT) {
  return Object.fromEntries(sourceFilesUnder(join(root, 'src', 'hebra')).map((f) => [f, readFileSync(f, 'utf8')]));
}

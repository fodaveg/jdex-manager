// Build of JDex Manager as an EXTERNAL Hebra plugin (docs/SPEC-PLUGINS-EXTERNOS.md in the
// Hebra repo, section 3 and 6). It is a separate build from the Obsidian one
// (`esbuild.config.mjs`, CommonJS, `main.js`): it produces, in the repo root,
//
//   hebra-main.mjs    ONE ES module (entry `src/hebra/main.ts`) that exports `activate`
//   hebra-styles.css  the plugin stylesheet (`src/hebra/hebra-styles.css`)
//   hebra.json        the manifest, GENERATED here (never by hand): version from
//                     package.json and the sha256 of the two files above
//
// and then runs the guard over `hebra-main.mjs`. Hebra loads the module from a `blob:`
// URL, where a relative or dynamic import has no base, and lends it its own CodeMirror
// (`hebraShared()` swaps each shared import for a read from Hebra's registry): a second
// copy of `@codemirror/state` would break `EditorState` in the editor. So the guard fails
// (exit 1, with the reason) on anything that would only break once loaded inside Hebra.
import esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hebraShared } from 'hebra-plugin-api/build';
import { PLUGIN_SHARED_MODULES } from 'hebra-plugin-api/shared';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = 'src/hebra/main.ts';
const STYLES_SOURCE = 'src/hebra/hebra-styles.css';
const MAIN_FILE = 'hebra-main.mjs';
const STYLES_FILE = 'hebra-styles.css';
const MANIFEST_FILE = 'hebra.json';

/**
 * Ranges declared in `hebra.json` for the shared modules the bundle actually imports
 * (spec section 3.2). They are the MINIMUM the plugin needs, not the version installed
 * here: Hebra checks them against its own copy at load time and turns the plugin off if
 * one is not satisfied. `assertInstalledSatisfies` keeps them honest at build time.
 */
const SHARED_RANGES = {
  '@codemirror/state': '^6.5.0',
  '@codemirror/view': '^6.30.0'
};

/** Source text that only exists inside the real package: finding it in the bundle means a
 *  copy of that package was inlined instead of borrowed from Hebra. */
const INLINE_COPY_MARKERS = [
  ['@codemirror/state', 'multiple instances of @codemirror/state'],
  ['@codemirror/state', 'Unrecognized extension value in extension set'],
  ['@codemirror/view', 'Calls to EditorView.update are not allowed while an update is in progress']
];

/** Packages that must never be bundled: they are lent by Hebra (`PLUGIN_SHARED_MODULES`) or
 *  are type-only for the plugin (`@codemirror/autocomplete`). */
const NEVER_BUNDLED_INPUT = /^node_modules\/(@codemirror|@lezer|style-mod|w3c-keyname|crelt)\//;

function sha256(file) {
  return `sha256:${createHash('sha256').update(readFileSync(join(ROOT, file))).digest('hex')}`;
}

/**
 * Blanks comments and the CONTENT of string, template and regexp literals so the checks
 * below look at code only (the bundle includes `yaml`, whose comments and messages
 * mention `Buffer`), and collects the literals. A small lexer, enough for esbuild output:
 * it tracks whether a `/` starts a regexp from the previous significant token.
 */
export function scanCode(text) {
  let code = '';
  const strings = [];
  let previous = '';
  let i = 0;
  const regexAllowedAfter = /[(,=:[!&|?{};+\-*%<>~^]$|(^|[^\w$.])(return|typeof|case|do|else|in|of|void|delete|throw|new|yield|await)$/;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
      code += ' ';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      let value = '';
      while (j < text.length && text[j] !== ch) {
        if (text[j] === '\\') {
          value += text[j + 1] ?? '';
          j += 2;
        } else {
          value += text[j];
          j += 1;
        }
      }
      strings.push(value);
      code += ch + ch;
      previous = 'x"';
      i = j + 1;
      continue;
    }
    if (ch === '/' && regexAllowedAfter.test(previous)) {
      let j = i + 1;
      let inClass = false;
      while (j < text.length && text[j] !== '\n') {
        if (text[j] === '\\') j += 2;
        else {
          if (text[j] === '[') inClass = true;
          else if (text[j] === ']') inClass = false;
          else if (text[j] === '/' && !inClass) break;
          j += 1;
        }
      }
      code += '/r/';
      previous = 'x/';
      i = j + 1;
      continue;
    }
    code += ch;
    if (!/\s/.test(ch)) previous = (previous + ch).slice(-12);
    i += 1;
  }
  return { code, strings };
}

/**
 * The guard. Returns the list of problems (empty = fine); the caller prints them and exits
 * non-zero. `metafile` is esbuild's, for the structural checks.
 */
export function guardBundle(text, metafile, mainFile = MAIN_FILE) {
  const problems = [];
  const { code, strings } = scanCode(text);
  const output = Object.values(metafile.outputs)[0];

  for (const imported of output.imports) {
    if (!PLUGIN_SHARED_MODULES.includes(imported.path)) {
      problems.push(
        `${mainFile}: import sin resolver «${imported.path}» (${imported.kind}); solo se admiten los módulos que presta Hebra`
      );
    }
  }
  if (/(^|[^.\w$])import\s*\(/.test(code)) {
    problems.push(`${mainFile}: contiene un import() dinámico; una URL blob: no resuelve imports`);
  }
  const staticImport = /(^|[^.\w$])import\s*(["'`{*]|[\w$]+\s*(,|from\b))/.exec(code);
  if (staticImport) {
    problems.push(`${mainFile}: contiene un import estático («${staticImport[0].trim()}»)`);
  }
  if (/(^|[^.\w$])export\b[^;]*?\bfrom\s*["'`]/.test(code)) {
    problems.push(`${mainFile}: contiene un re-export desde otro módulo («export … from»)`);
  }
  for (const literal of strings) {
    if (/^\.{1,2}\//.test(literal) && /\.(m?[jt]s|json|css)$/.test(literal)) {
      problems.push(`${mainFile}: ruta relativa a un fichero entre comillas («${literal}»)`);
    }
    if (/^node:/.test(literal)) problems.push(`${mainFile}: referencia a «${literal}»`);
    if (literal === 'obsidian' || literal === 'electron') {
      problems.push(`${mainFile}: referencia a «${literal}»`);
    }
  }
  for (const [name, hint] of [
    ['process', 'process'],
    ['Buffer', 'Buffer'],
    ['require', 'require'],
    ['__dirname', '__dirname'],
    ['__filename', '__filename']
  ]) {
    const use = new RegExp(`(^|[^.\\w$])${name}\\b`).exec(code);
    if (use) problems.push(`${mainFile}: usa «${hint}» (no existe en el navegador de Hebra)`);
  }
  for (const [pkg, marker] of INLINE_COPY_MARKERS) {
    if (text.includes(marker)) {
      problems.push(
        `${mainFile}: copia en línea de ${pkg} (contiene «${marker}»); tiene que venir de hebraShared()`
      );
    }
  }
  for (const input of Object.keys(output.inputs)) {
    if (NEVER_BUNDLED_INPUT.test(input)) {
      problems.push(`${mainFile}: empaqueta «${input}», que presta Hebra o es solo de tipos`);
    }
    if (/(^|\/)obsidian(\/|$)/.test(input.replace(/^node_modules\//, ''))) {
      problems.push(`${mainFile}: empaqueta «${input}»`);
    }
  }
  if (!/export\s*\{[^}]*\bactivate\b[^}]*\}/.test(code)) {
    problems.push(`${mainFile}: no exporta «activate»`);
  }
  return problems;
}

/** `^M.m.p` is satisfied by an installed `M.m'.p'` with the same major and a version >= it. */
function assertInstalledSatisfies(name, range) {
  const installed = JSON.parse(
    readFileSync(join(ROOT, 'node_modules', name, 'package.json'), 'utf8')
  ).version;
  const [major, minor, patch] = range.slice(1).split('.').map(Number);
  const [iMajor, iMinor, iPatch] = installed.split('.').map(Number);
  const ok =
    iMajor === major && (iMinor > minor || (iMinor === minor && iPatch >= patch));
  if (!ok) {
    throw new Error(`${name}@${installed} instalado no satisface el rango declarado ${range}`);
  }
}

export async function buildHebra() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const result = await esbuild.build({
    absWorkingDir: ROOT,
    entryPoints: [ENTRY],
    outfile: MAIN_FILE,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    plugins: [hebraShared()],
    metafile: true,
    legalComments: 'none',
    logLevel: 'warning',
    banner: {
      js: '// JDex Manager, plugin for Hebra. GENERATED by scripts/build-hebra.mjs: edit src/hebra/.'
    }
  });
  copyFileSync(join(ROOT, STYLES_SOURCE), join(ROOT, STYLES_FILE));

  const problems = guardBundle(readFileSync(join(ROOT, MAIN_FILE), 'utf8'), result.metafile);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`build:hebra GUARD: ${problem}`);
    throw new Error(`el guardarraíl de ${MAIN_FILE} falló (${problems.length})`);
  }

  // The shared modules the bundle really imports: `hebraShared()` turns each into a
  // virtual input in the `hebra-shared` namespace.
  const output = Object.values(result.metafile.outputs)[0];
  const used = Object.keys(output.inputs)
    .filter((input) => input.startsWith('hebra-shared:'))
    .map((input) => input.slice('hebra-shared:'.length))
    .sort();
  const shared = {};
  for (const name of used) {
    const range = SHARED_RANGES[name];
    if (!range) throw new Error(`el bundle importa ${name} pero scripts/build-hebra.mjs no declara su rango`);
    assertInstalledSatisfies(name, range);
    shared[name] = range;
  }

  const manifest = {
    schema: 1,
    id: 'jdex-manager',
    name: 'JDex Manager',
    version: pkg.version,
    apiVersion: '^1.2.0',
    description:
      'La ruta de una nota en tu sistema Johnny.Decimal, su auditoría y la bandeja de entrada.',
    author: 'fodaveg',
    repo: 'fodaveg/jdex-manager',
    platforms: ['macos', 'ios', 'linux', 'windows', 'web'],
    main: MAIN_FILE,
    styles: STYLES_FILE,
    icon: 'folder-tree',
    capabilities: { required: ['vault.read', 'vault.write', 'editor'], optional: [] },
    network: { hosts: [] },
    shared,
    files: { [MAIN_FILE]: sha256(MAIN_FILE), [STYLES_FILE]: sha256(STYLES_FILE) },
    ageRating: '4+'
  };
  writeFileSync(join(ROOT, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const manifest = await buildHebra();
    const size = readFileSync(join(ROOT, MAIN_FILE)).length;
    console.log(
      `build:hebra ok: ${MAIN_FILE} ${size} bytes, ${MANIFEST_FILE} v${manifest.version}, shared ${JSON.stringify(manifest.shared)}`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

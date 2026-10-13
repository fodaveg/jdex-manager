// Audits what actually SHIPS. `npm audit --omit=dev` is the wrong question for this repo: every
// dependency is a devDependency, yet `yaml` is bundled into hebra-main.mjs. So: bundle both
// entries (no files written), collect the npm packages that end up inside, and fail if
// `npm audit` reports an advisory against any of them (or against a package that only reaches
// them through its own dependencies). Needs the network (npm audit).
import esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** `node_modules/a/node_modules/@s/b/x.js` -> `@s/b` (the innermost package). */
export function packageOf(input) {
  const marker = 'node_modules/';
  const at = input.lastIndexOf(marker);
  if (at < 0) return null;
  const parts = input.slice(at + marker.length).split('/');
  return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

async function bundled(entry, extra) {
  const result = await esbuild.build({
    absWorkingDir: ROOT, entryPoints: [entry], bundle: true, write: false, metafile: true,
    logLevel: 'silent', outfile: 'unused.js', ...extra
  });
  const names = new Set();
  for (const output of Object.values(result.metafile.outputs)) {
    for (const input of Object.keys(output.inputs)) {
      const name = packageOf(input);
      if (name) names.add(name);
    }
  }
  return names;
}

/** For each package with an advisory: its severity and every package its `via` chain reaches. */
export function advisoryReach(audit) {
  const vulns = audit.vulnerabilities ?? {};
  const reach = new Map();
  for (const [name, v] of Object.entries(vulns)) {
    const stack = [name];
    const seen = new Set();
    while (stack.length) {
      const current = stack.pop();
      if (seen.has(current)) continue;
      seen.add(current);
      for (const via of vulns[current]?.via ?? []) {
        if (typeof via === 'string') stack.push(via);
      }
    }
    reach.set(name, { severity: v.severity, seen });
  }
  return reach;
}

/** Advisories that touch a shipped package, as `name (severity)` strings. */
export function shippedHits(audit, shipped) {
  const hits = [];
  for (const [name, info] of advisoryReach(audit)) {
    if (shipped.has(name)) hits.push(`${name} (${info.severity})`);
  }
  return hits;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const obsidian = await bundled('src/main.ts', {
    format: 'cjs', platform: 'node', target: 'es2018',
    external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*']
  });
  const hebra = await bundled('src/hebra/main.ts', {
    format: 'esm', platform: 'browser', target: 'es2020'
  });
  const shipped = new Set([...obsidian, ...hebra]);
  console.log(`audit:bundled  main.js: ${[...obsidian].sort().join(', ') || '(none)'}`);
  console.log(`audit:bundled  hebra-main.mjs: ${[...hebra].sort().join(', ') || '(none)'}`);

  let raw;
  try {
    raw = execFileSync('npm', ['audit', '--json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64e6 });
  } catch (error) {
    raw = error.stdout; // npm audit exits non-zero when it finds something
    if (!raw) throw error;
  }
  const audit = JSON.parse(raw);
  if (audit.error) throw new Error(`npm audit failed: ${JSON.stringify(audit.error)}`);
  // An advisory against a package that merely DEPENDS on a shipped one is not shipped code;
  // an advisory against the shipped package itself is.
  const hits = shippedHits(audit, shipped);
  if (hits.length > 0) {
    console.error(`audit:bundled FAIL: advisories in shipped packages: ${hits.join(', ')}`);
    process.exit(1);
  }
  console.log('audit:bundled ok: no advisory in any package bundled into either artifact');
}

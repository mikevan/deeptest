#!/usr/bin/env node
/**
 * Copies one HelloWorld port from the HelloWorlds repository into
 * test/fixtures/, without dependencies or tool records, so DeepTest's own
 * suite has a committed copy to run against and a fresh clone of DeepTest
 * can run `npm test` without HelloWorlds present.
 *
 * HelloWorlds is the source of truth; the fixture is a generated copy.
 * Change a port there, run this, commit both.
 *
 *   node scripts/sync-fixtures.mjs react-vitest
 *   node scripts/sync-fixtures.mjs --all
 *   node scripts/sync-fixtures.mjs vue-vitest --from D:\other\HelloWorlds
 */
import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, '..', 'test', 'fixtures');
const args = process.argv.slice(2);
const fromIndex = args.indexOf('--from');
const source = fromIndex >= 0 ? resolve(args[fromIndex + 1]) : resolve(here, '..', '..', 'HelloWorlds');
const names = args.filter((a, i) => a !== '--from' && a !== '--all' && (fromIndex < 0 || i !== fromIndex + 1));
const all = args.includes('--all');

const SKIP = new Set(['node_modules', '.venv', '.keepsafe', '.untangleit', 'dist', 'coverage', '.angular', '__pycache__', '.pytest_cache', '.git', '_to_delete', '.vscode', 'test-results']);
// Inside .deeptest/ only what travels with the code: the decisions, and the Playwright fixture the specs import.
const KEEP_IN_DEEPTEST = new Set(['decisions.json', 'witness-playwright.ts']);
function wanted(p) {
  const parts = p.split(/[\\/]/);
  const name = parts[parts.length - 1];
  if (SKIP.has(name)) {
    return false;
  }
  const at = parts.lastIndexOf('.deeptest');
  if (at >= 0 && at < parts.length - 1) {
    return parts.length === at + 2 && KEEP_IN_DEEPTEST.has(name);
  }
  return true;
}

if (!existsSync(source)) {
  console.error(`HelloWorlds not found at ${source}. Pass --from <path>.`);
  process.exit(1);
}
const ports = all
  ? readdirSync(source).filter((n) => !n.startsWith('.') && !n.startsWith('_') && statSync(join(source, n)).isDirectory() && existsSync(join(source, n, 'README.md')))
  : names;
if (ports.length === 0) {
  console.error('Name a port (react-vitest, vue-vitest, ...) or pass --all.');
  process.exit(1);
}
for (const port of ports) {
  const from = join(source, port);
  if (!existsSync(from)) {
    console.error(`No port named ${port} under ${source}.`);
    process.exit(1);
  }
  const to = join(fixtures, `helloworld-${port}`);
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true, filter: (p) => wanted(p) });
  const files = countFiles(to);
  console.log(`${port} -> test/fixtures/helloworld-${port} (${files} files)`);
}

function countFiles(dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? countFiles(join(dir, e.name)) : 1;
  }
  return n;
}

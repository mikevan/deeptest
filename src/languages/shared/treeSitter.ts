/**
 * Loads web-tree-sitter and a grammar from wasm files on disk. No native
 * modules, no node-gyp, no per-platform builds: the same two wasm files run
 * inside VS Code on Windows, macOS, and Linux, and inside plain Node for the
 * test suite.
 */
import { Language, Parser } from 'web-tree-sitter';
import * as fs from 'node:fs';
import * as path from 'node:path';

let initialised: Promise<void> | undefined;
const languages = new Map<string, Promise<Language>>();

/**
 * @param runtimeWasm absolute path to web-tree-sitter.wasm
 */
export function initTreeSitter(runtimeWasm: string): Promise<void> {
  if (!initialised) {
    initialised = Parser.init({ locateFile: () => runtimeWasm }).then(() => undefined);
  }
  return initialised;
}

export async function loadLanguage(grammarWasm: string): Promise<Language> {
  if (!initialised) {
    throw new Error('initTreeSitter must be called before loadLanguage');
  }
  await initialised;
  const key = path.resolve(grammarWasm);
  let pending = languages.get(key);
  if (!pending) {
    pending = Language.load(fs.readFileSync(key));
    languages.set(key, pending);
  }
  return pending;
}

export async function createParser(grammarWasm: string): Promise<Parser> {
  const language = await loadLanguage(grammarWasm);
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}

/**
 * Folder holding the wasm files when running from a repository checkout
 * (the test suite). The build copies the same files into dist/, which is
 * what the extension uses at runtime.
 */
export function repoWasmDir(repoRoot: string = process.cwd()): string {
  const dir = path.join(repoRoot, 'dist');
  const vendored = fs.readdirSync(path.join(repoRoot, 'vendor')).filter((f) => f.endsWith('.wasm'));
  if (fs.existsSync(path.join(dir, 'web-tree-sitter.wasm')) && vendored.every((f) => fs.existsSync(path.join(dir, f)))) {
    return dir;
  }
  // Before the first build: assemble a staging folder from the sources.
  const staging = path.join(repoRoot, 'out', 'wasm');
  fs.mkdirSync(staging, { recursive: true });
  fs.copyFileSync(path.join(repoRoot, 'node_modules', 'web-tree-sitter', 'web-tree-sitter.wasm'), path.join(staging, 'web-tree-sitter.wasm'));
  for (const file of fs.readdirSync(path.join(repoRoot, 'vendor'))) {
    if (file.endsWith('.wasm')) {
      fs.copyFileSync(path.join(repoRoot, 'vendor', file), path.join(staging, file));
    }
  }
  return staging;
}

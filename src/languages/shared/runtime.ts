/**
 * Where the extension's bundled grammars live at runtime. Set once at
 * activation; tests and scripts run from a checkout fall back to the
 * repository layout.
 *
 * The hooks used to be here too, in a folder of DeepTest's own. They are not
 * any more: 1.0.17 moved the last runner off Istanbul, and every hook a run
 * needs now comes from the Witness package, which knows where its own are.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface RuntimeEnvironment {
  wasmDir: string;
}

let current: RuntimeEnvironment | undefined;

export function setRuntimeEnvironment(env: RuntimeEnvironment): void {
  current = env;
}

export function runtimeEnvironment(): RuntimeEnvironment {
  if (current) {
    return current;
  }
  const root = process.cwd();
  const dist = path.join(root, 'dist');
  return {
    wasmDir: fs.existsSync(path.join(dist, 'web-tree-sitter.wasm')) ? dist : path.join(root, 'out', 'wasm'),
  };
}

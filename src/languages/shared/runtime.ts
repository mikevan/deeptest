/**
 * Where the extension's bundled helper files live at runtime: the wasm
 * grammars and the test-runner hooks. Set once at activation; tests and
 * scripts run from a checkout fall back to the repository layout.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface RuntimeEnvironment {
  wasmDir: string;
  hooksDir: string;
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
    hooksDir: path.join(root, 'hooks'),
  };
}

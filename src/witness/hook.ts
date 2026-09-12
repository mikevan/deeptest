/**
 * Witness: the instrumenter as the hooks load it. Bundled by esbuild into
 * dist/hooks/witness-instrument.cjs with web-tree-sitter inside, because
 * it runs in the project's own Node process where DeepTest's node_modules
 * does not exist. The grammars are read from the wasm folder the driver
 * names in DEEPTEST_WASM_DIR.
 */
import * as path from 'node:path';
import { createParser, initTreeSitter } from '../languages/shared/treeSitter';
import { Instrumenter, Instrumented, WitnessMaps } from './instrument';

export interface WitnessInstrumenter {
  instrument(filePath: string, source: string): Instrumented;
  mapsOnly(filePath: string, source: string): WitnessMaps;
}

/** Picks the grammar by extension: .ts and .mts/.cts use TypeScript, .tsx TSX, everything else JavaScript (which reads JSX). */
export async function createInstrumenter(wasmDir: string): Promise<WitnessInstrumenter> {
  await initTreeSitter(path.join(wasmDir, 'web-tree-sitter.wasm'));
  const typescript = new Instrumenter(await createParser(path.join(wasmDir, 'tree-sitter-typescript.wasm')));
  const tsx = new Instrumenter(await createParser(path.join(wasmDir, 'tree-sitter-tsx.wasm')));
  const javascript = new Instrumenter(await createParser(path.join(wasmDir, 'tree-sitter-javascript.wasm')));
  const pick = (filePath: string): Instrumenter => {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.tsx' ? tsx : ext === '.ts' || ext === '.mts' || ext === '.cts' ? typescript : javascript;
  };
  return {
    instrument: (filePath, source) => pick(filePath).instrument(filePath, source),
    mapsOnly: (filePath, source) => pick(filePath).mapsOnly(filePath, source),
  };
}

/**
 * TypeScript / JavaScript plugin: Jest or Vitest with Istanbul for the
 * numerator, tree-sitter (typescript, tsx, javascript grammars) for
 * structure, and detection from package.json so the first run asks nothing.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Parser } from 'web-tree-sitter';
import { DepthOptions, FileStructure } from '../../engine/types';
import { runtimeEnvironment } from '../shared/runtime';
import { createParser, initTreeSitter } from '../shared/treeSitter';
import { CoverageSource, Detection, FieldSpec, HostServices, LanguagePlugin, StructureEnvironment, StructureSource } from '../types';
import { TypeScriptCoverageSource, detectRunner, findVitestConfig, guessSourceRoot, guessTestsPath, isTestFile, readPackageJson, resolveModuleDir, walkSources } from './coverage';
import { analyzeTypeScriptTree } from './structure';

const FIELDS: FieldSpec[] = [
  {
    key: 'runner',
    label: 'Test runner',
    kind: 'select',
    options: [
      { value: 'auto', label: 'Detect from package.json' },
      { value: 'vitest', label: 'Vitest' },
      { value: 'jest', label: 'Jest' },
    ],
    hint: 'Jest brings its own coverage. Vitest needs @vitest/coverage-istanbul; DeepTest offers to install it.',
  },
  {
    key: 'extraArgs',
    label: 'Extra runner arguments',
    kind: 'text',
    placeholder: '--bail',
    hint: 'Optional. Passed to the runner as typed.',
  },
];

async function detect(workspaceRoot: string, _host: HostServices): Promise<Detection> {
  const notes: string[] = [];
  const pkg = readPackageJson(workspaceRoot);
  const runner = detectRunner(workspaceRoot);
  if (!pkg) {
    notes.push('No package.json at the workspace root.');
  } else if (runner) {
    const cfg =
      runner === 'vitest'
        ? findVitestConfig(workspaceRoot)
        : pkg.jest
          ? 'the "jest" key in package.json'
          : ['jest.config.js', 'jest.config.ts', 'jest.config.mjs', 'jest.config.cjs', 'jest.config.json'].find((f) => fs.existsSync(path.join(workspaceRoot, f)));
    notes.push(`Found ${runner}${cfg ? ` (configured in ${cfg})` : ''}.`);
    if (runner === 'vitest' && !resolveModuleDir(workspaceRoot, '@vitest/coverage-istanbul')) {
      notes.push('@vitest/coverage-istanbul is not installed yet; DeepTest will offer to install it on the first run.');
    }
  } else {
    notes.push('No test runner found in package.json. Install Vitest or Jest, or pick one below.');
  }
  const testsPath = guessTestsPath(workspaceRoot);
  const sourceRoot = guessSourceRoot(workspaceRoot, testsPath);
  const root = path.join(workspaceRoot, testsPath);
  const testFiles = walkSources(root)
    .map((rel) => (testsPath ? `${testsPath}/${rel}` : rel))
    .filter((rel) => isTestFile(rel));
  return { testsPath, sourceRoot, testFiles, fields: { runner: 'auto', extraArgs: '' }, notes };
}

class TypeScriptStructureSource implements StructureSource {
  constructor(private readonly parsers: { typescript: Parser; tsx: Parser; javascript: Parser }) {}

  analyze(relativePath: string, text: string, options: DepthOptions): FileStructure {
    const ext = path.extname(relativePath).toLowerCase();
    const parser = ext === '.tsx' ? this.parsers.tsx : ext === '.ts' || ext === '.mts' || ext === '.cts' ? this.parsers.typescript : this.parsers.javascript;
    const tree = parser.parse(text);
    if (!tree) {
      throw new Error(`tree-sitter could not parse ${relativePath}`);
    }
    try {
      return analyzeTypeScriptTree(relativePath, tree, options);
    } finally {
      tree.delete();
    }
  }

  dispose(): void {
    this.parsers.typescript.delete();
    this.parsers.tsx.delete();
    this.parsers.javascript.delete();
  }
}

export const typescriptPlugin: LanguagePlugin = {
  id: 'typescript',
  displayName: 'TypeScript / JavaScript',
  vscodeLanguageIds: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
  extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'],
  configFields: FIELDS,
  isTestFile,
  detect,
  createCoverageSource(): CoverageSource {
    return new TypeScriptCoverageSource({ hooksDir: runtimeEnvironment().hooksDir });
  },
  async createStructureSource(env: StructureEnvironment): Promise<StructureSource> {
    await initTreeSitter(path.join(env.wasmDir, 'web-tree-sitter.wasm'));
    return new TypeScriptStructureSource({
      typescript: await createParser(path.join(env.wasmDir, 'tree-sitter-typescript.wasm')),
      tsx: await createParser(path.join(env.wasmDir, 'tree-sitter-tsx.wasm')),
      javascript: await createParser(path.join(env.wasmDir, 'tree-sitter-javascript.wasm')),
    });
  },
};

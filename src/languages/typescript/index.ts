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
import { TypeScriptCoverageSource, detectPlaywrightCt, detectRunner, findVitestConfig, guessSourceRoot, guessTestsPath, isTestFile, readPackageJson, resolveModuleDir, walkSources } from './coverage';
import { analyzeTypeScriptTree } from './structure';
import { detectFramework, frameworkSentence } from './framework';
import { extractScript, isSingleFileComponent } from '@projectrevivesolutions/complexity';

const FIELDS: FieldSpec[] = [
  {
    key: 'runner',
    label: 'Test runner',
    kind: 'select',
    options: [
      { value: 'auto', label: 'Detect from package.json' },
      { value: 'vitest', label: 'Vitest' },
      { value: 'jest', label: 'Jest' },
      { value: 'mocha', label: 'Mocha' },
    ],
    hint: 'Jest brings its own coverage. Vitest needs @vitest/coverage-istanbul; DeepTest offers to install it. Mocha needs nothing: DeepTest measures it through Witness on Node 22.15 or later.',
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
  const framework = pkg ? detectFramework(workspaceRoot) : undefined;
  if (framework) {
    notes.push(`Framework: ${frameworkSentence(framework, runner)}`);
  }
  if (!pkg) {
    notes.push('No package.json at the workspace root.');
  } else if (framework?.name === 'Angular' && framework.angularBuilder === 'legacy-karma') {
    notes.push('This project tests through the older "@angular-devkit/build-angular:karma" builder, which DeepTest does not drive; "ng update" moves a project to "@angular/build:unit-test". Nothing needs installing.');
  } else if (framework?.name === 'Angular' && framework.angularRunner === 'karma') {
    notes.push('Angular runs its tests through "ng test" with Karma. DeepTest drives that builder through a generated Karma config and runs the browser headless.');
  } else if (framework?.name === 'Angular' && framework.angularRunner === 'vitest') {
    notes.push('Angular runs its tests through "ng test". DeepTest drives that builder with the hook as a setup file.');
    if (!resolveModuleDir(workspaceRoot, '@vitest/coverage-istanbul')) {
      notes.push('@vitest/coverage-istanbul is not installed yet; DeepTest will offer to install it on the first run.');
    }
  } else if (detectPlaywrightCt(workspaceRoot)) {
    const ct = detectPlaywrightCt(workspaceRoot)!;
    notes.push(`Found Playwright component tests (${ct.package}${ct.configFile ? `, configured in ${ct.configFile}` : ''}).`);
    notes.push('They are measured through Witness, which instruments the component build and reads the page; each component test file imports test and expect from .deeptest/witness-playwright.ts, the one line a project adds. Only what the page runs is counted. Nothing needs installing beyond Playwright\'s own browser.');
  } else if (runner) {
    const cfg =
      runner === 'vitest'
        ? findVitestConfig(workspaceRoot)
        : runner === 'mocha'
          ? pkg.mocha
            ? 'the "mocha" key in package.json'
            : ['.mocharc.cjs', '.mocharc.js', '.mocharc.json', '.mocharc.jsonc', '.mocharc.yaml', '.mocharc.yml'].find((f) => fs.existsSync(path.join(workspaceRoot, f)))
          : pkg.jest
            ? 'the "jest" key in package.json'
            : ['jest.config.js', 'jest.config.ts', 'jest.config.mjs', 'jest.config.cjs', 'jest.config.json'].find((f) => fs.existsSync(path.join(workspaceRoot, f)));
    notes.push(`Found ${runner}${cfg ? ` (configured in ${cfg})` : ''}.`);
    if (runner === 'mocha') {
      notes.push('Mocha is measured through Witness, DeepTest\'s own instrumentation, in ES modules and CommonJS alike. Nothing needs installing; Node 22.15 or later is required.');
    }
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
    if (isSingleFileComponent(relativePath)) {
      // A single-file component is parsed through its script blocks. The
      // library blanks everything outside them, character for character,
      // so the tree's rows are the editor's lines. Lines outside the
      // blocks (template, style, the tags themselves) are declarations:
      // they count for coverage when the runner reports them and are
      // never scored for density, because the template's decisions are
      // not parsed yet (1.0.3; see the engineering notes).
      const script = extractScript(text);
      if (!script) {
        const declarations = new Set<number>();
        for (let l = 1; l <= text.split('\n').length; l += 1) {
          declarations.add(l);
        }
        return { path: relativePath, depth: new Map(), routes: new Map(), functions: [], unreachable: new Set(), declarations };
      }
      const structure = this.parse(relativePath, script.source, script.lang === 'tsx' ? this.parsers.tsx : script.lang === 'typescript' ? this.parsers.typescript : this.parsers.javascript, options);
      for (const l of script.outside) {
        structure.declarations.add(l);
        structure.depth.delete(l);
      }
      return structure;
    }
    return this.parse(relativePath, text, ext === '.tsx' ? this.parsers.tsx : ext === '.ts' || ext === '.mts' || ext === '.cts' ? this.parsers.typescript : this.parsers.javascript, options);
  }

  private parse(relativePath: string, text: string, parser: Parser, options: DepthOptions): FileStructure {
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
  extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'],
  configFields: FIELDS,
  isTestFile,
  detect,
  createCoverageSource(): CoverageSource {
    return new TypeScriptCoverageSource({ hooksDir: runtimeEnvironment().hooksDir, wasmDir: runtimeEnvironment().wasmDir });
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

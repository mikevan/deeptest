/**
 * Python plugin: coverage.py dynamic contexts for the numerator, tree-sitter
 * for structure, and detection that fills in the interpreter, the tests
 * folder, and the test runner without asking.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DepthOptions, FileStructure } from '../../engine/types';
import { createParser, initTreeSitter } from '../shared/treeSitter';
import { runProcess } from '../shared/process';
import { CoverageSource, Detection, FieldSpec, HostServices, LanguagePlugin, StructureEnvironment, StructureSource } from '../types';
import { PythonCoverageSource, guessTestsPath, interpreterFromProject, isTestFile, walkPython } from './coverage';
import { analyzePythonTree } from './structure';

const FIELDS: FieldSpec[] = [
  {
    key: 'interpreter',
    label: 'Python interpreter',
    kind: 'text',
    placeholder: process.platform === 'win32' ? 'python' : 'python3',
    hint: 'Pre-filled from the Python extension when it has one selected. Needs coverage and pytest; DeepTest offers to install them.',
  },
  {
    key: 'pytestArgs',
    label: 'Extra pytest arguments',
    kind: 'text',
    placeholder: '-x --maxfail=5',
    hint: 'Optional. Passed to pytest as typed.',
  },
];

async function interpreterFromEditor(host: HostServices, workspaceRoot: string): Promise<string | undefined> {
  try {
    const api = (await host.extensionApi('ms-python.python')) as
      | { environments?: { getActiveEnvironmentPath?: (scope?: unknown) => { path?: string } | undefined } }
      | undefined;
    const env = api?.environments?.getActiveEnvironmentPath?.(workspaceRoot);
    if (env?.path && fs.existsSync(env.path)) {
      return env.path;
    }
  } catch {
    // The Python extension is optional.
  }
  return undefined;
}

function guessSourceRoot(workspaceRoot: string, testsPath: string): string {
  for (const candidate of ['src', 'lib', 'app']) {
    const abs = path.join(workspaceRoot, candidate);
    if (candidate !== testsPath && fs.existsSync(abs) && walkPython(abs).length > 0) {
      return candidate;
    }
  }
  return '';
}

async function detect(workspaceRoot: string, host: HostServices): Promise<Detection> {
  const notes: string[] = [];
  const testsPath = guessTestsPath(workspaceRoot);
  const testFiles = testsPath
    ? walkPython(path.join(workspaceRoot, testsPath))
        .filter((rel) => isTestFile(path.basename(rel)))
        .map((rel) => `${testsPath}/${rel}`)
    : walkPython(workspaceRoot).filter((rel) => isTestFile(path.basename(rel)));
  const sourceRoot = guessSourceRoot(workspaceRoot, testsPath);

  let interpreter = await interpreterFromEditor(host, workspaceRoot);
  if (interpreter) {
    notes.push(`Using the Python selected in the Python extension: ${interpreter}`);
  } else if ((interpreter = interpreterFromProject(workspaceRoot) ?? '')) {
    notes.push(`Using the project's own virtual environment: ${interpreter}`);
  } else {
    interpreter = '';
    const fallback = process.platform === 'win32' ? 'python' : 'python3';
    try {
      const probe = await runProcess(fallback, ['--version'], { cwd: workspaceRoot });
      if (probe.exitCode === 0) {
        notes.push(`Using ${fallback} on PATH (${probe.output.trim()})`);
      }
    } catch {
      notes.push(`No Python found on PATH as '${fallback}'. Enter one below.`);
    }
  }
  for (const marker of ['pyproject.toml', 'pytest.ini', 'setup.cfg', 'tox.ini']) {
    const abs = path.join(workspaceRoot, marker);
    if (fs.existsSync(abs) && /\[tool\.pytest|\[pytest\]|\[tool:pytest\]/.test(fs.readFileSync(abs, 'utf8'))) {
      notes.push(`pytest is configured in ${marker}; its settings apply.`);
      break;
    }
  }
  if (fs.existsSync(path.join(workspaceRoot, 'conftest.py')) || (testsPath && fs.existsSync(path.join(workspaceRoot, testsPath, 'conftest.py')))) {
    notes.push('Found conftest.py.');
  }
  return { testsPath, sourceRoot, testFiles, fields: { interpreter, pytestArgs: '' }, notes };
}

class PythonStructureSource implements StructureSource {
  constructor(private readonly parser: { parse(text: string): { rootNode: unknown; delete(): void } | null; delete(): void }) {}

  analyze(relativePath: string, text: string, options: DepthOptions): FileStructure {
    const tree = this.parser.parse(text);
    if (!tree) {
      throw new Error(`tree-sitter could not parse ${relativePath}`);
    }
    try {
      return analyzePythonTree(relativePath, tree as never, options);
    } finally {
      tree.delete();
    }
  }

  dispose(): void {
    this.parser.delete();
  }
}

export const pythonPlugin: LanguagePlugin = {
  id: 'python',
  displayName: 'Python',
  vscodeLanguageIds: ['python'],
  extensions: ['.py'],
  configFields: FIELDS,
  isTestFile,
  detect,
  createCoverageSource(): CoverageSource {
    return new PythonCoverageSource();
  },
  async createStructureSource(env: StructureEnvironment): Promise<StructureSource> {
    await initTreeSitter(path.join(env.wasmDir, 'web-tree-sitter.wasm'));
    const parser = await createParser(path.join(env.wasmDir, 'tree-sitter-python.wasm'));
    return new PythonStructureSource(parser);
  },
};

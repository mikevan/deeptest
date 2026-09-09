/**
 * The Fix brief: everything an assistant needs to close one shortfall in a
 * single pass, written so that a capable model can nail it and a weak one
 * cannot mistake it for something simpler. DeepTest hands this over and
 * judges the result; it does not vouch for whoever does the work.
 */
import { FileResult, FunctionComplexity, LineResult } from '../engine/types';
import { describeRouteSteps, describeStep } from './plain';

export interface BriefInput {
  path: string;
  line: LineResult;
  file: FileResult;
  /** Text of the target line and a few lines around it, 1-based line numbers. */
  context: Array<{ line: number; text: string }>;
  testsPath: string;
  language: string;
}

export function buildBrief(input: BriefInput): string {
  const { path, line, file, context, testsPath, language } = input;
  const route = line.route;
  const reachedStep = route.reached > 0 ? route.steps[route.reached - 1] : undefined;
  const neighbourTests = new Set<string>();
  for (const other of file.lines) {
    if (other.line !== line.line && Math.abs(other.line - line.line) <= 20) {
      for (const t of other.tests) {
        neighbourTests.add(t);
      }
    }
  }
  const lines: string[] = [];
  lines.push(`# DeepTest: make ${path} line ${line.line} meet its test bar`);
  lines.push('');
  lines.push(`Language: ${language}. Tests live under: ${testsPath || '(workspace root)'}.`);
  lines.push('');
  lines.push(`## The line`);
  lines.push('');
  lines.push('```');
  for (const c of context) {
    lines.push(`${c.line === line.line ? '>' : ' '} ${String(c.line).padStart(4)} | ${c.text}`);
  }
  lines.push('```');
  lines.push('');
  lines.push(`## The bar`);
  lines.push('');
  lines.push(
    `This line is guarded by ${line.depth} decision${line.depth === 1 ? '' : 's'}, so it needs at least ${line.bar} DISTINCT test${line.bar === 1 ? '' : 's'} that execute it. Today ${line.density} do${line.density === 1 ? 'es' : ''}. Short by ${line.gap}.`,
  );
  if (line.tests.length > 0) {
    lines.push('');
    lines.push(`Tests that already reach it: ${line.tests.map((t) => `\`${t}\``).join(', ')}. New tests must differ from these in which decision they take differently.`);
  }
  lines.push('');
  lines.push(`## The route`);
  lines.push('');
  if (route.total === 0) {
    lines.push('No decisions guard this line inside its function. Calling the function is enough to reach it.');
  } else {
    lines.push('Every one of these must hold, in order, for control to arrive at the line:');
    lines.push('');
    for (const step of describeRouteSteps(route)) {
      lines.push(`- ${step}`);
    }
    if (route.reached < route.total) {
      lines.push('');
      lines.push(`Existing tests stop at decision ${route.reached + 1}: ${describeStep(route.steps[route.reached])}. The new test must make that happen and keep going.`);
    }
    if (reachedStep) {
      lines.push('');
      lines.push(`Decision ${route.reached} (line ${reachedStep.line}) is already cleared by ${reachedStep.testsPast} test${reachedStep.testsPast === 1 ? '' : 's'}; copy their setup.`);
    }
  }
  if (neighbourTests.size > 0) {
    lines.push('');
    lines.push(`## Nearby tests to match in style`);
    lines.push('');
    for (const t of Array.from(neighbourTests).sort().slice(0, 12)) {
      lines.push(`- \`${t}\``);
    }
  }
  lines.push('');
  lines.push(`## Done means`);
  lines.push('');
  lines.push(`- ${line.gap} new test${line.gap === 1 ? '' : 's'}, each a separate test case with its own name, each executing line ${line.line} of ${path}.`);
  lines.push('- Each new test asserts something about the outcome of that line, not only that it ran.');
  lines.push('- Every test passes, the new ones and the old ones. Run the whole suite yourself before you report done; a new test that fails is not done, it is a new problem.');
  lines.push('- Do not change the code under test to make the line easier to reach. If the line cannot be reached, say so instead of forcing it.');
  lines.push('');
  lines.push('DeepTest will re-run the suite and report whether the line cleared its bar. It will not accept the fix on your behalf.');
  return lines.join('\n');
}

export type FunctionFixMode = 'test' | 'refactor';

export interface FunctionBriefInput {
  path: string;
  fn: FunctionComplexity;
  file: FileResult;
  /** The function's own text, 1-based line numbers; long functions are cut with a note. */
  source: Array<{ line: number; text: string }>;
  sourceTruncated: boolean;
  limit: number;
  testsPath: string;
  language: string;
  mode: FunctionFixMode;
}

/**
 * The brief for a function that is harder to test than the limit. Two
 * honest answers exist and the person chooses between them before this is
 * built: test every way through it as it stands, or break it into smaller
 * functions that each fit under the limit. Both are judged the same way
 * afterwards: DeepTest re-measures and reports; it accepts nothing.
 */
export function buildFunctionBrief(input: FunctionBriefInput): string {
  const { path, fn, file, source, sourceTruncated, limit, testsPath, language, mode } = input;
  const inside = file.lines.filter((l) => l.line >= fn.startLine && l.line <= fn.endLine);
  const short = inside.filter((l) => l.status === 'short' || l.status === 'untested');
  const totalGap = short.reduce((sum, l) => sum + l.gap, 0);
  const lines: string[] = [];
  const title = mode === 'test' ? `test every way through ${fn.name}()` : `bring ${fn.name}() within ${limit} ways through`;
  lines.push(`# DeepTest: ${title} in ${path}`);
  lines.push('');
  lines.push(`Language: ${language}. Tests live under: ${testsPath || '(workspace root)'}.`);
  lines.push('');
  lines.push('## The function');
  lines.push('');
  lines.push(`\`${fn.name}()\`, ${path} lines ${fn.startLine} to ${fn.endLine}. It has ${fn.complexity} ways through it (cyclomatic complexity ${fn.complexity}); the limit for this project is ${limit}.`);
  lines.push(`Its Cognitive Complexity is ${fn.cognitive} (Campbell, SonarSource 2018)${fn.cognitive === fn.cognitiveOrdered ? '' : ` and ${fn.cognitiveOrdered} by MikeVan's Better Cognitive Complexity (MBCC), which charges a chain of and/or one per operand when the order of the operands carries meaning`}. Cyclomatic counts forks; cognitive complexity counts how hard the function is to follow, charging nesting more the deeper it goes.`);
  lines.push('');
  lines.push('```');
  for (const c of source) {
    lines.push(`${String(c.line).padStart(4)} | ${c.text}`);
  }
  if (sourceTruncated) {
    lines.push(`     | ... (cut here; read the rest of the function from the file)`);
  }
  lines.push('```');
  lines.push('');
  lines.push('## Where the tests fall short today');
  lines.push('');
  if (short.length === 0) {
    lines.push('Every line inside it already has the tests it needs. The problem is the shape of the function, not the tests.');
  } else {
    lines.push(`${short.length} line${short.length === 1 ? '' : 's'} inside it ${short.length === 1 ? 'is' : 'are'} short of the tests ${short.length === 1 ? 'it needs' : 'they need'}, ${totalGap} test${totalGap === 1 ? '' : 's'} in all:`);
    lines.push('');
    for (const l of short.slice(0, 25)) {
      const where = l.route.total > 0 && l.route.reached < l.route.total ? ` Tests stop at: ${describeStep(l.route.steps[l.route.reached])}.` : '';
      lines.push(`- Line ${l.line}: ${l.density} of ${l.bar} test${l.bar === 1 ? '' : 's'} (${l.depth} decision${l.depth === 1 ? '' : 's'} guard it).${where}`);
    }
    if (short.length > 25) {
      lines.push(`- and ${short.length - 25} more; DeepTest lists them all.`);
    }
  }
  lines.push('');
  if (mode === 'test') {
    lines.push('## The job');
    lines.push('');
    lines.push(`Write tests until every line inside \`${fn.name}()\` has as many distinct tests executing it as there are decisions guarding it. Work through the decisions in order: each \`if\`, \`else\`, loop, error handler, and each half of an \`and\` or \`or\` is a way through that needs its own test.`);
    lines.push('');
    lines.push('## Done means');
    lines.push('');
    lines.push(`- Every line listed above has at least its required number of distinct tests, each a separate test case with its own name.`);
    lines.push('- Each new test asserts something about the outcome, not only that the code ran.');
    lines.push('- Every test passes, the new ones and the old ones. Run the whole suite yourself before you report done; a new test that fails is not done, it is a new problem.');
    lines.push(`- Do not change \`${fn.name}()\` or any other code under test. If a way through cannot be reached from a test, say so instead of forcing it.`);
  } else {
    lines.push('## The job');
    lines.push('');
    lines.push(`Break \`${fn.name}()\` into smaller functions so that it, and every function you create from it, has at most ${limit} ways through. Behaviour must not change: same inputs, same outputs, same errors, same side effects, in the same order.`);
    lines.push('');
    lines.push('## Done means');
    lines.push('');
    lines.push(`- \`${fn.name}()\` and every function produced from it has at most ${limit} ways through (cyclomatic complexity ${limit} or less).`);
    lines.push('- The existing tests pass without being edited. They are the contract for the behaviour. If a test must change for the refactor to work, stop and explain why before changing it.');
    lines.push('- No new features, no removed behaviour, no changed error messages, no reordered side effects.');
    lines.push('- Names for the new functions say what they do; a reader who has never seen the code should follow the main function from top to bottom.');
    lines.push('- Every line of the new functions has as many distinct tests executing it as there are decisions guarding it; add tests where the split leaves a new function short.');
    lines.push('- Every test passes. Run the whole suite yourself before you report done.');
  }
  lines.push('');
  lines.push('DeepTest will re-run the suite and measure the function again. It will not accept the result on your behalf.');
  return lines.join('\n');
}

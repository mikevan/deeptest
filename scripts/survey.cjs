#!/usr/bin/env node
/**
 * DeepTest without the editor. Runs a project through the TypeScript coverage
 * source and prints what the side panel would show, as text.
 *
 * The panel is a VS Code view with no command line, so verifying a runner used
 * to mean asking a person to read a screen and describe it back. Descriptions
 * lose exactly the detail that matters: whether a line carries a real test name,
 * whether a file no test imports is present or missing, whether attribution
 * names a source file or a bundle chunk. This prints the evidence instead, so a
 * driver change can be checked by reading output rather than by trusting a
 * recollection.
 *
 * Build first, because it runs the compiled sources and needs the wasm beside
 * them:
 *
 *   npm run build && npm run compile-tests
 *   node scripts/survey.cjs <project> [--tests <dir>] [--source <dir>] [--runner auto|jest|vitest] [--file <relative path>]
 */
'use strict';
const path = require('node:path');
const { typescriptPlugin } = require('../out/src/languages/typescript/index.js');
const words = require('../out/src/ui/words.js');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const project = process.argv[2];
  if (!project || project.startsWith('--')) {
    console.error('Usage: node scripts/survey.cjs <project> [--tests <dir>] [--source <dir>] [--runner auto|jest|vitest] [--file <relative path>]');
    process.exit(2);
  }
  const workspaceRoot = path.resolve(project);
  const settings = {
    testsPath: arg('tests', ''),
    sourceRoot: arg('source', 'src'),
    fields: { runner: arg('runner', 'auto'), extraArgs: '' },
  };
  const log = [];
  const source = typescriptPlugin.createCoverageSource();
  const ctx = { workspaceRoot, settings, log: (l) => log.push(l) };

  console.log(`project      ${workspaceRoot}`);
  console.log(`sourceRoot   ${settings.sourceRoot || '(root)'}   testsPath ${settings.testsPath || '(none)'}   runner ${settings.fields.runner}`);

  const env = await source.checkEnvironment(ctx);
  console.log(`environment  ${env.ok ? 'ok' : 'NOT OK'}: ${env.summary}`);
  for (const p of env.problems || []) {
    console.log(`               ${p}`);
  }
  if (!env.ok) {
    console.log(`fix          ${env.fix ? `${env.fix.title}: ${env.fix.command} ${(env.fix.args || []).join(' ')}` : '(none offered)'}`);
    process.exit(1);
  }

  // The log is most valuable exactly when the run fails, so a failure prints it
  // whether or not --log was asked for. The first version of this script printed
  // it only after a successful run, which meant a failing driver told you
  // nothing, which is the opposite of the point.
  let run;
  try {
    run = await source.run(ctx);
  } catch (err) {
    console.log(`run failed    ${err && err.message ? err.message : err}`);
    console.log('');
    console.log(`log          ${log.length} lines, printed because the run failed:`);
    for (const l of log) {
      console.log(`  ${l}`);
    }
    process.exit(1);
  }
  console.log(`tests        ${run.tests.passed} passed, ${run.tests.failed} failed, ${run.tests.skipped} skipped, ${run.tests.errors || 0} errors`);
  // The same check the panel makes before it draws a card (1.0.14): every
  // finished test left a record, and no record was cut off.
  const e = run.evidence || {};
  const hole = words.evidenceProblemSentence(e);
  console.log(`evidence     ${e.testsFinished} finished, ${e.testsRecorded} recorded, ${e.brokenBoundaries} cut off${e.reconcilable ? '' : ' (not reconcilable for this runner)'}${hole ? '   <- THE PANEL WOULD REFUSE: ' + hole : ''}`);

  const ids = new Set();
  for (const c of run.coverages) {
    for (const tests of c.lines.values()) {
      for (const t of tests) {
        ids.add(t);
      }
    }
  }
  console.log(`attribution  ${ids.size} distinct test ids across ${run.coverages.length} files`);
  if (ids.size === 0) {
    console.log('             NONE. Every line will read as having run at startup only.');
  } else {
    for (const id of [...ids].sort().slice(0, 5)) {
      console.log(`               ${id}`);
    }
    if (ids.size > 5) {
      console.log(`               ... and ${ids.size - 5} more`);
    }
  }

  console.log('');
  console.log('file                                     lines  covered  attributed');
  for (const c of [...run.coverages].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const lines = c.lines.size;
    const attributed = [...c.lines.values()].filter((s) => s.size > 0).length;
    const covered = c.executed ? c.executed.size : 0;
    const flag = c.unmeasured ? `   <- UNMEASURED: ${c.unmeasured}` : lines > 0 && covered === 0 ? '   <- no test reached this file' : c.skipped && c.skipped.length ? `   <- ${c.skipped.length} decision(s) not counted on line(s) ${c.skipped.map((k) => k.line).join(', ')}` : '';
    console.log(`${c.path.padEnd(40)} ${String(lines).padStart(5)}  ${String(covered).padStart(7)}  ${String(attributed).padStart(10)}${flag}`);
  }

  const one = arg('file', '');
  if (one) {
    const c = run.coverages.find((x) => x.path === one || x.path.endsWith(one));
    if (!c) {
      console.log(`\n${one} is not in the report. Measured: ${run.measuredFiles.join(', ')}`);
    } else {
      console.log(`\nper line, ${c.path}:`);
      for (const line of [...c.lines.keys()].sort((a, b) => a - b)) {
        const tests = [...(c.lines.get(line) || [])];
        console.log(`  ${String(line).padStart(4)}  ${tests.length ? tests.join(' | ') : '(no test)'}`);
      }
    }
  }

  console.log('');
  console.log(`log lines    ${log.length} (pass --log to print them)`);
  if (process.argv.includes('--log')) {
    for (const l of log) {
      console.log(`  ${l}`);
    }
  }
}

main().catch((err) => {
  console.error(`survey failed: ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});

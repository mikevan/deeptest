/**
 * The engines preflight: does the tool we are about to drive run on this Node?
 *
 * The range that matters most here is Angular CLI 22's real one, which is
 * what the environment check said "ok" to on a Node the CLI then refused to
 * start on. Every case below uses ranges taken from real packages rather
 * than invented ones, so a change to the reader is checked against the
 * grammar that `engines.node` fields actually use.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { compareVersions, declaredEngines, engineMismatch, engineMismatchSentence, parseVersion, satisfies } from '../src/languages/typescript/engines';
import { TypeScriptCoverageSource, enginePackages } from '../src/languages/typescript/coverage';

/** Angular CLI 22.1.8, verbatim from its package.json. */
const ANGULAR = '^22.22.3 || ^24.15.0 || >=26.0.0';

const v = (text: string) => parseVersion(text)!;

test('parseVersion takes what node --version and a package.json actually print', () => {
  assert.deepEqual(parseVersion('v22.22.0'), { major: 22, minor: 22, patch: 0 });
  assert.deepEqual(parseVersion('22.22.3'), { major: 22, minor: 22, patch: 3 });
  assert.deepEqual(parseVersion('22.22'), { major: 22, minor: 22, patch: 0 }, 'a missing part is zero');
  assert.deepEqual(parseVersion('22'), { major: 22, minor: 0, patch: 0 });
  assert.deepEqual(parseVersion('v24.0.0-nightly20260101'), { major: 24, minor: 0, patch: 0 }, 'a prerelease tag is stripped, not refused');
  assert.equal(parseVersion('22.x'), undefined);
  assert.equal(parseVersion(''), undefined);
  assert.equal(parseVersion('latest'), undefined);
  assert.equal(compareVersions(v('22.22.0'), v('22.22.3')), -3);
  assert.equal(compareVersions(v('23.0.0'), v('22.99.99')), 1);
  assert.equal(compareVersions(v('22.22.3'), v('22.22.3')), 0);
});

test('the Angular CLI 22 range: the installed Node was below it, and the patch update clears it', () => {
  // This is the finding the delivery exists for: 22.22.0 is outside the range
  // the CLI publishes, and the check used to say the environment was ok.
  assert.equal(satisfies(v('22.22.0'), ANGULAR), false);
  assert.equal(satisfies(v('22.22.3'), ANGULAR), true, 'the floor itself is inside the range');
  assert.equal(satisfies(v('22.23.2'), ANGULAR), true);
  assert.equal(satisfies(v('23.0.0'), ANGULAR), false, 'the caret stops at the next major, so Node 23 is not covered');
  assert.equal(satisfies(v('24.14.0'), ANGULAR), false);
  assert.equal(satisfies(v('24.15.0'), ANGULAR), true);
  assert.equal(satisfies(v('25.9.9'), ANGULAR), false, 'the gap between the second caret and the floor of the third alternative');
  assert.equal(satisfies(v('26.0.0'), ANGULAR), true);
  assert.equal(satisfies(v('30.1.0'), ANGULAR), true);
});

test('the comparators these fields use, including npm\'s caret rule below 1.0', () => {
  assert.equal(satisfies(v('22.15.0'), '>=22.15.0'), true);
  assert.equal(satisfies(v('22.14.9'), '>=22.15.0'), false);
  assert.equal(satisfies(v('0.2.9'), '^0.2.3'), true, 'below 1.0 the caret holds the minor');
  assert.equal(satisfies(v('0.3.0'), '^0.2.3'), false);
  assert.equal(satisfies(v('0.0.3'), '^0.0.3'), true, 'and at 0.0.x it holds the patch');
  assert.equal(satisfies(v('0.0.4'), '^0.0.3'), false);
  assert.equal(satisfies(v('22.22.9'), '~22.22.3'), true);
  assert.equal(satisfies(v('22.23.0'), '~22.22.3'), false);
  assert.equal(satisfies(v('22.0.0'), '^22'), true, 'a partial version fills with zero');
  assert.equal(satisfies(v('14.5.0'), '>=14 <16'), true, 'two comparators on one alternative must both hold');
  assert.equal(satisfies(v('16.0.0'), '>=14 <16'), false);
  assert.equal(satisfies(v('99.0.0'), '*'), true);
  assert.equal(satisfies(v('99.0.0'), ''), true);
  assert.equal(satisfies(v('22.22.3'), '22.22.3'), true, 'a bare version means exactly it');
  assert.equal(satisfies(v('22.22.4'), '22.22.3'), false);
});

test('a range the reader cannot parse is "cannot tell", never "no"', () => {
  // Refusing to run a project because we misread its range would be the same
  // class of wrong answer this file removes, pointed the other way.
  assert.equal(satisfies(v('22.22.0'), '22.x'), undefined);
  assert.equal(satisfies(v('22.22.0'), '>=14.0.0 || garbage'), true, 'one readable alternative is enough to answer');
  assert.equal(satisfies(v('12.0.0'), '>=14.0.0 || garbage'), false, 'and the readable alternative still decides a no');
  assert.equal(satisfies(v('22.22.0'), 'garbage || nonsense'), undefined);
});

test('declaredEngines reads only what a package actually declares', () => {
  assert.deepEqual(declaredEngines(JSON.stringify({ name: '@angular/cli', version: '22.1.8', engines: { node: ANGULAR } }), 'fallback'), {
    name: '@angular/cli',
    version: '22.1.8',
    node: ANGULAR,
  });
  assert.equal(declaredEngines(JSON.stringify({ name: 'vitest', version: '3.2.7' }), 'vitest'), undefined, 'most packages declare nothing, and that is silence, not a problem');
  assert.equal(declaredEngines(JSON.stringify({ engines: { npm: '>=8' } }), 'x'), undefined, 'an npm requirement is not a node requirement');
  assert.equal(declaredEngines(JSON.stringify({ engines: { node: '  ' } }), 'x'), undefined);
  assert.equal(declaredEngines('{ not json', 'x'), undefined);
  assert.deepEqual(declaredEngines(JSON.stringify({ engines: { node: '>=1' } }), 'fallback')?.name, 'fallback', 'a package with no name is called what we looked it up as');
});

test('engineMismatch names the first tool that will not run, and passes over the rest', () => {
  const pkg = (name: string, version: string, node?: string) => ({ name, packageJsonText: JSON.stringify({ name, version, ...(node ? { engines: { node } } : {}) }) });
  const cli = pkg('@angular/cli', '22.1.8', ANGULAR);
  const vitest = pkg('vitest', '3.2.7');
  const impossible = pkg('karma', '6.4.4', '>=99.0.0');

  assert.deepEqual(engineMismatch('v22.22.0', [cli, vitest]), { tool: '@angular/cli', toolVersion: '22.1.8', requires: ANGULAR, installed: 'v22.22.0' });
  assert.equal(engineMismatch('v22.23.2', [cli, vitest]), undefined, 'a supported Node leaves nothing to say');
  assert.equal(engineMismatch('v22.23.2', [{ name: '@angular/cli', packageJsonText: undefined }]), undefined, 'a package that is not installed is not a mismatch');
  assert.equal(engineMismatch('v22.22.0', [{ name: 'x', packageJsonText: JSON.stringify({ engines: { node: '22.x' } }) }]), undefined, 'an unreadable range is passed over');
  assert.equal(engineMismatch('not a version', [cli]), undefined, 'and an unreadable Node is not judged either');
  assert.equal(engineMismatch('v22.23.2', [vitest, impossible])?.tool, 'karma', 'the list order decides which is named');
});

test('the sentence names the package, both versions, and the button as it is labelled', () => {
  assert.equal(
    engineMismatchSentence({ tool: '@angular/cli', toolVersion: '22.1.8', requires: ANGULAR, installed: 'v22.22.0' }),
    '@angular/cli 22.1.8 does not run on this Node. It needs Node ^22.22.3 || ^24.15.0 || >=26.0.0, and v22.22.0 is what would run it. Update Node to a version it supports, then press "Check my code again".',
  );
  assert.equal(
    engineMismatchSentence({ tool: 'karma', toolVersion: '', requires: '>=99.0.0', installed: 'v22.23.2' }),
    'karma does not run on this Node. It needs Node >=99.0.0, and v22.23.2 is what would run it. Update Node to a version it supports, then press "Check my code again".',
  );
});

test('enginePackages lists what each runner actually starts, the refusing process first', () => {
  assert.deepEqual(enginePackages('ng-vitest', '.'), ['@angular/cli', '@angular/build', 'vitest']);
  assert.deepEqual(enginePackages('ng-karma', '.'), ['@angular/cli', '@angular/build', 'karma']);
  assert.deepEqual(enginePackages('vitest', '.'), ['vitest']);
  assert.deepEqual(enginePackages('jest', '.'), ['jest']);
  assert.deepEqual(enginePackages('mocha', '.'), ['mocha']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deeptest-ct-'));
  assert.deepEqual(enginePackages('playwright-ct', dir), ['@playwright/test'], 'with no component package detected, the runner itself still counts');
});

/**
 * The gate through the public method, on a project whose runner declares a
 * Node nobody has. Everything else about the project is fine, which is the
 * case that used to pass: installed, configured, and about to fail.
 */
test('checkEnvironment refuses when the runner itself will not start on this Node', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deeptest-engines-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', devDependencies: { vitest: '^3.2.0' }, scripts: { test: 'vitest run' } }));
  const vitestDir = path.join(dir, 'node_modules', 'vitest');
  fs.mkdirSync(vitestDir, { recursive: true });
  const source = new TypeScriptCoverageSource({ wasmDir: path.resolve('dist') });
  const ctx = { workspaceRoot: dir, settings: { testsPath: 'test', sourceRoot: 'src', fields: { runner: 'auto', extraArgs: '' } }, log: () => undefined };

  fs.writeFileSync(path.join(vitestDir, 'package.json'), JSON.stringify({ name: 'vitest', version: '3.2.7' }));
  const without = await source.checkEnvironment(ctx);
  assert.equal(without.ok, true, `a runner that declares nothing is left alone: ${without.problems.join(' ')}`);

  fs.writeFileSync(path.join(vitestDir, 'package.json'), JSON.stringify({ name: 'vitest', version: '3.2.7', engines: { node: '>=99.0.0' } }));
  const refused = await source.checkEnvironment(ctx);
  assert.equal(refused.ok, false, 'the same project, with a Node requirement nobody meets');
  assert.match(refused.problems[0], /^vitest 3\.2\.7 does not run on this Node\. It needs Node >=99\.0\.0, and v/);
  assert.match(refused.problems[0], /Update Node to a version it supports, then press "Check my code again"\.$/);
  assert.match(refused.summary, /vitest needs >=99\.0\.0$/);

  fs.writeFileSync(path.join(vitestDir, 'package.json'), JSON.stringify({ name: 'vitest', version: '3.2.7', engines: { node: '>=18.0.0' } }));
  assert.equal((await source.checkEnvironment(ctx)).ok, true, 'and a requirement this Node meets says nothing at all');
});

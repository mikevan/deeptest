import { beforeAll, test } from 'vitest';
import assert from 'node:assert/strict';
import type { Parser } from 'web-tree-sitter';
import { createParser, initTreeSitter, repoWasmDir } from '../src/languages/shared/treeSitter';
import { analyzeTypeScriptTree } from '../src/languages/typescript/structure';
import { DEFAULT_DEPTH_OPTIONS, DepthOptions } from '../src/engine/types';

let ts: Parser;
let js: Parser;

beforeAll(async () => {
  const dir = repoWasmDir();
  await initTreeSitter(`${dir}/web-tree-sitter.wasm`);
  ts = await createParser(`${dir}/tree-sitter-typescript.wasm`);
  js = await createParser(`${dir}/tree-sitter-javascript.wasm`);
});

function analyze(source: string, options: Partial<DepthOptions> = {}, parser: Parser = ts) {
  const tree = parser.parse(source);
  assert.ok(tree, 'parse failed');
  return analyzeTypeScriptTree('x.ts', tree, { ...DEFAULT_DEPTH_OPTIONS, ...options });
}

function depths(source: string, options: Partial<DepthOptions> = {}, parser: Parser = ts): Record<number, number> {
  const s = analyze(source, options, parser);
  const out: Record<number, number> = {};
  for (const [line, depth] of Array.from(s.depth.entries()).sort((a, b) => a[0] - b[0])) {
    out[line] = depth;
  }
  return out;
}

const lines = (...xs: string[]): string => `${xs.join('\n')}\n`;

test('straight-line function: body depth 0, def line is a declaration', () => {
  const s = analyze(lines('export function f(x: number) {', '  const y = x + 1;', '  return y;', '}'));
  assert.deepEqual(Array.from(s.declarations), [1]);
  assert.equal(s.depth.get(2), 0);
  assert.equal(s.depth.get(3), 0);
  assert.deepEqual(s.functions, [{ name: 'f', startLine: 1, endLine: 4, complexity: 1, campbell: 0, mbcc: 0 }]);
});

test('if / else if / else: cumulative like Python, else carries the earlier branches', () => {
  const d = depths(lines('function f(x) {', '  if (x === 1) {', '    a();', '  } else if (x === 2) {', '    b();', '  } else {', '    c();', '  }', '  d();', '}'));
  assert.deepEqual(d, { 1: 0, 2: 1, 3: 1, 4: 2, 5: 2, 6: 2, 7: 2, 9: 0 });
});

test('short circuits: &&, ||, and ?? are operands; ternary counts', () => {
  const src = lines('function f(a, b, c) {', '  if (a && b || c) {', '    go();', '  }', '  const z = a ? 1 : 2;', '  const w = a ?? b;', '  return z;', '}');
  assert.deepEqual(depths(src), { 1: 0, 2: 3, 3: 3, 5: 1, 6: 1, 7: 0 });
  assert.deepEqual(depths(src, { countShortCircuit: false, countTernary: false }), { 1: 0, 2: 1, 3: 1, 5: 0, 6: 0, 7: 0 });
});

test('loops: for, for-of, for-in, while, do-while each add one decision', () => {
  const d = depths(lines('function f(xs) {', '  for (let i = 0; i < 3; i++) {', '    a();', '  }', '  for (const x of xs) {', '    b();', '  }', '  while (xs.length) {', '    c();', '  }', '  do {', '    d();', '  } while (xs.length);', '}'));
  assert.deepEqual(d, { 1: 0, 2: 1, 3: 1, 5: 1, 6: 1, 8: 1, 9: 1, 11: 1, 12: 1 });
});

test('do-while reports a simple identifier condition with both outcomes', () => {
  const s = analyze(lines('function f(ready) {', '  do {', '    work();', '  } while (ready);', '}'));
  assert.deepEqual(s.routes.get(2), [{ line: 2, kind: 'loop', condition: 'ready', outcome: 'is true, and separately false' }]);
});

test('do-while removes nested parentheses from its displayed condition', () => {
  const s = analyze(lines('function f(ready) {', '  do {', '    work();', '  } while ((((ready))));', '}'));
  assert.deepEqual(s.routes.get(2), [{ line: 2, kind: 'loop', condition: 'ready', outcome: 'is true, and separately false' }]);
});

test('do-while reports a negated condition with both outcomes', () => {
  const s = analyze(lines('function f(done) {', '  do {', '    work();', '  } while (!done);', '}'));
  assert.deepEqual(s.routes.get(2), [{ line: 2, kind: 'loop', condition: '!done', outcome: 'is true, and separately false' }]);
});

test('do-while reports a comparison condition with both outcomes', () => {
  const s = analyze(lines('function f(index, length) {', '  do {', '    index++;', '  } while (index < length);', '}'));
  assert.deepEqual(s.routes.get(2), [{ line: 2, kind: 'loop', condition: 'index < length', outcome: 'is true, and separately false' }]);
});

test('do-while reports a call condition with both outcomes', () => {
  const s = analyze(lines('function f(ready) {', '  do {', '    work();', '  } while (ready());', '}'));
  assert.deepEqual(s.routes.get(2), [{ line: 2, kind: 'loop', condition: 'ready()', outcome: 'is true, and separately false' }]);
});

test('do-while includes an and operand from its condition', () => {
  const s = analyze(lines('function f(a, b) {', '  do {', '    work();', '  } while (a && b);', '}'));
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.condition}:${step.outcome}`), ['loop:a && b:is true, and separately false', 'and:b:is also true']);
});

test('do-while includes an or operand from its condition', () => {
  const s = analyze(lines('function f(a, b) {', '  do {', '    work();', '  } while (a || b);', '}'));
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.condition}:${step.outcome}`), ['loop:a || b:is true, and separately false', 'or:b:is true when the part before it is false']);
});

test('do-while includes a nullish operand from its condition', () => {
  const s = analyze(lines('function f(a, b) {', '  do {', '    work();', '  } while (a ?? b);', '}'));
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.condition}:${step.outcome}`), ['loop:a ?? b:is true, and separately false', 'or:b:is used when the part before it is null']);
});

test('do-while includes a ternary decision from its condition', () => {
  const s = analyze(lines('function f(a, b, c) {', '  do {', '    work();', '  } while (a ? b : c);', '}'));
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.condition}:${step.outcome}`), ['loop:a ? b : c:is true, and separately false', 'ternary:a:is true, and separately false']);
});

test('do-while preserves mixed condition operands in source order', () => {
  const s = analyze(lines('function f(a, b, c) {', '  do {', '    work();', '  } while (a && b || c);', '}'));
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.condition}:${step.outcome}`), ['loop:a && b || c:is true, and separately false', 'and:b:is also true', 'or:c:is true when the part before it is false']);
});

test('do-while preserves a chain of and operands in source order', () => {
  const s = analyze(lines('function f(a, b, c) {', '  do {', '    work();', '  } while (a && b && c);', '}'));
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.condition}:${step.outcome}`), ['loop:a && b && c:is true, and separately false', 'and:b:is also true', 'and:c:is also true']);
});

test('do-while preserves a chain of or operands in source order', () => {
  const s = analyze(lines('function f(a, b, c) {', '  do {', '    work();', '  } while (a || b || c);', '}'));
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.condition}:${step.outcome}`), ['loop:a || b || c:is true, and separately false', 'or:b:is true when the part before it is false', 'or:c:is true when the part before it is false']);
});

test('do-while keeps both outcomes when short circuits are disabled', () => {
  const s = analyze(lines('function f(a, b) {', '  do {', '    work();', '  } while (a && b);', '}'), { countShortCircuit: false });
  assert.deepEqual(s.routes.get(2), [{ line: 2, kind: 'loop', condition: 'a && b', outcome: 'is true, and separately false' }]);
});

test('do-while keeps both outcomes when ternary counting is disabled', () => {
  const s = analyze(lines('function f(a, b, c) {', '  do {', '    work();', '  } while (a ? b : c);', '}'), { countTernary: false });
  assert.deepEqual(s.routes.get(2), [{ line: 2, kind: 'loop', condition: 'a ? b : c', outcome: 'is true, and separately false' }]);
});

test('for loop without an expression reports its parser condition field', () => {
  const s = analyze(lines('function f() {', '  for (;;) {', '    work();', '  }', '}'));
  assert.deepEqual(s.routes.get(2), [{ line: 2, kind: 'loop', condition: ';', outcome: 'is true at least once' }]);
  assert.equal(s.depth.get(3), 1);
});

test('for loop reports a simple identifier condition', () => {
  const s = analyze(lines('function f(ready) {', '  for (; ready;) {', '    work();', '  }', '}'));
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.condition}:${step.outcome}`), ['loop:ready:is true at least once']);
});

test('for loop removes nested parentheses from its displayed condition', () => {
  const s = analyze(lines('function f(ready) {', '  for (; (((ready)));) {', '    work();', '  }', '}'));
  assert.deepEqual(s.routes.get(3)?.map((step) => step.condition), ['ready']);
});

test('for loop includes an and operand from its condition', () => {
  const s = analyze(lines('function f(a, b) {', '  for (; a && b;) {', '    work();', '  }', '}'));
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.condition}`), ['loop:a && b', 'and:b']);
  assert.equal(s.depth.get(3), 2);
});

test('for loop includes an or operand from its condition', () => {
  const s = analyze(lines('function f(a, b) {', '  for (; a || b;) {', '    work();', '  }', '}'));
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.outcome}`), ['loop:is true at least once', 'or:is true when the part before it is false']);
});

test('for loop includes a nullish operand from its condition', () => {
  const s = analyze(lines('function f(a, b) {', '  for (; a ?? b;) {', '    work();', '  }', '}'));
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.condition}:${step.outcome}`), ['loop:a ?? b:is true at least once', 'or:b:is used when the part before it is null']);
});

test('for loop includes a ternary decision from its condition', () => {
  const s = analyze(lines('function f(a, b, c) {', '  for (; a ? b : c;) {', '    work();', '  }', '}'));
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.condition}`), ['loop:a ? b : c', 'ternary:a']);
});

test('for loop preserves nested condition operands in source order', () => {
  const s = analyze(lines('function f(a, b, c) {', '  for (; a && b || c;) {', '    work();', '  }', '}'));
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.condition}`), ['loop:a && b || c', 'and:b', 'or:c']);
  assert.equal(s.depth.get(3), 3);
});

test('for loop includes an and operand from its increment', () => {
  const s = analyze(lines('function f(ready, next) {', '  for (; ready; ready && next()) {', '    work();', '  }', '}'));
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.condition}`), ['loop:ready', 'and:next()']);
});

test('for loop includes an or operand from its increment', () => {
  const s = analyze(lines('function f(ready, next) {', '  for (; ready; ready || next()) {', '    work();', '  }', '}'));
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.condition}`), ['loop:ready', 'or:next()']);
});

test('for loop includes a nullish operand from its increment', () => {
  const s = analyze(lines('function f(ready, next) {', '  for (; ready; ready ?? next()) {', '    work();', '  }', '}'));
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.outcome}`), ['loop:is true at least once', 'or:is used when the part before it is null']);
});

test('for loop includes a ternary decision from its increment', () => {
  const s = analyze(lines('function f(ready, a, b) {', '  for (; ready; ready ? a() : b()) {', '    work();', '  }', '}'));
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.condition}`), ['loop:ready', 'ternary:ready']);
});

test('for loop omits condition operands when short circuits are disabled', () => {
  const s = analyze(lines('function f(a, b) {', '  for (; a && b;) {', '    work();', '  }', '}'), { countShortCircuit: false });
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.condition}`), ['loop:a && b']);
  assert.equal(s.depth.get(3), 1);
});

test('for loop omits increment ternaries when ternary counting is disabled', () => {
  const s = analyze(lines('function f(ready, a, b) {', '  for (; ready; ready ? a() : b()) {', '    work();', '  }', '}'), { countTernary: false });
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.condition}`), ['loop:ready']);
  assert.equal(s.depth.get(3), 1);
});

test('while loop reports a simple identifier condition', () => {
  const s = analyze(lines('function f(ready) {', '  while (ready) {', '    work();', '  }', '}'));
  assert.deepEqual(s.routes.get(2), [{ line: 2, kind: 'loop', condition: 'ready', outcome: 'is true at least once' }]);
});

test('while loop removes nested parentheses from its displayed condition', () => {
  const s = analyze(lines('function f(ready) {', '  while ((((ready)))) {', '    work();', '  }', '}'));
  assert.deepEqual(s.routes.get(3)?.map((step) => step.condition), ['ready']);
});

test('while loop reports a negated condition', () => {
  const s = analyze(lines('function f(done) {', '  while (!done) {', '    work();', '  }', '}'));
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.condition}:${step.outcome}`), ['loop:!done:is true at least once']);
});

test('while loop reports a comparison condition', () => {
  const s = analyze(lines('function f(index, length) {', '  while (index < length) {', '    index++;', '  }', '}'));
  assert.deepEqual(s.routes.get(2)?.map((step) => step.condition), ['index < length']);
  assert.equal(s.depth.get(3), 1);
});

test('while loop reports a call condition', () => {
  const s = analyze(lines('function f(ready) {', '  while (ready()) {', '    work();', '  }', '}'));
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.condition}`), ['loop:ready()']);
});

test('while loop separates an and condition into its leftmost test and operand', () => {
  const s = analyze(lines('function f(a, b) {', '  while (a && b) {', '    work();', '  }', '}'));
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.condition}`), ['loop:a', 'and:b']);
  assert.equal(s.depth.get(3), 2);
});

test('while loop separates an or condition into its leftmost test and operand', () => {
  const s = analyze(lines('function f(a, b) {', '  while (a || b) {', '    work();', '  }', '}'));
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.condition}:${step.outcome}`), ['loop:a:is true at least once', 'or:b:is true when the part before it is false']);
});

test('while loop separates a nullish condition into its leftmost test and operand', () => {
  const s = analyze(lines('function f(a, b) {', '  while (a ?? b) {', '    work();', '  }', '}'));
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.condition}:${step.outcome}`), ['loop:a:is true at least once', 'or:b:is used when the part before it is null']);
});

test('while loop includes a ternary decision from its condition', () => {
  const s = analyze(lines('function f(a, b, c) {', '  while (a ? b : c) {', '    work();', '  }', '}'));
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.condition}`), ['loop:a ? b : c', 'ternary:a']);
});

test('while loop preserves mixed condition operands in source order', () => {
  const s = analyze(lines('function f(a, b, c) {', '  while (a && b || c) {', '    work();', '  }', '}'));
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.condition}`), ['loop:a', 'and:b', 'or:c']);
  assert.equal(s.depth.get(3), 3);
});

test('while loop preserves a chain of and operands in source order', () => {
  const s = analyze(lines('function f(a, b, c) {', '  while (a && b && c) {', '    work();', '  }', '}'));
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.condition}`), ['loop:a', 'and:b', 'and:c']);
});

test('while loop preserves a chain of or operands in source order', () => {
  const s = analyze(lines('function f(a, b, c) {', '  while (a || b || c) {', '    work();', '  }', '}'));
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.condition}`), ['loop:a', 'or:b', 'or:c']);
});

test('while loop keeps the full condition when short circuits are disabled', () => {
  const s = analyze(lines('function f(a, b) {', '  while (a && b) {', '    work();', '  }', '}'), { countShortCircuit: false });
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.condition}`), ['loop:a && b']);
  assert.equal(s.depth.get(3), 1);
});

test('while loop omits its ternary step when ternary counting is disabled', () => {
  const s = analyze(lines('function f(a, b, c) {', '  while (a ? b : c) {', '    work();', '  }', '}'), { countTernary: false });
  assert.deepEqual(s.routes.get(2)?.map((step) => `${step.kind}:${step.condition}`), ['loop:a ? b : c']);
  assert.equal(s.depth.get(3), 1);
});

test('switch: k-th case costs k, default costs the number of cases above it', () => {
  const s = analyze(lines('function f(v) {', '  switch (v) {', '    case 1:', '      a();', '      break;', '    case 2: {', '      b();', '      break;', '    }', '    default:', '      c();', '  }', '}'));
  assert.equal(s.depth.get(4), 1);
  assert.equal(s.depth.get(7), 2);
  assert.equal(s.depth.get(11), 2);
  assert.deepEqual(s.routes.get(11)?.map((st) => `${st.condition}:${st.outcome}`), ['v is 1:is false', 'v is 2:is false']);
  assert.deepEqual(s.routes.get(7)?.map((st) => `${st.condition}:${st.outcome}`), ['v is 1:is false', 'v is 2:is true']);
});

test.each([
  ['line comment before the first case', ['    // choose one', '    case 1:', '      hit();'], 1, ['v is 1:is true']],
  ['block comment before the first case', ['    /* choose one */', '    case 1:', '      hit();'], 1, ['v is 1:is true']],
  ['multiline comment before the first case', ['    /* choose', '       one */', '    case 1:', '      hit();'], 1, ['v is 1:is true']],
  ['JSDoc comment before the first case', ['    /** choose one */', '    case 1:', '      hit();'], 1, ['v is 1:is true']],
  ['todo comment before the first case', ['    // TODO: choose one', '    case 1:', '      hit();'], 1, ['v is 1:is true']],
  ['empty line comment before the first case', ['    //', '    case 1:', '      hit();'], 1, ['v is 1:is true']],
  ['empty block comment before the first case', ['    /**/', '    case 1:', '      hit();'], 1, ['v is 1:is true']],
  ['line comment between cases', ['    case 1: break;', '    // try the next case', '    case 2:', '      hit();'], 2, ['v is 1:is false', 'v is 2:is true']],
  ['block comment between cases', ['    case 1: break;', '    /* try the next case */', '    case 2:', '      hit();'], 2, ['v is 1:is false', 'v is 2:is true']],
  ['multiline comment between cases', ['    case 1: break;', '    /* try', '       the next case */', '    case 2:', '      hit();'], 2, ['v is 1:is false', 'v is 2:is true']],
  ['JSDoc comment between cases', ['    case 1: break;', '    /** try the next case */', '    case 2:', '      hit();'], 2, ['v is 1:is false', 'v is 2:is true']],
  ['line comment before default', ['    case 1: break;', '    // otherwise', '    default:', '      hit();'], 1, ['v is 1:is false']],
  ['block comment before default', ['    case 1: break;', '    /* otherwise */', '    default:', '      hit();'], 1, ['v is 1:is false']],
  ['multiline comment before default', ['    case 1: break;', '    /* or', '       otherwise */', '    default:', '      hit();'], 1, ['v is 1:is false']],
  ['JSDoc comment before default', ['    case 1: break;', '    /** otherwise */', '    default:', '      hit();'], 1, ['v is 1:is false']],
  ['line comment after an empty case', ['    case 1:', '    // fall through', '    case 2:', '      hit();'], 2, ['v is 1:is false', 'v is 2:is true']],
  ['block comment after an empty case', ['    case 1:', '    /* fall through */', '    default:', '      hit();'], 1, ['v is 1:is false']],
])('switch ignores non-clause named children: %s', (_name, body, expectedDepth, expectedRoute) => {
  const source = lines('function f(v) {', '  switch (v) {', ...body, '  }', '}');
  const hitLine = source.split('\n').findIndex((line) => line.includes('hit();')) + 1;
  const s = analyze(source);
  assert.equal(s.depth.get(hitLine), expectedDepth);
  assert.deepEqual(s.routes.get(hitLine)?.map((step) => `${step.condition}:${step.outcome}`), expectedRoute);
});

test('try/catch/finally: catch costs one, finally is free, and the flag turns catch off', () => {
  const src = lines('function f() {', '  try {', '    a();', '  } catch (e) {', '    b();', '  } finally {', '    c();', '  }', '}');
  assert.deepEqual(depths(src), { 1: 0, 2: 0, 3: 0, 4: 1, 5: 1, 6: 0, 7: 0 });
  assert.deepEqual(depths(src, { countExcept: false }), { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 });
  assert.deepEqual(analyze(src).routes.get(5)?.map((st) => `${st.kind}:${st.condition}:${st.outcome}`), ['except:e:is thrown inside the try']);
});

test('nested functions and arrows restart depth; a one-line arrow body is scored, not declared', () => {
  const src = lines('export const add = (a, b) => a + b;', 'export const pick = (a, b) => a || b;', 'function outer(x) {', '  if (x) {', '    const inner = (y) => {', '      if (y) return 1;', '      return 0;', '    };', '    return inner;', '  }', '}');
  const s = analyze(src);
  assert.equal(s.declarations.has(1), false, 'one-line arrow is scored');
  assert.equal(s.depth.get(1), 0);
  assert.equal(s.depth.get(2), 1, 'the || inside the arrow body counts on its line');
  assert.equal(s.declarations.has(3), true);
  assert.equal(s.depth.get(5), 1);
  assert.equal(s.depth.get(6), 1);
  assert.equal(s.depth.get(7), 0);
  assert.equal(s.depth.get(9), 1);
  assert.deepEqual(s.functions.map((fn) => [fn.name, fn.complexity]), [['add', 1], ['pick', 2], ['outer', 2], ['inner', 2]]);
});

test('classes: methods and fields are declarations, method bodies are scored', () => {
  const s = analyze(lines('class C {', '  count = 0;', '  bump(n) {', '    if (n > 0) {', '      this.count += n;', '    }', '  }', '  one() { return 1; }', '}', 'const c = new C();'));
  assert.deepEqual(Array.from(s.declarations).sort((a, b) => a - b), [1, 2, 3, 10]);
  assert.equal(s.depth.get(5), 1);
  assert.equal(s.declarations.has(8), false, 'one-line method body is scored on the def line');
  assert.equal(s.depth.get(8), 0);
  assert.deepEqual(s.functions.map((fn) => fn.name), ['bump', 'one']);
});

test('unreachable: after return/throw/break/continue, and after if/else, try/catch, switch with default that all return', () => {
  const src = lines(
    'function a(x) {',
    '  if (x) {',
    '    return 1;',
    '  } else {',
    '    throw new Error();',
    '  }',
    '  dead1();',
    '}',
    'function b() {',
    '  try {',
    '    return 1;',
    '  } catch (e) {',
    '    return 2;',
    '  }',
    '  dead2();',
    '}',
    'function c(v) {',
    '  switch (v) {',
    '    case 1: return 1;',
    '    default: return 0;',
    '  }',
    '  dead3();',
    '}',
    'function d(xs) {',
    '  for (const x of xs) {',
    '    continue;',
    '    dead4();',
    '  }',
    '  live();',
    '}',
  );
  const s = analyze(src);
  assert.deepEqual(Array.from(s.unreachable).sort((a, b) => a - b), [7, 15, 22, 27]);
});

test('reachable: if without else, switch without default, switch whose case breaks', () => {
  const src = lines(
    'function a(x) {',
    '  if (x) { return 1; }',
    '  live1();',
    '  switch (x) { case 1: return 1; }',
    '  live2();',
    '  switch (x) { case 1: break; default: return 0; }',
    '  live3();',
    '}',
  );
  assert.deepEqual(Array.from(analyze(src).unreachable), []);
});

test('routes: else-if chain and operands in source order', () => {
  const s = analyze(lines('function f(a, b, c) {', '  if (a && b) {', '    x();', '  } else if (c) {', '    y();', '  } else {', '    z();', '  }', '}'));
  const show = (line: number) => s.routes.get(line)?.map((st) => `${st.kind}:${st.condition}:${st.outcome}`);
  assert.deepEqual(show(3), ['if:a:is true', 'and:b:is also true']);
  assert.deepEqual(show(5), ['if:a && b:is false', 'elif:c:is true']);
  assert.deepEqual(show(7), ['if:a && b:is false', 'elif:c:is false']);
});

test('depth always equals route length', () => {
  const s = analyze(lines('function f(a, b, xs) {', '  if (a && b) {', '    for (const x of xs) {', '      const y = x ? 1 : 2;', '    }', '  } else if (a) {', '    a();', '  } else {', '    b();', '  }', '  switch (a) { case 1: return 1; default: return 2; }', '}'));
  for (const [line, depth] of s.depth) {
    assert.equal(s.routes.get(line)?.length ?? 0, depth, `line ${line}`);
  }
});

test('plain JavaScript parses with the JavaScript grammar and the same rules', () => {
  const d = depths(lines('function f(x) {', '  if (x) {', '    return 1;', '  }', '  return 0;', '}', 'module.exports = { f };'), {}, js);
  assert.deepEqual(d, { 1: 0, 2: 1, 3: 1, 5: 0, 7: 0 });
  assert.equal(analyze(lines('const a = 1;'), {}, js).declarations.has(1), true);
});

test('empty file produces nothing', () => {
  const s = analyze('');
  assert.equal(s.depth.size, 0);
  assert.equal(s.functions.length, 0);
});

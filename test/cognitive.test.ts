/**
 * Cognitive Complexity, checked against the rules and worked examples in
 * Campbell, "Cognitive Complexity: A New Way of Measuring Understandability",
 * SonarSource, 2018, and against MikeVan's Better Cognitive Complexity
 * (MBCC), the ordered-operand rule from the RefactorIt spec. Each test names the rule it pins down.
 */
import { beforeAll, test } from 'vitest';
import assert from 'node:assert/strict';
import type { Parser } from 'web-tree-sitter';
import { createParser, initTreeSitter, repoWasmDir } from '../src/languages/shared/treeSitter';
import { analyzePythonTree } from '../src/languages/python/structure';
import { analyzeTypeScriptTree } from '../src/languages/typescript/structure';
import { functionsInRecursionCycles } from '../src/languages/shared/cognitive';

let py: Parser;
let ts: Parser;

beforeAll(async () => {
  const dir = repoWasmDir();
  await initTreeSitter(`${dir}/web-tree-sitter.wasm`);
  py = await createParser(`${dir}/tree-sitter-python.wasm`);
  ts = await createParser(`${dir}/tree-sitter-typescript.wasm`);
});

/** [cyclomatic, cognitive, cognitiveOrdered] for the named function, or the first one. */
function pyScore(source: string, name?: string): [number, number, number] {
  const tree = py.parse(source);
  assert.ok(tree, 'parse failed');
  const s = analyzePythonTree('x.py', tree);
  const fn = name ? s.functions.find((f) => f.name === name) : s.functions[0];
  assert.ok(fn, `function ${name ?? '#0'} not found`);
  return [fn.complexity, fn.cognitive, fn.cognitiveOrdered];
}

function tsScore(source: string, name?: string): [number, number, number] {
  const tree = ts.parse(source);
  assert.ok(tree, 'parse failed');
  const s = analyzeTypeScriptTree('x.ts', tree);
  const fn = name ? s.functions.find((f) => f.name === name) : s.functions[0];
  assert.ok(fn, `function ${name ?? '#0'} not found`);
  return [fn.complexity, fn.cognitive, fn.cognitiveOrdered];
}

// ---- Python -------------------------------------------------------------

test('py: a straight-line function scores 0, however long it is', () => {
  const body = Array.from({ length: 40 }, (_, i) => `    self.f${i} = x${i}`).join('\n');
  assert.deepEqual(pyScore(`def f(self, ${Array.from({ length: 40 }, (_, i) => `x${i}`).join(', ')}):\n${body}\n`), [1, 0, 0]);
});

test('py: one if is +1; a second if nested inside it is +2', () => {
  assert.deepEqual(pyScore('def f(a, b):\n    if a:\n        return 1\n    return 0\n'), [2, 1, 1]);
  assert.deepEqual(pyScore('def f(a, b):\n    if a:\n        if b:\n            return 1\n    return 0\n'), [3, 3, 3]);
});

test('py: elif and else are +1 each with no nesting charge, but their bodies are one level deeper', () => {
  // if +1, elif +1, else +1; the nested if inside else is +1 + 1 nesting = +2. Total 5.
  const src = 'def f(a, b, c):\n    if a:\n        return 1\n    elif b:\n        return 2\n    else:\n        if c:\n            return 3\n    return 0\n';
  assert.deepEqual(pyScore(src), [4, 5, 5]);
});

test('py: a flat match with many cases costs 1; cyclomatic charges every case', () => {
  const cases = Array.from({ length: 12 }, (_, i) => `        case ${i}:\n            return ${i}`).join('\n');
  const src = `def f(x):\n    match x:\n${cases}\n    return -1\n`;
  assert.deepEqual(pyScore(src), [13, 1, 1]);
});

test('py: loops are structural, and a loop else is hybrid', () => {
  // for +1, while nested +2, for-else +1. Total 4.
  const src = 'def f(xs):\n    for x in xs:\n        while x:\n            x -= 1\n    else:\n        return 0\n    return 1\n';
  assert.deepEqual(pyScore(src), [3, 4, 4]);
});

test('py: try costs nothing, except is structural, finally and else cost nothing', () => {
  // except +1, the if inside it +2. Total 3.
  const src = 'def f():\n    try:\n        g()\n    except ValueError as e:\n        if e:\n            raise\n    else:\n        h()\n    finally:\n        k()\n';
  assert.deepEqual(pyScore(src), [3, 3, 3]);
});

test('py: whitepaper boolean runs: a and b and c is +1; a and b or c is +2', () => {
  assert.deepEqual(pyScore('def f(a, b, c):\n    return a and b and c\n'), [3, 1, 1]);
  assert.deepEqual(pyScore('def f(a, b, c):\n    return a and b or c\n'), [3, 2, 2]);
  // The whitepaper example: a && b && c || d || e && f is three sequences.
  assert.deepEqual(pyScore('def f(a, b, c, d, e, g):\n    return a and b and c or d or e and g\n'), [6, 3, 3]);
});

test('py: parentheses and not start a fresh sequence', () => {
  // a and (b or c): one and-run, one or-run inside. Published 2.
  assert.deepEqual(pyScore('def f(a, b, c):\n    return a and (b or c)\n'), [3, 2, 2]);
  assert.deepEqual(pyScore('def f(a, b, c):\n    return a and not (b or c)\n'), [3, 2, 2]);
});

test('py: MBCC: independent pure operands still cost one', () => {
  assert.deepEqual(pyScore('def f(a, b, c):\n    if a > 0 and b > 0 and c > 0:\n        return 1\n    return 0\n'), [4, 2, 2]);
});

test('py: MBCC: a later operand reaching into a name an earlier one tested costs one per operand', () => {
  // member is not None and member.dues is not None and member.dues.paid > cutoff
  // published: if +1, one run +1 = 2. ordered: if +1, three operands +3 = 4.
  const src = 'def f(member, cutoff):\n    if member is not None and member.dues is not None and member.dues.paid > cutoff:\n        return 1\n    return 0\n';
  assert.deepEqual(pyScore(src), [4, 2, 4]);
});

test('py: MBCC: a call anywhere in the run makes it ordered', () => {
  const src = 'def f(xs):\n    if xs and len(xs) > 3:\n        return 1\n    return 0\n';
  assert.deepEqual(pyScore(src), [3, 2, 3]);
});

test('py: MBCC: a walrus makes it ordered', () => {
  const src = 'def f(xs):\n    if xs and (n := count(xs)):\n        return n\n    return 0\n';
  assert.deepEqual(pyScore(src), [3, 2, 3]);
});

test('py: MBCC applies per run, not per expression', () => {
  // (m and m.x) or flag: the and-run is ordered (2), the or-run is independent (1). Published 2, ordered 3.
  const src = 'def f(m, flag):\n    return (m and m.x) or flag\n';
  assert.deepEqual(pyScore(src), [3, 2, 3]);
});

test('py: ternary is structural, and nests', () => {
  // outer ternary +1, inner ternary +2. Total 3.
  assert.deepEqual(pyScore('def f(a, b):\n    return 1 if a else (2 if b else 3)\n'), [3, 3, 3]);
});

test('py: a lambda or nested def adds nesting but no increment', () => {
  // if inside a lambda: +1 for the if... a ternary at nesting 1 = +2. Nothing for the lambda.
  assert.deepEqual(pyScore('def f(xs):\n    return sorted(xs, key=lambda x: 1 if x else 0)\n', 'f'), [2, 2, 2]);
  // nested def: the inner if is one level deeper, +2. The inner function is also scored on its own at +1.
  const src = 'def outer(a):\n    def inner(b):\n        if b:\n            return 1\n        return 0\n    return inner(a)\n';
  assert.deepEqual(pyScore(src, 'outer'), [1, 2, 2]);
  assert.deepEqual(pyScore(src, 'inner'), [2, 1, 1]);
});

test('py: comprehensions cost nothing here, while cyclomatic counts each clause', () => {
  assert.deepEqual(pyScore('def f(xs):\n    return [x for x in xs if x]\n'), [3, 0, 0]);
});

test('py: recursion is +1 per function on a cycle, direct or mutual, by name', () => {
  assert.deepEqual(pyScore('def fact(n):\n    if n < 2:\n        return 1\n    return n * fact(n - 1)\n'), [2, 2, 2]);
  const mutual = 'def even(n):\n    return n == 0 or odd(n - 1)\n\ndef odd(n):\n    return n != 0 and even(n - 1)\n\ndef alone(n):\n    return even(n)\n';
  // even: or-run +1 (ordered: has a call, so 2), recursion +1. odd: the same. alone: nothing.
  assert.deepEqual(pyScore(mutual, 'even'), [2, 2, 3]);
  assert.deepEqual(pyScore(mutual, 'odd'), [2, 2, 3]);
  assert.deepEqual(pyScore(mutual, 'alone'), [1, 0, 0]);
  assert.deepEqual(pyScore('class C:\n    def walk(self, n):\n        if n:\n            self.walk(n - 1)\n', 'walk'), [2, 2, 2]);
});

test('py: the whitepaper-style deep nest charges more the deeper it goes', () => {
  // if +1, for +2, if +3, and-run +1 = 7. Cyclomatic is 5.
  const src = 'def f(xs, a, b):\n    if a:\n        for x in xs:\n            if x and b:\n                return x\n    return None\n';
  assert.deepEqual(pyScore(src), [5, 7, 7]);
});

// ---- TypeScript / JavaScript -------------------------------------------

test('ts: a straight-line function scores 0', () => {
  assert.deepEqual(tsScore('function f(a: number) {\n  const b = a + 1;\n  return b;\n}\n'), [1, 0, 0]);
});

test('ts: else if and else are hybrid; nesting starts inside them', () => {
  // if +1, else if +1, else +1, nested if inside else +2. Total 5.
  const src = 'function f(a, b, c) {\n  if (a) { return 1; }\n  else if (b) { return 2; }\n  else { if (c) { return 3; } }\n  return 0;\n}\n';
  assert.deepEqual(tsScore(src), [4, 5, 5]);
});

test('ts: a flat switch costs 1 whatever the number of cases', () => {
  const cases = Array.from({ length: 12 }, (_, i) => `    case ${i}: return ${i};`).join('\n');
  const src = `function f(x) {\n  switch (x) {\n${cases}\n    default: return -1;\n  }\n}\n`;
  assert.deepEqual(tsScore(src), [13, 1, 1]);
});

test('ts: loops, catch, ternary, and labeled jumps', () => {
  // for +1, while +2, catch +1, ternary in catch body +2 = 6.
  const src = 'function f(xs) {\n  for (const x of xs) {\n    while (x) { x--; }\n  }\n  try { g(); } catch (e) { return e ? 1 : 0; } finally { h(); }\n}\n';
  assert.deepEqual(tsScore(src), [5, 6, 6]);
  // labeled continue is +1, plain break is nothing. outer for +1, inner for +2, if +3, continue LABEL +1 = 7.
  const labeled = 'function f(m) {\n  outer: for (const a of m) {\n    for (const b of a) {\n      if (b) { continue outer; }\n      break;\n    }\n  }\n}\n';
  assert.deepEqual(tsScore(labeled), [4, 7, 7]);
});

test('ts: whitepaper boolean runs, and ?? costs nothing', () => {
  assert.deepEqual(tsScore('function f(a, b, c, d, e, g) {\n  return a && b && c || d || e && g;\n}\n'), [6, 3, 3]);
  assert.deepEqual(tsScore('function f(a, b) {\n  return a ?? b;\n}\n'), [2, 0, 0]);
  assert.deepEqual(tsScore('function f(a, b, c) {\n  return a && !(b || c);\n}\n'), [3, 2, 2]);
});

test('ts: MBCC with this-rooted member access and calls', () => {
  // pure independent: published 1, ordered 1
  assert.deepEqual(tsScore('function f(a, b, c) {\n  return a > 0 && b > 0 && c > 0;\n}\n'), [3, 1, 1]);
  // user && user.profile && user.profile.name: ordered 3
  assert.deepEqual(tsScore('function f(user) {\n  return user && user.profile && user.profile.name;\n}\n'), [3, 1, 3]);
  // call inside: ordered
  assert.deepEqual(tsScore('function f(xs) {\n  return xs && xs.length > 0 && check(xs);\n}\n'), [3, 1, 3]);
  // this.x && this.x.y inside a method
  assert.deepEqual(tsScore('class C {\n  ok() {\n    return this.x && this.x.y;\n  }\n}\n', 'ok'), [2, 1, 2]);
});

test('ts: arrows add nesting but no increment; expression-bodied arrow with a ternary', () => {
  // ternary inside the arrow: nesting 1, so +2. The arrow itself is also its own function scoring +1.
  const src = 'function f(xs) {\n  return xs.map((x) => x ? 1 : 0);\n}\n';
  assert.deepEqual(tsScore(src, 'f'), [1, 2, 2]);
});

test('ts: recursion by name, direct and through this', () => {
  assert.deepEqual(tsScore('function fact(n) {\n  if (n < 2) { return 1; }\n  return n * fact(n - 1);\n}\n'), [2, 2, 2]);
  assert.deepEqual(tsScore('class T {\n  walk(n) {\n    if (n) { this.walk(n - 1); }\n  }\n}\n', 'walk'), [2, 2, 2]);
});

// ---- Shared -------------------------------------------------------------

test('recursion cycles: self loops and mutual cycles, not mere callers', () => {
  const calls = new Map<string, Set<string>>([
    ['a', new Set(['b'])],
    ['b', new Set(['a'])],
    ['c', new Set(['a'])],
    ['d', new Set(['d'])],
    ['e', new Set(['missing'])],
  ]);
  assert.deepEqual(Array.from(functionsInRecursionCycles(calls)).sort(), ['a', 'b', 'd']);
});

import { beforeAll, test } from 'vitest';
import assert from 'node:assert/strict';
import type { Parser } from 'web-tree-sitter';
import { createParser, initTreeSitter, repoWasmDir } from '../src/languages/shared/treeSitter';
import { analyzePythonTree, DEFAULT_DEPTH_OPTIONS, DepthOptions } from '../src/languages/python/structure';

let parser: Parser;

beforeAll(async () => {
  const dir = repoWasmDir();
  await initTreeSitter(`${dir}/web-tree-sitter.wasm`);
  parser = await createParser(`${dir}/tree-sitter-python.wasm`);
});

function analyze(source: string, options: Partial<DepthOptions> = {}) {
  const tree = parser.parse(source);
  assert.ok(tree, 'parse failed');
  return analyzePythonTree('x.py', tree, { ...DEFAULT_DEPTH_OPTIONS, ...options });
}

function depths(source: string, options: Partial<DepthOptions> = {}): Record<number, number> {
  const s = analyze(source, options);
  const out: Record<number, number> = {};
  for (const [line, depth] of Array.from(s.depth.entries()).sort((a, b) => a[0] - b[0])) {
    out[line] = depth;
  }
  return out;
}

test('straight-line function body has depth 0 and the def line is a declaration', () => {
  const s = analyze('def f(x):\n    y = x + 1\n    return y\n');
  assert.deepEqual(Array.from(s.declarations), [1]);
  assert.equal(s.depth.get(1), 0);
  assert.equal(s.depth.get(2), 0);
  assert.equal(s.depth.get(3), 0);
  assert.deepEqual(s.functions, [{ name: 'f', startLine: 1, endLine: 3, complexity: 1 }]);
});

test('if: the if line and its body share one decision; else is the other half', () => {
  const d = depths('def f(x):\n    if x:\n        a()\n    else:\n        b()\n    c()\n');
  assert.deepEqual(d, { 1: 0, 2: 1, 3: 1, 4: 1, 5: 1, 6: 0 });
});

test('elif chain accumulates decisions; else after the chain carries all of them', () => {
  const d = depths('def f(x):\n    if x == 1:\n        a()\n    elif x == 2:\n        b()\n    elif x == 3:\n        c()\n    else:\n        d()\n');
  assert.deepEqual(d, { 1: 0, 2: 1, 3: 1, 4: 2, 5: 2, 6: 3, 7: 3, 8: 3, 9: 3 });
});

test('nested ifs add up', () => {
  const d = depths('def f(x, y):\n    if x:\n        if y:\n            deep()\n');
  assert.deepEqual(d, { 1: 0, 2: 1, 3: 2, 4: 2 });
});

test('short circuits: each and/or adds a decision to the line and to the body', () => {
  const src = 'def f(a, b, c):\n    if a and b or c:\n        go()\n';
  assert.deepEqual(depths(src), { 1: 0, 2: 3, 3: 3 });
  assert.deepEqual(depths(src, { countShortCircuit: false }), { 1: 0, 2: 1, 3: 1 });
});

test('ternary and comprehension clauses count on their own line', () => {
  const src = 'def f(xs, c):\n    y = 1 if c else 2\n    z = [x for x in xs if x]\n    return y\n';
  assert.deepEqual(depths(src), { 1: 0, 2: 1, 3: 2, 4: 0 });
  assert.deepEqual(depths(src, { countTernary: false, countComprehensions: false }), { 1: 0, 2: 0, 3: 0, 4: 0 });
});

test('for and while loops are one decision; loop else shares it', () => {
  const d = depths('def f(xs):\n    for x in xs:\n        a(x)\n    else:\n        b()\n    while xs and True:\n        c()\n');
  assert.deepEqual(d, { 1: 0, 2: 1, 3: 1, 4: 1, 5: 1, 6: 2, 7: 2 });
});

test('try/except: try body is free, k-th except costs k, finally is free', () => {
  const src = 'def f():\n    try:\n        a()\n    except ValueError:\n        b()\n    except KeyError:\n        c()\n    else:\n        d()\n    finally:\n        e()\n';
  assert.deepEqual(depths(src), { 1: 0, 2: 0, 3: 0, 4: 1, 5: 1, 6: 2, 7: 2, 8: 0, 9: 0, 10: 0, 11: 0 });
  assert.deepEqual(depths(src, { countExcept: false }), { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0 });
});

test('match: k-th case costs k, a guard adds its decisions', () => {
  const d = depths('def f(v, g):\n    match v:\n        case 1:\n            a()\n        case 2 if g and g > 1:\n            b()\n        case _:\n            c()\n');
  assert.deepEqual(d, { 1: 0, 2: 0, 3: 1, 4: 1, 5: 4, 6: 4, 7: 3, 8: 3 });
});

test('with: body is free unless the header has decisions', () => {
  const d = depths('def f(a, b):\n    with open(a or b) as fh:\n        fh.read()\n');
  assert.deepEqual(d, { 1: 0, 2: 1, 3: 1 });
});

test('module-level with is recorded as a declaration', () => {
  const s = analyze('with open("x") as fh:\n    value = fh.read()\n');
  assert.equal(s.declarations.has(1), true);
  assert.equal(s.depth.get(1), 0);
});

test('with in a class body is recorded as a declaration', () => {
  const s = analyze('class Resource:\n    with open("x") as fh:\n        value = fh.read()\n');
  assert.equal(s.declarations.has(2), true);
  assert.deepEqual(s.routes.get(2), []);
});

test('with in a function body is not recorded as a declaration', () => {
  const s = analyze('def read(path):\n    with open(path) as fh:\n        return fh.read()\n');
  assert.equal(s.declarations.has(2), false);
  assert.equal(s.depth.get(2), 0);
});

test('with nested under an if keeps the enclosing route without becoming a declaration', () => {
  const s = analyze('def read(enabled, path):\n    if enabled:\n        with open(path) as fh:\n            return fh.read()\n');
  assert.equal(s.declarations.has(3), false);
  assert.deepEqual(s.routes.get(3)?.map((step) => step.kind), ['if']);
});

test('with nested in a loop keeps the loop route without becoming a declaration', () => {
  const s = analyze('def read_all(paths):\n    for path in paths:\n        with open(path) as fh:\n            consume(fh.read())\n');
  assert.equal(s.declarations.has(3), false);
  assert.deepEqual(s.routes.get(3)?.map((step) => step.kind), ['loop']);
});

test('depth resets inside a nested function', () => {
  const d = depths('def outer(x):\n    if x:\n        def inner(y):\n            if y:\n                return 1\n            return 0\n        return inner\n');
  assert.deepEqual(d, { 1: 0, 2: 1, 3: 1, 4: 1, 5: 1, 6: 0, 7: 1 });
});

test('unreachable: statements after return, raise, break, continue in the same block', () => {
  const s = analyze(
    'def f(xs):\n    for x in xs:\n        if x:\n            continue\n            dead1()\n        break\n        dead2()\n    return 1\n    if xs:\n        dead3()\n    else:\n        dead4()\n',
  );
  assert.deepEqual(Array.from(s.unreachable).sort((a, b) => a - b), [5, 7, 9, 10, 11, 12]);
});

test('unreachable: code after an if/else, try/except, with, or match whose every path returns', () => {
  const src = [
    'def a(x):',
    '    if x:',
    '        return 1',
    '    elif x is None:',
    '        raise ValueError()',
    '    else:',
    '        return 2',
    '    dead_a()',
    'def b():',
    '    try:',
    '        return 1',
    '    except E:',
    '        return None',
    '    dead_b()',
    'def c(fh):',
    '    with fh:',
    '        return fh.read()',
    '    dead_c()',
    'def d(v):',
    '    match v:',
    '        case 1:',
    '            return 1',
    '        case _:',
    '            return 0',
    '    dead_d()',
    'def e():',
    '    try:',
    '        pass',
    '    finally:',
    '        return 1',
    '    dead_e()',
    '',
  ].join('\n');
  const s = analyze(src);
  assert.deepEqual(Array.from(s.unreachable).sort((a, b) => a - b), [8, 14, 18, 25, 31]);
});

test('reachable: if without else, try whose handler falls through, loops, match without wildcard', () => {
  const src = [
    'def a(x):',
    '    if x:',
    '        return 1',
    '    live_a()',
    'def b():',
    '    try:',
    '        return 1',
    '    except E:',
    '        log()',
    '    live_b()',
    'def c(xs):',
    '    for x in xs:',
    '        return x',
    '    while True:',
    '        return 1',
    '    live_c()',
    'def d(v):',
    '    match v:',
    '        case 1:',
    '            return 1',
    '        case 2 if v:',
    '            return 2',
    '    live_d()',
    'def e():',
    '    try:',
    '        pass',
    '    except E:',
    '        return 1',
    '    else:',
    '        log()',
    '    live_e()',
    'def f():',
    '    try:',
    '        go()',
    '    except E:',
    '        return 1',
    '    else:',
    '        pass',
    '    live_f()',
    '',
  ].join('\n');
  const s = analyze(src);
  assert.deepEqual(Array.from(s.unreachable), []);
});

test('raise ends a block too', () => {
  const s = analyze('def f():\n    raise ValueError()\n    print(1)\n');
  assert.deepEqual(Array.from(s.unreachable), [3]);
});

test('module-level code, class bodies, method defs, and decorators are declarations', () => {
  const src = 'import os\nX = 1\n\nclass C:\n    attr = 2\n\n    @property\n    def m(self):\n        return self.attr\n\ndef f():\n    pass\n\nif __name__ == "__main__":\n    f()\n';
  const s = analyze(src);
  assert.deepEqual(Array.from(s.declarations).sort((a, b) => a - b), [1, 2, 4, 5, 7, 8, 11, 14, 15]);
  assert.equal(s.depth.get(9), 0);
  assert.equal(s.depth.get(12), 0);
  assert.equal(s.depth.get(15), 1);
  assert.deepEqual(s.functions.map((fn) => fn.name), ['m', 'f']);
});

test('cyclomatic complexity counts every branch point, ignores nested functions, and ignores depth flags', () => {
  const src = [
    'def big(a, b, xs):',
    '    if a and b:',
    '        pass',
    '    elif a or b:',
    '        pass',
    '    for x in xs:',
    '        while x:',
    '            x -= 1',
    '    try:',
    '        pass',
    '    except A:',
    '        pass',
    '    except B:',
    '        pass',
    '    y = 1 if a else 2',
    '    z = [i for i in xs if i]',
    '    match a:',
    '        case 1:',
    '            pass',
    '        case 2:',
    '            pass',
    '    def inner(q):',
    '        if q:',
    '            return 1',
    '        return 0',
    '    return inner',
    '',
  ].join('\n');
  const s = analyze(src, { countShortCircuit: false, countTernary: false, countComprehensions: false, countExcept: false });
  const big = s.functions.find((fn) => fn.name === 'big');
  const inner = s.functions.find((fn) => fn.name === 'inner');
  // 1 + if + and + elif + or + for + while + except + except + ternary + for_in + if_clause + case + case = 14
  assert.equal(big?.complexity, 14);
  assert.equal(inner?.complexity, 2);
  assert.equal(big?.startLine, 1);
  assert.equal(big?.endLine, 26);
});

test('a compound statement on one line keeps the larger depth for that line', () => {
  const d = depths('def f(x):\n    if x: return 1\n    return 0\n');
  assert.deepEqual(d, { 1: 0, 2: 1, 3: 0 });
});

test('multi-line statements are keyed by their first line', () => {
  const d = depths('def f(a, b):\n    if (a and\n            b):\n        go()\n    total = sum([\n        1, 2])\n');
  assert.deepEqual(d, { 1: 0, 2: 2, 4: 2, 5: 0 });
});

test('async for and async with are scored like their sync forms', () => {
  const d = depths('async def f(xs):\n    async for x in xs:\n        await x\n    async with xs as y:\n        await y\n');
  assert.deepEqual(d, { 1: 0, 2: 1, 3: 1, 4: 0, 5: 0 });
});

test('a lambda on a line contributes its decisions to that line', () => {
  const d = depths('def f():\n    g = lambda a, b: a and b\n    return g\n');
  assert.deepEqual(d, { 1: 0, 2: 1, 3: 0 });
});

test('empty file produces nothing', () => {
  const s = analyze('');
  assert.equal(s.depth.size, 0);
  assert.equal(s.functions.length, 0);
  assert.equal(s.unreachable.size, 0);
  assert.equal(s.declarations.size, 0);
});

test('routes: elif and else carry the earlier branches as "is false" steps, in order', () => {
  const s = analyze('def f(x):\n    if x == 1:\n        a()\n    elif x == 2:\n        b()\n    else:\n        c()\n');
  const show = (line: number) => s.routes.get(line)?.map((st) => `${st.kind}:${st.condition}:${st.outcome}`);
  assert.deepEqual(show(3), ['if:x == 1:is true']);
  assert.deepEqual(show(5), ['if:x == 1:is false', 'elif:x == 2:is true']);
  assert.deepEqual(show(7), ['if:x == 1:is false', 'elif:x == 2:is false']);
  assert.equal(s.depth.get(7), 2);
});

test('routes: short-circuit operands come out in source order with their own outcomes', () => {
  const s = analyze('def f(a, b, c):\n    if a and b or c:\n        go()\n');
  assert.deepEqual(
    s.routes.get(3)?.map((st) => [st.kind, st.condition, st.outcome]),
    [
      ['if', 'a', 'is true'],
      ['and', 'b', 'is also true'],
      ['or', 'c', 'is true when the part before it is false'],
    ],
  );
});

test('routes: loops, except clauses, and match cases name what must happen', () => {
  const s = analyze(
    'def f(xs, v):\n    for x in xs:\n        a()\n    try:\n        b()\n    except ValueError:\n        c()\n    except KeyError:\n        d()\n    match v:\n        case 1:\n            e()\n        case _:\n            g()\n',
  );
  const show = (line: number) => s.routes.get(line)?.map((st) => `${st.kind}:${st.condition}:${st.outcome}`);
  assert.deepEqual(show(3), ['loop:x in xs:has at least one item']);
  assert.deepEqual(show(7), ['except:ValueError:is raised inside the try']);
  assert.deepEqual(show(9), ['except:ValueError:is not what was raised', 'except:KeyError:is raised inside the try']);
  assert.deepEqual(show(12), ['case:v matches 1:is true']);
  assert.deepEqual(show(14), ['case:v matches 1:is false', 'case:v matches _:is true']);
});

test('routes: depth always equals route length', () => {
  const src = 'def f(a, b, xs):\n    if a and b:\n        for x in xs:\n            y = 1 if x else 2\n            z = [i for i in xs if i]\n    elif a:\n        pass\n    else:\n        pass\n';
  const s = analyze(src);
  for (const [line, depth] of s.depth) {
    assert.equal(s.routes.get(line)?.length ?? 0, depth, `line ${line}`);
  }
});

test('routes: nested function starts a fresh route', () => {
  const s = analyze('def outer(x):\n    if x:\n        def inner(y):\n            return y\n');
  assert.deepEqual(s.routes.get(4), []);
  assert.equal(s.routes.get(3)?.length, 1);
});

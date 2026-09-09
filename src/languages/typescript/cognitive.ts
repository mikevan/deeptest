/**
 * Cognitive Complexity for TypeScript and JavaScript, on a tree-sitter
 * tree. The arithmetic is in ../shared/cognitive.ts; this file only says
 * what each node is.
 *
 * Mapping:
 *
 *   if                       structural; condition at this level, body one deeper
 *   else if / else           hybrid: +1, body one deeper
 *   for / for-in / for-of / while / do   structural
 *   switch                   structural, once, however many cases
 *   catch                    structural; try and finally cost nothing
 *   c ? x : y                structural; all three parts one deeper
 *   a && b, a || b           one boolean sequence per run of the same operator
 *   a ?? b, a?.b             nothing (the whitepaper excludes null-coalescing)
 *   break LABEL, continue LABEL   +1, no nesting
 *   arrow, function expression, method, nested class   no increment; contents one deeper
 *   recursion                +1 for each function on a call cycle within
 *                            the file, by name (f() or this.f())
 *
 * Ordered-operand rule inputs: a call, `new`, `await`, `yield`, an
 * assignment, or ++/-- makes an operand impure; member and subscript
 * access reach into their leftmost name (`this` counts as a name).
 */
import type { Node } from 'web-tree-sitter';
import { BooleanRules, CognitiveCounter, CognitiveScore, functionsInRecursionCycles } from '../shared/cognitive';

const FUNCTION_TYPES = new Set(['function_declaration', 'function_expression', 'arrow_function', 'method_definition', 'generator_function', 'generator_function_declaration', 'function']);
const CLASS_TYPES = new Set(['class_declaration', 'class', 'abstract_class_declaration']);
const IMPURE = new Set(['call_expression', 'new_expression', 'await_expression', 'yield_expression', 'assignment_expression', 'augmented_assignment_expression', 'update_expression']);
const BOOLEAN = new Set(['&&', '||']);

const rules: BooleanRules = {
  booleanParts(node) {
    if (node.type !== 'binary_expression') {
      return null;
    }
    const operator = node.childForFieldName('operator')?.text ?? '';
    if (!BOOLEAN.has(operator)) {
      return null;
    }
    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    return left && right ? { operator, left, right } : null;
  },
  isImpure: (node) => IMPURE.has(node.type),
  memberRoot(node) {
    if (node.type !== 'member_expression' && node.type !== 'subscript_expression') {
      return null;
    }
    let n: Node | null = node;
    while (n && (n.type === 'member_expression' || n.type === 'subscript_expression' || n.type === 'call_expression' || n.type === 'non_null_expression')) {
      n = n.type === 'call_expression' ? n.childForFieldName('function') : n.type === 'non_null_expression' ? n.namedChildren[0] ?? null : n.childForFieldName('object');
    }
    return n && (n.type === 'identifier' || n.type === 'this') ? n.text : null;
  },
  identifierName: (node) => (node.type === 'identifier' || node.type === 'this' ? node.text : null),
  stopsAt: (node) => FUNCTION_TYPES.has(node.type) || CLASS_TYPES.has(node.type),
};

class Walker {
  readonly counter = new CognitiveCounter(rules);

  visit(node: Node | null, nesting: number): void {
    if (!node) {
      return;
    }
    if (FUNCTION_TYPES.has(node.type) || CLASS_TYPES.has(node.type)) {
      this.visit(node.childForFieldName('body'), nesting + 1);
      return;
    }
    switch (node.type) {
      case 'if_statement':
        this.counter.structural(nesting);
        this.visitIfParts(node, nesting);
        return;
      case 'for_statement':
      case 'for_in_statement':
      case 'while_statement':
      case 'do_statement':
        this.counter.structural(nesting);
        for (const field of ['initializer', 'condition', 'increment', 'left', 'right']) {
          this.visit(node.childForFieldName(field), nesting);
        }
        this.visit(node.childForFieldName('body'), nesting + 1);
        return;
      case 'switch_statement':
        this.counter.structural(nesting);
        this.visit(node.childForFieldName('value'), nesting);
        for (const clause of node.childForFieldName('body')?.namedChildren ?? []) {
          if (clause) {
            this.children(clause, nesting + 1);
          }
        }
        return;
      case 'try_statement':
        this.visit(node.childForFieldName('body'), nesting);
        this.visitCatch(node.childForFieldName('handler'), nesting);
        this.visit(node.childForFieldName('finalizer')?.childForFieldName('body') ?? null, nesting);
        return;
      case 'ternary_expression':
        this.counter.structural(nesting);
        this.children(node, nesting + 1);
        return;
      case 'binary_expression':
        if (rules.booleanParts(node)) {
          for (const operand of this.counter.booleanSequence(node)) {
            this.visit(operand, nesting);
          }
          return;
        }
        this.children(node, nesting);
        return;
      case 'break_statement':
      case 'continue_statement':
        if (node.childForFieldName('label')) {
          this.counter.fundamental();
        }
        return;
      default:
        this.children(node, nesting);
    }
  }

  private children(node: Node, nesting: number): void {
    for (const child of node.namedChildren) {
      if (child) {
        this.visit(child, nesting);
      }
    }
  }

  /** Condition and consequence of an if, then its else-chain: `else if` is hybrid, and so is a final `else`. */
  private visitIfParts(node: Node, nesting: number): void {
    this.visit(node.childForFieldName('condition'), nesting);
    this.visit(node.childForFieldName('consequence'), nesting + 1);
    const alternative = node.childForFieldName('alternative');
    if (!alternative) {
      return;
    }
    // alternative is an else_clause holding either an if_statement (else if) or a statement.
    const inner = alternative.namedChildren[0] ?? null;
    this.counter.fundamental();
    if (inner?.type === 'if_statement') {
      this.visitIfParts(inner, nesting);
    } else {
      this.visit(inner, nesting + 1);
    }
  }

  private visitCatch(handler: Node | null, nesting: number): void {
    if (!handler) {
      return;
    }
    this.counter.structural(nesting);
    this.visit(handler.childForFieldName('body'), nesting + 1);
  }
}

/** Names this function body calls as `name(...)` or `this.name(...)`. */
function calledNames(body: Node | null): Set<string> {
  const names = new Set<string>();
  const visit = (n: Node): void => {
    if (n.type === 'call_expression') {
      const fn = n.childForFieldName('function');
      if (fn?.type === 'identifier') {
        names.add(fn.text);
      } else if (fn?.type === 'member_expression' && fn.childForFieldName('object')?.type === 'this') {
        const property = fn.childForFieldName('property')?.text;
        if (property) {
          names.add(property);
        }
      }
    }
    for (const child of n.namedChildren) {
      if (child) {
        visit(child);
      }
    }
  };
  if (body) {
    visit(body);
  }
  return names;
}

export interface ScoredFunction {
  name: string;
  node: Node;
}

/** Scores every function in a file, recursion cycles included. Same order as the input. */
export function scoreTypeScriptFunctions(functions: ScoredFunction[]): CognitiveScore[] {
  const calls = new Map<string, Set<string>>();
  for (const fn of functions) {
    const existing = calls.get(fn.name) ?? new Set<string>();
    for (const callee of calledNames(fn.node.childForFieldName('body'))) {
      existing.add(callee);
    }
    calls.set(fn.name, existing);
  }
  const recursive = functionsInRecursionCycles(calls);
  return functions.map((fn) => {
    const walker = new Walker();
    walker.visit(fn.node.childForFieldName('body'), 0);
    if (recursive.has(fn.name)) {
      walker.counter.fundamental();
    }
    return walker.counter.score;
  });
}

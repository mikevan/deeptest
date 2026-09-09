/**
 * Cognitive Complexity for Python, on a tree-sitter tree. The arithmetic is
 * in ../shared/cognitive.ts; this file only says what each Python node is.
 *
 * Mapping (see the shared file for the rule each word means):
 *
 *   if                      structural; condition at this level, body one deeper
 *   elif / else             hybrid: +1, body one deeper
 *   for / while             structural; loop `else` is hybrid
 *   except                  structural; try / else / finally cost nothing
 *   match                   structural, once, however many cases
 *   x if c else y           structural; all three parts one deeper
 *   a and b, a or b         one boolean sequence per run of the same operator
 *   lambda, nested def      no increment; contents one level deeper
 *   nested class            no increment; its body one level deeper
 *   with                    nothing
 *   comprehensions          nothing. The whitepaper predates a ruling on
 *                           them and this is the reading that a
 *                           comprehension is a single expression, not a
 *                           loop the reader steps through. Marked as a
 *                           decision in docs/engineering-notes.md.
 *   recursion               +1 for each function on a call cycle within
 *                           the file, by name (f() or self.f())
 *
 * Ordered-operand rule inputs: a call, an `await`, or a walrus (:=) makes an
 * operand impure; attribute and subscript access reach into their leftmost
 * name.
 */
import type { Node } from 'web-tree-sitter';
import { BooleanRules, CognitiveCounter, CognitiveScore, functionsInRecursionCycles } from '../shared/cognitive';

const STOP = new Set(['lambda', 'function_definition', 'class_definition']);
const IMPURE = new Set(['call', 'named_expression', 'await']);

const rules: BooleanRules = {
  booleanParts(node) {
    if (node.type !== 'boolean_operator') {
      return null;
    }
    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    const operator = node.childForFieldName('operator')?.text ?? 'and';
    return left && right ? { operator, left, right } : null;
  },
  isImpure: (node) => IMPURE.has(node.type),
  memberRoot(node) {
    if (node.type !== 'attribute' && node.type !== 'subscript') {
      return null;
    }
    let n: Node | null = node;
    while (n && (n.type === 'attribute' || n.type === 'subscript' || n.type === 'call')) {
      n = n.type === 'attribute' ? n.childForFieldName('object') : n.type === 'subscript' ? n.childForFieldName('value') : n.childForFieldName('function');
    }
    return n?.type === 'identifier' ? n.text : null;
  },
  identifierName: (node) => (node.type === 'identifier' ? node.text : null),
  stopsAt: (node) => STOP.has(node.type),
};

class Walker {
  readonly counter = new CognitiveCounter(rules);

  visit(node: Node | null, nesting: number): void {
    if (!node) {
      return;
    }
    switch (node.type) {
      case 'if_statement':
        this.visitIf(node, nesting);
        return;
      case 'for_statement':
      case 'while_statement':
        this.visitLoop(node, nesting);
        return;
      case 'try_statement':
        this.visitTry(node, nesting);
        return;
      case 'match_statement':
        this.visitMatch(node, nesting);
        return;
      case 'conditional_expression':
        this.counter.structural(nesting);
        this.children(node, nesting + 1);
        return;
      case 'boolean_operator':
        for (const operand of this.counter.booleanSequence(node)) {
          this.visit(operand, nesting);
        }
        return;
      case 'lambda':
        this.visit(node.childForFieldName('body'), nesting + 1);
        return;
      case 'function_definition':
      case 'class_definition':
        this.visit(node.childForFieldName('body'), nesting + 1);
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

  private visitIf(node: Node, nesting: number): void {
    this.counter.structural(nesting);
    this.visit(node.childForFieldName('condition'), nesting);
    this.visit(node.childForFieldName('consequence'), nesting + 1);
    for (const alternative of node.childrenForFieldName('alternative')) {
      if (!alternative) {
        continue;
      }
      this.counter.fundamental();
      if (alternative.type === 'elif_clause') {
        this.visit(alternative.childForFieldName('condition'), nesting);
        this.visit(alternative.childForFieldName('consequence'), nesting + 1);
      } else {
        this.visit(alternative.childForFieldName('body'), nesting + 1);
      }
    }
  }

  private visitLoop(node: Node, nesting: number): void {
    this.counter.structural(nesting);
    for (const field of ['left', 'right', 'condition']) {
      this.visit(node.childForFieldName(field), nesting);
    }
    this.visit(node.childForFieldName('body'), nesting + 1);
    const alternative = node.childForFieldName('alternative');
    if (alternative) {
      this.counter.fundamental();
      this.visit(alternative.childForFieldName('body'), nesting + 1);
    }
  }

  private visitTry(node: Node, nesting: number): void {
    this.visit(node.childForFieldName('body'), nesting);
    for (const clause of node.namedChildren) {
      if (!clause) {
        continue;
      }
      if (clause.type === 'except_clause' || clause.type === 'except_group_clause') {
        this.counter.structural(nesting);
        this.visit(clause.childForFieldName('value'), nesting);
        this.visit(clause.namedChildren.find((c) => c?.type === 'block') ?? null, nesting + 1);
      } else if (clause.type === 'else_clause' || clause.type === 'finally_clause') {
        this.visit(clause.childForFieldName('body') ?? clause.namedChildren.find((c) => c?.type === 'block') ?? null, nesting);
      }
    }
  }

  private visitMatch(node: Node, nesting: number): void {
    this.counter.structural(nesting);
    this.visit(node.childForFieldName('subject'), nesting);
    for (const clause of node.childForFieldName('body')?.namedChildren ?? []) {
      if (clause?.type === 'case_clause') {
        this.visit(clause.childForFieldName('guard'), nesting + 1);
        this.visit(clause.childForFieldName('consequence'), nesting + 1);
      }
    }
  }
}

/** Names this function body calls as `name(...)`, `self.name(...)`, or `cls.name(...)`. */
function calledNames(body: Node | null): Set<string> {
  const names = new Set<string>();
  const visit = (n: Node): void => {
    if (n.type === 'call') {
      const fn = n.childForFieldName('function');
      if (fn?.type === 'identifier') {
        names.add(fn.text);
      } else if (fn?.type === 'attribute') {
        const object = fn.childForFieldName('object')?.text;
        const attribute = fn.childForFieldName('attribute')?.text;
        if ((object === 'self' || object === 'cls') && attribute) {
          names.add(attribute);
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
export function scorePythonFunctions(functions: ScoredFunction[]): CognitiveScore[] {
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

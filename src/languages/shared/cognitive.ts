/**
 * Cognitive Complexity, the language-neutral half.
 *
 * The rules are G. Ann Campbell's, "Cognitive Complexity: A New Way of
 * Measuring Understandability", SonarSource, 2018
 * (https://www.sonarsource.com/docs/CognitiveComplexity.pdf):
 *
 *   structural  +1, plus one per level of nesting it sits inside:
 *               if, ternary, switch, every loop, catch
 *   hybrid      +1, no nesting charge, but the body is one level deeper:
 *               else if / elif, else
 *   fundamental +1, never a nesting charge:
 *               each run of the same boolean operator (a && b && c is one,
 *               a && b || c is two), each method in a recursion cycle,
 *               break LABEL / continue LABEL
 *   nesting     one level deeper inside every structure above, and inside
 *               every nested function or lambda (which is not itself an
 *               increment)
 *   nothing     try, finally, with, return, plain break and continue,
 *               null-coalescing (?? and ?.), the method itself
 *
 * Every language walker is written against this counter so the arithmetic
 * lives in one place and the walkers only say what each node is.
 *
 * Two numbers come out of one walk:
 *
 *   published  the whitepaper's rule for boolean runs: one per run
 *   ordered    Michael's departure (RefactorIt spec, draft 3): a run counts
 *              one only when its operands are independent and pure. When
 *              order carries meaning, it counts one per operand, because
 *              the reader must understand the short-circuit to understand
 *              the code. Order carries meaning when any operand contains a
 *              call or an assignment, or when a later operand reaches into
 *              (member access, subscript) a name an earlier operand tested.
 *
 * Everything else is identical between the two, so the difference between
 * them is exactly the cost of ordered boolean logic in the function.
 */
import type { Node } from 'web-tree-sitter';

export interface CognitiveScore {
  /** Cognitive complexity as published. */
  cognitive: number;
  /** Cognitive complexity with the ordered-operand rule for boolean runs. */
  cognitiveOrdered: number;
}

/** What a language walker must be able to say about an expression. */
export interface BooleanRules {
  /**
   * When the node is a binary boolean operator, its operator text and its
   * two operands; otherwise null. `not` / `!` and parentheses are not
   * boolean operators: their inner expression is a fresh sequence.
   */
  booleanParts(node: Node): { operator: string; left: Node; right: Node } | null;
  /** True for a call, an assignment, or anything else with an effect or a cost. */
  isImpure(node: Node): boolean;
  /** True for member access or subscript; `root` is the leftmost identifier. */
  memberRoot(node: Node): string | null;
  /** True for a bare identifier. */
  identifierName(node: Node): string | null;
  /** Node types the operand scan must not descend into (nested functions, blocks). */
  stopsAt(node: Node): boolean;
}

export class CognitiveCounter {
  private published = 0;
  private ordered = 0;

  constructor(private readonly rules: BooleanRules) {}

  get score(): CognitiveScore {
    return { cognitive: this.published, cognitiveOrdered: this.ordered };
  }

  /** if, ternary, switch, loop, catch: +1 and one more per level of nesting. */
  structural(nesting: number): void {
    this.published += 1 + nesting;
    this.ordered += 1 + nesting;
  }

  /** elif / else if / else, and anything else that costs one with no nesting charge. */
  fundamental(): void {
    this.published += 1;
    this.ordered += 1;
  }

  /**
   * Scores one boolean sequence: the node must be a boolean operator. The
   * left-deep tree is flattened into source order and split into runs of
   * the same operator; each run costs one (published) or, when order
   * matters, one per operand (ordered). Returns the leaf operands so the
   * walker can keep going into them: a parenthesised or negated operand,
   * a call argument, or a ternary may hold a sequence of its own, and
   * those are separate sequences by the whitepaper's rule.
   */
  booleanSequence(node: Node): Node[] {
    const operands: Node[] = [];
    const operators: string[] = [];
    const flatten = (n: Node): void => {
      const p = this.rules.booleanParts(n);
      if (!p) {
        operands.push(n);
        return;
      }
      flatten(p.left);
      operators.push(p.operator);
      flatten(p.right);
    };
    flatten(node);
    if (operators.length === 0) {
      return operands;
    }
    // Runs of the same operator. An operand at a boundary belongs to both runs.
    let start = 0;
    for (let i = 1; i <= operators.length; i += 1) {
      if (i === operators.length || operators[i] !== operators[start]) {
        const runOperands = operands.slice(start, i + 1);
        this.published += 1;
        this.ordered += this.orderMatters(runOperands) ? runOperands.length : 1;
        start = i;
      }
    }
    return operands;
  }

  /**
   * Michael's rule. A run of operands is ordered when any operand is
   * impure, or when a later operand reaches into a name that an earlier
   * operand mentioned: `m is not None and m.dues is not None` is ordered,
   * `is_active and is_paid and is_adult` is not.
   */
  private orderMatters(operands: Node[]): boolean {
    const seen = new Set<string>();
    for (const operand of operands) {
      let impure = false;
      let reachesIntoEarlier = false;
      const names = new Set<string>();
      const visit = (n: Node): void => {
        if (this.rules.stopsAt(n)) {
          return;
        }
        if (this.rules.isImpure(n)) {
          impure = true;
        }
        const root = this.rules.memberRoot(n);
        if (root !== null && seen.has(root)) {
          reachesIntoEarlier = true;
        }
        const id = this.rules.identifierName(n);
        if (id !== null) {
          names.add(id);
        }
        for (const child of n.namedChildren) {
          if (child) {
            visit(child);
          }
        }
      };
      visit(operand);
      if (impure || reachesIntoEarlier) {
        return true;
      }
      for (const name of names) {
        seen.add(name);
      }
    }
    return false;
  }
}

/**
 * Recursion cycles by name within one file. Every function is a node; an
 * edge is a call to a function name that exists in the file. Each function
 * on a cycle (including a function that calls itself) gets one increment.
 * Cross-file recursion and dynamic dispatch are invisible to this and are
 * left uncounted; the engineering notes say so.
 */
export function functionsInRecursionCycles(calls: Map<string, Set<string>>): Set<string> {
  const onCycle = new Set<string>();
  const names = Array.from(calls.keys());
  const reachable = (from: string, target: string): boolean => {
    const stack = [from];
    const visited = new Set<string>();
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const next of calls.get(current) ?? []) {
        if (next === target) {
          return true;
        }
        if (!visited.has(next) && calls.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }
    return false;
  };
  for (const name of names) {
    if (reachable(name, name)) {
      onCycle.add(name);
    }
  }
  return onCycle;
}

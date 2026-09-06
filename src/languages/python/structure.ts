/**
 * Python structure analysis on a tree-sitter syntax tree.
 *
 * Produces, for one file:
 *   - the route to each statement line: every decision that must go a
 *     particular way for control to arrive there, outermost first, plus the
 *     decisions evaluated on the line itself
 *   - depth per line, which is the route's length
 *   - cyclomatic complexity per function
 *   - unreachable statement lines
 *   - declaration lines (everything outside a function body)
 *
 * Depth rules, per the DeepTest spec, all configurable except the first:
 *
 *   if C:            line and body: enclosing + operands(C)
 *   elif C2:         enclosing + (each earlier branch went the other way: 1
 *                    per branch) + operands(C2)
 *   else:            enclosing + 1 per earlier branch. The other half of the
 *                    decisions above it, not a new decision.
 *   for / while:     line and body: enclosing + 1 (+ operands in the header)
 *   try:             body: enclosing
 *   k-th except:     enclosing + (k-1 earlier handlers did not match) + 1  [countExcept]
 *   k-th case:       enclosing + (k-1 earlier cases did not match) + 1 (+ guard)
 *   with:            body: enclosing (+ operands in the header)
 *   a and b, a or b: +1 per extra operand                              [countShortCircuit]
 *   x if c else y:   +1                                                [countTernary]
 *   comprehension for / if clause: +1 each                             [countComprehensions]
 *
 * operands(C) is 1 for the decision itself plus one per short-circuit
 * operand, so `if a and b:` is two decisions: a must be true, b must be
 * true. That is the MC/DC reading of the spec.
 *
 * Depth restarts at 0 inside every function body. A nested function is
 * reached by being called, not by the decisions around its def.
 *
 * Cyclomatic complexity is McCabe's: 1 + every branch point in the function,
 * nested functions excluded. It always counts short circuits, ternaries, and
 * comprehension clauses, whatever the depth flags say, because CC is a
 * published number and depth is Michael's.
 *
 * Statement lines are the statement's FIRST line, because that is where
 * coverage.py attributes a multi-line statement.
 */
import type { Node, Tree } from 'web-tree-sitter';
import { DEFAULT_DEPTH_OPTIONS, DepthOptions, FileStructure, FunctionComplexity, RouteStep } from '../../engine/types';

export { DEFAULT_DEPTH_OPTIONS };
export type { DepthOptions };

const TERMINATORS = new Set(['return_statement', 'raise_statement', 'break_statement', 'continue_statement']);
const FUNCTION_TYPES = new Set(['function_definition']);
const DEFINITION_TYPES = new Set(['decorated_definition', 'function_definition', 'class_definition']);
const CONDITIONAL_TYPES = new Set(['if_statement', 'match_statement']);
const LOOP_TYPES = new Set(['for_statement', 'while_statement']);
const TRY_WITH_TYPES = new Set(['try_statement', 'with_statement']);
const MAX_CONDITION = 100;

function text(node: Node | null | undefined): string {
  if (!node) {
    return '';
  }
  const flat = node.text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_CONDITION ? `${flat.slice(0, MAX_CONDITION - 1)}…` : flat;
}

class Analyzer {
  readonly depth = new Map<number, number>();
  readonly routes = new Map<number, RouteStep[]>();
  readonly unreachable = new Set<number>();
  readonly declarations = new Set<number>();
  readonly functions: FunctionComplexity[] = [];

  constructor(private readonly options: DepthOptions) {}

  private line(node: Node): number {
    return node.startPosition.row + 1;
  }

  /** Records the route (and therefore the depth) for a line. Keeps the longer one when a line holds two statements. */
  private record(node: Node, route: RouteStep[]): void {
    const line = this.line(node);
    const previous = this.depth.get(line);
    if (previous === undefined || route.length > previous) {
      this.depth.set(line, route.length);
      this.routes.set(line, route);
    }
  }

  /**
   * Decisions evaluated inside an expression subtree, as route steps. Stops
   * at blocks (their statements are scored on their own) and at nested
   * function or class definitions.
   */
  private exprSteps(node: Node | null, line: number): RouteStep[] {
    if (!node) {
      return [];
    }
    const steps: RouteStep[] = [];
    const visit = (n: Node): void => {
      if (n.type === 'block' || FUNCTION_TYPES.has(n.type) || n.type === 'class_definition') {
        return;
      }
      switch (n.type) {
        case 'boolean_operator': {
          // Left-deep tree: visit the left side first so operands come out
          // in source order, then the right operand is its own step.
          const left = n.childForFieldName('left');
          const right = n.childForFieldName('right');
          if (left) {
            visit(left);
          }
          if (this.options.countShortCircuit) {
            const op = n.childForFieldName('operator')?.text === 'or' ? 'or' : 'and';
            steps.push({
              line,
              kind: op,
              condition: text(right),
              outcome: op === 'and' ? 'is also true' : 'is true when the part before it is false',
            });
          }
          if (right) {
            visit(right);
          }
          return;
        }
        case 'conditional_expression':
          if (this.options.countTernary) {
            steps.push({ line, kind: 'ternary', condition: text(n.namedChildren[1]), outcome: 'is true, and separately false' });
          }
          break;
        case 'for_in_clause':
          if (this.options.countComprehensions) {
            steps.push({ line, kind: 'comprehension', condition: text(n), outcome: 'produces at least one item' });
          }
          break;
        case 'if_clause':
          if (this.options.countComprehensions) {
            steps.push({ line, kind: 'comprehension', condition: text(n.namedChildren[0]), outcome: 'is true for some item' });
          }
          break;
        default:
          break;
      }
      for (const child of n.namedChildren) {
        if (child) {
          visit(child);
        }
      }
    };
    visit(node);
    return steps;
  }

  /**
   * A decision whose condition may contain short circuits: the first
   * operand is the decision itself, each further operand is its own step.
   * Order matters: boolean_operator nests left-deep, so the leftmost
   * operand is the innermost `left`.
   */
  private conditionSteps(condition: Node | null, kind: RouteStep['kind'], line: number, outcome: string): RouteStep[] {
    if (!condition) {
      return [{ line, kind, condition: '', outcome }];
    }
    let leftmost: Node = condition;
    while (leftmost.type === 'boolean_operator' && this.options.countShortCircuit) {
      const left = leftmost.childForFieldName('left');
      if (!left) {
        break;
      }
      leftmost = left;
    }
    const first: RouteStep = { line, kind, condition: text(leftmost), outcome };
    // Steps for the remaining operands, and any ternaries or comprehensions inside.
    return [first, ...this.exprSteps(condition, line)];
  }

  private headerSteps(node: Node, fields: string[], line: number): RouteStep[] {
    const steps: RouteStep[] = [];
    for (const field of fields) {
      for (const child of node.childrenForFieldName(field)) {
        if (child) {
          steps.push(...this.exprSteps(child, line));
        }
      }
    }
    return steps;
  }

  analyzeModule(root: Node): void {
    this.visitBlock(root, [], false);
  }

  private visitBlock(block: Node, route: RouteStep[], inFunction: boolean): void {
    let dead = false;
    for (const stmt of block.namedChildren) {
      if (!stmt || stmt.type === 'comment') {
        continue;
      }
      if (dead) {
        this.markUnreachable(stmt);
        continue;
      }
      this.visitStatement(stmt, route, inFunction);
      if (this.terminates(stmt)) {
        dead = true;
      }
    }
  }

  /**
   * True when control can never fall out of the bottom of this statement.
   * Loops never qualify (the body may run zero times). This is the check
   * that catches LayerTime's toUtm case: a return after a try/except whose
   * every path already returned.
   */
  private terminates(stmt: Node): boolean {
    if (TERMINATORS.has(stmt.type)) {
      return true;
    }
    const blockTerminates = (block: Node | null): boolean => {
      if (!block) {
        return false;
      }
      const statements = block.namedChildren.filter((c): c is Node => Boolean(c) && c!.type !== 'comment');
      return statements.some((s) => this.terminates(s));
    };
    switch (stmt.type) {
      case 'if_statement': {
        const alternatives = stmt.childrenForFieldName('alternative').filter((a): a is Node => Boolean(a));
        const hasElse = alternatives.some((a) => a.type === 'else_clause');
        if (!hasElse) {
          return false;
        }
        if (!blockTerminates(stmt.childForFieldName('consequence'))) {
          return false;
        }
        return alternatives.every((alt) =>
          blockTerminates(alt.type === 'elif_clause' ? alt.childForFieldName('consequence') : alt.childForFieldName('body')),
        );
      }
      case 'try_statement': {
        const children = stmt.namedChildren.filter((c): c is Node => Boolean(c));
        const finallyClause = children.find((c) => c.type === 'finally_clause');
        if (finallyClause && blockTerminates(finallyClause.namedChildren.find((c) => c?.type === 'block') ?? null)) {
          return true;
        }
        const elseClause = children.find((c) => c.type === 'else_clause');
        const bodyPath =
          blockTerminates(stmt.childForFieldName('body')) ||
          (elseClause !== undefined && blockTerminates(elseClause.childForFieldName('body') ?? elseClause.namedChildren.find((c) => c?.type === 'block') ?? null));
        if (!bodyPath) {
          return false;
        }
        const handlers = children.filter((c) => c.type === 'except_clause' || c.type === 'except_group_clause');
        return handlers.every((h) => blockTerminates(h.namedChildren.find((c) => c?.type === 'block') ?? null));
      }
      case 'with_statement':
        return blockTerminates(stmt.childForFieldName('body'));
      case 'match_statement': {
        const body = stmt.childForFieldName('body');
        if (!body) {
          return false;
        }
        const cases = body.namedChildren.filter((c): c is Node => Boolean(c) && c!.type === 'case_clause');
        if (cases.length === 0) {
          return false;
        }
        const last = cases[cases.length - 1];
        const patterns = last.namedChildren.filter((c): c is Node => Boolean(c) && c!.type === 'case_pattern');
        const irrefutable = !last.childForFieldName('guard') && patterns.length === 1 && patterns[0].text === '_';
        return irrefutable && cases.every((c) => blockTerminates(c.childForFieldName('consequence')));
      }
      default:
        return false;
    }
  }

  private markUnreachable(node: Node): void {
    if (node.type === 'comment') {
      return;
    }
    if (node.type === 'block') {
      for (const child of node.namedChildren) {
        if (child) {
          this.markUnreachable(child);
        }
      }
      return;
    }
    this.unreachable.add(this.line(node));
    for (const child of node.namedChildren) {
      if (child && (child.type === 'block' || child.type.endsWith('_clause') || FUNCTION_TYPES.has(child.type))) {
        this.markUnreachable(child);
      }
    }
  }

  private declare(node: Node, inFunction: boolean): void {
    if (!inFunction) {
      this.declarations.add(this.line(node));
    }
  }

  private visitDecoratedDefinition(stmt: Node, route: RouteStep[], inFunction: boolean): void {
    stmt.namedChildren.filter((child): child is Node => Boolean(child)).forEach((child) => {
      if (child.type === 'decorator') {
        this.declare(child, inFunction);
        this.record(child, [...route, ...this.exprSteps(child, this.line(child))]);
      } else {
        this.visitStatement(child, route, inFunction);
      }
    });
  }

  private visitFunctionDefinition(stmt: Node, route: RouteStep[], inFunction: boolean): void {
    const line = this.line(stmt);
    this.declare(stmt, inFunction);
    this.record(stmt, [...route, ...this.headerSteps(stmt, ['parameters', 'return_type'], line)]);
    const body = stmt.childForFieldName('body');
    const name = stmt.childForFieldName('name')?.text ?? '<lambda>';
    this.functions.push({
      name,
      startLine: line,
      endLine: stmt.endPosition.row + 1,
      complexity: 1 + this.complexityOf(body),
    });
    if (body) {
      this.visitBlock(body, [], true);
    }
  }

  private visitClassDefinition(stmt: Node, route: RouteStep[], inFunction: boolean): void {
    const line = this.line(stmt);
    this.declare(stmt, inFunction);
    this.record(stmt, [...route, ...this.headerSteps(stmt, ['superclasses'], line)]);
    const body = stmt.childForFieldName('body');
    if (body) {
      // A class body executes at import time. Its statements are
      // declarations unless we are already inside a function.
      this.visitBlock(body, [], inFunction);
    }
  }

  private visitIfStatement(stmt: Node, route: RouteStep[], inFunction: boolean): void {
    const line = this.line(stmt);
    this.declare(stmt, inFunction);
    const condition = stmt.childForFieldName('condition');
    const own = this.conditionSteps(condition, 'if', line, 'is true');
    this.record(stmt, [...route, ...own]);
    const consequence = stmt.childForFieldName('consequence');
    if (consequence) {
      this.visitBlock(consequence, [...route, ...own], inFunction);
    }
    // Earlier branches that must have gone the other way, one step each.
    const failed: RouteStep[] = [{ line, kind: 'if', condition: text(condition), outcome: 'is false' }];
    for (const alternative of stmt.childrenForFieldName('alternative').filter((child): child is Node => Boolean(child))) {
      if (alternative.type === 'elif_clause') {
        this.visitElifClause(alternative, route, failed, inFunction);
      } else if (alternative.type === 'else_clause') {
        this.visitElseClause(alternative, route, failed, inFunction);
      }
    }
  }

  private visitElifClause(clause: Node, route: RouteStep[], failed: RouteStep[], inFunction: boolean): void {
    const line = this.line(clause);
    const condition = clause.childForFieldName('condition');
    const own = this.conditionSteps(condition, 'elif', line, 'is true');
    const clauseRoute = [...route, ...failed, ...own];
    this.declare(clause, inFunction);
    this.record(clause, clauseRoute);
    const body = clause.childForFieldName('consequence');
    if (body) {
      this.visitBlock(body, clauseRoute, inFunction);
    }
    failed.push({ line, kind: 'elif', condition: text(condition), outcome: 'is false' });
  }

  private visitElseClause(clause: Node, route: RouteStep[], failed: RouteStep[], inFunction: boolean): void {
    const clauseRoute = [...route, ...failed];
    this.declare(clause, inFunction);
    this.record(clause, clauseRoute);
    const body = clause.childForFieldName('body');
    if (body) {
      this.visitBlock(body, clauseRoute, inFunction);
    }
  }

  private visitLoopStatement(stmt: Node, route: RouteStep[], inFunction: boolean): void {
    const line = this.line(stmt);
    this.declare(stmt, inFunction);
    const own = this.loopSteps(stmt, line);
    const inner = [...route, ...own];
    this.record(stmt, inner);
    const body = stmt.childForFieldName('body');
    if (body) {
      this.visitBlock(body, inner, inFunction);
    }
    const alternative = stmt.childForFieldName('alternative');
    if (alternative) {
      this.visitLoopElseClause(alternative, inner, inFunction);
    }
  }

  private loopSteps(stmt: Node, line: number): RouteStep[] {
    if (stmt.type === 'for_statement') {
      const header = `${text(stmt.childForFieldName('left'))} in ${text(stmt.childForFieldName('right'))}`;
      return [{ line, kind: 'loop', condition: header, outcome: 'has at least one item' }, ...this.headerSteps(stmt, ['left', 'right'], line)];
    }
    return this.conditionSteps(stmt.childForFieldName('condition'), 'loop', line, 'is true at least once');
  }

  private visitLoopElseClause(clause: Node, route: RouteStep[], inFunction: boolean): void {
    this.declare(clause, inFunction);
    this.record(clause, route);
    const body = clause.childForFieldName('body');
    if (body) {
      this.visitBlock(body, route, inFunction);
    }
  }

  private visitTryStatement(stmt: Node, route: RouteStep[], inFunction: boolean): void {
    this.declare(stmt, inFunction);
    this.record(stmt, route);
    const body = stmt.childForFieldName('body');
    if (body) {
      this.visitBlock(body, route, inFunction);
    }
    const earlier: RouteStep[] = [];
    for (const child of stmt.namedChildren) {
      if (child) {
        this.visitTryClause(child, route, earlier, inFunction);
      }
    }
  }

  private visitTryClause(clause: Node, route: RouteStep[], earlier: RouteStep[], inFunction: boolean): void {
    if (clause.type === 'except_clause' || clause.type === 'except_group_clause') {
      this.visitExceptClause(clause, route, earlier, inFunction);
    } else if (clause.type === 'else_clause' || clause.type === 'finally_clause') {
      this.visitPlainTryClause(clause, route, inFunction);
    }
  }

  private visitExceptClause(clause: Node, route: RouteStep[], earlier: RouteStep[], inFunction: boolean): void {
    const line = this.line(clause);
    const value = clause.childForFieldName('value');
    const caught = text(value) || 'any exception';
    const own: RouteStep[] = this.options.countExcept
      ? [...earlier, { line, kind: 'except', condition: caught, outcome: 'is raised inside the try' }]
      : [];
    const inner = [...route, ...own, ...this.exprSteps(value, line)];
    this.declare(clause, inFunction);
    this.record(clause, inner);
    const block = clause.namedChildren.find((child) => child?.type === 'block');
    if (block) {
      this.visitBlock(block, [...route, ...own], inFunction);
    }
    earlier.push({ line, kind: 'except', condition: caught, outcome: 'is not what was raised' });
  }

  private visitPlainTryClause(clause: Node, route: RouteStep[], inFunction: boolean): void {
    this.declare(clause, inFunction);
    this.record(clause, route);
    const block = clause.childForFieldName('body') ?? clause.namedChildren.find((child) => child?.type === 'block');
    if (block) {
      this.visitBlock(block, route, inFunction);
    }
  }

  private visitWithStatement(stmt: Node, route: RouteStep[], inFunction: boolean): void {
    const line = this.line(stmt);
    this.declare(stmt, inFunction);
    const clause = stmt.namedChildren.find((child) => child?.type === 'with_clause') ?? null;
    const inner = [...route, ...this.exprSteps(clause, line)];
    this.record(stmt, inner);
    const body = stmt.childForFieldName('body');
    if (body) {
      this.visitBlock(body, inner, inFunction);
    }
  }

  private visitMatchStatement(stmt: Node, route: RouteStep[], inFunction: boolean): void {
    const line = this.line(stmt);
    this.declare(stmt, inFunction);
    const subject = text(stmt.childForFieldName('subject'));
    this.record(stmt, [...route, ...this.headerSteps(stmt, ['subject'], line)]);
    const earlier: RouteStep[] = [];
    const clauses = stmt.childForFieldName('body')?.namedChildren ?? [];
    for (const clause of clauses) {
      if (clause?.type === 'case_clause') {
        this.visitCaseClause(clause, subject, route, earlier, inFunction);
      }
    }
  }

  private visitCaseClause(clause: Node, subject: string, route: RouteStep[], earlier: RouteStep[], inFunction: boolean): void {
    const line = this.line(clause);
    const pattern = clause.namedChildren
      .filter((child): child is Node => Boolean(child) && child!.type === 'case_pattern')
      .map((child) => text(child))
      .join(' | ');
    const own: RouteStep[] = [...earlier, { line, kind: 'case', condition: `${subject} matches ${pattern}`, outcome: 'is true' }];
    const guard = clause.childForFieldName('guard');
    if (guard) {
      const guardExpression = guard.namedChildren[0] ?? null;
      own.push(...this.conditionSteps(guardExpression, 'guard', line, 'is true'));
    }
    const inner = [...route, ...own];
    this.declare(clause, inFunction);
    this.record(clause, inner);
    const consequence = clause.childForFieldName('consequence');
    if (consequence) {
      this.visitBlock(consequence, inner, inFunction);
    }
    earlier.push({ line, kind: 'case', condition: `${subject} matches ${pattern}`, outcome: 'is false' });
  }

  private visitSimpleStatement(stmt: Node, route: RouteStep[], inFunction: boolean): void {
    this.declare(stmt, inFunction);
    this.record(stmt, [...route, ...this.exprSteps(stmt, this.line(stmt))]);
  }

  private visitDefinitionStatement(stmt: Node, route: RouteStep[], inFunction: boolean): void {
    switch (stmt.type) {
      case 'decorated_definition':
        this.visitDecoratedDefinition(stmt, route, inFunction);
        return;
      case 'class_definition':
        this.visitClassDefinition(stmt, route, inFunction);
        return;
      default:
        this.visitFunctionDefinition(stmt, route, inFunction);
    }
  }

  private visitConditionalStatement(stmt: Node, route: RouteStep[], inFunction: boolean): void {
    if (stmt.type === 'match_statement') {
      this.visitMatchStatement(stmt, route, inFunction);
    } else {
      this.visitIfStatement(stmt, route, inFunction);
    }
  }

  private visitTryOrWithStatement(stmt: Node, route: RouteStep[], inFunction: boolean): void {
    if (stmt.type === 'with_statement') {
      this.visitWithStatement(stmt, route, inFunction);
    } else {
      this.visitTryStatement(stmt, route, inFunction);
    }
  }

  private visitStatement(stmt: Node, route: RouteStep[], inFunction: boolean): void {
    if (DEFINITION_TYPES.has(stmt.type)) {
      this.visitDefinitionStatement(stmt, route, inFunction);
      return;
    }
    if (CONDITIONAL_TYPES.has(stmt.type)) {
      this.visitConditionalStatement(stmt, route, inFunction);
      return;
    }
    if (LOOP_TYPES.has(stmt.type)) {
      this.visitLoopStatement(stmt, route, inFunction);
      return;
    }
    if (TRY_WITH_TYPES.has(stmt.type)) {
      this.visitTryOrWithStatement(stmt, route, inFunction);
      return;
    }
    // Simple statement: expression, assignment, return, import, pass...
    this.visitSimpleStatement(stmt, route, inFunction);
  }

  /** Branch points inside a function body, nested functions excluded. */
  private complexityOf(node: Node | null): number {
    if (!node) {
      return 0;
    }
    let count = 0;
    const visit = (n: Node): void => {
      if (FUNCTION_TYPES.has(n.type) || n.type === 'class_definition') {
        return;
      }
      switch (n.type) {
        case 'if_statement':
        case 'elif_clause':
        case 'for_statement':
        case 'while_statement':
        case 'except_clause':
        case 'except_group_clause':
        case 'case_clause':
        case 'boolean_operator':
        case 'conditional_expression':
        case 'for_in_clause':
        case 'if_clause':
          count += 1;
          break;
        default:
          break;
      }
      for (const child of n.namedChildren) {
        if (child) {
          visit(child);
        }
      }
    };
    visit(node);
    return count;
  }
}

export function analyzePythonTree(path: string, tree: Tree, options: DepthOptions = DEFAULT_DEPTH_OPTIONS): FileStructure {
  const analyzer = new Analyzer(options);
  analyzer.analyzeModule(tree.rootNode);
  return {
    path,
    depth: analyzer.depth,
    routes: analyzer.routes,
    functions: analyzer.functions,
    unreachable: analyzer.unreachable,
    declarations: analyzer.declarations,
  };
}

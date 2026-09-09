/**
 * TypeScript / JavaScript structure analysis on a tree-sitter tree. The
 * three grammars (typescript, tsx, javascript) share node names, so one
 * analyzer serves all of them.
 *
 * Same contract, same depth rules as the Python analyzer, mapped onto the
 * C-family syntax:
 *
 *   if (C)                line and body: enclosing + operands(C)
 *   else if (C2)          enclosing + 1 per earlier branch + operands(C2)
 *   else                  enclosing + 1 per earlier branch
 *   for / for-in / for-of / while / do   enclosing + 1 (+ operands)
 *   try                   body: enclosing
 *   catch                 enclosing + 1                        [countExcept]
 *   k-th case             enclosing + k (earlier cases missed, this one hit)
 *   default               enclosing + number of cases above it
 *   a && b, a || b, a ?? b   +1 per extra operand               [countShortCircuit]
 *   c ? x : y             +1                                    [countTernary]
 *
 * countComprehensions has no JavaScript meaning and is ignored here.
 *
 * Depth restarts at 0 inside every function, arrow function, and method.
 * Statements outside any function (module level, class bodies, field
 * initialisers) are declarations: they run at import time, not under a
 * test. A one-line arrow such as `const add = (a, b) => a + b;` is not a
 * declaration, because its body runs under tests and Istanbul attributes
 * that execution to the same line.
 *
 * Statement lines are the statement's first line, which is where Istanbul
 * puts its statement counter.
 */
import type { Node, Tree } from 'web-tree-sitter';
import { DEFAULT_DEPTH_OPTIONS, DepthOptions, FileStructure, FunctionComplexity, RouteStep } from '../../engine/types';
import { scoreTypeScriptFunctions, ScoredFunction } from './cognitive';

const TERMINATORS = new Set(['return_statement', 'throw_statement', 'break_statement', 'continue_statement']);
const FUNCTION_TYPES = new Set(['function_declaration', 'function_expression', 'arrow_function', 'method_definition', 'generator_function', 'generator_function_declaration', 'function']);
const CLASS_TYPES = new Set(['class_declaration', 'class', 'abstract_class_declaration']);
const DECLARATION_STATEMENT_TYPES = new Set(['function_declaration', 'generator_function_declaration', 'class_declaration', 'abstract_class_declaration']);
const WRAPPED_STATEMENT_TYPES = new Set(['labeled_statement', 'statement_block']);
const LOOP_STATEMENT_TYPES = new Set(['for_statement', 'for_in_statement', 'while_statement', 'do_statement']);
const SHORT_CIRCUIT = new Set(['&&', '||', '??']);
const MAX_CONDITION = 100;

function text(node: Node | null | undefined): string {
  if (!node) {
    return '';
  }
  const flat = node.text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_CONDITION ? `${flat.slice(0, MAX_CONDITION - 1)}…` : flat;
}

/** Strips one layer of parentheses for display: `(x > 0)` -> `x > 0`. */
function unparen(node: Node | null): Node | null {
  let n = node;
  while (n && n.type === 'parenthesized_expression' && n.namedChildren.length === 1 && n.namedChildren[0]) {
    n = n.namedChildren[0];
  }
  return n;
}

class Analyzer {
  readonly depth = new Map<number, number>();
  readonly routes = new Map<number, RouteStep[]>();
  readonly unreachable = new Set<number>();
  readonly declarations = new Set<number>();
  readonly functions: FunctionComplexity[] = [];
  /** The node behind each entry of `functions`, same order, for the cognitive pass. */
  private readonly functionNodes: ScoredFunction[] = [];

  constructor(private readonly options: DepthOptions) {}

  /** Fills in the cognitive numbers once the whole file is known, because recursion cycles need every function. */
  scoreCognitive(): void {
    const scores = scoreTypeScriptFunctions(this.functionNodes);
    scores.forEach((score, i) => {
      this.functions[i].cognitive = score.cognitive;
      this.functions[i].cognitiveOrdered = score.cognitiveOrdered;
    });
  }

  private line(node: Node): number {
    return node.startPosition.row + 1;
  }

  private record(node: Node, route: RouteStep[], inFunction: boolean): void {
    const line = this.line(node);
    const previous = this.depth.get(line);
    if (previous === undefined || route.length > previous) {
      this.depth.set(line, route.length);
      this.routes.set(line, route);
    }
    if (inFunction) {
      // A scored statement shares this line with a declaration header
      // (one-line arrow, one-line method). The line is scored, not declared.
      this.declarations.delete(line);
    }
  }

  private declare(node: Node, inFunction: boolean): void {
    if (!inFunction && !this.depth.has(this.line(node))) {
      this.declarations.add(this.line(node));
    }
  }

  private exprSteps(node: Node | null, line: number): RouteStep[] {
    if (!node) {
      return [];
    }
    const steps: RouteStep[] = [];
    const visit = (n: Node): void => {
      if (n.type === 'statement_block' || FUNCTION_TYPES.has(n.type) || CLASS_TYPES.has(n.type)) {
        return;
      }
      if (n.type === 'binary_expression') {
        const op = n.childForFieldName('operator')?.text ?? '';
        if (SHORT_CIRCUIT.has(op)) {
          const left = n.childForFieldName('left');
          const right = n.childForFieldName('right');
          if (left) {
            visit(left);
          }
          if (this.options.countShortCircuit) {
            const kind = op === '&&' ? 'and' : 'or';
            steps.push({
              line,
              kind,
              condition: text(right),
              outcome: op === '&&' ? 'is also true' : op === '||' ? 'is true when the part before it is false' : 'is used when the part before it is null',
            });
          }
          if (right) {
            visit(right);
          }
          return;
        }
      }
      if (n.type === 'ternary_expression' && this.options.countTernary) {
        steps.push({ line, kind: 'ternary', condition: text(n.childForFieldName('condition')), outcome: 'is true, and separately false' });
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

  private conditionSteps(condition: Node | null, kind: RouteStep['kind'], line: number, outcome: string): RouteStep[] {
    const inner = unparen(condition);
    if (!inner) {
      return [{ line, kind, condition: '', outcome }];
    }
    let leftmost: Node = inner;
    while (leftmost.type === 'binary_expression' && SHORT_CIRCUIT.has(leftmost.childForFieldName('operator')?.text ?? '') && this.options.countShortCircuit) {
      const left = leftmost.childForFieldName('left');
      if (!left) {
        break;
      }
      leftmost = left;
    }
    return [{ line, kind, condition: text(unparen(leftmost)), outcome }, ...this.exprSteps(inner, line)];
  }

  analyzeProgram(root: Node): void {
    this.visitStatements(root.namedChildren.filter((c): c is Node => Boolean(c)), [], false);
  }

  private visitBlock(node: Node | null, route: RouteStep[], inFunction: boolean): void {
    if (!node) {
      return;
    }
    if (node.type === 'statement_block' || node.type === 'program') {
      this.visitStatements(node.namedChildren.filter((c): c is Node => Boolean(c)), route, inFunction);
    } else {
      // A single statement without braces.
      this.visitStatement(node, route, inFunction);
    }
  }

  private visitStatements(statements: Node[], route: RouteStep[], inFunction: boolean): void {
    let dead = false;
    for (const stmt of statements) {
      if (stmt.type === 'comment') {
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

  private terminates(stmt: Node): boolean {
    if (TERMINATORS.has(stmt.type)) {
      return true;
    }
    const blockTerminates = (node: Node | null): boolean => {
      if (!node) {
        return false;
      }
      if (node.type === 'statement_block') {
        return node.namedChildren.some((c) => c && c.type !== 'comment' && this.terminates(c));
      }
      return this.terminates(node);
    };
    switch (stmt.type) {
      case 'labeled_statement':
        return false;
      case 'if_statement': {
        const alt = stmt.childForFieldName('alternative');
        if (!alt) {
          return false;
        }
        const altBody = alt.namedChildren.find((c): c is Node => Boolean(c)) ?? null;
        return blockTerminates(stmt.childForFieldName('consequence')) && blockTerminates(altBody);
      }
      case 'try_statement': {
        const finalizer = stmt.childForFieldName('finalizer');
        if (finalizer && blockTerminates(finalizer.childForFieldName('body'))) {
          return true;
        }
        const handler = stmt.childForFieldName('handler');
        if (!handler) {
          return false;
        }
        return blockTerminates(stmt.childForFieldName('body')) && blockTerminates(handler.childForFieldName('body'));
      }
      case 'switch_statement': {
        const body = stmt.childForFieldName('body');
        if (!body) {
          return false;
        }
        const clauses = body.namedChildren.filter((c): c is Node => Boolean(c) && (c!.type === 'switch_case' || c!.type === 'switch_default'));
        if (!clauses.some((c) => c.type === 'switch_default')) {
          return false;
        }
        // Every clause must end in return/throw (a break would fall out).
        return clauses.every((c) => {
          const stmts = c.childrenForFieldName('body').filter((s): s is Node => Boolean(s));
          return stmts.some((s) => (s.type === 'return_statement' || s.type === 'throw_statement') || (s.type !== 'break_statement' && this.terminatesNoBreak(s)));
        });
      }
      default:
        return false;
    }
  }

  /** Like terminates(), but a break does not count: inside a switch it only leaves the switch. */
  private terminatesNoBreak(stmt: Node): boolean {
    if (stmt.type === 'break_statement') {
      return false;
    }
    if (stmt.type === 'statement_block') {
      return stmt.namedChildren.some((c) => c && this.terminatesNoBreak(c));
    }
    return this.terminates(stmt);
  }

  private markUnreachable(node: Node): void {
    if (node.type === 'comment' || node.type === 'empty_statement') {
      return;
    }
    if (node.type === 'statement_block') {
      for (const child of node.namedChildren) {
        if (child) {
          this.markUnreachable(child);
        }
      }
      return;
    }
    this.unreachable.add(this.line(node));
    for (const child of node.namedChildren) {
      if (child && (child.type === 'statement_block' || child.type.endsWith('_clause') || child.type.endsWith('_statement') || child.type === 'switch_body' || child.type === 'switch_case' || child.type === 'switch_default')) {
        this.markUnreachable(child);
      }
    }
  }

  private functionName(fn: Node): string {
    const own = fn.childForFieldName('name');
    if (own) {
      return own.text;
    }
    const parent = fn.parent;
    if (parent?.type === 'variable_declarator') {
      return parent.childForFieldName('name')?.text ?? '<anonymous>';
    }
    if (parent?.type === 'pair') {
      return parent.childForFieldName('key')?.text ?? '<anonymous>';
    }
    if (parent?.type === 'assignment_expression') {
      return parent.childForFieldName('left')?.text ?? '<anonymous>';
    }
    if (parent?.type === 'public_field_definition' || parent?.type === 'field_definition') {
      return parent.childForFieldName('name')?.text ?? '<anonymous>';
    }
    return '<anonymous>';
  }

  private visitFunction(fn: Node): void {
    const body = fn.childForFieldName('body');
    const name = this.functionName(fn);
    this.functions.push({
      name,
      startLine: this.line(fn),
      endLine: fn.endPosition.row + 1,
      complexity: 1 + this.complexityOf(body),
      cognitive: 0,
      cognitiveOrdered: 0,
    });
    this.functionNodes.push({ name, node: fn });
    if (!body) {
      return;
    }
    if (body.type === 'statement_block') {
      this.visitBlock(body, [], true);
    } else {
      // Expression-bodied arrow: the expression is the whole body and Istanbul counts it as a statement.
      this.record(body, this.exprSteps(body, this.line(body)), true);
      this.visitNestedFunctions(body);
    }
  }

  /** Functions inside an expression (callbacks, arrows in arguments) still get their own analysis. */
  private visitNestedFunctions(node: Node): void {
    for (const child of node.namedChildren) {
      if (!child) {
        continue;
      }
      if (FUNCTION_TYPES.has(child.type)) {
        this.visitFunction(child);
      } else if (CLASS_TYPES.has(child.type)) {
        this.visitClassBody(child.childForFieldName('body'), false);
      } else {
        this.visitNestedFunctions(child);
      }
    }
  }

  private visitClassBody(body: Node | null, inFunction: boolean): void {
    if (!body) {
      return;
    }
    for (const member of body.namedChildren) {
      if (!member) {
        continue;
      }
      if (member.type === 'method_definition') {
        this.declare(member, inFunction);
        this.record(member, this.exprSteps(member.childForFieldName('parameters'), this.line(member)), false);
        this.visitFunction(member);
      } else if (member.type === 'public_field_definition' || member.type === 'field_definition') {
        this.declare(member, inFunction);
        this.visitNestedFunctions(member);
      } else if (member.type === 'class_static_block') {
        this.visitBlock(member.childForFieldName('body'), [], inFunction);
      }
    }
  }

  private exportDeclaration(stmt: Node): Node | null {
    return stmt.childForFieldName('declaration') ?? stmt.childForFieldName('value');
  }

  private visitExportStatement(stmt: Node, route: RouteStep[], inFunction: boolean): void {
    const decl = this.exportDeclaration(stmt);
    if (decl && (FUNCTION_TYPES.has(decl.type) || CLASS_TYPES.has(decl.type) || decl.type.endsWith('_declaration'))) {
      this.visitStatement(decl, route, inFunction);
    } else {
      this.declare(stmt, inFunction);
      this.record(stmt, [...route, ...this.exprSteps(stmt, this.line(stmt))], inFunction);
    }
  }

  private visitFunctionDeclaration(stmt: Node, route: RouteStep[], inFunction: boolean): void {
    this.declare(stmt, inFunction);
    this.record(stmt, [...route, ...this.exprSteps(stmt.childForFieldName('parameters'), this.line(stmt))], false);
    this.visitFunction(stmt);
  }

  private visitClassDeclaration(stmt: Node, inFunction: boolean): void {
    this.declare(stmt, inFunction);
    this.visitClassBody(stmt.childForFieldName('body'), false);
  }

  private visitDeclarationStatement(stmt: Node, route: RouteStep[], inFunction: boolean): void {
    if (stmt.type === 'function_declaration' || stmt.type === 'generator_function_declaration') {
      this.visitFunctionDeclaration(stmt, route, inFunction);
    } else {
      this.visitClassDeclaration(stmt, inFunction);
    }
  }

  private visitLabeledStatement(stmt: Node, route: RouteStep[], inFunction: boolean): void {
    const body = stmt.childForFieldName('body');
    if (body) {
      this.visitStatement(body, route, inFunction);
    }
  }

  private visitWrappedStatement(stmt: Node, route: RouteStep[], inFunction: boolean): void {
    if (stmt.type === 'labeled_statement') {
      this.visitLabeledStatement(stmt, route, inFunction);
    } else {
      this.visitBlock(stmt, route, inFunction);
    }
  }

  private visitIfStatement(stmt: Node, route: RouteStep[], inFunction: boolean): void {
    const line = this.line(stmt);
    this.declare(stmt, inFunction);
    const condition = stmt.childForFieldName('condition');
    const own = this.conditionSteps(condition, 'if', line, 'is true');
    this.record(stmt, [...route, ...own], inFunction);
    this.visitBlock(stmt.childForFieldName('consequence'), [...route, ...own], inFunction);
    const failed: RouteStep[] = [{ line, kind: 'if', condition: text(unparen(condition)), outcome: 'is false' }];
    let alt = stmt.childForFieldName('alternative');
    while (alt) {
      const altBody = alt.namedChildren.find((child): child is Node => Boolean(child)) ?? null;
      if (altBody?.type === 'if_statement') {
        const altLine = this.line(altBody);
        const altCondition = altBody.childForFieldName('condition');
        const altOwn = this.conditionSteps(altCondition, 'elif', altLine, 'is true');
        const altRoute = [...route, ...failed, ...altOwn];
        this.declare(altBody, inFunction);
        this.record(altBody, altRoute, inFunction);
        this.visitBlock(altBody.childForFieldName('consequence'), altRoute, inFunction);
        failed.push({ line: altLine, kind: 'elif', condition: text(unparen(altCondition)), outcome: 'is false' });
        alt = altBody.childForFieldName('alternative');
      } else {
        const altRoute = [...route, ...failed];
        this.declare(alt, inFunction);
        this.record(alt, altRoute, inFunction);
        this.visitBlock(altBody, altRoute, inFunction);
        alt = null;
      }
    }
  }

  private visitLoopStatement(stmt: Node, route: RouteStep[], inFunction: boolean): void {
    const line = this.line(stmt);
    this.declare(stmt, inFunction);
    let own: RouteStep[];
    if (stmt.type === 'for_in_statement') {
      own = [{ line, kind: 'loop', condition: `${text(stmt.childForFieldName('left'))} of ${text(stmt.childForFieldName('right'))}`, outcome: 'has at least one item' }, ...this.exprSteps(stmt.childForFieldName('right'), line)];
    } else if (stmt.type === 'for_statement') {
      own = [{ line, kind: 'loop', condition: text(unparen(stmt.childForFieldName('condition'))) || 'for (;;)', outcome: 'is true at least once' }, ...this.exprSteps(stmt.childForFieldName('condition'), line), ...this.exprSteps(stmt.childForFieldName('increment'), line)];
    } else if (stmt.type === 'while_statement') {
      own = this.conditionSteps(stmt.childForFieldName('condition'), 'loop', line, 'is true at least once');
    } else {
      // do { } while (c): the body runs once regardless; the condition decides repeats.
      own = [{ line, kind: 'loop', condition: text(unparen(stmt.childForFieldName('condition'))), outcome: 'is true, and separately false' }, ...this.exprSteps(stmt.childForFieldName('condition'), line)];
    }
    const inner = [...route, ...own];
    this.record(stmt, inner, inFunction);
    this.visitBlock(stmt.childForFieldName('body'), inner, inFunction);
  }

  private visitSwitchClause(clause: Node, subject: string, route: RouteStep[], earlier: RouteStep[], inFunction: boolean): void {
    const line = this.line(clause);
    let own: RouteStep[];
    if (clause.type === 'switch_case') {
      const value = text(clause.childForFieldName('value'));
      own = [...earlier, { line, kind: 'case', condition: `${subject} is ${value}`, outcome: 'is true' }];
      this.declare(clause, inFunction);
      this.record(clause, [...route, ...own], inFunction);
      this.visitStatements(clause.childrenForFieldName('body').filter((stmt): stmt is Node => Boolean(stmt)), [...route, ...own], inFunction);
      earlier.push({ line, kind: 'case', condition: `${subject} is ${value}`, outcome: 'is false' });
    } else {
      own = [...earlier];
      this.declare(clause, inFunction);
      this.record(clause, [...route, ...own], inFunction);
      this.visitStatements(clause.childrenForFieldName('body').filter((stmt): stmt is Node => Boolean(stmt)), [...route, ...own], inFunction);
    }
  }

  private isSwitchClause(node: Node | null | undefined): node is Node {
    return Boolean(node) && (node!.type === 'switch_case' || node!.type === 'switch_default');
  }

  private visitSwitchStatement(stmt: Node, route: RouteStep[], inFunction: boolean): void {
    const line = this.line(stmt);
    this.declare(stmt, inFunction);
    const subject = text(unparen(stmt.childForFieldName('value')));
    this.record(stmt, [...route, ...this.exprSteps(stmt.childForFieldName('value'), line)], inFunction);
    const body = stmt.childForFieldName('body');
    if (!body) {
      return;
    }
    const earlier: RouteStep[] = [];
    for (const clause of body.namedChildren) {
      if (!this.isSwitchClause(clause)) {
        continue;
      }
      this.visitSwitchClause(clause, subject, route, earlier, inFunction);
    }
  }

  private visitTryStatement(stmt: Node, route: RouteStep[], inFunction: boolean): void {
    this.declare(stmt, inFunction);
    this.record(stmt, route, inFunction);
    this.visitBlock(stmt.childForFieldName('body'), route, inFunction);
    const handler = stmt.childForFieldName('handler');
    if (handler) {
      const caught = text(handler.childForFieldName('parameter')) || 'any error';
      const own: RouteStep[] = this.options.countExcept ? [{ line: this.line(handler), kind: 'except', condition: caught, outcome: 'is thrown inside the try' }] : [];
      this.declare(handler, inFunction);
      this.record(handler, [...route, ...own], inFunction);
      this.visitBlock(handler.childForFieldName('body'), [...route, ...own], inFunction);
    }
    const finalizer = stmt.childForFieldName('finalizer');
    if (finalizer) {
      this.declare(finalizer, inFunction);
      this.record(finalizer, route, inFunction);
      this.visitBlock(finalizer.childForFieldName('body'), route, inFunction);
    }
  }

  private visitSimpleStatement(stmt: Node, route: RouteStep[], inFunction: boolean): void {
    this.declare(stmt, inFunction);
    this.record(stmt, [...route, ...this.exprSteps(stmt, this.line(stmt))], inFunction);
    this.visitNestedFunctions(stmt);
  }

  private visitTryOrSimpleStatement(stmt: Node, route: RouteStep[], inFunction: boolean): void {
    if (stmt.type === 'try_statement') {
      this.visitTryStatement(stmt, route, inFunction);
    } else {
      this.visitSimpleStatement(stmt, route, inFunction);
    }
  }

  private visitControlStatement(stmt: Node, route: RouteStep[], inFunction: boolean): void {
    if (stmt.type === 'if_statement') {
      this.visitIfStatement(stmt, route, inFunction);
    } else if (LOOP_STATEMENT_TYPES.has(stmt.type)) {
      this.visitLoopStatement(stmt, route, inFunction);
    } else if (stmt.type === 'switch_statement') {
      this.visitSwitchStatement(stmt, route, inFunction);
    } else {
      this.visitTryOrSimpleStatement(stmt, route, inFunction);
    }
  }

  private visitStatement(stmt: Node, route: RouteStep[], inFunction: boolean): void {
    if (stmt.type === 'export_statement') {
      this.visitExportStatement(stmt, route, inFunction);
      return;
    }
    if (DECLARATION_STATEMENT_TYPES.has(stmt.type)) {
      this.visitDeclarationStatement(stmt, route, inFunction);
      return;
    }
    if (WRAPPED_STATEMENT_TYPES.has(stmt.type)) {
      this.visitWrappedStatement(stmt, route, inFunction);
      return;
    }
    this.visitControlStatement(stmt, route, inFunction);
  }

  private complexityOf(node: Node | null): number {
    if (!node) {
      return 0;
    }
    let count = 0;
    const visit = (n: Node): void => {
      if (FUNCTION_TYPES.has(n.type) || CLASS_TYPES.has(n.type)) {
        return;
      }
      switch (n.type) {
        case 'if_statement':
        case 'for_statement':
        case 'for_in_statement':
        case 'while_statement':
        case 'do_statement':
        case 'catch_clause':
        case 'switch_case':
        case 'ternary_expression':
          count += 1;
          break;
        case 'binary_expression':
          if (SHORT_CIRCUIT.has(n.childForFieldName('operator')?.text ?? '')) {
            count += 1;
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
    return count;
  }
}

export function analyzeTypeScriptTree(path: string, tree: Tree, options: DepthOptions = DEFAULT_DEPTH_OPTIONS): FileStructure {
  const analyzer = new Analyzer(options);
  analyzer.analyzeProgram(tree.rootNode);
  analyzer.scoreCognitive();
  return {
    path,
    depth: analyzer.depth,
    routes: analyzer.routes,
    functions: analyzer.functions,
    unreachable: analyzer.unreachable,
    declarations: analyzer.declarations,
  };
}

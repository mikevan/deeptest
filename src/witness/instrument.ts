/**
 * Witness: the instrumenter.
 *
 * Rewrites a JavaScript or TypeScript source so that every statement,
 * function, and decision reports to the Witness runtime as it runs. The
 * rewrite is textual: counters are inserted into the source on the same
 * line as the thing they count, and nothing is regenerated, so every line
 * number in the instrumented file is the line number in the editor and no
 * source map is needed to get back. The parse tree comes from the same
 * tree-sitter grammars DeepTest uses for routes and depth, so what the
 * analysis calls a decision and what the runtime counts at run time are
 * decided by one tree.
 *
 * The maps it produces are Istanbul's shape (statementMap, fnMap,
 * branchMap, with the same node choices istanbul-lib-instrument makes), so
 * any Istanbul reporter and every existing DeepTest reader can consume the
 * counters unchanged. Where the two differ is deliberate and documented in
 * docs/witness.md; the differential test in test/witness.test.ts pins the
 * agreement on every fixture.
 *
 * Counters, on the per-file object W the runtime hands out:
 *   W.s(id)             a statement ran
 *   W.v(id, name, expr) a statement whose value is an expression (a
 *                       declarator or class field initialiser); returns
 *                       the value, and gives an anonymous function the
 *                       name it would have had, which a plain sequence
 *                       expression would take away
 *   W.f(id)             a function was entered
 *   W.b(id, cond)       a two-way decision (if, ternary); records which
 *                       way it went and returns the condition's value
 *   W.l(id, i, expr)    the i-th operand of a boolean run, or a default
 *                       parameter value, was evaluated; returns it
 *   W.c(id, i)          the i-th case of a switch was entered
 */
import type { Node, Parser, Tree } from 'web-tree-sitter';

export interface Position {
  line: number;
  column: number;
}
export interface Location {
  start: Position;
  end: Position;
}
export interface FunctionMapEntry {
  name: string;
  decl: Location;
  loc: Location;
  line: number;
}
export interface BranchMapEntry {
  type: string;
  line: number;
  loc: Location;
  locations: Location[];
}
export interface WitnessMaps {
  path: string;
  statementMap: Record<string, Location>;
  fnMap: Record<string, FunctionMapEntry>;
  branchMap: Record<string, BranchMapEntry>;
  /** Decisions left uncounted, with the line and the reason; never silent. */
  skipped: Array<{ line: number; reason: string }>;
}

export interface Instrumented {
  code: string;
  maps: WitnessMaps;
  /** The identifier the instrumented code uses for its per-file runtime object. */
  handle: string;
}

const STATEMENT_TYPES = new Set([
  'expression_statement',
  'break_statement',
  'continue_statement',
  'debugger_statement',
  'return_statement',
  'throw_statement',
  'try_statement',
  'if_statement',
  'for_statement',
  'for_in_statement',
  'while_statement',
  'do_statement',
  'switch_statement',
  'with_statement',
  'labeled_statement',
]);
const FUNCTION_TYPES = new Set(['function_declaration', 'function_expression', 'function', 'generator_function', 'generator_function_declaration', 'arrow_function', 'method_definition']);
const LOGICAL = new Set(['&&', '||', '??']);
export const MISPARSE = 'the grammar reads a non-null assertion (x!) after a logical operator as covering the whole run, so the operands cannot be told apart; the statement is counted, the decision is not';
// Logical assignment (a ??= b) is a decision to the structure analysis but not
// a branch to istanbul-lib-instrument 6, so the Istanbul view leaves it out too.
const WRAPPING_BODIES: Array<[string, string[]]> = [
  ['if_statement', ['consequence']],
  ['for_statement', ['body']],
  ['for_in_statement', ['body']],
  ['while_statement', ['body']],
  ['do_statement', ['body']],
  ['with_statement', ['body']],
];

interface Edit {
  at: number;
  text: string;
  /** Lower goes first at the same offset. */
  order: number;
  /** Insertion sequence; openers keep it, closers reverse it, so nested wrappers close inside out. */
  seq: number;
  closer: boolean;
}

function loc(node: Node): Location {
  return {
    start: { line: node.startPosition.row + 1, column: node.startPosition.column },
    end: { line: node.endPosition.row + 1, column: node.endPosition.column },
  };
}

function emptyLoc(node: Node): Location {
  const p = { line: node.startPosition.row + 1, column: node.startPosition.column };
  return { start: p, end: p };
}

/** A string-literal statement in the directive prologue of a program or function body. */
function isDirective(node: Node): boolean {
  if (node.type !== 'expression_statement' || node.namedChildCount !== 1 || node.namedChild(0)!.type !== 'string') {
    return false;
  }
  const parent = node.parent;
  if (!parent || (parent.type !== 'program' && parent.type !== 'statement_block')) {
    return false;
  }
  if (parent.type === 'statement_block' && !(parent.parent && FUNCTION_TYPES.has(parent.parent.type))) {
    return false;
  }
  for (let i = 0; i < parent.namedChildCount; i += 1) {
    const sibling = parent.namedChild(i)!;
    if (sibling.id === node.id) {
      return true;
    }
    if (sibling.type === 'comment') {
      continue;
    }
    if (sibling.type !== 'expression_statement' || sibling.namedChildCount !== 1 || sibling.namedChild(0)!.type !== 'string') {
      return false;
    }
  }
  return false;
}

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export class Instrumenter {
  private edits: Edit[] = [];
  private statements: Location[] = [];
  private functions: FunctionMapEntry[] = [];
  private branches: BranchMapEntry[] = [];
  private skipped: Array<{ line: number; reason: string }> = [];
  private handle = '';

  constructor(private readonly parser: Parser) {}

  /**
   * Instruments `source` for the file at `filePath` (absolute, forward
   * slashes). With `embedMaps`, the file's prologue carries its own maps,
   * for a runtime that cannot be told about the file any other way (a
   * browser page); without it the loader registers the maps in-thread.
   */
  instrument(filePath: string, source: string, embedMaps = false): Instrumented {
    this.edits = [];
    this.statements = [];
    this.functions = [];
    this.branches = [];
    this.skipped = [];
    this.handle = `__witness_${hash(filePath)}`;
    // Pass one finds TypeScript's non-null assertions and blanks them; they
    // mean nothing at run time, and the grammar reads `a && b!.c` as
    // `(a && b)!.c` (tree-sitter/tree-sitter-typescript issue 299), which
    // would put operand counters in the wrong places. Pass two parses the
    // blanked text, which is the same program with the right tree.
    const blanked = this.blankNonNull(source);
    const tree: Tree | null = this.parser.parse(blanked);
    if (!tree) {
      throw new Error(`Witness could not parse ${filePath}`);
    }
    const maps: WitnessMaps = { path: filePath, statementMap: {}, fnMap: {}, branchMap: {}, skipped: this.skipped };
    try {
      this.visit(tree.rootNode);
      this.statements.forEach((s, i) => (maps.statementMap[String(i)] = s));
      this.functions.forEach((f, i) => (maps.fnMap[String(i)] = f));
      this.branches.forEach((b, i) => (maps.branchMap[String(i)] = b));
      this.prologue(tree.rootNode, blanked, embedMaps ? maps : undefined);
    } finally {
      tree.delete();
    }
    const code = this.apply(blanked);
    return { code, maps, handle: this.handle };
  }

  private blankNonNull(source: string): string {
    const tree: Tree | null = this.parser.parse(source);
    if (!tree) {
      return source;
    }
    const bangs: number[] = [];
    const walk = (n: Node): void => {
      if (n.type === 'non_null_expression') {
        const last = n.child(n.childCount - 1);
        if (last && last.type === '!') {
          bangs.push(last.startIndex);
        }
      }
      for (let i = 0; i < n.namedChildCount; i += 1) {
        const c = n.namedChild(i);
        if (c) {
          walk(c);
        }
      }
    };
    try {
      walk(tree.rootNode);
    } finally {
      tree.delete();
    }
    if (bangs.length === 0) {
      return source;
    }
    const chars = source.split('');
    for (const at of bangs) {
      chars[at] = ' ';
    }
    return chars.join('');
  }

  /** The maps alone, for a file no test will load: same rules, no rewrite kept. */
  mapsOnly(filePath: string, source: string): WitnessMaps {
    return this.instrument(filePath, source).maps;
  }

  // ---- edits ----

  private insert(at: number, text: string, order = 5, closer = false): void {
    this.edits.push({ at, text, order, seq: this.edits.length, closer });
  }

  private apply(source: string): string {
    const edits = [...this.edits].sort((a, b) => a.at - b.at || a.order - b.order || (a.closer && b.closer ? b.seq - a.seq : a.seq - b.seq));
    let out = '';
    let cursor = 0;
    for (const e of edits) {
      out += source.slice(cursor, e.at) + e.text;
      cursor = e.at;
    }
    return out + source.slice(cursor);
  }

  /** `const W = globalThis.__witness__.file("<id>"[, maps]);` after any shebang and directive prologue. */
  private prologue(root: Node, source: string, maps?: WitnessMaps): void {
    let at = 0;
    if (source.startsWith('#!')) {
      at = source.indexOf('\n') + 1;
    }
    for (let i = 0; i < root.namedChildCount; i += 1) {
      const child = root.namedChild(i)!;
      if (child.type === 'comment') {
        continue;
      }
      if (!isDirective(child)) {
        break;
      }
      at = child.endIndex;
    }
    const embedded = maps ? `, ${JSON.stringify({ path: maps.path, statementMap: maps.statementMap, fnMap: maps.fnMap, branchMap: maps.branchMap })}` : '';
    this.insert(at, `const ${this.handle} = globalThis.__witness__.file(${JSON.stringify(this.handle)}${embedded});`, 0);
  }

  // ---- counters ----

  private statement(node: Node): number {
    const id = this.statements.length;
    this.statements.push(loc(node));
    return id;
  }

  private coverStatement(node: Node): void {
    const id = this.statement(node);
    this.insert(node.startIndex, `${this.handle}.s(${id});`, 3);
  }

  /** A statement whose worth is an expression: the initialiser of a declarator or a class field. */
  private coverValue(value: Node, name: string): void {
    const id = this.statement(value);
    this.insert(value.startIndex, `${this.handle}.v(${id}, ${JSON.stringify(name)}, `, 4);
    this.insert(value.endIndex, ')', 1, true);
  }

  private coverFunction(node: Node): void {
    const body = node.childForFieldName('body');
    if (!body) {
      return; // an overload signature or an abstract method
    }
    const nameNode = node.childForFieldName('name');
    let name = nameNode?.text ?? '';
    if (!name) {
      const parent = node.parent;
      if (parent?.type === 'variable_declarator' || parent?.type === 'public_field_definition' || parent?.type === 'pair' || parent?.type === 'assignment_expression') {
        name = (parent.childForFieldName('name') ?? parent.childForFieldName('key') ?? parent.childForFieldName('left'))?.text ?? '';
      }
    }
    const id = this.functions.length;
    this.functions.push({
      name: name || '(anonymous_' + id + ')',
      decl: { start: loc(node).start, end: loc(body).start },
      loc: loc(body),
      line: node.startPosition.row + 1,
    });
    if (body.type === 'statement_block') {
      this.insert(body.startIndex + 1, `${this.handle}.f(${id});`, 2);
    } else {
      // An arrow with an expression body: istanbul turns it into a block
      // with a return and counts that return as a statement. Same here.
      const sid = this.statement(body);
      this.insert(body.startIndex, `(${this.handle}.f(${id}), ${this.handle}.s(${sid}), `, 4);
      this.insert(body.endIndex, ')', 1, true);
    }
  }

  private branch(type: string, node: Node, locations: Location[]): number {
    const id = this.branches.length;
    this.branches.push({ type, line: node.startPosition.row + 1, loc: loc(node), locations });
    return id;
  }

  private wrapCondition(id: number, condition: Node, statementId?: number): void {
    // `if (x)` keeps its parentheses: the wrapper goes inside them.
    const target = condition.type === 'parenthesized_expression' && condition.namedChildCount === 1 ? condition.namedChild(0)! : condition;
    const prefix = statementId === undefined ? '' : `${this.handle}.s(${statementId}), `;
    this.insert(target.startIndex, `(${prefix}${this.handle}.b(${id}, `, 4);
    this.insert(target.endIndex, '))', 1, true);
  }

  private wrapOperand(id: number, index: number, node: Node): void {
    this.insert(node.startIndex, `${this.handle}.l(${id}, ${index}, `, 4);
    this.insert(node.endIndex, ')', 1, true);
  }

  /** Braces around a bare statement body. An `else if` keeps its shape; it is a statement of its own with its own counters. */
  private blockify(node: Node | null, elseBranch = false): void {
    if (!node || node.type === 'statement_block' || node.type === 'empty_statement' || (elseBranch && node.type === 'if_statement')) {
      return;
    }
    this.insert(node.startIndex, '{', 1);
    this.insert(node.endIndex, '}', 9, true);
  }

  // ---- the walk ----

  private visit(node: Node): void {
    const type = node.type;
    if (type === 'variable_declarator') {
      const value = node.childForFieldName('value');
      if (value) {
        this.coverValue(value, node.childForFieldName('name')?.text ?? '');
      }
    } else if (type === 'public_field_definition') {
      const value = node.childForFieldName('value');
      if (value) {
        this.coverValue(value, node.childForFieldName('name')?.text ?? '');
      }
    } else if (STATEMENT_TYPES.has(type)) {
      // A label must sit directly on its loop for `continue label` to
      // parse, so the loop under a label carries no counter of its own; the
      // labeled statement's counter is on the same line. A directive
      // ('use strict') is not a statement to Istanbul or to the engine, and
      // a counter in front of it would demote it to a plain string.
      // An `else if` is a statement to Istanbul but a counter in front of it
      // would split it from its `else` (`else W.s(2); if (...)` is a different
      // program), so its counter rides inside the condition instead.
      const elseIf = type === 'if_statement' && node.parent?.type === 'else_clause';
      if (node.parent?.type !== 'labeled_statement' && !isDirective(node) && !elseIf) {
        this.coverStatement(node);
      }
      this.coverControl(node, elseIf ? this.statement(node) : undefined);
    } else if (FUNCTION_TYPES.has(type)) {
      this.coverFunction(node);
    } else if (type === 'ternary_expression') {
      const condition = node.childForFieldName('condition')!;
      if (this.misparsed(condition)) {
        this.skipped.push({ line: node.startPosition.row + 1, reason: MISPARSE });
      } else {
        const consequence = node.childForFieldName('consequence')!;
        const alternative = node.childForFieldName('alternative')!;
        const id = this.branch('cond-expr', node, [loc(consequence), loc(alternative)]);
        this.wrapCondition(id, condition);
      }
    } else if (type === 'binary_expression' && LOGICAL.has(node.childForFieldName('operator')?.text ?? '')) {
      if (!this.isOperandOfSameRun(node)) {
        if (this.misparsed(node)) {
          this.skipped.push({ line: node.startPosition.row + 1, reason: MISPARSE });
        } else {
          const operands = this.flattenRun(node, node.childForFieldName('operator')!.text);
          const id = this.branch('binary-expr', node, operands.map(loc));
          operands.forEach((o, i) => this.wrapOperand(id, i, o));
        }
      }
    } else if ((type === 'required_parameter' || type === 'optional_parameter') && node.childForFieldName('value')) {
      const value = node.childForFieldName('value')!;
      const id = this.branch('default-arg', node, [loc(value)]);
      this.wrapOperand(id, 0, value);
    } else if (type === 'assignment_pattern' || type === 'object_assignment_pattern') {
      // A default anywhere a pattern can carry one: a parameter, a
      // destructured parameter, or a destructuring declaration in a body.
      // Istanbul counts them all as default-arg branches.
      const value = node.childForFieldName('right')!;
      const id = this.branch('default-arg', node, [loc(value)]);
      this.wrapOperand(id, 0, value);
    }
    for (let i = 0; i < node.namedChildCount; i += 1) {
      const child = node.namedChild(i);
      if (child) {
        this.visit(child);
      }
    }
  }

  private coverControl(node: Node, statementInCondition?: number): void {
    const type = node.type;
    if (type === 'if_statement') {
      const consequence = node.childForFieldName('consequence')!;
      const alternative = node.childForFieldName('alternative');
      const elseBody = alternative?.namedChild(0) ?? null;
      const id = this.branch('if', node, [loc(consequence), elseBody ? loc(elseBody) : emptyLoc(node)]);
      this.wrapCondition(id, node.childForFieldName('condition')!, statementInCondition);
      this.blockify(consequence);
      this.blockify(elseBody, true);
    } else if (type === 'switch_statement') {
      const body = node.childForFieldName('body')!;
      const cases: Node[] = [];
      for (let i = 0; i < body.namedChildCount; i += 1) {
        const c = body.namedChild(i)!;
        if (c.type === 'switch_case' || c.type === 'switch_default') {
          cases.push(c);
        }
      }
      const id = this.branch('switch', node, cases.map(loc));
      cases.forEach((c, i) => {
        // After the colon that ends the case label.
        const colon = this.colonOf(c);
        this.insert(colon + 1, `${this.handle}.c(${id}, ${i});`, 2);
      });
    } else {
      for (const [t, fields] of WRAPPING_BODIES) {
        if (t === type) {
          for (const f of fields) {
            this.blockify(node.childForFieldName(f));
          }
        }
      }
    }
  }

  private colonOf(switchCase: Node): number {
    for (let i = switchCase.childCount - 1; i >= 0; i -= 1) {
      const c = switchCase.child(i)!;
      if (c.type === ':') {
        return c.startIndex;
      }
    }
    return switchCase.startIndex;
  }

  /**
   * Istanbul makes one branch of a whole run of logical operators, whatever
   * the operators and however the parentheses fall (`a || (b && c)` is one
   * branch with three operands), so a logical expression inside another
   * logical expression is not a branch of its own.
   */
  private isOperandOfSameRun(node: Node): boolean {
    let parent = node.parent;
    while (parent && parent.type === 'parenthesized_expression') {
      parent = parent.parent;
    }
    return Boolean(parent && parent.type === 'binary_expression' && LOGICAL.has(parent.childForFieldName('operator')?.text ?? ''));
  }

  /**
   * tree-sitter-typescript reads `a || b!.c === d` as `(a || b)!.c === d`:
   * a non-null assertion directly over a binary expression, which no real
   * program contains. Wrapping operands on that reading would record the
   * wrong outcome, so such a run is left uncounted and reported, never
   * guessed at. Statements around it are counted as usual.
   */
  private misparsed(node: Node): boolean {
    if (node.type === 'non_null_expression' && node.namedChildCount === 1 && node.namedChild(0)!.type === 'binary_expression') {
      return true;
    }
    let up = node.parent;
    while (up && up.type === 'parenthesized_expression') {
      up = up.parent;
    }
    if (node.type === 'binary_expression' && up?.type === 'non_null_expression') {
      return true;
    }
    for (let i = 0; i < node.namedChildCount; i += 1) {
      const child = node.namedChild(i)!;
      if (FUNCTION_TYPES.has(child.type)) {
        continue;
      }
      if (this.misparsed(child)) {
        return true;
      }
    }
    return false;
  }

  private flattenRun(node: Node, _operator: string): Node[] {
    const out: Node[] = [];
    const walk = (n: Node): void => {
      const inner = n.type === 'parenthesized_expression' && n.namedChildCount === 1 ? n.namedChild(0)! : n;
      if (inner.type === 'binary_expression' && LOGICAL.has(inner.childForFieldName('operator')?.text ?? '')) {
        walk(inner.childForFieldName('left')!);
        walk(inner.childForFieldName('right')!);
      } else {
        out.push(n);
      }
    };
    walk(node);
    return out;
  }
}


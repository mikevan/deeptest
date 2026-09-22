/**
 * Does the tool we are about to drive actually run on this Node?
 *
 * Every npm package may declare `engines.node`, a semver range saying which
 * Node versions it supports. Nothing read it before 1.0.15, so the sequence
 * a person saw was: the setup screen says the environment is ok, the check
 * starts, and then the tool itself refuses. `checkAngularEnvironment` did
 * exactly that, reporting "ok" on a machine whose Node the Angular CLI would
 * not start on. The environment check has one job, to say whether this
 * project can be checked, and it was answering without looking at the
 * requirement the tool publishes for that purpose.
 *
 * Reading the range means understanding it, which means a semver matcher.
 * `semver` the package is the obvious answer and is not taken: principle 7
 * says nothing extra to install, DeepTest bundles what it imports, and the
 * subset of the grammar that `engines.node` fields actually use is small
 * enough to implement and pin with tests. What is supported is written
 * below, and anything outside it is treated as "cannot tell", which lets the
 * run proceed rather than refusing a project over a range we failed to read.
 * Refusing on a misread range would be the same class of wrong answer this
 * file exists to remove, pointed the other way.
 *
 * Supported: `||` between alternatives, spaces between requirements that
 * must all hold, the comparators `^ ~ >= <= > < =` and a bare version, and
 * `*` or an empty range for anything. Partial versions (`^22`, `>=22.22`)
 * fill the missing parts with zero. Prerelease and build metadata are
 * stripped: a person running a Node prerelease is past the point where this
 * check helps them.
 */

/** A version as the three numbers that order it. */
export interface Version {
  major: number;
  minor: number;
  patch: number;
}

/** "v22.22.0", "22.22", "22" -> the three numbers. Undefined when it is not a version at all. */
export function parseVersion(text: string): Version | undefined {
  const cleaned = text.trim().replace(/^[v=]+/, '').split(/[-+]/)[0];
  const parts = cleaned.split('.');
  if (parts.length === 0 || parts[0] === '') {
    return undefined;
  }
  const numbers: number[] = [];
  for (const part of parts.slice(0, 3)) {
    if (!/^\d+$/.test(part)) {
      return undefined;
    }
    numbers.push(Number(part));
  }
  return { major: numbers[0], minor: numbers[1] ?? 0, patch: numbers[2] ?? 0 };
}

/** Negative when a is older, zero when they are the same, positive when a is newer. */
export function compareVersions(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** One requirement: the version must be `op` the bound. */
interface Bound {
  op: '>=' | '<' | '>' | '<=' | '=';
  version: Version;
}

/**
 * `^22.22.3` and `~22.22.3` each stand for two bounds, so every comparator
 * expands to a list. Undefined means the comparator could not be read, which
 * makes the whole range unreadable.
 */
function expand(comparator: string): Bound[] | undefined {
  const text = comparator.trim();
  if (text === '' || text === '*' || text === 'x') {
    return [];
  }
  const match = /^(\^|~|>=|<=|>|<|=)?\s*(.+)$/.exec(text);
  if (!match) {
    return undefined;
  }
  const version = parseVersion(match[2]);
  if (!version) {
    return undefined;
  }
  const operator = match[1] ?? '=';
  if (operator === '^') {
    // Up to the next version that may break: the next major, or for 0.x the
    // next minor, or for 0.0.x the next patch. npm's rule, kept as npm has it.
    const upper: Version =
      version.major > 0
        ? { major: version.major + 1, minor: 0, patch: 0 }
        : version.minor > 0
          ? { major: 0, minor: version.minor + 1, patch: 0 }
          : { major: 0, minor: 0, patch: version.patch + 1 };
    return [{ op: '>=', version }, { op: '<', version: upper }];
  }
  if (operator === '~') {
    return [{ op: '>=', version }, { op: '<', version: { major: version.major, minor: version.minor + 1, patch: 0 } }];
  }
  return [{ op: operator as Bound['op'], version }];
}

function holds(version: Version, bound: Bound): boolean {
  const order = compareVersions(version, bound.version);
  switch (bound.op) {
    case '>=':
      return order >= 0;
    case '<=':
      return order <= 0;
    case '>':
      return order > 0;
    case '<':
      return order < 0;
    default:
      return order === 0;
  }
}

/**
 * Whether the version satisfies the range. Undefined, not false, when the
 * range uses something this reader does not support: the caller then lets
 * the run proceed instead of refusing a project over a range we misread.
 */
export function satisfies(version: Version, range: string): boolean | undefined {
  const alternatives = range.split('||');
  let readable = false;
  for (const alternative of alternatives) {
    const bounds: Bound[] = [];
    let ok = true;
    for (const comparator of alternative.trim().split(/\s+/)) {
      const expanded = expand(comparator);
      if (!expanded) {
        ok = false;
        break;
      }
      bounds.push(...expanded);
    }
    if (!ok) {
      continue;
    }
    readable = true;
    if (bounds.every((bound) => holds(version, bound))) {
      return true;
    }
  }
  return readable ? false : undefined;
}

/** What a package says it needs, and what it calls itself. */
export interface Declared {
  name: string;
  version: string;
  node: string;
}

/**
 * The `engines.node` range an installed package declares, with its own
 * version for the sentence. Undefined when the package declares nothing,
 * which most do; that is not a problem, it is silence.
 */
export function declaredEngines(packageJsonText: string, fallbackName: string): Declared | undefined {
  let parsed: { name?: string; version?: string; engines?: { node?: string } };
  try {
    parsed = JSON.parse(packageJsonText);
  } catch {
    return undefined;
  }
  const node = parsed.engines?.node;
  if (typeof node !== 'string' || node.trim() === '') {
    return undefined;
  }
  return { name: parsed.name ?? fallbackName, version: parsed.version ?? '', node };
}

/** A tool that will not run here, ready for engineMismatchSentence to phrase. */
export interface EngineMismatch {
  /** The package's own name, as it calls itself. */
  tool: string;
  /** Its version, or an empty string when it does not say. */
  toolVersion: string;
  /** The range it declares. */
  requires: string;
  /** The Node that would run it, as `node --version` printed it. */
  installed: string;
}

/**
 * The first tool in the list that declares a Node range the running Node
 * does not satisfy. Undefined when every tool is happy, declares nothing, or
 * declares something this reader cannot parse.
 */
export function engineMismatch(nodeVersion: string, packages: Array<{ name: string; packageJsonText: string | undefined }>): EngineMismatch | undefined {
  const running = parseVersion(nodeVersion);
  if (!running) {
    return undefined;
  }
  for (const pkg of packages) {
    if (pkg.packageJsonText === undefined) {
      continue;
    }
    const declared = declaredEngines(pkg.packageJsonText, pkg.name);
    if (!declared) {
      continue;
    }
    if (satisfies(running, declared.node) === false) {
      return { tool: declared.name, toolVersion: declared.version, requires: declared.node, installed: nodeVersion };
    }
  }
  return undefined;
}

/**
 * What the person reads when a tool will not run here. The package is named
 * as npm names it, because that is the name they will type if they go
 * looking, and both versions are given so the sentence can be checked rather
 * than believed. It names the button on the panel's failure state exactly.
 *
 * It lives here and not in ui/words.ts because environment sentences belong
 * to the plugin that discovers them: the Python plugin keeps
 * missingPackagesSentence the same way, and nothing under src/languages/
 * imports src/ui/.
 */
export function engineMismatchSentence(mismatch: EngineMismatch): string {
  const named = mismatch.toolVersion ? `${mismatch.tool} ${mismatch.toolVersion}` : mismatch.tool;
  return `${named} does not run on this Node. It needs Node ${mismatch.requires}, and ${mismatch.installed} is what would run it. Update Node to a version it supports, then press "Check my code again".`;
}

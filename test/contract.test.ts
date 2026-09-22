/**
 * The contract between the tools, checked against the tools.
 *
 * `docs/toolkit/toolkit-api.md` is the published contract: what a sibling may
 * call, what it may read, and what it may expect back. Draft 5 of it published
 * five silent commands, an event surface, a public record file, and an
 * integration between DeepTest and UntangleIt, and not one of those existed in
 * either tool. Nothing caught it, because nothing was looking. A document that
 * is right today and unchecked tomorrow drifts the same way again, so this
 * test is the check.
 *
 * Four rules, and only four. Every command the document publishes is
 * registered by the tool that publishes it. Each tool's `prsToolkit.commands`
 * is exactly the set of silent commands published for it, and every one is
 * registered. Both tools declare a complete `prsToolkit` block. Every public
 * record path is demonstrably written by the tool that owns it.
 *
 * Two things it deliberately does not do. It stops reading at section 10,
 * which is where designs that are not built are kept, so a proposal can never
 * be mistaken for a promise or fail this test. And it does not validate
 * KeepSafe, which is someone else's repository: it checks only that the one
 * KeepSafe command our code actually invokes is the one the document says we
 * invoke.
 *
 * It keys off the section headings and the tables under them, never off
 * backticks in ordinary prose, so rewording an explanation cannot fail a
 * build. The first test below proves each rule fires, against small trees
 * built for the purpose; the second runs the rules against the real ones.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Where section 10 begins. Everything from here on is a design, not a promise. */
const PROPOSED = '## 10. Proposed, not built';

/** The heading each tool's command table sits under, and the name it goes by in the records table. */
const TOOLS = [
  { tool: 'deeptest', heading: '### 3.2 DeepTest', row: 'DeepTest', root: () => process.cwd() },
  { tool: 'untangleit', heading: '### 3.3 UntangleIt', row: 'UntangleIt', root: () => path.resolve(process.cwd(), '..', 'UntangleIt') },
] as const;

/** The one KeepSafe command this toolkit calls. KeepSafe is not ours to check further. */
const KEEPSAFE_COMMAND = 'keepsafe.quickCheckpoint';

/** The contract half of the document: everything above section 10. */
function contractOnly(doc: string): string {
  const at = doc.indexOf(PROPOSED);
  assert.ok(at > 0, `The contract document must keep the heading "${PROPOSED}". Without it there is no line between what is built and what is only designed, and this test would start reading designs as promises.`);
  return doc.slice(0, at);
}

/** The rows of the markdown table under a heading, each row as its cells. */
function tableUnder(doc: string, heading: string): string[][] {
  const lines = contractOnly(doc).split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === heading);
  assert.ok(start >= 0, `The contract document must have a section headed "${heading}".`);
  const rows: string[][] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith('#')) {
      break;
    }
    if (!line.trim().startsWith('|')) {
      continue;
    }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length === 0 || /^-+$/.test(cells[0]) || cells[0] === 'Command' || cells[0] === 'Tool') {
      continue;
    }
    rows.push(cells);
  }
  return rows;
}

/** The single backticked token in a cell, or undefined. */
function ticked(cell: string): string | undefined {
  return /^`([^`]+)`/.exec(cell)?.[1];
}

/** What the document publishes for one tool: every command, and which of them are silent. */
function published(doc: string, heading: string): { all: string[]; silent: string[] } {
  const all: string[] = [];
  const silent: string[] = [];
  for (const cells of tableUnder(doc, heading)) {
    const name = ticked(cells[0]);
    if (!name) {
      continue;
    }
    all.push(name);
    if (cells[1] === 'silent') {
      silent.push(name);
    }
  }
  return { all, silent };
}

/** The public record path each tool owns, from the records table. */
function publishedRecords(doc: string): Array<{ row: string; file: string }> {
  const out: Array<{ row: string; file: string }> = [];
  for (const cells of tableUnder(doc, '## 4. Records on disk')) {
    const file = ticked(cells[2] ?? '');
    if (file) {
      out.push({ row: cells[0], file });
    }
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(p));
    } else if (entry.name.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

/** Every command the tool registers, from its own source. */
function registeredCommands(srcDir: string): string[] {
  const found = new Set<string>();
  for (const file of sourceFiles(srcDir)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/registerCommand\(\s*'([^']+)'/g)) {
      found.add(m[1]);
    }
  }
  return Array.from(found).sort();
}

/**
 * Whether the tool demonstrably writes that path. Both tools build a record
 * path from its folder and its file name and write it with writeFileSync, so
 * the proof is one source file carrying all three. It is deliberately not a
 * match on the joined string: nobody writes ".deeptest/decisions.json" as one
 * literal, and a check that demanded it would be satisfied by a comment.
 */
function writesRecord(srcDir: string, record: string): boolean {
  const folder = record.split('/')[0];
  const base = record.split('/').pop()!;
  return sourceFiles(srcDir).some((file) => {
    const text = fs.readFileSync(file, 'utf8');
    return text.includes('writeFileSync') && text.includes(`'${folder}'`) && text.includes(`'${base}'`);
  });
}

interface ToolFacts {
  tool: string;
  row: string;
  heading: string;
  packageJson: { prsToolkit?: { protocol?: unknown; verb?: unknown; commands?: unknown; records?: unknown } };
  registered: string[];
  srcDir: string;
}

/** The four rules. Every problem is a sentence a person can act on. */
function contractProblems(doc: string, tools: ToolFacts[]): string[] {
  const problems: string[] = [];
  for (const t of tools) {
    const { all, silent } = published(doc, t.heading);
    // 1. Published means registered.
    for (const name of all) {
      if (!t.registered.includes(name)) {
        problems.push(`${t.row} publishes "${name}" in the contract and does not register it. Either register it or move it to section 10.`);
      }
    }
    // 3. The block exists and is complete.
    const block = t.packageJson.prsToolkit;
    if (!block) {
      problems.push(`${t.row} has no prsToolkit block in its package.json, so a sibling cannot discover it the way section 2 says siblings discover tools.`);
      continue;
    }
    for (const [key, ok] of [
      ['protocol', typeof block.protocol === 'number'],
      ['verb', typeof block.verb === 'string' && block.verb.length > 0],
      ['commands', Array.isArray(block.commands)],
      ['records', Array.isArray(block.records)],
    ] as const) {
      if (!ok) {
        problems.push(`${t.row}'s prsToolkit block is missing "${key}" or has it in the wrong shape.`);
      }
    }
    // 2. The block's commands are exactly the published silent ones, and each is registered.
    if (Array.isArray(block.commands)) {
      const declared = [...(block.commands as string[])].sort();
      const expected = [...silent].sort();
      if (JSON.stringify(declared) !== JSON.stringify(expected)) {
        problems.push(`${t.row}'s prsToolkit.commands is [${declared.join(', ')}] and the contract publishes the silent commands [${expected.join(', ')}]. The block lists silent commands and nothing else.`);
      }
      for (const name of declared) {
        if (!t.registered.includes(name)) {
          problems.push(`${t.row} declares "${name}" in prsToolkit.commands and does not register it.`);
        }
      }
    }
  }
  // 4. Every published record is written by the tool that owns it.
  for (const { row, file } of publishedRecords(doc)) {
    const owner = tools.find((t) => t.row === row);
    if (!owner) {
      problems.push(`The records table names "${row}", which is not a tool this test knows how to check.`);
      continue;
    }
    if (!writesRecord(owner.srcDir, file)) {
      problems.push(`${row} publishes "${file}" as a public record and nothing in its source writes it.`);
    }
  }
  return problems;
}

/**
 * Each rule, against trees built to break it. Without this the rules could all
 * be inverted and the real check below would still pass, which is the failure
 * this whole file exists to prevent.
 */
test('the contract rules fail on the things they are meant to catch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deeptest-contract-'));
  const src = path.join(dir, 'src');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'ext.ts'), "vscode.commands.registerCommand('t.run', run);\nvscode.commands.registerCommand('t.api.measure', m);\n");
  fs.writeFileSync(path.join(src, 'store.ts'), "const p = path.join(root, '.t', 'records.json');\nfs.writeFileSync(p, text);\n");

  const doc = [
    '# contract',
    '',
    '### 3.2 DeepTest',
    '',
    '| Command | Kind | Arguments | Result |',
    '|---|---|---|---|',
    '| `t.run` | interactive | none | runs |',
    '| `t.api.measure` | silent | none | measures |',
    '',
    '## 4. Records on disk',
    '',
    '| Tool | Folder | Public file | Meaning |',
    '|---|---|---|---|',
    '| DeepTest | `.t/` | `.t/records.json` | the records |',
    '',
    PROPOSED,
    '',
    '| Command | Kind | Arguments | Result |',
    '|---|---|---|---|',
    '| `t.api.dreamt` | silent | none | never built |',
    '',
  ].join('\n');

  const facts = (over: Partial<ToolFacts> = {}): ToolFacts[] => [
    {
      tool: 'deeptest',
      row: 'DeepTest',
      heading: '### 3.2 DeepTest',
      packageJson: { prsToolkit: { protocol: 1, verb: 'measure and judge', commands: ['t.api.measure'], records: ['.t/records.json'] } },
      registered: ['t.api.measure', 't.run'],
      srcDir: src,
      ...over,
    },
  ];

  assert.deepEqual(contractProblems(doc, facts()), [], 'a tool that does what it publishes has nothing to answer for');

  // The section 10 boundary: a command published only there is never required.
  assert.ok(
    !contractProblems(doc, facts()).some((p) => p.includes('t.api.dreamt')),
    'section 10 is a notebook, and nothing in it is a promise',
  );

  // 1. Published and not registered.
  const missing = contractProblems(doc, facts({ registered: ['t.api.measure'] }));
  assert.equal(missing.length, 1);
  assert.match(missing[0], /publishes "t\.run" in the contract and does not register it/);

  // 2. The block disagrees with the published silent commands.
  const wrongList = contractProblems(doc, facts({ packageJson: { prsToolkit: { protocol: 1, verb: 'v', commands: ['t.run'], records: [] } } }));
  assert.ok(wrongList.some((p) => /prsToolkit\.commands is \[t\.run\]/.test(p)), wrongList.join(' | '));
  assert.ok(wrongList.some((p) => /declares "t\.run" in prsToolkit\.commands/.test(p)) === false, 't.run is registered, so only the mismatch is reported');
  const unregistered = contractProblems(doc, facts({ packageJson: { prsToolkit: { protocol: 1, verb: 'v', commands: ['t.api.ghost'], records: [] } } }));
  assert.ok(unregistered.some((p) => /declares "t\.api\.ghost" in prsToolkit\.commands and does not register it/.test(p)));

  // 3. The block is missing, or incomplete.
  assert.match(contractProblems(doc, facts({ packageJson: {} }))[0], /has no prsToolkit block/);
  const incomplete = contractProblems(doc, facts({ packageJson: { prsToolkit: { verb: 'v', commands: ['t.api.measure'], records: [] } } }));
  assert.ok(incomplete.some((p) => /missing "protocol"/.test(p)), incomplete.join(' | '));

  // 4. A public record nothing writes.
  const empty = path.join(dir, 'empty');
  fs.mkdirSync(empty, { recursive: true });
  const unwritten = contractProblems(doc, facts({ srcDir: empty }));
  assert.ok(unwritten.some((p) => /publishes "\.t\/records\.json" as a public record and nothing in its source writes it/.test(p)));

  // A comment naming the file is not a write.
  const commentOnly = path.join(dir, 'comment');
  fs.mkdirSync(commentOnly, { recursive: true });
  fs.writeFileSync(path.join(commentOnly, 'a.ts'), "// writes .t/records.json one day\nexport const x = 1;\n");
  assert.ok(contractProblems(doc, facts({ srcDir: commentOnly })).some((p) => /nothing in its source writes it/.test(p)));
});

/**
 * The real trees. This is the one that fails when the product and the document
 * part company, and it needs UntangleIt checked out beside DeepTest, which is
 * the layout the release script builds on and the one every tree is developed
 * in. It fails loudly rather than skipping if the sibling is missing, because a
 * contract check that quietly measures half the toolkit is worse than none.
 */
test('the published contract matches DeepTest and UntangleIt as they are built', () => {
  const doc = fs.readFileSync(path.join('docs', 'toolkit', 'toolkit-api.md'), 'utf8');
  const facts: ToolFacts[] = TOOLS.map((t) => {
    const root = t.root();
    const pkg = path.join(root, 'package.json');
    assert.ok(fs.existsSync(pkg), `The contract test reads ${t.row} at ${root}, and there is no package.json there. UntangleIt has to be checked out beside DeepTest for this check to mean anything.`);
    return {
      tool: t.tool,
      row: t.row,
      heading: t.heading,
      packageJson: JSON.parse(fs.readFileSync(pkg, 'utf8')),
      registered: registeredCommands(path.join(root, 'src')),
      srcDir: path.join(root, 'src'),
    };
  });

  assert.deepEqual(contractProblems(doc, facts), []);

  // The KeepSafe integration, as narrowly as it can honestly be checked: the
  // document names one command, and both tools call that one and no other.
  const contract = contractOnly(doc);
  assert.ok(contract.includes(`\`${KEEPSAFE_COMMAND}\``), `The contract must name ${KEEPSAFE_COMMAND}, which is the only KeepSafe command this toolkit calls.`);
  for (const t of facts) {
    const calls = new Set<string>();
    for (const file of sourceFiles(t.srcDir)) {
      for (const m of fs.readFileSync(file, 'utf8').matchAll(/'(keepsafe\.[A-Za-z]+)'/g)) {
        calls.add(m[1]);
      }
    }
    assert.deepEqual(Array.from(calls), [KEEPSAFE_COMMAND], `${t.row} names ${Array.from(calls).join(', ') || 'no'} KeepSafe command(s); the contract says this toolkit calls only ${KEEPSAFE_COMMAND}.`);
  }
});

# DeepTest

The DeepTest engine inside a VS Code extension built for people who do not read code:
it checks an AI's work and says, in plain words, what is not done.

Coverage tells you a line ran. It does not tell you the line ran under enough
tests to matter. A failure path buried under five nested conditions that one
happy-path test happens to brush past is "covered." It is not tested. An AI
that ran out of context halfway through a feature leaves exactly that kind of
hole, and the person who ships it is the one who pays for it.

DeepTest scores every executable line against the decisions that guard it:

```
density(line) = distinct tests that executed the line
depth(line)   = decisions that must go a particular way to reach the line,
                plus decisions evaluated on the line itself
bar(line)     = max(depth, 1)
```

| Overlay | Meaning |
|---|---|
| Green, double check | Over the bar. More tests than decisions. |
| Light green, check | Met the bar exactly. |
| Yellow, triangle | Short. Some tests, not enough. |
| Red, cross | Untested. No test reached it. |
| Grey, dash | Unreachable. Delete it, do not test around it. |

The gutter glyphs differ in shape, so the overlay reads without colour.

## One button

Open the DeepTest view in the activity bar and press run. The first time,
a configuration screen opens with everything already filled in: the language
found in the workspace, the tests folder, the code under test, the test
runner from `package.json` or the interpreter the Python extension has
selected. For most projects the right move is to press "Save and run tests"
without touching a field. If a tool is missing (`coverage`, `pytest`,
`@vitest/coverage-istanbul`), DeepTest names it and offers to install it.

Every value it saves is an ordinary `deeptest.*` workspace setting.

## What you see

The side panel opens with the verdict in one line: "This is not ready: 4 lines were never tested." Under it, one button, three lines on what the tests say, and the worst lines as cards with Fix this, Accept as it is, and Open. No engineer's word appears anywhere unless you tick "Show the engineer's numbers next to the plain words."

## What you get

- A **per-line overlay** in every open file: tint, glyph, and `tests/bar` at
  the end of the line. Hover for the tests that reached it and how far the
  tests get along the route to it. The overlay follows your edits and flags
  the file as changed until the next run.
- A **sidebar** with the summary against your thresholds (line coverage,
  density pass rate, average density, cyclomatic complexity), the ranked
  shortfalls worst first, lines a person accepted, functions over the
  complexity limit, and unreachable code.
- A **report** for someone who does not read code. The five worst lines get
  the full story: the chain of decisions on the way to the line, where the
  existing tests stop, what the line does, and what to do. Everything else
  gets one row. Save it as Markdown to send on.
- **Decisions**, yours. On every shortfall: Fix this, Accept as it is, or
  Leave for now. Nothing happens without a person choosing it.

## The human rule

The tool finds and explains. The person who is accountable decides. Once
they decide, the assistant they choose does the work, and DeepTest judges
the result.

**Fix this** is the one place DeepTest hands work to an AI, so it asks
first. If the [KeepSafe](https://marketplace.visualstudio.com/items?itemName=KeepSafe.keepsafe)
extension is installed, DeepTest offers to create a KeepSafe checkpoint,
which is the undo button for everything the assistant is about to change.
Then a confirmation names the line and says what will happen; nothing is
sent until you press "Yes, send it". The brief itself carries the exact
line, the bar, the decisions on the route, where tests stop, and nearby
tests to copy in style; it goes to the editor's chat if there is one and to
the clipboard regardless. DeepTest carries no model and no key. If KeepSafe
is not installed, the setup screen recommends it and DeepTest says nothing
more about it. After the next run the line is green,
or the report says "fix attempted, still short by N" and it is your call
again. No retry on the tool's initiative.

**Fix this on a function** sits on the "Hardest to test" row and beside
every function in the report that is over your limit. There are two honest
answers to a function with too many ways through it, and you choose: break
it into smaller pieces that each fit under the limit without changing what
it does, or leave it alone and test every way through it. Either way the
same checkpoint offer and confirmation apply, the brief goes to your
assistant, and the next check measures the function again and says whether
it is within your limit now.

**Accept** records why the line may stay below its bar, with your name and
the date, in `.deeptest/decisions.json` next to the code. It leaves the
ranked list and sits in its own section with the reason beside it. A
decision is pinned to the text of the line; change the line and the
decision no longer applies, and says so.

## Languages

One contract, every language. The engine, overlay, sidebar, report, and
configuration screen know no language. A plugin supplies detection,
per-test coverage, structure (routes, depth, complexity, unreachable code),
and its own small block of configuration fields.

| Plugin | Runner | Per-test attribution | Structure |
|---|---|---|---|
| Python | pytest | coverage.py dynamic contexts, one run | tree-sitter-python |
| TypeScript / JavaScript | Jest or Vitest | Istanbul counters snapshotted around every test by a setup hook, one run | tree-sitter typescript, tsx, javascript |

Adding a language is a folder under `src/languages/` and one line in the
registry. If it needs an edit anywhere else, that is a bug in the contract.
Java, C#, C++, and one of PHP or Go are next.

## Depth rules

| Construct | Depth of the line and its body |
|---|---|
| `if C` | enclosing + 1 + short circuits in C |
| `elif` / `else if` | 1 per earlier branch (they went the other way) + its own condition |
| `else` | 1 per earlier branch. The other half of the same decisions. |
| `for` / `while` / `do` | enclosing + 1 |
| `try` body, `else`, `finally` | enclosing |
| k-th `except` / `catch` | enclosing + k |
| k-th `case` | enclosing + k, plus the guard if present; `default` counts the cases above it |
| `a and b`, `a && b`, `a or b`, `a \|\| b`, `a ?? b` | +1 per extra operand |
| `x if c else y`, `c ? x : y` | +1 |
| comprehension `for` / `if` clause (Python) | +1 each |

Depth restarts at 0 inside every function. Module-level statements, `def`,
`class`, and method headers, decorators, and field initialisers run at
import time, not under a test; they count for coverage and are excluded
from density. Every rule after the first is a checkbox.

"Worst" is the gap: complexity minus tests, largest first, then the deeper
bar. That one definition drives the sidebar, the status bar, and the report.

## Requirements

- VS Code 1.104 or newer.
- Python projects: the Python the project already uses (the one the Python extension selected, else the project's own `.venv`, else `python` on PATH) with `coverage` and `pytest` installed in it. DeepTest never brings a Python of its own.
- TypeScript / JavaScript projects: Node on PATH and Jest or Vitest in the
  project. Vitest also needs `@vitest/coverage-istanbul`.

Nothing else. No native modules, no extra extensions.

## Settings

All under `deeptest.`:

| Setting | Default | Purpose |
|---|---|---|
| `language` | detected | plugin id: `python`, `typescript` |
| `testsPath` | detected | tests folder, relative to the workspace |
| `sourceRoot` | detected | code under test; empty means the whole workspace minus tests |
| `languageSettings` | `{}` | per-plugin fields, edited by the configuration screen |
| `thresholds.minCoverage` | 80 | percent |
| `thresholds.minDensityPassRate` | 90 | percent of scored lines at or over their bar |
| `thresholds.minAverageDensity` | 1.0 | mean of tests/bar |
| `thresholds.maxFunctionComplexity` | 10 | per function |
| `report.detailedRoutes` | 5 | how many shortfalls the report explains in full |
| `depth.*` | all on | the counting rules above |
| `overlay.enabled`, `overlay.showInlineNumbers` | on | |
| `colors.*` | | background tints per state |

## Developing

```
npm install
npm test            # engine, parsers, adapters, decisions, report (Vitest; the Python case needs python3 with coverage and pytest)
npm run build       # bundle to dist/, copy wasm grammars and runner hooks
npm run test:vscode # launches VS Code against both fixture projects and drives the extension
```

To try a build in VS Code itself: `npx @vscode/vsce package --no-dependencies`,
then in the Extensions view choose "Install from VSIX..." from the "..." menu,
pick the file, and click "Restart Extensions" when offered.

DeepTest measures itself: point it at this repository with language
`typescript`, tests folder `test`, source root `src`. The engine, parsers,
and report sit at their bar; the editor-facing files only run inside the
integration suite, which Istanbul does not see, so they show red. That is
the truth and the tool is not going to soften it for its own author.

Every run writes `.deeptest/` into the workspace under test (runner
output, generated config, attribution, and `decisions.json`). Commit
`decisions.json`; ignore the rest.

## Known limits

- pytest parametrized cases share one function name under coverage.py's
  `test_function` context, so `test_x[1]` and `test_x[2]` count as one test.
  pytest-cov's `--cov-context=test` records node ids instead; the parser
  already accepts that format, the runner does not yet request it.
- Line coverage is what the summary reports. coverage.py's own percentage
  blends in branch coverage and reads lower.
- The density numerator is distinct test cases, not distinct assertions.
- Jest runs get `--setupFilesAfterEnv` with the project's own list plus the
  hook; Vitest runs use a generated config that wraps the project's. A
  project whose config is a function of the environment is called with
  `mode: 'test'`.

## License

DeepTest is free software under the GNU General Public License, version 3.0 only. See the LICENSE file.

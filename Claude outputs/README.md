# DeepTest

"Coverage tells you a line ran. DeepTest tells you whether it was tested."

![DeepTest in action: check, read the verdict, decide](media/deeptest.gif)

DeepTest checks an AI's work and says, in plain words, what is not done. It runs your own tests, then scores every line against the decisions that guard it: a failure path buried under five nested conditions needs five tests, not one happy-path test that happens to brush past it. The verdict comes first, in one sentence. You decide what to do about it.

### Why DeepTest

- **Density, not coverage**: Every line is scored against the number of decisions on the way to it, so a "covered" line that one test skims is reported as short.
- **Plain words first**: "This is not ready: 945 lines were never tested." The engineer's numbers sit behind one switch.
- **Routes, not guesses**: For every untested line, the chain of decisions on the way to it and exactly where your tests stop.
- **You decide, always**: Fix this, Accept as it is, or Leave for now. DeepTest never edits code and never accepts a fix on your behalf.
- **Your own runner**: pytest, Jest, or Vitest, the one your project already has. DeepTest ships no runtime.
- **100% local**: Results and decisions stay in `.deeptest/` in your workspace. No model, no key, no network.

### DeepTest + KeepSafe: Partners in Protection

"KeepSafe remembers where you were. DeepTest tells you whether you should go back."

Before DeepTest hands a fix to your AI assistant, it offers a KeepSafe checkpoint. After the assistant is done, DeepTest measures again. If the line is still short, the report says so, and the checkpoint is your way back.

### Workflow

**Check → Read the verdict → Fix, Accept, or Leave → Check again**

### Quick Start

1. Install DeepTest from the VS Code Marketplace.
2. Open the DeepTest panel and select Check my code. The setup screen opens once, already filled in; select Save and run tests.
3. Read the verdict. On each card, select Fix this, Accept as it is, or Open.
4. Select Check my code again after your assistant's work.

![DeepTest: the verdict, in plain words, first](media/panel.png)

---

## Features

**The verdict first**: One sentence at the top of the panel, then what the tests say against your limits, then the worst lines as cards.

**Per-line overlay**: Every open file shows each line's state in the gutter: green over the bar, light green met, yellow short, red untested, grey unreachable. The glyphs differ in shape, so it reads without colour. Hover for the tests that reached the line and how far along the route they got.

**Routes**: For every shortfall, the decisions that must go a particular way to reach the line, outermost first, with a tick or a cross on each for whether any test got past it.

**Three numbers per function**: Ways through (cyclomatic complexity), tangle by Campbell's Cognitive Complexity, and tangle by MikeVan's Better Cognitive Complexity (MBCC). Ways through drives the "Hardest to test" verdict; the two tangle numbers sit beside it, and the full report compares all three side by side.

**Fix this**: The one place DeepTest hands work to an AI, so it asks first. A KeepSafe checkpoint is offered, then a confirmation that names the line and says what will happen. The brief carries the line, its bar, the route, where tests stop, and nearby tests to copy in style. It goes to the editor's chat and to the clipboard.

**Fix this on a function**: Two honest answers to a function with too many ways through it: break it into smaller pieces without changing what it does, or leave it and test every way through. You choose. When UntangleIt is installed, "Break it into smaller pieces" hands the job to it.

**Accept as it is**: Records why a line may stay below its bar, with your name and the date, in `.deeptest/decisions.json` beside the code. Pinned to the text of the line; change the line and the decision says it no longer applies.

**Full report**: The five worst lines in full, the rest one row each, accepted lines with their reasons, unreachable code, the functions over your limit, and a "Ways through against tangle" table. Save as Markdown to send on.

**Honest failures**: A test run that fails before any test ran is reported as exactly that, with the runner's own words. DeepTest never scores a run in which no test ran.

### Commands

| Command | Function |
|---------|----------|
| **Check my code** | Run the tests and show the verdict |
| **Tell me where the tests are** | Open the setup screen |
| **Full report** | Open the full report |
| **Show what is happening** | Open the log |
| **Colour the lines in my files on or off** | Toggle the overlay |
| **Show the numbers (for engineers) on or off** | Show the engineer's numbers beside the plain words |

---

## How a Line Is Scored

```
density(line) = distinct tests that executed the line
depth(line)   = decisions that must go a particular way to reach the line,
                plus decisions evaluated on the line itself
bar(line)     = max(depth, 1)
```

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

Depth restarts at 0 inside every function. Module-level statements, `def`, `class`, and method headers, decorators, and field initialisers run at import time, not under a test; they count for coverage and are excluded from density. Every rule after the first is a checkbox in the settings.

"Worst" is the gap: bar minus tests, largest first, then the deeper bar. That one definition drives the panel, the status bar, and the report.

The three complexity numbers come from the shared library `@projectrevivesolutions/complexity`, the same one UntangleIt measures with, so the two tools never disagree about a function. The rules are in that package's `docs/measures.md`.

---

## Languages

| Plugin | Runner | Per-test attribution | Structure |
|---|---|---|---|
| Python | pytest | coverage.py dynamic contexts, one run | tree-sitter-python |
| TypeScript / JavaScript | Jest or Vitest | Istanbul counters snapshotted around every test by a setup hook, one run | tree-sitter typescript, tsx, javascript |

One contract, every language: the engine, overlay, panel, report, and setup screen know no language. Java, C#, C++, and one of PHP or Go are next.

---

## Requirements

- Visual Studio Code 1.104.0 or newer.
- Python projects: the Python the project already uses (the one the Python extension selected, else the project's own `.venv`, else `python` on PATH) with `coverage` and `pytest` installed in it.
- TypeScript / JavaScript projects: Node on PATH and Jest or Vitest in the project. Vitest also needs `@vitest/coverage-istanbul`; DeepTest offers the install.

Nothing else. No native modules, no extra extensions. If a project's `pytest.ini` turns on pytest-cov, DeepTest runs pytest without those options for its check and leaves the file alone.

---

## Settings

All under `deeptest.`:

| Setting | Default | Purpose |
|---|---|---|
| `language` | detected | plugin id: `python`, `typescript` |
| `testsPath` | detected | tests folder, relative to the workspace |
| `sourceRoot` | detected | code under test; empty means the whole workspace minus tests |
| `languageSettings` | `{}` | per-plugin fields, edited by the setup screen |
| `thresholds.minCoverage` | 80 | percent |
| `thresholds.minDensityPassRate` | 90 | percent of scored lines at or over their bar |
| `thresholds.minAverageDensity` | 1.0 | mean of tests/bar |
| `thresholds.maxFunctionComplexity` | 10 | ways through, per function |
| `report.detailedRoutes` | 5 | how many shortfalls the report explains in full |
| `depth.*` | all on | the counting rules above |
| `overlay.enabled`, `overlay.showInlineNumbers` | on | |
| `keepSafe.offerCheckpoint` | on | offer a checkpoint before every hand-off |
| `showNumbers` | off | the engineer's numbers beside the plain words |
| `colors.*` | | background tints per state |

---

## Known Limits

- pytest parametrized cases share one function name under coverage.py's `test_function` context, so `test_x[1]` and `test_x[2]` count as one test.
- Line coverage is what the summary reports. coverage.py's own percentage blends in branch coverage and reads lower.
- The density numerator is distinct test cases, not distinct assertions.
- Recursion is found by name within one file; cross-file recursion does not add to the tangle.

---

## Developing

```
cd ..\complexity && npm install      # the shared scorer, built once
cd ..\DeepTest && npm install
npm test            # engine, parsers, adapters, decisions, report (Vitest; the Python cases need python3 with coverage and pytest)
npm run build       # bundle to dist/, copy wasm grammars and runner hooks
npm run test:vscode # launches VS Code against both fixture projects and drives the extension
npx @vscode/vsce package --no-dependencies
```

Then in the Extensions view choose "Install from VSIX..." from the "..." menu, pick the file, and reload the window. The panel header carries the build number.

DeepTest measures itself: point it at this repository with language `typescript`, tests folder `test`, source root `src`. The editor-facing files only run inside the integration suite, which Istanbul does not see, so they show red. That is the truth and the tool is not going to soften it for its own author.

Design and contracts: `docs/toolkit/`. Engineering reasons: `docs/engineering-notes.md`. Acceptance script: `docs/uat.md`.

---

**License:** GPL-3.0-only. Part of MikeVan's AI Development Toolkit, published by Project Revive Solutions, LLC, https://projectrevivesolutions.com.

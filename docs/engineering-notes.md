# Engineering notes

What was tried, what failed, and why the code looks the way it does.
Kept here so nobody re-learns it the hard way.

## Per-test attribution for Python

The spec flagged coverage.py's dynamic contexts as UNVERIFIED. Verified on
coverage 7.16.0 with pytest 9.1.1: `dynamic_context = test_function` in the
rcfile plus `coverage json --show-contexts` gives, per line, the list of test
functions that executed it, named `module.test_function`. Import-time
execution shows as the empty string context. One pytest run, no plugin,
no per-test process launches. Python got the numerator for free, as the spec
hoped.

Two consequences to know about:

1. Parametrized cases collapse to the function name. pytest-cov's
   `--cov-context=test` uses node ids (`tests/test_x.py::test_x[1]|run`),
   which would fix that at the cost of a second dependency. The context
   parser already handles both spellings.
2. coverage.py's statement parser drops code after an unconditional return
   from its statement list, so the dead `return "dead"` in the fixture is
   simply absent from the JSON. It is neither covered nor missing. That is
   exactly the failure the spec warned about (LayerTime's `toUtm` case), so
   unreachable detection lives in the tree-sitter pass, not in coverage.

## tree-sitter without native modules

Native tree-sitter bindings need node-gyp and a rebuild per VS Code Electron
version. That is a barrier. `web-tree-sitter` (wasm) runs the same two files
everywhere.

- `tree-sitter-wasms` from npm failed to load with a dylink metadata error in
  web-tree-sitter 0.27: its wasm files are built against an older ABI. The
  `tree-sitter-python` 0.25.0 package ships its own `tree-sitter-python.wasm`
  (ABI 15) which loads fine. It is vendored under `vendor/` with its
  licence so the build does not depend on a package with native prebuilds.
- web-tree-sitter ships ESM and CJS builds. esbuild picked the ESM one, which
  uses `import.meta.url` to locate its wasm and to `createRequire`, and that
  is `undefined` inside a CommonJS bundle. Neither `alias` nor `conditions`
  could reach the CJS file through the package's exports map, so
  `esbuild.mjs` has a four-line resolve plugin that points `web-tree-sitter`
  at `web-tree-sitter.cjs` directly. The runtime wasm path is passed
  explicitly via `Parser.init({ locateFile })`.
- The `case` guard in the Python grammar is an `if_clause` node, the same
  type comprehensions use. The analyzer counts it as one decision plus its
  short circuits, independent of the comprehension flag.

## Testing the extension itself

The engine and parser tests run under `node --test`, no framework. The
integration suite runs inside a real editor via `@vscode/test-electron`.

`update.code.visualstudio.com` was unreachable from the build container
(HTTP 403), so the runner accepts `DEEPTEST_VSCODE_PATH` and was exercised
against VSCodium 1.109 under Xvfb. The suite activates the extension, runs
the fixture project, checks every line status, edits the file to confirm
the stale flag, jumps to a shortfall line, and drives the "no tests found"
path. Screenshots confirmed the overlay, sidebar, status bar, and the
configuration webview render as designed.

## Decisions taken without a ruling

- The bar floors at 1. A depth-0 line with no tests is red, not "met".
- Declarations (anything outside a function body) count for coverage and not
  for density. Asking which test exercised a `def` line has no useful answer.
- The `if` line shares its body's depth. To exercise an `if` you need its
  decision taken, so the line and the block it guards want the same number.
- A line after a chain of `if`/`elif` that all return sits at the enclosing
  depth, not at the sum of the failed conditions. It is not inside any of
  them. Reasonable people could argue the other way; it is one line in
  `visitStatement` if the ruling changes.
- Average density is the mean of `tests / bar` over scored lines, uncapped.
  One line with fifty tests can carry a file. That is why the density pass
  rate sits beside it and why the ranked list is the product.

## Round two: the contract, routes, decisions, report, TypeScript

### The contract (src/languages/types.ts)

Round one had the engine and UI language-free but the structure pass and
the runner hard-wired to Python. Now a `LanguagePlugin` supplies detection,
a `CoverageSource`, a `StructureSource`, and its config fields; the runner
looks the plugin up in a registry and touches nothing else. Config moved
from `deeptest.python.*` to `deeptest.languageSettings.<id>.<field>`,
rendered from the plugin's `FieldSpec` list, so the config screen has no
language in it either. `grep -i python src/runner.ts src/ui src/engine`
returns nothing, and the integration suite proves the same extension runs
a Python workspace and a JavaScript workspace with the same screens.

### Routes

The structure pass used to throw the decisions away and keep the count.
Now it keeps them: `routes: Map<line, RouteStep[]>`, each step the source
text of a condition and the outcome it needs, and depth is defined as the
route's length so the two can never disagree (a test asserts it).

The engine then answers "how far do the tests get" by looking at coverage
along the route: past decision k means some test reached the next
executable route line. First attempt used "the next step's line", which
broke on `case` labels: a label carries no statement counter, so the
report claimed no test got past the first case of a switch that every test
walks through. The fix skips forward to the first route line the coverage
tool knows about. DeepTest's own source caught that bug on the first
self-measurement, which is the best argument for self-measurement.

### The elif rule changed

Round one charged an `elif` for every operand of every earlier condition.
With routes that made no sense: to reach an `elif`, each earlier decision
went the other way, one outcome each, however many operands it had. Now an
earlier branch costs 1. Operands still count on the branch that holds
them. Same for `case` and `except`.

### Decisions

`.deeptest/decisions.json`, plain JSON, meant to be committed. A decision
is pinned to a hash of the line's text; the integration suite tripped over
this by editing the buffer before accepting a line, which is exactly the
behaviour wanted, so the suite reverts first. `lineReader` prefers the open
editor buffer over the disk so an unsaved edit already invalidates.

### The Fix hand-off

`workbench.action.chat.open` with a query, when the editor has a chat
surface, and the clipboard always. No model, no key, no retry. VSCodium
under test has no chat command and the fallback path is what the suite
exercises.

### TypeScript / JavaScript per-test attribution

Neither Jest nor Vitest attributes coverage per test case. Both keep live
Istanbul counters in a worker-global object, so a setup hook snapshots the
counters before each test and diffs after. Findings:

- Jest's global is `__coverage__`; Vitest's istanbul provider uses
  `__VITEST_COVERAGE__`. The hook checks both.
- Jest's babel plugin instruments the original AST, so positions are source
  positions. Vitest instruments esbuild output, so positions are in
  transformed coordinates and the provider remaps at the end through
  `inputSourceMap`. A stripped blank line shifted every attribution below
  it by one. `hooks/attribution.cjs` now carries a 60-line VLQ decoder and
  remaps the same way. No dependency.
- Loading the hook without clobbering the project's config: Jest exposes
  its resolved config through `--showConfig`, so the run passes the
  existing `setupFilesAfterEnv` list plus the hook. Vitest has no CLI flag
  for setup files, so a generated `.deeptest/vitest.config.mjs` imports
  the project's config and `mergeConfig`s the hook and coverage settings.
- `--dir test` re-roots Vitest's include patterns and found no tests; a
  positional path filter does what was wanted.
- Runners print colour even with CI=true; summaries are parsed after
  stripping ANSI.
- Runners are resolved by walking up from the workspace like Node does,
  because monorepos hoist them.

### Self-measurement

The unit tests moved from node:test to Vitest so the extension can measure
itself through its own TypeScript plugin. First honest number: engine and
parsers at bar, editor-facing code at zero, 27 functions over complexity
10, and one `continue` in the TypeScript analyzer that no test reaches
after 16 of its 17 guarding decisions. All true.

## Round three: the interface for humans

His review of v0.2.0 in one line: "why is the interface so techy?" The
report spoke to the lawyer; every other screen spoke to the auditor who
defined the metric. Fix:

- `src/ui/words.ts` is the one place every user-facing phrase lives,
  written for the lawyer first. "density 0/3, short by 3" became "never
  tested, needs 3". The engineer's vocabulary is behind one switch, "Show
  the numbers", and appears beside the plain phrase, never instead of it.
- The tree view is gone. The side panel is a webview: verdict first, one
  button, three lines on what the tests say, then the worst lines as cards
  with Fix / Accept / Open, the rest folded. Same view id, so the
  integration suite did not change.
- Whole percentages on every human-facing surface; decimals live behind
  the switch.
- The setup screen folds the counting rules and the average-density
  threshold under "Advanced: what counts as a condition".
- Product name on the front is DeepTest; the extension id, settings
  namespace, and engine keep the DeepTest name so nothing installed
  breaks.

## Whose runtime

DeepTest never supplies a language runtime. Each plugin uses what the
project already uses: Python from the Python extension's selection, else
the project's own `.venv`/`venv`, else PATH; Jest or Vitest from the
project's `node_modules`, resolved up the tree the way Node does. Java
will follow the same rule (the Java extension's JDK, else the Maven or
Gradle wrapper). The PATH fallback for Python originally came before the
project's virtual environment; that order was wrong and is now reversed.

## Words on the screen

The instructions DeepTest gives must name the control exactly as it is
labelled, and every sentence ends with a full stop. A message said "Open
Details" when the link on screen said "Show the log"; that is the kind of
slip a testing tool cannot afford. The rule now: `src/ui/words.ts` and the
sidebar share one vocabulary, error messages from the plugins say `Press
"Show the log"`, and the verdict reads as a sentence ("This is not ready:
3 lines were never tested.") on the sidebar, in the report, and in the
Markdown export alike. `test/words.test.ts` and
`test/decisions-report.test.ts` pin the exact strings.

## DeepTest checking itself on Windows (open)

On Michael's machine the self-check runs all 107 tests to green and then
Vitest prints "Unhandled Error — Unknown Error: undefined", exits 1, and
writes no coverage-final.json. The same run on Linux passes and writes
coverage. The nested fixture run (`test/typescript-adapter.test.ts`,
which drives the same adapter against `test/fixtures/tsproject-vitest`)
passes on his machine, so Vitest, the istanbul provider, and the hook all
work there; the difference is in how the outer run is launched.

Read of the Vitest and tinypool sources: that label comes from
`pool.runTests` rejecting, and the value printed is the worker task's
rejection reason after `String()`, so something in the worker rejected
with `undefined` itself after the last test file finished. Nothing in our
hook can do that (every path is wrapped), and no Vitest or tinypool path
found so far rejects without an Error.

Two differences between the failing outer run and the passing nested run
were removed, on the reasoning that each is a Windows-only source of
disagreement about paths:

1. VS Code hands the workspace folder over as `c:\workspace\DeepTest`
   with a lower-case drive letter; Node resolves the same files to
   `C:\...`. Vitest keys its coverage map and module graph by absolute
   path, so the two spellings look like different files. The nested run
   used `path.resolve`, which gives `C:`. `workspaceRootOf()` in
   `src/ui/paths.ts` now takes the file system's own spelling
   (`fs.realpathSync.native`) before any plugin sees the root.
2. The generated `.deeptest/vitest.config.mjs` imported the project's
   config through a `file://` URL. Vite bundles a config's relative
   imports with esbuild but leaves URL imports to Node, so Node loaded
   `vitest.config.ts` itself, stripped the types, and warned about the
   missing `"type": "module"`. The wrapper now imports the config by
   relative path, so it goes through esbuild like the project's own run.

If the self-check still fails after these, the next step is to bisect on
the machine, from `C:\workspace\DeepTest` in PowerShell:

    npx vitest run --coverage.enabled --coverage.provider=istanbul --coverage.reporter=json

runs Vitest with coverage and without DeepTest's wrapper or hook. If that
fails the same way, the fault is in Vitest or the istanbul provider on
Windows and DeepTest is only reporting it. If it passes, run

    node node_modules\vitest\vitest.mjs run --config .deeptest\vitest.config.mjs test/

which is exactly DeepTest's command; the wrapper it leaves behind can be
edited by hand to remove `setupFiles` (the hook) and rerun, which decides
between the hook and the coverage settings.

## Fix this: the checkpoint offer and the confirmation

"Fix this" used to be one click from a card to a brief in the AI's chat.
That is one click from an accountant to an assistant rewriting his code
with no undo. Two gates now stand in front of the hand-off, in this order:

1. If the KeepSafe extension is installed (`KeepSafe.keepsafe`, checked
   with `vscode.extensions.getExtension`), a notification offers "Create a
   checkpoint" or "Skip". Yes runs KeepSafe's own public command
   `keepsafe.quickCheckpoint`, which checkpoints the first workspace
   folder under a timestamped name and shows its own confirmation. That
   command is the whole contract with KeepSafe: no import, no shared
   code, nothing to break when either extension updates. The offer is
   controlled by `deeptest.keepSafe.offerCheckpoint` (default on) and only
   shown when KeepSafe is installed. Closing the notification counts as
   "Skip"; the next gate is modal and does the deciding.
2. A modal dialog, "Send this to your AI assistant?", names the file and
   line, says the assistant may change code and tests, and says DeepTest
   will measure and not accept. Nothing is recorded in decisions.json and
   nothing goes to the clipboard until "Yes, send it".

When KeepSafe is not installed the setup screen says so under "Before the
AI changes your code", links the Marketplace listing, and offers one
button that opens KeepSafe's page in the Extensions view (the built-in
`extension.open` command). No other surface mentions KeepSafe, on the
principle that Jeff should not be told about tools he does not have while
he is reading a verdict.

The integration suite cannot press a modal button. The harness sets
`DEEPTEST_TEST_HOST=1` in the extension host's environment
(`extensionTestsEnv` in test/integration/runTests.ts) and the Fix flow
treats that as "Yes, send it". It is read from the process environment,
not from a setting, so nothing a user can configure skips the question.

## Fix this on a function

The report named the hardest function and offered nothing to do about it.
For Jeff that is the first thing he would want to act on, so "Fix this"
now exists at function level: on the "Hardest to test" row in the side
panel and beside every over-limit function in the report.

A function over the complexity limit has two honest fixes and they pull in
opposite directions, so the person picks before anything is built: refactor
it into pieces that each fit under the limit with behaviour unchanged, or
leave the shape alone and test every way through it. The brief
(`buildFunctionBrief` in src/report/brief.ts) quotes the function with line
numbers (cut at 120 lines with a note), lists every line inside it that is
short of tests and where the tests stop, and states "done" for the chosen
mode. The refactor mode's contract is the existing tests: they must pass
without being edited, and if the assistant thinks one must change it has to
stop and say why. Both modes end with the same sentence about DeepTest
measuring and not accepting.

The decision is stored in decisions.json with `scope: "function"`, pinned
to the hash of the line the function starts on, with `gapAtDecision` being
ways through over the limit. Function and line decisions on the same line
number are kept apart (`findDecision` ignores function decisions;
`recordDecision` and `removeDecision` match on scope). After the next
check the row says "Still N ways through over your limit, nothing changed"
or "but closer", or "Fixed after your request", or "it has changed since"
when the start line was renamed, which a refactor often does; that is
accepted because a decision about `calc()` must not silently cover a
function now called something else.

Both fixes share one gate function (`gates` in src/decisions/commands.ts):
KeepSafe offer, then the modal confirmation with the task spelled out.

### Where "Refactor It" will plug in

Michael's next tool refactors a method over a configurable complexity
limit until it and every method produced from it are within the limit,
responsibly. DeepTest's "Break it into smaller pieces" choice is the seam:
today it hands a refactor brief to the generic assistant; when Refactor It
exists, that one choice routes to it instead, through its public command,
the same one-directional pattern as KeepSafe, with DeepTest staying the
judge afterwards. The place to change is `fixFunction` in
src/decisions/commands.ts, and only the `refactor` branch of it.

## One build, one number

Two different builds went out labelled 0.3.0 and then two labelled 0.3.1,
and the second time it cost an hour: the KeepSafe offer "did not fire"
because the running copy predated it, and nothing on screen could say so.
Rule from here: every build handed over gets a new version in package.json
and in the VSIX name, and the side panel prints "DeepTest <version>" at
its foot so a screenshot always says which build it came from.

## Publisher

DeepTest publishes under `prs`, the Marketplace identifier for Project
Revive Solutions, LLC, so its extension id is `prs.deeptest`. Refactor It
will be `prs.refactorit`. KeepSafe stays `KeepSafe.keepsafe`: it is already
live under that publisher, the Marketplace cannot move a listing between
publishers, and a republish would start its install count and reviews from
zero. Its id lives in one place, src/keepsafe.ts.

## Cognitive complexity beside cyclomatic (0.3.7)

Why: cyclomatic counts forks, so a flat message switch with 28 cases sits
at the top of the "harder to test" list although nobody finds it hard to
follow, while a method with three nested loops and a guard chain scores
lower. Michael wants to compare cyclomatic, Campbell's cognitive
complexity (SonarSource, 2018, https://www.sonarsource.com/docs/CognitiveComplexity.pdf),
and his own ordered-operand variant on real projects before choosing which
number, if any, should drive the verdict. So this build measures all three
and changes no verdict: "Hardest to test" and the over-limit list are
still ways through, with the tangle shown beside them, and the full report
gains a "Ways through against tangle" table of the 30 functions with the
most ways through.

Shape: the arithmetic is one class (src/languages/shared/cognitive.ts,
`CognitiveCounter`) and each language has a walker that only says what
each node is (src/languages/python/cognitive.ts,
src/languages/typescript/cognitive.ts). Nothing above the language contract
changed except two new numbers on `FunctionComplexity`. Scores are filled
in after the whole file is walked because recursion cycles need every
function's call list first.

Rules as implemented, and the readings that had to be chosen:

- Structural (+1 plus nesting): if, ternary, switch/match (once, however
  many cases), for, while, do, catch/except. Hybrid (+1, no nesting
  charge, body one deeper): elif/else if, else, and a Python loop `else`.
  Fundamental (+1 flat): each run of the same boolean operator, each
  function on a recursion cycle, break LABEL / continue LABEL. Nothing:
  try, finally, with, `??`, `?.`, plain break and continue.
- Boolean runs are found by flattening the left-deep tree into source
  order and cutting it where the operator changes. `a and b and c or d or
  e and f` is three runs, as in the whitepaper. Parentheses and `not`
  start a fresh sequence.
- Ordered-operand rule (the second number): a run costs one per operand
  when any operand contains a call, `await`, a walrus, an assignment,
  `new`, `yield`, or `++`/`--`, or when a later operand does member or
  subscript access rooted at a name an earlier operand mentioned. `member
  is not None and member.dues is not None and member.dues.paid > cutoff`
  costs 3; `a > 0 and b > 0 and c > 0` costs 1. An operand at a run
  boundary belongs to both runs. This is the only place the two numbers
  differ, so their difference is the cost of ordered boolean logic.
- Nesting: everything inside a function counts toward it, nested
  functions and lambdas included, one level deeper each and with no
  increment of their own. That is the whitepaper's rule and it has a
  visible consequence: `activate()` in src/extension.ts has 2 ways
  through and a tangle of 113, because it registers twenty commands with
  inline callbacks. The nested functions are also rows of their own, so
  their complexity appears twice in the table, once on its own and once
  inside the parent. SonarJS makes one exception (a top-level function
  with no structural complexity of its own reports its nested functions
  separately, to cope with module wrappers and test suites); not adopted
  here, so the numbers stay the whitepaper's. Candidate for a later
  decision.
- Comprehensions cost nothing. The whitepaper predates a ruling and the
  reading taken is that a comprehension is one expression, not a loop the
  reader steps through. Cyclomatic still counts each clause. UNVERIFIED
  against SonarPython's implementation.
- Recursion is by name within one file: `f()`, `self.f()`, `cls.f()`,
  `this.f()`. Two methods with the same name in different classes of one
  file share a node in the call graph, which can produce a false cycle;
  cross-file recursion is invisible. Both are accepted for now and both
  are the reason the recursion increment is a single flat +1.
- Ternary is structural, not hybrid; one summary of the whitepaper reads
  otherwise but Appendix B lists it with the structural increments.

Checked against the whitepaper's worked cases in test/cognitive.test.ts
(27 tests, both languages), and against DeepTest's own source: the three
flat switch-style dispatchers (onSidebarMessage 28 ways / tangle 22,
onReportMessage 23 / 22) drop below the deeply nested renderers
(renderMarkdown 20 / 56, results 28 / 45), which is the ordering the
measure was adopted to produce.

## The run that never happened (0.3.8)

First real project, Regalia: every check said "0 tests passed", 6%
coverage, 5402 lines never tested, and a refactor went ahead on those
numbers. The log had the cause in plain sight. Regalia's pytest.ini sets
`addopts = --cov=. --cov-report=... --cov-fail-under=5`. DeepTest runs
pytest with `-p no:cov` so that coverage.py is the only thing measuring;
with pytest-cov switched off, pytest no longer knows the `--cov` options,
prints a usage error, and exits 4 before collecting a test. coverage.py
still wrote a data file (import-time execution), so DeepTest scored it.

Two fixes, both in src/languages/python/coverage.ts:

1. `readProjectAddopts` reads `addopts` from pytest.ini, .pytest.ini,
   pyproject.toml (`[tool.pytest.ini_options]`, string or array), tox.ini,
   or setup.cfg, in pytest's own order. `withoutCoverageOptions` drops
   every `--cov*` and `--no-cov*` token, plus the value token of the ones
   that take a separate value (`--cov src`, `--cov-report html`). What is
   left goes back on the command line as `-o addopts=<rest>`, which
   overrides the ini value for this run only. The project's file is never
   touched, and the log says exactly which options were left out. When
   addopts has no pytest-cov options nothing is added, so every other
   project runs exactly as before.
2. `pytestFailureBeforeTests` turns pytest's exit codes 4 (usage), 3
   (internal), 5 (no tests collected), and 2 without any test having
   passed (collection error) into a thrown error carrying pytest's last
   lines, so the panel shows "The test run failed before any test ran,
   because pytest did not accept its command line. pytest said: ..." and
   no numbers. Exit 2 after tests did run (Ctrl-C) is left alone.

Verified against real pytest 9.1.1 with no pytest-cov installed:
test/python-adapter.test.ts copies the fixture into a temp folder with
Regalia's exact addopts line and gets 3 passed; a second copy with a
bogus option gets the failure sentence, not a result.

Lesson recorded for the tool itself: a measurement of test rigour must
refuse to produce a number from a run in which no test ran. The old
behaviour was worse than no tool, because 6% looked like a fact.

## The measure has a name (0.3.9)

The ordered-operand variant of Cognitive Complexity is MikeVan's Better
Cognitive Complexity, MBCC for short, everywhere a person reads it: the
"Hardest to test" row ("Its tangle is 39 by Campbell and 45 by MBCC."),
the over-limit list, the report's comparison table ("Tangle (Campbell)",
"Tangle (MBCC)"), the Markdown export, and the refactor brief. Campbell's
figure keeps her name for the same reason: a reader can look either one
up. Nothing in the arithmetic changed; field names (`cognitive`,
`cognitiveOrdered`) stay, since the scorer is about to move into a shared
package and the rename of code identifiers belongs there.

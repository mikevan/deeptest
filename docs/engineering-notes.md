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

### Where UntangleIt will plug in

Named 2026-09-11: the tool is UntangleIt (`prs.untangleit`, command
`untangleit.method`, records `.untangleit/`). The Marketplace refused the
tool's first display name as too similar to an existing listing, and a
dormant Visual Studio extension by mynkow shares that first name. Nothing
in DeepTest's source named the sibling yet, so the rename touched only
these notes, the README, and the workspace settings. The sibling file, when
it is written, is src/untangleit.ts.

Michael's next tool refactors a method over a configurable complexity
limit until it and every method produced from it are within the limit,
responsibly. DeepTest's "Break it into smaller pieces" choice is the seam:
today it hands a refactor brief to the generic assistant; when UntangleIt
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
Revive Solutions, LLC, so its extension id is `prs.deeptest`. UntangleIt
is `prs.untangleit` (named on 2026-09-11, see above). KeepSafe stays `KeepSafe.keepsafe`: it is already
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

## One scorer for every tool (0.4.0)

The complexity arithmetic left this tree. `@projectrevivesolutions/complexity`
(C:\workspace\complexity, repo mikevan/complexity) now holds the counter,
the Python and TypeScript walkers, McCabe's fork count, the function
finders, the 27 whitepaper tests, and docs/measures.md with every rule and
every reading chosen. DeepTest depends on it (`file:../complexity` until the
repo is on GitHub, then `github:mikevan/complexity#<commit>`), and
UntangleIt will depend on the same package, so the two tools cannot
disagree about the same function. The package holds no grammars and starts
no parser: DeepTest still walks the tree for routes and depth and hands
the function nodes over; the package hands back
`{ cyclomatic, campbell, mbcc }`.

Field names in DeepTest followed the package: `cognitive` is `campbell`,
`cognitiveOrdered` is `mbcc`. `complexity` (cyclomatic) kept its name
because decisions.json and the API shape carry it. Checked that the
numbers are identical to 0.3.7 on DeepTest's own source (renderMarkdown
20 / 56 / 59, onSidebarMessage 28 / 22 / 22, activate 2 / 113 / 120,
terminates 21 / 29 / 39) before the copies were deleted.

Build order matters once: the package must be built before DeepTest
compiles (`npm install` in C:\workspace\complexity runs its `prepare`
script, which is the build). `npm install` in DeepTest then symlinks it
and esbuild bundles it into dist/extension.js like any other dependency;
the VSIX carries no reference to the folder.

## The hand-off to UntangleIt (0.4.3)

Why: "Break it into smaller pieces" built a refactor brief and sent it to
the chat assistant, and the docs had called the routing to the untangling
tool "next" since 2026-09-06. With UntangleIt on the Marketplace, DeepTest
handing the job to the chat assistant instead of the sibling that
measures every piece afterwards would have been the toolkit contradicting
its own thesis on its first public day.

What: src/untangleit.ts mirrors src/keepsafe.ts (id `prs.untangleit`,
command `untangleit.method`, installed check, Extensions-view opener,
Marketplace link). In `fixFunction`, when the person picks the refactor
choice and UntangleIt is installed, DeepTest calls `untangleit.method`
with `{ path, startLine }` and stops. UntangleIt runs its own gates (the
KeepSafe offer, then its modal), hands its own brief, and keeps its own
run record; DeepTest records no decision at that point because the person
has not yet said yes to anything, and judges the pieces on the next
check. When UntangleIt is not installed, nothing changes: DeepTest's own
brief and gates, and a recommendation with a link on the setup screen
under "When a function is too tangled". The routing rule
(`functionFixRoute`) and every new sentence live in src/ui/words.ts so
the unit tests pin them without a vscode import.

What was found on the other side: `untangleit.method` refused a method
that was not in UntangleIt's last measure ("Press Find the tangled
methods first"), which is every call from DeepTest on a fresh editor.
UntangleIt 0.1.8 now measures the file on demand when the method is not
in its state, and only complains when no method starts on that line. That
change is in UntangleIt's own tree and notes; DeepTest depends on the
published command, not on that behaviour.

Not done: the refactor brief in src/report/brief.ts still exists for the
not-installed case. The 2026-09-06 decision was to move it to UntangleIt;
it stays here as the fallback until UntangleIt is the common case.

## The run that ran nothing (0.4.5)

0.3.8 caught pytest failing before collection (exit codes 2 to 5) and
reported those runs as failed instead of scoring them. It missed the other
shape: every test collected, every test errored at setup, exit code 1,
"0 passed, 5 errors". Regalia without Docker running produces exactly this
(its fixtures start PostgreSQL through Testcontainers), and 0.3.8 scored it
as "0 passed, 5 could not run" beside a 16% coverage figure. The 16% was
import-time execution, not tests; presenting it as coverage is a false
reading, which is the one thing this tool must never give.

The guard now lives in src/runner.ts, above the language contract, so it
holds for every plugin: a run counts only when passed + failed > 0
(`testsRan` in src/ui/words.ts). Errored and skipped tests executed no code
under test. When nothing ran, the runner logs the four counts and the exit
code, sets the error state with `nothingToScoreSentence`, and returns
before parseStructures. The person sees "No test ran to the end, so there
is nothing to score. 5 tests could not run, usually because of a setup
error such as a missing fixture or a database that is not running. Press
"Show the log" to see the test run." with "Check my code again", "Show the
log", and "Change the setup" underneath. Pinned in test/words.test.ts.

Alternatives weighed: a coverage-percentage floor (wrong: a small honest
run can be 3%); trusting the plugin's exit code (wrong: pytest returns 1
for both "tests failed" and "tests errored", and Jest returns 1 for both
too); treating errors as failures (wrong: a failed test ran the code and
its coverage is real; an errored one did not).

## The install button says where (0.4.5)

"This Python is missing coverage." with an "Install coverage" button was
right but not enough: in the field the person could not tell whether the
install would land in the project's .venv or the global Python. The
sentence now names the interpreter (`missingPackagesSentence` in
src/languages/python/coverage.ts): "The Python at C:\...\.venv\Scripts\
python.exe is missing coverage." for an absolute path, "The Python found as
"python" on your PATH is missing coverage." for a bare name, and the button
reads "Install coverage into that Python". The command is unchanged: that
interpreter, -m pip install. Pinned in test/python-adapter.test.ts.

Bundling coverage.py inside the VSIX was considered and set aside for now:
it must import inside the interpreter that runs the tests, its C extension
is built per platform and per Python version, the pure-Python tracer is
slower and drops concurrency and plugins (coverage.readthedocs.io/en/latest/
install.html), and Apache-2.0 inside a GPL-3.0-only package adds a NOTICE
obligation. Kept open: ship the pure-Python tracer as an offline fallback
only, used when the project's own copy is absent and pip cannot run, with
the report saying which copy measured.

## The sanity check between ways through and tangle (0.4.5)

Decision, 2026-09-12: DeepTest ranks and judges by ways through, and only
by ways through. Density is tests against ways through per line, the
verdict is built on it, and "Hardest to test" is literally the function
with the most paths a test must reach. Tangle (Campbell and MBCC) rides
beside every function as a sanity check and drives nothing here; it
drives UntangleIt, whose question it answers. The open question from
2026-09-09 (which number drives the list) is closed this way.

The check is one sentence appended by `tangleSentence` through
`tangleCheck` in src/ui/words.ts. Tangle above ways through means
nesting: "It is harder to follow than it is to test, which means nesting.
That is a job for UntangleIt." Ways through at twice the tangle or more
means a flat dispatcher: "It is long rather than hard to follow. It needs
tests more than it needs untangling." When the numbers agree the sentence
says nothing extra. This is DeepTest pointing at UntangleIt's door without
ranking by its number, per the paper on MBCC (toolkit docs) and section 6
of it: the three numbers are collected as a check on each other, not to
drive coverage, and when Campbell and MBCC disagree, MBCC wins.

The library changed underneath at the same time (ordered branches: the
k-th branch of a chain on different facts costs k; an exclusive chain on
one value costs one, like a switch), so the MBCC figure on existing
functions moves. Nothing in DeepTest's arithmetic reads it, so no
DeepTest verdict changes; the comparison table and the tangle numbers
behind the switch do. Rebuild the library before this tree.

## 1.0 survey: the seven HelloWorld ports through the plugin as it stands (2026-09-12)

Method: the seven ports in C:\workspace\HelloWorlds (copied to test/fixtures/
helloworld-* by scripts/sync-fixtures.mjs) were driven headlessly through
the language layer exactly as the extension drives it: guessLanguage, the
plugin's detect(), checkEnvironment(), run(), then the structure parser on
every measured file and the engine's analyze(). No VS Code. Every port has
the same program: greet fully tested, names thinly tested, and
pickGreeting() nested five deep with no tests, 27 ways through, Campbell
73, MBCC 97, eleven tests (ten in Python).

| Port | Detection said | Environment | Run | Per-test attribution | Villain found | Source files the plugin never saw |
|---|---|---|---|---|---|---|
| python | tests/, pyproject pytest | ok | 10 passed | 17 lines | pick_greeting 27/73/97 | none |
| react-jest | jest, package.json key | ok | 11 passed | 18 lines | pickGreeting 27/73/97 | none |
| react-vitest | vitest, vite.config.ts | ok | **failed: "vitest produced no coverage"** (finding 1); 11 passed once the hook was reachable | 18 lines after the fix | pickGreeting 27/73/97 after the fix | none |
| vue-vitest | vitest, vite.config.ts | ok | 11 passed (after finding 1) | 17 lines | **NOT FOUND** | App.vue, Greeting.vue, GreetingPicker.vue |
| svelte-vitest | vitest, vite.config.ts | ok | 11 passed (after finding 1) | 17 lines | **NOT FOUND** | App.svelte, Greeting.svelte, GreetingPicker.svelte |
| angular-vitest | "Found vitest." | needs @vitest/coverage-istanbul; the offered install fetched 5.0.0 against vitest 4.1.11 | **failed: "coverageFilesDirectory is required"** (finding 3b); driving the vitest binary directly bypasses the Angular builder anyway (finding 3a) | works through `ng test` (see below) but points at bundle chunks, not sources (finding 3c) | ScheduleService.pickGreeting 27/73/97 once measured | all of src/app until the builder path is used |
| angular-karma | **"No test runner found. Install Vitest or Jest."** (finding 4) | not ok | not attempted | none | none | all |

### Finding 1: the Vitest hook cannot be loaded from outside the project root. Production bug, every Vitest project.

The generated wrapper config sets `test.setupFiles` to the hook's absolute
path in the extension's install folder. Vite refuses to load it: "Failed
to load url .../hooks/vitest.mjs. Does the file exist?", which is Vite's
wording for a file its `server.fs.allow` list rejects, and the default
allow list is the project root. The file exists; the path form does not
matter (absolute, file://, and relative all fail); the extension's install
folder is never inside a person's project. Two fixes were confirmed on
react-vitest: adding `server: { fs: { allow: [hooksDir, '.'] } }` to the
wrapper, and copying the hook and attribution.cjs into the project's own
.deeptest/ folder and pointing setupFiles there. The second is the one to
ship, because the Angular builder needs it too (finding 3c) and it removes
the dependence on Vite's allow list altogether. DeepTest's own suite never
caught this because its fixture runs use the repository's hooks/ folder,
which is inside the repository root. Ships as 1.0.1, before anything else
in the slot.

### Finding 2: .vue and .svelte files are invisible, and the report is falsely clean.

The plugin's source-extension pattern and the coverage include glob cover
js, jsx, ts, tsx, mjs, and cjs. A single-file component is neither walked
nor instrumented, so on the Vue and Svelte ports the tests pass, coverage
reads 60.71%, "Hardest to test" says every function is within the limit,
and the villain does not exist. This is the failure the toolkit exists to
prevent: a clean verdict on code nobody measured. Phase 1 (walk them, show
them red) and phase 2 (parse the script block with its line numbers) of the
1.0 plan are the fix, and their order matters: red before parsed, never
invisible.

### Finding 3: Angular is a builder, not a binary.

3a. detectRunner finds `vitest` in node_modules and drives vitest.mjs with
the wrapper config. An Angular project has no vite config; the tests need
the Angular compiler and TestBed, which only the builder provides. The
driver must detect `angular.json` with `@angular/build:unit-test` and run
`ng test` instead. The builder has everything the driver needs, verified
with `ng test --help` on Angular CLI 22.1.8: `--setup-files`,
`--coverage`, `--coverage-include`, `--coverage-reporters json`,
`--runner karma|vitest`, `--watch=false`. Both the Vitest and the Karma
projects go through this one builder (`"runner": "karma"` in angular.json
for the latter), so the Angular driver is one driver with a runner switch.

3b. The install offer for @vitest/coverage-istanbul is unpinned. On a
Vitest 4 project npm installed 5.0.0 (peer: vitest 5.0.0), and every test
file failed with "coverageFilesDirectory is required". The offer must pin
the coverage package to the project's Vitest major
(`@vitest/coverage-istanbul@4` here). Same bug, same fix, on every Vitest
project whose Vitest is not the newest major.

3c. The builder bundles with esbuild before running, and `--setup-files`
paths resolve relative to the project root and are bundled too: an
absolute path is appended to the root ("Could not resolve
.../angular-vitest/sessions/.../hooks/vitest.mjs"), and inside the bundle
`import.meta.url` no longer points at the hooks folder, so the hook's
`require('./attribution.cjs')` fails. With the hook copied to
.deeptest/vitest.mjs and attribution.cjs resolved through an environment
variable (DEEPTEST_HOOKS_DIR), `ng test --watch=false --coverage
--coverage-reporters json --coverage-include 'src/**/*.ts' --setup-files
.deeptest/vitest.mjs` ran 11 tests, wrote coverage-final.json under
coverage/<project>/ with every src file including schedule.service.ts
(without --coverage-include the report holds only the files a test
loaded, and the villain is absent), and wrote per-test attribution. But
the attribution names bundle chunks (`chunk-G3X6D2YX.js`,
`spec-app-greet.js`), not source files: the live Istanbul counters the
hook snapshots are on the bundle, while the JSON report is source-mapped
by the coverage provider afterwards. The driver has to map the hook's
lines back through the bundle's source maps, or take attribution from a
per-test coverage dump the provider has already mapped. This is the one
open engineering question in 1.0 and it is phase 3's first job.

### Finding 4: a Karma project is told to install Vitest.

With neither jest nor vitest in package.json, detection says "No test
runner found in package.json. Install Vitest or Jest, or pick one below."
and the environment check offers "Install Vitest". On an Angular Karma
project that advice is wrong and, followed, harmful. Detection must
recognise angular.json's runner before it concludes there is no runner,
and the sentence must never recommend a runner into a project that has
one.

### What worked without change

React on Jest is fully served today: detection, environment, run, per-test
attribution on 18 lines, the villain first at 27/73/97, no file missed.
React on Vitest is fully served once finding 1 is fixed. The structure
parser reads .tsx and .jsx correctly, including the component files.

### Revised order for the 1.0 phases

1. 1.0.1: finding 1 (hook copied into .deeptest/, attribution resolved by
   environment variable) and finding 3b (pinned install). Both are
   production bugs in 1.0.0 and both are small.
2. 1.0.2: finding 4 and phase 1 (framework detection; .vue and .svelte
   walked and shown red).
3. 1.0.3: phase 2 (single-file component script blocks parsed).
4. 1.0.4: the Angular driver through the builder, Vitest runner, with the
   source-map question answered (3a, 3c).
5. 1.0.5: the Karma runner through the same builder.
6. 1.0.6 and 1.0.7 as planned.

## The Vitest hook moves into the project, and the install is pinned (1.0.1)

Finding 1 of the 1.0 survey, fixed: the Vitest hook and attribution.cjs
are copied into <project>/.deeptest/hooks/ before every run and
test.setupFiles points there, inside the project root, where Vite's
server.fs.allow permits it. The helper is found through DEEPTEST_HOOKS_DIR
instead of a relative require, so when a bundling runner (the Angular
builder, 1.0.4) rewrites import.meta.url the path still resolves. The
Jest driver is unchanged: Node loads its hook by absolute path and has no
allow list. Alternative rejected: adding `server.fs.allow` to the wrapper
config. It works (confirmed on react-vitest), but it depends on a Vite
setting that a project's own config could override, and the Angular
builder needs the copy anyway.

Finding 3b, fixed: the coverage-package install is pinned to the
project's Vitest major (`coverageIstanbulSpec`: "@vitest/coverage-istanbul@4"
for Vitest 4.1.11). The sentence and the button carry the pinned spec.

Verified with the plugin compiled from this tree and the hooks folder
outside every project: react-vitest 11 passed, attribution on 18 lines,
villain first; vue-vitest and svelte-vitest 11 passed (their villains
stay invisible until 1.0.2 and 1.0.3). New tests: the Vitest end-to-end
run from a temporary folder outside the repository (the shape the suite
had never exercised, which is why the bug lived through 0.2 to 1.0), and
the pin. tsconfig now excludes test/fixtures, since the HelloWorld copies
carry framework sources the extension's compiler must not see.

## The framework is known, and single-file components turn red (1.0.2)

Findings 2 and 4 of the 1.0 survey, fixed. Nothing here parses a
component or drives a new runner; those are 1.0.3 and 1.0.4.

Detection. `src/languages/typescript/framework.ts` reads package.json
(`@angular/core`, `svelte`, `vue`, `react`, in that order, since a Vue or
Svelte project can carry React as a transitive-looking dev dependency but
not the other way round) and the config file beside it, and for Angular
reads angular.json to find the runner under the `@angular/build:unit-test`
builder (`"runner": "karma"` or nothing, which means Vitest; the old
`@angular-devkit/build-angular:karma` builder is Karma). The setup screen's
first note is now "Framework: Vue 3 with Vitest." or "Framework: Angular
22, tests through ng test with Karma."; a plain project gets no framework
line. The major comes from the dependency range, so it is the version the
project asked for, not the one installed.

The Karma advice. `checkEnvironment` looks at the framework before it
looks for a runner. An Angular project with a runner under the builder is
refused in one sentence, "This is an Angular project whose tests run
through "ng test" with Karma. DeepTest cannot drive Angular's test builder
yet; that is coming in a 1.0 update. Nothing needs installing.", with no
fix button, because the only fix on offer would have been "Install
Vitest" into a project that must not have it run directly (finding 3a:
the vitest binary bypasses the Angular compiler and TestBed). The Vitest
flavour gets the same refusal, so nobody is offered a run that produces
a broken result.

Visibility. `.vue` and `.svelte` join the source extensions in three
places: `SOURCE_EXT` in the walker, `SOURCE_GLOB_EXTENSIONS` in the
Vitest wrapper's coverage include and the Jest `collectCoverageFrom`
default, and the plugin's `extensions` list (with `src/detect/language.ts`
counting them as TypeScript). The structure source returns an empty
structure for them: no functions, no depth, no routes. The engine then
scores every executable line the coverage tool reports at the floor bar
of 1, so an untested component is a block of red lines in "Look at these
first" instead of a file that does not exist. Istanbul, through the Vite
plugins, maps the instrumented output back to the component's own line
numbers (GreetingPicker.vue: 52 executable lines starting at line 14, the
first `if`, none under any test), so the red lines land on the right
lines in the editor, and 1.0.3 only has to supply the parse.

What changes on the fixtures: vue-vitest goes from 60.71% coverage and
nothing to look at, to 27.27% with GreetingPicker.vue's 52 lines at the
top of the list; svelte-vitest the same at 26.44%. The villain is still
not named (no functions in an empty structure), so "Hardest to test" says
nothing until 1.0.3. react-vitest and react-jest are unchanged at 11
passed and pickGreeting 27/73/97. angular-vitest and angular-karma now
refuse politely instead of failing or advising an install.

UntangleIt is untouched by 1.0.2: it ranks functions, an empty structure
has none, and the parser it shares with DeepTest did not change. It gets
the SFC script-block parser in 1.0.3 in the same delivery as DeepTest.

Six new tests in test/typescript-adapter.test.ts, all against the
helloworld-* fixtures: detection per port, the sentences, the notes order,
the Angular refusal without a fix for both runners, the walker and the
language guess on `.vue` and `.svelte`, and an SFC scored through the
engine at bar 1 with every line untested. 191 unit tests expected.

## Single-file components are parsed (1.0.3)

Phase 2 of the 1.0 plan. A `.vue` or `.svelte` file carries its logic in
one or more `<script>` blocks; the template around them is HTML with its
own control flow.

The parse. The library gained `extractScript` (src/sfc.ts) and
`isSingleFileComponent`. It does not extract the block: it returns the
whole file with every character outside the script blocks replaced by a
space, newlines kept. The text is the same length, the same line count,
and the same columns, so the tree-sitter rows are the editor's line
numbers with no offset table to maintain, and a route, a depth, a
function's start line, an Istanbul line, and UntangleIt's read-and-rewrite
of a method all name the same line without translation. Every block is
kept (Vue's `<script>` beside `<script setup>`, Svelte's `<script module>`
beside `<script>`), each a module-level run of statements that a grammar
parses one after the other. The grammar is chosen from the `lang`
attributes: tsx if any block says so, TypeScript if any says `ts`, else
JavaScript. The alternative, cutting the block out and adding the start
line back to every number afterwards, was rejected: it is one more place
for an off-by-one to live, and there are five consumers of those numbers.

What the rest of the file is. Every line outside the blocks goes into the
structure's `declarations` set and out of `depth`. The engine then counts
such a line for coverage when the runner reports it (Istanbul does report
template lines, mapped back through the Vite plugin's source map) and
never scores it for density. The template's `v-if` and `{#if}` are
decisions a reader has to understand, and they wait for a later slot; a
component whose only logic is in its template scores every reported line
as a declaration, which is honest about what the tool has read.

What it shows on the fixtures. vue-vitest: `pickGreeting` in
GreetingPicker.vue at 27/73/97 starting on line 13, the same villain as
every other port, at the top of "Hardest to test"; line 37 at depth 6
with the six-step route, untested; coverage unchanged at 27.27%, density
pass rate 23.75%. svelte-vitest: the same at line 11. The module-level
`$props()` and `$derived()` calls in the Svelte instance block, and
`defineComponent` in Vue, are plain statements at nesting zero and add
nothing to any function's numbers, so the compiler-macro concern in the
plan did not arise on these fixtures.

UntangleIt in the same delivery: its structure source measures a
component through the same extraction, `.vue` and `.svelte` join its
walker, its extensions, and its language guess, and the untangle loop
reads and rewrites the method's real lines. New fixture
test/fixtures/sfc with a Vue, a Svelte, and a template-only component;
`classify` measures 5/5/7 in both at its editor line.

Tests: seven in the library (test/sfc.test.ts: line numbers, both blocks,
the grammar choice, CRLF, content on the tag line, a `<script>` inside a
string, and no block at all; 40 in the library now); the DeepTest test
from 1.0.2 is replaced by one that finds the villain in both fixtures
with its numbers, depth, route, and declaration lines, and pushes a
template line and a deep script line through the engine (191 unit tests,
the count unchanged); one in UntangleIt (14).

## Angular with Vitest, through the builder (1.0.4)

Finding 3 of the 1.0 survey, closed for the Vitest flavour. Karma is
1.0.5.

The driver. `runnerFor` asks the framework before it asks package.json:
an Angular project whose angular.json test target uses
`@angular/build:unit-test` with no `"runner": "karma"` is `ng-vitest`,
and the run is `ng test` through node_modules/@angular/cli/bin/ng.js with
`--watch=false --isolate --coverage --coverage-reporters json
--coverage-include <sourceRoot>/**/*.{...} --coverage-exclude` (one flag
per pattern, see below) `--setup-files .deeptest/hooks/vitest.mjs
--runner-config .deeptest/vitest.config.mjs`. The setup file is a
project-relative path because the builder bundles setup files and
appends an absolute one to the project root (finding 3c). The generated
runner config wraps the file the builder would have loaded (the target's
`runnerConfig`, or vitest-base.config.* beside angular.json; usually
nothing) and pins two things: `coverage.provider: 'istanbul'`, because the
builder picks v8 whenever v8 is installed alongside istanbul or alone,
and v8 keeps no live counters for the hook to snapshot; and
`coverage.reportsDirectory` under .deeptest/, so the report lands where
the driver reads it instead of coverage/<project>/. Both are honoured:
`determineCoverageProvider` and `reportsDirectory` in
@angular/build/src/builders/unit-test/runners/vitest/plugins.js read the
runner config first. The environment check for this runner wants the
CLI, Vitest, and @vitest/coverage-istanbul pinned to the Vitest major,
and offers npm install or the pinned package in that order.

The source-map answer. The builder instruments its own esbuild chunks,
which exist nowhere on disk (`<root>/chunk-G3X6D2YX.js`,
`<root>/spec-app-greeting.js`), so the live counters the hook snapshots
are keyed by chunk. Each chunk's coverage entry carries `inputSourceMap`
whose `sources` are project-relative files (`src/app/greet.ts`) and the
builder's own glue (`virtual:builder`), and each mapping segment names
its source index. So the hook now keeps the source index when it decodes
the mappings, and `originalPosition` returns the file with the line: when
the coverage key is not a file on disk, the statement belongs to
`sources[index]` resolved against the chunk's folder (the project root),
and a segment that points at a virtual module is nobody's line and is
dropped. When the key is on disk (Vite's own transform, Jest) the key
stands and only the line moves, which is the behaviour every existing
run depends on. `existsSync` is cached per path; the hook is inside the
test worker and must stay cheap. The alternative, reading the per-test
attribution from a coverage dump the provider had already mapped, was
rejected: the provider maps once at the end of the run, and there is no
per-test dump to read.

Isolation, the finding that was not in the survey. With the hook in
place the first run attributed one test of eleven. The builder defaults
`isolate` to false "to align with the Karma/Jasmine experience" (`ng test
--help`), and under Vitest with isolation off the setup file runs once
per worker, so the `beforeEach`/`afterEach` it registers attach to the
first spec file collected and to nothing after it; greeting.spec.ts (one
test) got the hook, greet.spec.ts (eight) and names.spec.ts (two) did
not. With `--isolate` every spec file gets the setup file and all eleven
tests are attributed. The cost on the fixture is about a second and a
half of environment setup per run. Correctness wins.

Array options. `--coverage-exclude a b c` fails the whole command with
"Unknown arguments: watch, isolate, ..., c": the CLI's yargs array
options swallow every following word, then reject the command. One flag
per value.

Verified on angular-vitest with the plugin compiled from this tree: 11
passed, attribution on 21 lines, `pickGreeting` (schedule.service.ts)
first at 27/73/97, coverage 25.61%; greet.ts and names.ts carry exactly
the per-line test counts the React ports do (`4(6) 5(1) 7(6) ...`). Every
other port unchanged. UntangleIt runs an Angular project's tests through
`ng test --watch=false` in the same delivery, so the loop's test gate
holds on Angular. Tests: two new in DeepTest (the runner config
detection; the hook mapping a chunk's counters back to a source file,
and leaving an on-disk key alone) and the Angular environment test
rewritten for the two flavours, 193 in all; one new in UntangleIt (15).

## Angular with Karma, through the builder (1.0.5)

Finding 3 of the 1.0 survey, closed for the Karma flavour, and the last
runner in 1.0 that needed a hook written from scratch.

Getting in. The builder ignores `--setup-files` and `--coverage-include`
for Karma (it says so on the console), so the only door is
`--runner-config`, a Karma config file. The generated
`.deeptest/karma.conf.cjs` applies the project's own karma.conf.js when
the test target names one (`runnerConfig` as a path, or `true` with a
karma.conf.js in the project root), and otherwise the same defaults the
builder would have used, because the builder applies its built-in config
only when no file is given (`getBaseKarmaOptions` in
@angular/build/src/builders/karma/karma-config.js). It then appends the
deeptest plugin, framework, and reporter, points karma-coverage's json
report at .deeptest/coverage, drops the kjhtml reporter, and turns a bare
"Chrome" into "ChromeHeadless" so a check never opens a window. A custom
launcher the project defines is kept as it is.

The hook, in two halves. `hooks/karma-client.js` runs in the browser as a
classic script after Jasmine (the deeptest framework appends it to Karma's
file list; Jasmine's own framework unshifts its files to the front, and
the spec bundles are ES modules, which the browser defers, so the client
always loads between the two). It registers a Jasmine reporter,
snapshots `window.__coverage__` counters on `specStarted`, diffs them on
`specDone`, and sends the statement ids that rose to the server with
`__karma__.info`, along with each file's statementMap and inputSourceMap
the first time that file appears. `hooks/karma.cjs` runs in the Karma
server (Node), listens for `browser_info`, maps every statement through
attribution.cjs's `originalPosition`, and writes the same jsonl the other
hooks write. One mapping function for four runners. The test id is
`<spec file>::<Jasmine fullName>`; Jasmine 4 and later report the file a
spec was defined in, and through Karma that is a URL under `/base/`,
which the client strips.

Why the counters need no chunk mapping here. The builder instruments each
source file before bundling for Karma (the coverage babel plugin in
javascript-transformer-worker.js), so `__coverage__` is keyed by source
path, and the inputSourceMap only moves a line from the compiled
JavaScript back to the TypeScript. `originalPosition` sees a key that is
on disk and does exactly that.

Files no test loads. karma-coverage reports only the files the bundle
loaded, and the builder ignores `--coverage-include`, so the villain would
vanish, the falsely-clean report the survey found for Vue. The driver
walks the source root after the run and instruments every source file
the report lacks with the project's own istanbul-lib-instrument (the
builder itself requires it for coverage) on the TypeScript as written,
with `typescript` and `decorators-legacy` parser plugins, to get its
executable lines, all untested. The universe differs from the builder's
by the lines the compiler lowers into statements: a decorator or a class
field (`schedule.service.ts` lines 10 and 11, `app.ts` lines 4 and 9
under the Vitest flavour, absent here). No line with a decision differs,
and every such file is entirely untested either way, so the verdict is
the same; the coverage percentage moves by under a point (25.61% under
Vitest, 26.19% under Karma on the same program). A file the instrumenter
cannot parse is logged by name and left out. The alternative, an
import-everything spec so the bundle loads every file, was rejected:
importing main.ts bootstraps the application.

The older builder. `@angular-devkit/build-angular:karma` takes different
flags and has no fixture, so a project on it is refused with the reason
and the `ng update` path; `detectAngularBuilder` tells the two apart.

Verified on angular-karma with the plugin compiled from this tree and a
headless Chromium 141 in the harness (Playwright's headless shell, carried
into the linked machine's VM in six pieces because that VM cannot fetch
a browser): 11 passed, attribution on 22 lines, `pickGreeting` first at
27/73/97, coverage 26.19%; greet.ts carries exactly the per-line test
counts the Vitest and React ports do. UntangleIt runs Karma projects
through `ng test --watch=false --browsers ChromeHeadless` and parses
Karma's summary. Tests: three new in DeepTest (the Karma summary parser,
the Karma config detection with both builders, and the unloaded-file
universe on the fixture's villain) and the Angular environment test
rewritten, 196 in all; UntangleIt's Angular test extended (15).

## 1.0.6 survey: Mocha and Playwright component tests (2026-09-12)

The plan left two runners to a survey before they earned a driver. Both
were run in the harness against the HelloWorld modules; nothing in the
plugin changed for this section.

Mocha, CommonJS. A port of the three modules (greet, names, schedule) as
CommonJS with ten Mocha specs on node:assert, mocha 11 and nyc 17. The
run `nyc --reporter=json --report-dir .deeptest/coverage --all --include
'src/**' mocha --require .deeptest/hooks/mocha.cjs` works with the
attribution helper as it is: nyc's require hook instruments through
babel-plugin-istanbul into `global.__coverage__`, the root hook plugin
(`exports.mochaHooks = { beforeEach, afterEach }`) snapshots and diffs the
same way the Jest hook does, the test id is `<spec file>::<fullTitle>`
from `this.currentTest`, and `--all` puts the never-loaded villain in
the report with every line untested. Ten attributions, keys by source
path, lines right. A Mocha driver for CommonJS is a copy of the Jest
driver with different arguments.

Mocha, ES modules. The same port with `"type": "module"` runs green under
nyc and reports zero hits on every line of every file: nyc instruments
through the CommonJS require hook and never sees an ES module. That is
the falsely-red report, the survey's Vue finding in reverse, and it is
the shape a modern Mocha project has. Fix proven in the harness: a
DeepTest loader (`node --import .deeptest/hooks/instrument-loader.mjs`)
registers a `load` hook that instruments every source under the source
root with the project's istanbul-lib-instrument (nyc's own dependency)
before Node evaluates it, so `__coverage__` exists and the same mocha
hook attributes ten of ten with the same lines as CommonJS. The
whole-run report then has to come from DeepTest too (write
`__coverage__` at process exit; instrument never-loaded files the way
the Karma driver does), which makes the loader a runner-independent
Node path: it would serve `node --test` and any other Node runner
unchanged. Cost: the loader is new code with the same care the Karma
hook needed; benefit: every ESM Node project.

Playwright component tests. A React port with @playwright/test 1.63,
@playwright/experimental-ct-react, and vite-plugin-istanbul in
`ctViteConfig`, run against the harness's Chromium 141 through
`launchOptions.executablePath` (Playwright wanted its own build 1234 and
could not download it there; the older build ran the two tests fine).
`window.__coverage__` is in the page, keyed by source path with the
TypeScript inputSourceMap, and a `test.afterEach` reading it through
`page.evaluate` gives per-test counters: each test gets a fresh page, so
the counters at the end of a test are that test's attribution with no
diff needed. What is not solved is getting that fixture into the
project's tests without editing them: Playwright has no global hook
with page access, only `globalSetup` (no page) and reporters (no page).
The route is Node module hooks (`module.registerHooks`, Node 22.15 and
later) in the worker processes through NODE_OPTIONS, redirecting
`@playwright/experimental-ct-*` to a DeepTest wrapper that re-exports
the package's `test` extended with an automatic fixture; unproven, and
the driver would also need `vite-plugin-istanbul` as its install offer.
Feasible, a delivery of its own, and it needs a HelloWorlds port.

Recommendation, for the decision: 1.0.6 the Mocha driver with the
DeepTest loader for ESM (CommonJS through nyc when nyc is present, the
loader otherwise); 1.0.7 Playwright component tests through module
hooks, with a `react-playwright-ct` port; 1.0.8 the words and the pages.
Or stop at Mocha CommonJS and Playwright detected-and-explained, and
close the slot at 1.0.7 as planned.

## Witness: Mocha through DeepTest's own instrumentation (1.0.6)

The 1.0.6 survey ended with a choice, and the choice was to build the
right thing: DeepTest instruments the sources itself, in one loader for
ES modules and CommonJS, with no dependency on nyc or any coverage
package. docs/witness.md is the design; this section is what happened
while building it.

What was built: `src/witness/instrument.ts` (the instrumenter, on the
tree-sitter grammars already shipped, textual insertion on the same
lines, Istanbul-shaped maps), `hooks/witness.cjs` (the runtime, the
`__witness__` global with `__coverage__` beside it, per-test lines,
outcomes, and function entries), `hooks/witness-loader.mjs`
(`module.registerHooks`), `hooks/mocha.cjs` (a root hook plugin that
only says which test is running), the `mocha` runner in coverage.ts
(NODE_OPTIONS carries the loader so --parallel workers get it too; the
universe of files no test loads comes from the same instrumenter in the
extension's process), esbuild's second bundle
(dist/hooks/witness-instrument.cjs, web-tree-sitter inside), the Mocha
option on the setup screen, and the `node-mocha` HelloWorlds port.

Found while building it, in the order the tests caught them:

- Istanbul makes one branch of a whole run of logical operators
  whatever the operators and parentheses. The first draft made one per
  operator, and the differential test disagreed on 13 lines across
  DeepTest's own source. Mirrored.
- tree-sitter-typescript reads `a && b!.c` as `(a && b)!.c` (issue 299,
  open, present in the current release). The first fix skipped such
  runs and reported them; the right fix blanks every non-null assertion
  before the real parse, since `!` means nothing at run time. Zero
  skipped on 128 files afterwards. The same mis-parse touches the
  structure analysis and the MBCC operand rule in both tools and the
  library: a fix of its own, listed under "open".
- A `for` body that is an `if` was not wrapped in braces (the rule that
  spares `else if` had spared every `if`), so `continue` inside it fell
  outside the loop. Caught by `node --check` in the shapes test.
- A counter in front of an `else if` splits it from its `else`, and the
  result is a valid program that does something else. `node --check`
  cannot catch that; the pattern assertion did. The statement counter
  for an `else if` now rides inside its condition.
- A counter in front of `'use strict'` demotes the directive to a
  string. Directives are not statements to Istanbul either; the
  differential test on hooks/ caught it.
- A `require()`d CommonJS file arrives in the load hook with no
  `format` on Node 22; the loader's format filter rejected it and CommonJS
  projects came back empty. Fixed by treating no format as a script when
  the file is under the source root.
- `module.register` (async hooks) does not affect `require()` and is
  deprecated in Node 26; `module.registerHooks` covers both and is the
  floor: Node 22.15.

Verified on the ports with the plugin compiled from this tree: the new
node-mocha port (ES modules) 10 passing, attribution on 17 lines, the
villain first at 27/73/97, coverage 22.37%, exactly the Python port's
shape; a CommonJS copy the same; per-test lines identical to nyc's on
every test where nyc can run at all. React, Vue, Svelte, Angular, and
Python unchanged. Tests: seven new in test/witness.test.ts including the
differential test over every fixture and all of src/, and the loader
run that compares the instrumented villain with an untouched copy on
384 inputs; 203 in all. istanbul-lib-instrument is now a named
devDependency (it was only ever hoisted from @vitest/coverage-istanbul,
and the differential test must not depend on hoisting).

Open, from this work: the non-null mis-parse in the structure analysis
and the library; moving Jest, Vitest, and the Angular runners onto
Witness; the engine counters for bundles and browsers; reading
`outcomes` and `entered`.

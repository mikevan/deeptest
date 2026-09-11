# DeepTest: build status and run instructions

Updated 2026-09-12 (1.0.2, in the tree). Companion to vscode-density-extension-spec.md.
Source tree and VSIX live at C:\workspace\DeepTest on Michael's machine. The
authoritative copy of this file is docs/build-status.md in that tree.
Committed on main: cc9d908 "Cognitive complexity beside cyclomatic" (0.3.7),
33fb006 "Pytest addopts no longer break the run" (0.3.8), 1fb82e5
"Complexity measured by the shared package", the 2026-09-11 Marketplace
commits (icon, README, packaging rules), then "Break it into smaller pieces
hands off to UntangleIt" (0.4.4, 2026-09-12, pushed).

Version policy (2026-09-12, later the same day): the core is declared done
and every extension is tagged 1.0.0 together (DeepTest, UntangleIt, the
pack, and the library). From here the minor number moves once per language
across the whole toolkit (Java 1.1, C# 1.2, C++ 1.3, Go or PHP 1.4); patch
numbers cover everything else. See docs/toolkit/toolkit-roadmap.md.

## 2026-09-12, 1.0.2: the framework is known; .vue and .svelte are visible

- src/languages/typescript/framework.ts (new): detectFramework,
  detectAngularRunner, frameworkSentence. The setup screen's first note
  names the framework and runner ("Framework: Vue 3 with Vitest.").
- checkEnvironment refuses an Angular project (Karma or Vitest under the
  ng test builder) in one sentence with no install button. Closes survey
  finding 4 ("Install Vitest" on a Karma project).
- .vue and .svelte are walked, instrumented, and scored at bar 1 with an
  empty structure, so an untested component shows red instead of
  vanishing. Closes survey finding 2. Parsing them is 1.0.3.
- Six new tests against test/fixtures/helloworld-*. 191 unit tests
  expected. UntangleIt unchanged in this delivery.
- Verify on HelloWorlds\vue-vitest opened in VS Code: the setup screen
  says "Framework: Vue 3 with Vitest."; "Check my code" lists
  src/components/GreetingPicker.vue under "Look at these first" (line 14
  first, never tested), where 1.0.1 showed nothing at all. On
  HelloWorlds\angular-karma the setup screen names Karma and there is no
  "Install Vitest" button.

## 2026-09-12, 1.0.1: the first slot of the Language Expansion series begins

- HelloWorlds (github.com/mikevan/HelloWorlds): seven ports of the same
  program, every villain at 27/73/97; copied into test/fixtures/helloworld-*
  by scripts/sync-fixtures.mjs.
- The 1.0 survey (docs/engineering-notes.md, "1.0 survey"): react-jest and
  python fully served; react-vitest failed in production (hook outside the
  project root); vue and svelte falsely clean; angular needs the builder;
  karma told to install Vitest.
- 1.0.1 fixes the two production bugs: the Vitest hook is copied into
  .deeptest/hooks and loaded from there, and the coverage-package install
  is pinned to the Vitest major. Two new tests (one end to end from a
  temporary folder). 185 unit tests expected.
- Verify on HelloWorlds\react-vitest opened in VS Code: "Check my code"
  reports 11 tests passed and pickGreeting() first; before 1.0.1 it said
  "vitest produced no coverage".

## 2026-09-12, second build: three changes in the tree (built as 0.4.5, shipped as 1.0.0)

- src/runner.ts refuses to score when passed + failed is 0 (errored and
  skipped tests executed nothing); `testsRan` and `nothingToScoreSentence`
  in src/ui/words.ts, two tests. Closes the "0 passed, 5 could not run,
  16% coverage" reading from 0.3.8. Language-neutral, above the plugin
  contract; 0.3.8 only caught pytest failing before collection.
- Python environment check names the interpreter the packages are missing
  from (`missingPackagesSentence`): "The Python at C:\...\python.exe is
  missing coverage." with the button "Install coverage into that Python";
  one test. Reason and the bundling alternatives in docs/engineering-notes.md.
- The sanity-check sentence: `tangleCheck` in src/ui/words.ts appends "It is
  harder to follow than it is to test, which means nesting. That is a job
  for UntangleIt." when tangle exceeds ways through, or "It is long rather
  than hard to follow. It needs tests more than it needs untangling." when
  ways through is at least twice the tangle. Two tests.
- DECISION 2026-09-12 (closes the open question from 2026-09-09): DeepTest
  ranks and judges by ways through and only by ways through. Tangle rides
  beside every function as a sanity check and drives UntangleIt. When
  Campbell and MBCC wildly disagree, MBCC wins. Reasoning in the paper
  docs/toolkit/mbcc-why-and-how.md (also in the project as
  claude/mbcc-why-and-how.md).
- The complexity library moved to 0.1.1 underneath: MBCC gained the
  ordered-branches rule (k-th branch of a chain on different facts costs
  k; a chain on one value against constants, like a switch, costs one).
  Nothing in DeepTest's arithmetic reads MBCC, so no verdict changes; the
  tangle numbers behind the switch do. Build the library first; DeepTest
  bundles its dist.
- Unit tests: 185 expected (180 + 3 + 2). words.test.ts and the
  missingPackagesSentence case were run in Claude's container against
  staged copies; the full suite, the build, and the install are still owed
  on Michael's machine.
- Verify: Regalia with Docker Desktop stopped must show "No test ran to the
  end, so there is nothing to score. ..." and no numbers; HelloWorld's
  "Hardest to test" row must end with "That is a job for UntangleIt."

## 2026-09-12, first session: hand-off verified, both trees committed and pushed

- DeepTest 0.4.4 and UntangleIt 0.1.10 built, installed, and the hand-off
  verified on HelloWorld: "Fix this" on pick_greeting(), "Break it into
  smaller pieces", UntangleIt's KeepSafe offer and modal appear, DeepTest's
  message reads "pick_greeting() is with UntangleIt."
- DeepTest committed on `main`, UntangleIt committed on `master` (its
  default branch; not main). UntangleIt's commit: "Measures on demand when
  called from DeepTest". Both pushed. Uploads and the fresh-profile pack
  install are still to do; no public announcement yet (friends review
  first).
- Test count is 180, not 207: commit 1fb82e5 moved the three cognitive.ts
  walkers and test/cognitive.test.ts (27 whitepaper tests) into
  `@projectrevivesolutions/complexity` at C:\workspace\complexity.
- Field note: on a production Python project DeepTest prompted "This Python
  is missing coverage." with an "Install coverage" button. By design
  (toolkit principle 5, the project's own runtime); coverage.py must import
  inside the interpreter that runs the tests. Bundling coverage.py was
  weighed and set aside: its C extension is per-platform, per-Python-version;
  the pure-Python tracer is slower and drops concurrency and plugins
  (coverage.readthedocs.io/en/latest/install.html); Apache-2.0 inside a
  GPL-3.0-only VSIX adds a NOTICE obligation. Middle path kept open: bundle
  the pure-Python tracer as an offline fallback only, report which copy was
  used.
- Lesson for delivering commands: PowerShell here-strings (`@" ... "@`) in
  a pasted block silently failed for the second commit. Use `git commit -F`
  with a message file written by Set-Content. Name the branch in every
  push.

## 2026-09-11 (late): the hand-off to UntangleIt is built (0.4.3)

- src/untangleit.ts (id, command, installed check, link) beside
  src/keepsafe.ts. In fixFunction, the refactor choice routes to
  `untangleit.method` with `{ path, startLine }` when UntangleIt is
  installed and stops; no decision is recorded (UntangleIt's gates are
  where the person says yes). Not installed: the old brief and gates, and
  a recommendation on the setup screen under "When a function is too
  tangled". Routing rule and sentences in src/ui/words.ts, pinned by two
  unit tests.
- UntangleIt 0.1.9 measures the file on demand in `untangle()` so the
  call from DeepTest works on a fresh editor.

## 2026-09-11: Marketplace packaging, logos, demo project, sibling rename

- Flat logo (checklist with a green check, black ground, KeepSafe's orange
  and green) in media/, named by the `icon` field.
- `.vscodeignore` gained `.keepsafe/**`, `.UntangleIt/**`, `_to_delete/**`,
  `Claude outputs/**`, `*.zip`, `media/**` with the icon and `media/*.svg`
  re-included.
- Packaging MUST use `--no-dependencies`. `@projectrevivesolutions/complexity`
  is installed as `file:../complexity`; the packager follows the link out
  of the project otherwise. The library is bundled into dist/extension.js
  by esbuild. The same now applies to UntangleIt.
- README images are rewritten by the packager to raw.githubusercontent.com
  from the `repository` field, so they show only once pushed.
- Demo project for GIFs: C:\workspace\HelloWorld (Python, pytest, 10
  tests, .venv with pytest, pytest-cov, coverage). schedule.py holds
  pick_greeting(), nested five deep with no tests.
- The pack: C:\workspace\MADTPackage, repo mikevan/MADTPackage, id
  prs.MADTPackage, listing KeepSafe.keepsafe, prs.deeptest, prs.untangleit.
- Sibling named UntangleIt on 2026-09-11 after the Marketplace refused its
  first display name.

## What exists (v0.3.8 core, unchanged since)

- One language contract (src/languages/types.ts) and a registry. Nothing
  above the contract names a language.
- Plugins: Python (coverage.py contexts + tree-sitter) and TypeScript /
  JavaScript (Jest or Vitest with an Istanbul snapshot hook + tree-sitter).
  Each plugin uses the project's own runtime. Python offers "Install
  coverage into that Python" when missing; Vitest projects get "Install
  @vitest/coverage-istanbul".
- Routes: every decision on the way to every line, with where the tests
  stop. Depth equals route length by construction.
- Three numbers per function: ways through (cyclomatic, the only number
  that drives the verdict), tangle (Campbell), tangle (MBCC), all from
  `@projectrevivesolutions/complexity`.
- Pytest runs honour the project's own addopts minus its pytest-cov
  options (0.3.8); a pytest that fails before collecting is reported as a
  failed run; a run with no passed or failed test is refused (0.4.5).
- Report: verdict against thresholds, worst shortfalls in full, accepted
  lines, unreachable code, over-complex functions, comparison table.
- Decisions: Fix this, Accept with reason, Leave.
- Environment variables read by the code (harness only): DEEPTEST_PYTHON,
  DEEPTEST_TEST_HOST, DEEPTEST_VSCODE_PATH, DEEPTEST_IT_ONLY,
  DEEPTEST_SCREENSHOT_*; UNTANGLEIT_PYTHON, UNTANGLEIT_TEST_HOST,
  UNTANGLEIT_VSCODE_PATH.

## First real run: Regalia, 2026-09-09

Regalia (C:\workspace\NonProfitAccounting\kofc-accounting-system) needs
Docker Desktop running: its conftest starts PostgreSQL 15 through
Testcontainers. Baseline with 0.3.8 and Docker up: 379 passed; coverage
44.75%; 31.92% of lines have enough tests; average density 2.84; 4661
shortfalls; 36 functions over 10 ways through. Of the 36, about 16 are flat
loaders and switches, about 12 are nested, and 4 are guard chains only the
ordered-operand rule catches. Under the 0.1.1 library the flat ones now
score a tangle of 1 and the guard chains score higher than before.

### The _segment_attempt() refactor: verified, NOT committed (demo pending)

Split into eight helpers, every piece within the limit of 10;
tests/unit/test_translation_service_segment_attempt.py, 23 characterization
tests, pass on both pre- and post-refactor code. Michael is not committing
anything in Regalia until after a demo.

## Run it (PowerShell)

```powershell
cd C:\workspace\complexity
npm test                                        # 33 tests
npm run build                                   # both extensions bundle its dist
cd C:\workspace\DeepTest
npm install
npm test                                        # 185 tests
npm run build
Remove-Item *.vsix -ErrorAction SilentlyContinue
npx @vscode/vsce package --no-dependencies
code --install-extension (Get-ChildItem *.vsix).FullName --force
```

Every delivery bumps the patch number before packaging (`npm version patch
--no-git-tag-version`) unless Michael says otherwise; 0.4.5 was set by hand.
Publisher is `prs` (prs.deeptest).

## Next

1. Run, build, install, and verify 0.4.5 on Michael's machine (see Verify
   above); then commit, one commit per tree.
2. Upload deeptest and untangleit VSIXs; fresh-profile install of
   prs.MADTPackage. Announcement waits for the friends' review.
3. After the demo: commit the _segment_attempt() refactor with its tests.
4. cash_flow_statement() in Regalia is the first real untangling candidate,
   with tests running from the start.
5. Baseline comparison card; Java, C#, C++ plugins; pytest-cov
   parametrized ids.

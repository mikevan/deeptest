# DeepTest: build status and run instructions

Michael Van Geertruy, with Claude. Project Revive Solutions, LLC.

Updated 2026-09-22 (1.0.18, in the tree). Companion to vscode-density-extension-spec.md.
Source tree and VSIX live at C:\workspace\MikeVan's AI Development Toolkit\DeepTest on Michael's machine. The
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

## 2026-09-22, 1.0.18: the published contract is cut down to the product, and checked

- `toolkit-api.md` is draft 6. Removed from the contract and moved to a new
  section 10, "Proposed, not built": `deeptest.api.status`,
  `deeptest.api.check`, `deeptest.api.function`, `deeptest.api.decisions`,
  `untangleit.api.plan`, `.deeptest/last-check.json` and the
  verdict-on-a-checkpoint flow, `onDidCheck` and `onDidDecide`, KeepSafe's
  record files, and the before-and-after measurement UntangleIt was said to
  make. Every one of them was published as shipped and none was built.
- The current contract, all of it verified present in source: extension ids
  and `getExtension` discovery; `deeptest.run`, `deeptest.fix`,
  `deeptest.fixFunction`, `untangleit.method`, `untangleit.worst`, and the one
  silent command `untangleit.api.measure`; the hand-off to `untangleit.method`
  through `prs.untangleit`; `keepsafe.quickCheckpoint`;
  `.deeptest/decisions.json` and `.untangleit/runs.json`; and the real
  `activate` exports, `{ state, run, report }` and `{ state, run }`.
- `DeepTest\package.json` gains a `prsToolkit` block: protocol 1, verb
  "measure and judge", `commands: []`, `records: [".deeptest/decisions.json"]`.
  Section 2 now states that `commands` lists silent commands only, which is
  what makes the empty array correct rather than unfinished.
- `test/contract.test.ts` (new) is the four rules, as a pure function over
  facts gathered from the trees: registrations from `registerCommand` calls in
  each tool's source, the block from each `package.json`, and record-write
  evidence from a source file that carries `writeFileSync` and the folder and
  file-name literals. It parses only the tables under `### 3.2 DeepTest`,
  `### 3.3 UntangleIt`, and `## 4. Records on disk`, and cuts the document at
  `## 10. Proposed, not built`, asserting that heading exists so the boundary
  cannot be deleted quietly.
- The second test in that file runs the same rules against trees built to
  break each one, including a file whose only mention of a record path is a
  comment. Six mutations of the real check were tried and all six failed it,
  including moving `untangleit.api.measure` into section 10, which the block
  rule catches: a real command cannot be demoted to proposed while discovery
  still advertises it.
- KeepSafe is checked only as far as is honest. The document must name
  `keepsafe.quickCheckpoint`, and each tool's source must name that command
  and no other. KeepSafe is not our repository.
- Tests: 220 in DeepTest, two more than 1.0.17. complexity, Witness, and
  UntangleIt untouched.
- Verified on Michael's machine, 2026-09-22, through `release.ps1` with no
  arguments: library mirrors byte for byte identical, complexity 104, Witness
  12, UntangleIt 17, DeepTest 220, all five trees built and packaged at
  1.0.17. Phase 0 mirrored draft 6 into `DeepTest\docs` first, so the contract
  test ran against the document the release ships and the implementations as
  they are built, not against a working copy.
- Verify: that run. The contract test is only worth anything after phase 0,
  because before it the mirror is whatever the last release left there.

## 2026-09-22, 1.0.17: Angular measures through Witness, and Istanbul leaves the product

- `writeShadowTree` mirrors the source root into `.deeptest/instrumented`:
  every source file instrumented with its maps embedded and labelled with the
  ORIGINAL path, everything else copied through. The copying is not an extra:
  a component names its template and stylesheet by relative path and a
  stylesheet names an image the same way, and each is resolved from the file
  that names it. A negative control proved the resolution is real. Pointing
  the stylesheet at a missing asset fails the build.
- `writeShadowTsConfig` extends the project's own test tsconfig, in the
  builder's own order of preference, and repoints every path alias whose
  target is inside the source root. An alias left alone pulls the
  uninstrumented file into the build, and every line in it then reads as never
  executed. `readTsPaths` follows `extends` and resolves each target the way
  TypeScript does, from a tsconfig that may carry comments and trailing
  commas.
- `detectAngularTestTarget` reads the project's source root, because the
  builder globs every `--include` pattern with that folder as the working
  directory. The include is therefore relative and never absolute: the Karma
  compatibility layer strips a leading slash from each pattern before globbing
  (`builders/karma/find-tests.js`), so an absolute pattern becomes a relative
  one, matches nothing, and the run reports zero tests and passes. That is how
  the first spike run failed.
- `renameTestFiles` moves the spec path in each test id from the mirror back
  to the source. The lines in the record were already right; without this the
  card would have shown test names pointing into a generated folder beside
  lines pointing into the project.
- Karma goes in through `angularKarmaConfig` and `--runner-config`, because
  the builder ignores `setupFiles` for that runner and says so in a warning.
  The generated config wraps the project's own when it has one and otherwise
  sets the defaults the builder would have applied itself, then adds the
  Witness framework and reporter, drops `kjhtml`, and turns a bare `Chrome`
  into `ChromeHeadless`.
- Removed: `unloadedCoverages`, `coverageIstanbulSpec`, `angularRunnerConfig`,
  the `@vitest/coverage-istanbul` and `karma-coverage` environment
  requirements, the `@vitest/coverage-istanbul` devDependency in both DeepTest
  and UntangleIt, and all five hooks DeepTest shipped (`attribution.cjs`,
  `jest.cjs`, `karma.cjs`, `karma-client.js`, `vitest.mjs`). DeepTest now ships
  no hooks of its own and `hooksDir` is gone from the runtime environment.
  `istanbul-lib-instrument` stays as a devDependency only, because it is the
  oracle the differential test grades the maps against.
- `esbuild.mjs` empties `dist/hooks` before filling it. Two files that had
  stopped being hooks had already shipped from an earlier build.
- Packaging, carried in the same delivery: `.refactorit` removed from the
  repository eleven days after the rename to UntangleIt, `.refactorit/**`
  ignored in DeepTest's `.gitignore` and `.vscodeignore`, `.deeptest/**`
  excluded from UntangleIt's package, and `hooks/**` dropped from DeepTest's
  `.vscodeignore` now that the folder is gone.
- Tests: 218 in DeepTest (four obsolete ones removed with the mechanism they
  described, three added: the generated Karma config, the shadow tsconfig and
  its aliases, the shadow tree itself, and the test-id rename), 12 in Witness
  (two added: the decorated class through the embedded maps, and the rewrite
  under `tsc --strict`).
- Verified on Michael's machine at Node v22.23.2, 2026-09-22. Witness 12
  passed, DeepTest 218 passed and 0 skipped. `survey.cjs` on
  HelloWorlds\angular-vitest and HelloWorlds\angular-karma: 11 finished, 11
  recorded, 11 carrying a file, 3 files with a line that ran, 0 cut off, test
  ids naming `src/app/*.spec.ts`. Both runners report the same table:
  `src/app/greet.ts` 9/9, `src/app/greeting.ts` 1/1 with 2 decisions uncounted
  on lines 10 and 11, `src/app/names.ts` 18 lines with 8 covered,
  `src/app/app.config.ts` 1 line at zero, `src/app/app.ts` no executable
  lines, `src/app/schedule.service.ts` 49 lines at zero, `src/main.ts` 2 lines
  at zero. Eighteen covered of eighty executable.
- Those figures differ from 1.0.15's 21 attributed lines and 25.61 percent,
  and that is the point of the delivery. Istanbul counted the builder's
  compiled output, where a decorated class field lowers into statements.
  Witness counts the source, and names the two initialisers in `greeting.ts`
  that Angular requires to appear exactly as written rather than counting
  them. The full line-by-line reconciliation against the 1.0.15 table has not
  been done.
- Verify: those two survey runs. They are the pair that matters, because the
  two ports hold identical TypeScript and differ only in their runner, so any
  disagreement between the tables is a defect and not a difference of opinion.

## 2026-09-22, 1.0.16: Jest measures through Witness

- The Jest branch of `run()` asks for no coverage from Jest at all. It reads
  the project's resolved transform table from `jest --showConfig`, wraps every
  entry with `hooks/witness-jest-transform.cjs` (`witnessTransform`), loads the
  runtime through `--setupFiles` and the boundary through
  `--setupFilesAfterEnv`, ours first in both, and lets the project's own
  entries follow.
- `witnessUniverse` takes an optional `{ sourceRoot, instrumentedDir }` and
  then produces both halves from one parse: the executable-line universe, and
  the instrumented source written under `.deeptest/instrumented` mirroring each
  file's path. Maps are embedded, because Jest gives every test file its own
  global and a registration made in one sandbox is invisible in the next.
  `prepareWorkDir` clears that folder, so a deleted source cannot leave an
  instrumented copy behind for the transformer to serve.
- The test-path filter goes ahead of every flag. Jest's yargs arrays swallow
  each following word, and a positional after them is read as one more setup
  file: the first run died with `Module ^/...test/ in the setupFilesAfterEnv
  option was not found`.
- `hooks/jest.cjs` now has no caller. It goes out with `attribution.cjs` when
  Angular moves onto Witness, not before.
- Tests: 218 in DeepTest (one new, `witnessTransform`), 10 in Witness (one new,
  the transformer end to end against a stub upstream). complexity and
  UntangleIt untouched.
- Verified on Michael's machine at Node v22.23.2, 2026-09-22. Witness 10
  passed, DeepTest 218 passed and 0 skipped. `survey.cjs` on
  HelloWorlds\react-jest, after `npm install` there: 11 finished, 11 recorded,
  11 carrying a file, 3 files with a line that ran, 0 cut off, no refusal;
  `src/components/Greeting.jsx` 1/1, `src/greet.js` 9/9, `src/names.js` 18
  lines with 8 covered, `src/schedule.js` 49 lines at zero. Every one of those
  figures matches what the same program reports on the react-vitest port,
  file for file.
- Verify: that survey run. The port is the awkward one on purpose, with JSX
  through `@babel/preset-react`, a jsdom environment, and a project
  `setupFilesAfterEnv` of its own that the hook goes in front of rather than
  replaces.

## 2026-09-22, 1.0.15: the tool has to run before we drive it, and Angular measures again

- `src/languages/typescript/engines.ts` (new) reads what each package DeepTest
  starts declares in `engines.node` and `checkEnvironment` refuses before the
  run when the running Node is outside it, naming the package, its range, and
  the installed version. A range the reader cannot parse lets the run proceed.
  `enginePackages` lists what each runner actually starts, the process that
  would refuse first.
- Angular with Vitest is back on the 1.0.4 path: the istanbul provider and the
  reports directory pinned in the generated runner config, `--coverage
  --coverage-reporters json --coverage-include`, `hooks/vitest.mjs` as the
  setup file, and the builder's chunks mapped back to sources through
  `hooks/attribution.cjs`. The environment check requires
  `@vitest/coverage-istanbul` again, pinned to the project's Vitest major.
  From 1.0.12 to 1.0.14 this path measured nothing: the builder bundles before
  Vitest runs, so the Witness plugin only ever saw built chunks outside the
  source root.
- A run that measured nothing at all is refused: no record carrying a file and
  no file with a line that ran. `Evidence` gained `recordsWithEvidence` and
  `filesWithHits`; one empty record is still ordinary and is not refused.
- `scripts/survey.cjs` prints all five evidence counts. It printed three, which
  is why the first 1.0.15 acceptance run could not show the new check at all.
- Tests: 217 in DeepTest (nine new in `test/engines.test.ts`, one new in
  `words.test.ts`, `reconcile` and the Angular runner config tests rewritten).
  Witness, UntangleIt, and complexity untouched.
- Verified on Michael's machine at Node v22.23.2, 2026-09-22. `npm test`: 217
  passed, 0 skipped. `survey.cjs` on HelloWorlds\angular-vitest: environment
  ok with `ng test with vitest 4.1.11`; 11 finished, 11 recorded, 11 carrying a
  file, 3 files with a line that ran, 0 cut off; `greet.ts` 9/9/9,
  `greeting.ts` 4/4/4, `names.ts` 13/8/8, 21 attributed lines over a universe
  of 82, which is 25.61% and is what the 1.0.4 note recorded. On
  HelloWorlds\react-vitest\_to_delete\scratch-empty, a project whose two
  passing tests touch nothing under `src`: 2 finished, 2 recorded, 0 carrying a
  file, 0 files with a line that ran, and the refusal fires with no card drawn.
- Verify: those two survey runs. The second is the one that proves the refusal,
  because a working Angular run can no longer produce the shape that triggers
  it.

## 2026-09-22, 1.0.14: a card is never drawn from evidence with a hole in it

- Every runner's records are counted against the runner's own test count
  in `collect()` (`reconcile`, `Evidence` on `CoverageRun`). Fewer records
  than finished tests, or any record whose boundary was cut, and the runner
  refuses with "The check did not finish." and the reason
  (`evidenceProblemSentence`), the three controls under it. Retries leave
  more records than tests and are allowed. The Python plugin reports its
  evidence as not reconcilable, since coverage.py contexts exist only where
  a test touched a line.
- Witness closes an open test on the next `begin` and at process exit with
  the boundary named in the record (`overlapped`, `unterminated`) instead of
  overwriting it or writing it as clean. A file a loader or the Vite plugin
  could not instrument is noted beside the reports (`unmeasured-*.json`)
  and shown as unmeasured, out of every number, verdict not ready.
  `witnessUniverse` and `unloadedCoverages` keep an unreadable file the same
  way rather than dropping it from the report.
- `maps.skipped` reaches the person: per file in the full report, counted in
  the summary. The Playwright fixture writes a record for a test whose page
  had no runtime, so an empty test is not an unaccounted one.
- The separator regression test in Witness constructs both spellings of a
  path explicitly, so it can fail on Linux as well as Windows.
- `scripts\survey.cjs` prints the evidence line and marks unmeasured files
  and uncounted decisions, so the headless view says what the panel would.
- Tests: Witness 9 (one new), DeepTest 207 (six new; 204 pass, 3 skipped
  Python cases as before). UntangleIt and complexity untouched.
- Verify on HelloWorlds\react-vitest: "Check my code" reports as it did at
  1.0.13 and the log carries "Evidence: 11 tests finished, 11 attribution
  records, 0 with a broken test boundary." Then, in a scratch copy of the
  same project, change one `describe` to `describe.concurrent` and add a
  short `await` in two of its tests: the panel must show "The check did not
  finish." with "1 test was cut off before it ended, so what it reached
  cannot be told apart from the next test. Nothing was scored." and no
  numbers. Restore the copy.

## 2026-09-12, 1.0.9: Witness is its own library

- src/witness/ and the Witness hooks (witness.cjs, witness-loader.mjs,
  witness-vite.mjs, witness-playwright-loader.mjs,
  witness-playwright.template.ts, mocha.cjs) leave DeepTest for
  C:\workspace\MikeVan's AI Development Toolkit\Witness,
  `@projectrevivesolutions/witness`, a `file:../Witness` dependency like
  complexity. coverage.ts imports createInstrumenter, hooksDir, HOOK_FILES,
  ENV, and nodeSupportsWitness from it; prepareWorkDir copies the Witness
  hooks from the package's dist/hooks beside DeepTest's own; the drivers
  set WITNESS_* beside DEEPTEST_*; esbuild copies the package's hooks into
  dist/hooks (the package index is bundled into extension.js, so hooksDir()
  is dist/hooks at runtime). No measurement changed. 200 tests (the five
  library tests now run in the Witness tree, which has 7).
- Verify: after `npm install` in Witness and in DeepTest, `npm test` in
  Witness passes 7 and in DeepTest 200; on HelloWorlds\node-mocha the panel
  shows 10 tests passed and pickGreeting first at 27/73/97; on
  HelloWorlds\react-playwright-ct 10 tests passed, greet.ts 4(6) 5(1) 7(6),
  pickGreeting 27/73/97; .deeptest\hooks in either project holds
  witness-instrument.cjs beside witness.cjs.

## 2026-09-12, 1.0.8: the words and the pages

- README Languages, Requirements, and Known Limits say what shipped;
  UntangleIt's test gate drives Mocha and Playwright component tests; the
  toolkit documents are level across DeepTest, UntangleIt, and the pack;
  the roadmap marks 1.0 done. 205 tests.
- Playwright component tests no longer need the import line: a resolve
  hook in Playwright's workers (hooks/witness-playwright-loader.mjs,
  through NODE_OPTIONS) answers each spec's import of the component
  package with DeepTest's fixture, written under .deeptest/hooks/. The
  HelloWorlds port commits no .deeptest folder and its specs import the
  package again. Witness never writes to a project file; the README and
  the setup notes say so in those words.
- Verify: on HelloWorlds\react-playwright-ct, with the two specs
  importing from "@playwright/experimental-ct-react" and no .deeptest
  folder committed, Check the tests passes 10 tests, greet.ts shows the
  same per-line test counts as before (4(6) 5(1) 7(6)), and
  pickGreeting is first at 27/73/97; the setup screen's Playwright note
  says nothing in the project changes. On HelloWorlds\node-mocha,
  UntangleIt's setup screen names the runner "mocha".

## 2026-09-12, 1.0.7: Playwright component tests through Witness in the page

- hooks/witness-vite.mjs instruments the component build and injects the
  runtime; hooks/witness-playwright.template.ts is the fixture DeepTest
  writes to .deeptest/witness-playwright.ts; runner playwright-ct with a
  wrapper config in .deeptest/ (own build cache, emptied per run).
- The one line a project adds: import test and expect from
  .deeptest/witness-playwright.ts in each spec. The setup screen names the
  files that lack it. Only what the page runs is counted.
- New port and fixture: HelloWorlds/react-playwright-ct, test/fixtures/helloworld-react-playwright-ct.
- Tests: 205 (two new). Needs Playwright's browser in the project
  (npx playwright install chromium).
- Verify on HelloWorlds\react-playwright-ct in VS Code after npm install
  and npx playwright install chromium there: the setup screen says "Found
  Playwright component tests (@playwright/experimental-ct-react,
  configured in playwright-ct.config.ts)." and the Witness sentence;
  "Check my code" reports 10 tests passed, pickGreeting() first with 27
  ways through, src/greet.ts line 4 showing 6 tests.

## 2026-09-12, 1.0.6: Witness, and Mocha through it

- DeepTest's own instrumentation (docs/witness.md): src/witness/,
  hooks/witness.cjs, hooks/witness-loader.mjs, hooks/mocha.cjs, a second
  esbuild bundle dist/hooks/witness-instrument.cjs.
- Runner mocha: ES modules and CommonJS, no coverage package, Node 22.15
  or later (module.registerHooks). Files no test loads come from the same
  instrumenter.
- New port and fixture: HelloWorlds/node-mocha, test/fixtures/helloworld-node-mocha.
- Tests: 203 (seven new, including the differential test against
  istanbul-lib-instrument on every fixture and all of src/). New named
  devDependency istanbul-lib-instrument; run npm install once.
- Verify on HelloWorlds\node-mocha in VS Code (Node 22.15 or later on
  PATH): the setup screen says "Found mocha (configured in the "mocha"
  key in package.json)." and the Witness sentence; "Check my code" reports
  10 tests passed, pickGreeting() first with 27 ways through, and
  src/greet.js line 4 shows 6 tests. No install button appears.

## 2026-09-12, 1.0.5: Angular with Karma runs through the builder

- Runner ng-karma: `ng test --watch=false --coverage --runner-config
  .deeptest/karma.conf.cjs`; the generated config wraps the project's
  karma.conf.js or the builder's defaults, adds the deeptest framework and
  reporter (hooks/karma.cjs, hooks/karma-client.js), runs Chrome headless.
- Per-test attribution through a Jasmine reporter in the browser and
  __karma__.info to the server; one mapping function for every runner.
- Files no test loads are instrumented with the project's
  istanbul-lib-instrument for their executable lines (all untested).
- The older @angular-devkit/build-angular:karma builder is refused with
  the reason. UntangleIt runs Karma projects headless.
- Tests: 196 in DeepTest (three new, one rewritten), 15 in UntangleIt.
- Needs Chrome on the machine (karma-chrome-launcher finds it).
- Verify on HelloWorlds\angular-karma in VS Code: the setup screen says
  "Framework: Angular 22, tests through ng test with Karma."; "Check my
  code" reports 11 tests passed, no browser window opens, pickGreeting()
  is first with 27 ways through, src/app/greet.ts line 4 shows 6 tests.
  Before 1.0.5 the run was refused.

## 2026-09-12, 1.0.4: Angular with Vitest runs through the builder

- Runner ng-vitest: `ng test --watch=false --isolate --coverage ...` with
  the hook as a project-relative setup file and a generated runner config
  that pins the istanbul provider and the reports directory.
- The hook maps a bundled chunk's counters back to the source file
  through the chunk's source map (hooks/attribution.cjs,
  originalPosition). --isolate is required: without it only the first
  spec file is attributed.
- UntangleIt runs Angular tests through ng test too.
- Tests: 193 in DeepTest (two new, one rewritten), 15 in UntangleIt.
- Verify on HelloWorlds\angular-vitest in VS Code: the setup screen says
  "Framework: Angular 22, tests through ng test with Vitest."; "Check my
  code" reports 11 tests passed and pickGreeting() first with 27 ways
  through; src/app/greet.ts line 4 shows 6 tests. Before 1.0.4 the run
  was refused.

## 2026-09-12, 1.0.3: single-file components are parsed

- The library's extractScript blanks everything outside a .vue or
  .svelte file's script blocks, newlines kept, so the parsed tree's rows
  are the editor's lines. DeepTest's structure source parses components
  through it; lines outside the blocks are declarations (counted for
  coverage, never for density). The template is not parsed.
- UntangleIt measures components the same way and walks .vue and .svelte.
- Tests: 7 new in the library (40), 1 replaced in DeepTest (191), 1 new in
  UntangleIt (14).
- Verify on HelloWorlds\vue-vitest in VS Code: "Check my code" puts
  pickGreeting() at the top of "Hardest to test" with 27 ways through,
  "Open" lands on line 13 of src/components/GreetingPicker.vue, and the
  first card under "Look at these first" is line 37 of that file with a
  six-step route. Then "Break it into smaller pieces" hands it to
  UntangleIt, whose list shows pickGreeting() from the .vue file first.
  The same on HelloWorlds\svelte-vitest, line 11 of src/lib/GreetingPicker.svelte.

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
  `@projectrevivesolutions/complexity` at C:\workspace\MikeVan's AI Development Toolkit\complexity.
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
- The pack: C:\workspace\MikeVan's AI Development Toolkit\MADTPackage, repo mikevan/MADTPackage, id
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
cd C:\workspace\MikeVan's AI Development Toolkit\complexity
npm test                                        # 33 tests
npm run build                                   # both extensions bundle its dist
cd C:\workspace\MikeVan's AI Development Toolkit\DeepTest
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

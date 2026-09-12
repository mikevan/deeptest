# Witness: DeepTest's own instrumentation

Draft 2, 2026-09-12 (draft 1 earlier the same day; draft 2 adds the Vite plugin, the Playwright fixture, and the engine-counter survey). Born inside DeepTest under `src/witness/` and `hooks/`; it becomes its own library, `@projectrevivesolutions/witness`, when UntangleIt needs it (see "Where it lives").

## 1. Why it exists

Every JavaScript runner the toolkit serves runs on V8 and ends up with Istanbul-shaped counters in a global object: a map keyed by file, each entry holding `s` (statement id to hit count), `statementMap`, `fnMap`, `branchMap`, and sometimes `inputSourceMap`. Jest's babel plugin, nyc, Vitest's istanbul provider, vite-plugin-istanbul, and Angular's builder all produce that object, and DeepTest's hooks snapshot and diff it around every test. That worked for four runners. It stopped working the day the survey met an ES-module Mocha project: nyc instruments through the CommonJS require hook and never sees an `import`, so the run is green and every line of every file reports zero hits. A falsely red report is the same failure as the falsely clean one the survey found for Vue, and the toolkit exists to prevent both.

The fix that does not cut a corner is for DeepTest to own the instrumentation. Witness owns three layers V8 lets a program own: every source before the engine sees it (the module loader), the counters the source reports to (the runtime), and, later, the engine's own execution counts through `node:inspector` and the DevTools protocol for code that cannot be transformed. This document covers the first two, which ship in 1.0.6.

## 2. The rule it serves

The counters, the per-test attribution, and the executable-line universe of every file come from one instrumenter. A file a test loaded and a file no test loaded are measured by the same rules, so the universe and the hits agree by construction. Where a project's own tooling instruments for us (Jest, Vitest, the Angular builder), that tooling stays in charge and Witness stays out; where nothing does, Witness does all of it.

## 3. The instrumenter (`src/witness/instrument.ts`)

Textual, on tree-sitter. The source is parsed with the same grammars DeepTest uses for routes and depth, and counters are inserted into the text on the same line as the thing they count. Nothing is regenerated, so every line number in the instrumented file is the line number in the editor, and there is no source map to be wrong. Because one tree decides both what the analysis calls a decision and where a counter goes, the two cannot drift.

The counters, on the per-file object `W` the runtime hands out:

| Call | Meaning |
|---|---|
| `W.s(id)` | a statement ran |
| `W.v(id, name, expr)` | a statement whose worth is an expression (a declarator or class-field initialiser); returns the value and gives an anonymous function the name it would have had, which a plain sequence expression takes away (Istanbul loses it) |
| `W.f(id)` | a function was entered |
| `W.b(id, cond)` | a two-way decision (if, ternary); records which way it went, returns the condition |
| `W.l(id, i, expr)` | the i-th operand of a boolean run, or a default parameter, was evaluated; returns it |
| `W.c(id, i)` | the i-th case of a switch was entered |

The node choices are Istanbul's, so the maps are Istanbul's shape and every reporter and every existing DeepTest reader consumes them unchanged: statements are expression, return, throw, break, continue, debugger, try, if, the loops, switch, with, and labeled statements, plus the initialiser of every declarator and class field; functions are declarations, expressions, arrows, methods, and generators; branches are `if` (two locations), the ternary, one branch per whole run of logical operators whatever the operators and parentheses (`a || (b && c)` is one three-way branch, as Istanbul reads it), one per switch with a location per case, one per default parameter, and one per logical assignment.

Four shapes need care, and each has a test. A bare statement body (`if (x) return;`, `for (...) f();`) is wrapped in braces so the counter sits inside it. An `else if` keeps its `else`: a counter in front of it would split the two (`else W.s(2); if (...)` is a different program), so its statement counter rides inside the condition, `else if ((W.s(2), W.b(3, b)))`. A loop under a label carries no counter of its own, because the label must sit directly on its loop for `continue label` to parse; the labeled statement's counter is on the same line. A directive (`'use strict'`) is not a statement to Istanbul or to the engine, and a counter in front of it would demote it to a plain string, so it is left alone and the file's prologue (`const W = globalThis.__witness__.file("<id>")`) is inserted after the directives, or after a shebang.

TypeScript's non-null assertion needs a second parse. tree-sitter-typescript, at its current release (0.23.2, byte-identical to npm's), reads `a && b!.c` as `(a && b)!.c` (issue 299, open). Counting operands on that tree would record the wrong outcome. Since `!` means nothing at run time, the first pass finds every non-null assertion and blanks it to a space, and the second pass parses the same program with the right tree. The same mis-parse touches the structure analysis and the MBCC operand rule in both tools and the library; that fix is listed in the engineering notes as work of its own.

Anything the instrumenter decides not to count goes into `maps.skipped` with the line and the reason, and the driver logs it. Nothing is ever silently skipped.

## 4. The runtime (`hooks/witness.cjs`)

One global, `globalThis.__witness__`, plain CommonJS with no dependencies, copied into the project's `.deeptest/hooks/` and loaded by the project's Node. It keeps the counters in Istanbul's shape at `globalThis.__coverage__` for anything that expects them there, and it records what Istanbul cannot: for every statement, decision outcome, and function entry, the id of the test that was running. The hooks tell it which test that is (`begin(id)` / `end()`), and at `end` it writes one JSON line for the test, `{ test, files: { path: [lines] }, outcomes: { path: { branchId: [indices] } }, entered: { path: [functionIds] } }`, into the attribution folder. The `files` part is the same shape every other DeepTest hook writes, so the driver reads all of them with one reader; `outcomes` and `entered` are the new facts, for the route confirmation in DeepTest and the behavioural fingerprint gate in UntangleIt to come.

At process exit the whole-run counters are written as `coverage-final.json`. A file instrumented by a loader this process never ran gets a runtime object that counts nothing and breaks nothing.

## 5. The loader (`hooks/witness-loader.mjs`)

`node --import <loader>` before any runner (the driver sets it through `NODE_OPTIONS`, so a runner's worker processes carry it too). It registers a `load` hook with `module.registerHooks`, which is synchronous, in-thread, and applies to `require()` as well as `import`; it was added in Node 22.15.0 and 23.5.0 and is a release candidate as of 24.13.1 and 25.4.0 (Node.js, "Modules: node:module API", https://nodejs.org/api/module.html). The older `module.register` was tried first in the survey and rejected: it does not affect all `require()` calls, and it is deprecated at run time in Node 26 (DEP0205, same page). So the floor is Node 22.15, the environment check says so in one sentence, and there is no fallback for an older Node.

Every source under the source root is instrumented as it loads, ES module or CommonJS alike (a `require()`d CommonJS file arrives in the hook with no `format` at all on Node 22; the loader treats that as a script). Test files, `node_modules`, `.deeptest`, and `.untangleit` are left alone. The instrumenter runs in the project's process, where DeepTest's `node_modules` does not exist, so it is bundled whole by esbuild, web-tree-sitter included, into `dist/hooks/witness-instrument.cjs`; the grammars stay in `dist/` and the loader reads them from `DEEPTEST_WASM_DIR`.

A project whose own TypeScript loader is registered before Witness (tsx, ts-node) hands Witness the transpiled JavaScript, since the last-registered hook runs first and calls the next; line numbers then depend on that transpiler keeping them, which esbuild-based ones do. Node's native type stripping keeps every position, and it is the path the tests use.

## 5b. The Vite plugin and the Playwright fixture (`hooks/witness-vite.mjs`, `hooks/witness-playwright.template.ts`)

A runner that builds the code under test with Vite and runs it in a browser page (Playwright component tests) gets Witness through a Vite plugin the wrapper config adds: every source under the source root is instrumented as Vite transforms it, with its maps embedded in the file's prologue (a page cannot be told about a file any other way), and the runtime is injected into the page's HTML ahead of every module. The same `witness.cjs` runs in the page: it detects that it is not in Node and returns records instead of writing them. Nothing is installed in the project; the plugin, the runtime, and the instrumenter come from `.deeptest/hooks`. The wrapper config re-roots the project's relative paths (`testDir`, `outputDir`, `ctTemplateDir`) against the project, since it lives in `.deeptest/`, and gives the component build its own cache folder, emptied before every run, because Playwright reuses a built bundle when its sources and dependencies are unchanged, config and plugins included, and a bundle built without the plugin would report nothing.

The test boundary is the one thing Playwright only gives from inside a test's worker, through a fixture a test file imports; there is no config-level way to register one ([Playwright, "Fixtures"](https://playwright.dev/docs/test-fixtures)). So DeepTest writes `.deeptest/witness-playwright.ts`, a `test` extended with one automatic fixture, and the project imports `test` and `expect` from it instead of from the Playwright package. That is the one line a project adds, and DeepTest never edits a test itself; the setup screen says which files still lack it and gives the exact import to use. Each test runs in its own page, so the page's counters at the end of the test are that test's attribution; the fixture carries them out with `snapshot()`, resets the page in case a project shares one, and writes one record per test. The driver turns the records into per-test lines, outcomes, and entries, and sums them into the whole-run report.

Only what the page runs is counted. Playwright's own loader transforms whatever a test imports in the worker and short-circuits every other loader, so a function a test calls in Node rather than in the page is not measured; the setup screen and the port's README say so, and the HelloWorlds port tests every function through a component for that reason.

The engine counters were surveyed for this runner and work: a reporter attached over the DevTools protocol to the browser Playwright launched (`--remote-debugging-port` through `launchOptions`) reads `Profiler.takePreciseCoverage` per page with call counts and block detail, with nothing in the project at all. They do not ship in 1.0.7 for attribution because Playwright does not await a reporter's `onTestBegin` and `onTestEnd`, so the boundary they see is late by up to a test, and a number that is right most of the time is the wrong kind of number for density. They remain the path for whole-run coverage without cooperation and for the second, independent count.

## 6. What proves it

`test/witness.test.ts`, all under `npm test`:

- The rewrite is a valid program (`node --check`), keeps the line count, and puts the counters where the rules above say.
- Every statement shape named in section 3, in one source, checked by pattern.
- The non-null blanking, on a two-line function with two assertions.
- The differential test: for every source under `test/fixtures/` (all eight HelloWorlds ports and the older fixtures), all of `src/`, and `hooks/`, istanbul-lib-instrument and Witness must produce the same statement lines, the same function lines, and the same branch types and lines, with nothing skipped. One disagreement fails the test and prints it.
- The loader, end to end in a child Node: an ES module, a CommonJS module, a TypeScript villain, and a file nobody loads, with the per-test lines, outcomes, and entries asserted; and the instrumented villain compared with an untouched copy of itself on 384 inputs, which must all agree, so the rewrite is proven not to change the program it measures.
- The universe of files no test loads, from the same instrumenter.
- The Vite plugin, driven directly: a component under the root comes back instrumented with its maps embedded and its lines intact, a spec and a file outside the root come back untouched, and the HTML hook injects the runtime verbatim.
- Playwright: detection on the HelloWorlds port, the fixture written for another framework's package, the count of spec files that import it with the exact relative import for one that does not, the wrapper config's re-rooting and cache folder, the summary parser, and two tests' page records merged into per-test attribution and a summed whole-run report.

In the harness the same instrumenter was also run against the whole source of UntangleIt and the complexity library (128 files identical with Istanbul), and the per-test attribution on the Mocha ports was compared with nyc's, line for line on all ten tests.

## 7. Where it lives, and the rule between the tools

Witness is born in DeepTest so it can be proven on the ports before anything depends on it. When UntangleIt needs it (the behavioural fingerprint gate, the runtime call graph), it moves to its own library, `@projectrevivesolutions/witness`, at `C:\workspace\Witness`, the fifth tree in `release.ps1` (`complexity`, `Witness`, `UntangleIt`, `DeepTest`, `MADTPackage`). It is not part of `complexity`: that is a pure measurement library with no file system and no process, and it stays that way.

There are no runtime dependencies between DeepTest and UntangleIt, because they are not always both installed. Witness is bundled into each extension at build time, the way the complexity library is, and each extension copies its own hooks into its own folder in the project (`.deeptest/hooks/`, `.untangleit/hooks/`). Nothing is ever resolved from the other extension.

## 8. Not yet

- Code a Playwright test runs in Node rather than in the page. Playwright's loader owns the worker; the seam for it is a transform Playwright would have to expose, or the engine counters through `node:inspector` in the worker, which is the same second layer as below.
- Jest, Vitest, and the Angular builder keep their own instrumenters in 1.0.6 and 1.0.7. Moving them onto Witness is the work that turns six drivers into one attribution core with three adapters each (an instrumenter, a transport, a boundary), and it comes after Witness has been on the Marketplace under Mocha.
- The engine counters (`Profiler.startPreciseCoverage` / `takePreciseCoverage` through `node:inspector` and the DevTools protocol) are the path for code Witness cannot transform: bundles a builder already produced, browser pages, Playwright component tests. They also give a second, independent count of the same run to check the first against.
- `outcomes` and `entered` are recorded and not yet read. DeepTest's route confirmation and UntangleIt's fingerprint gate are the readers.

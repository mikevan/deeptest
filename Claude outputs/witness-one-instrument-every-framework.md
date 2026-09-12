# One instrument, every framework: how DeepTest reads your tests line by line

Michael Van Geertruy, Project Revive Solutions, LLC. 2026-09-12.

Most testing tools answer one question: how much of the code did the tests run? DeepTest answers a harder one, for every line: which tests reached this line, and is that enough tests for the number of ways through the function it sits in? That is test density, and it comes with the route, in plain words, that a test would have to take to reach a line nobody has reached. "lang is 'en', hour is under 12, formal is true, mood is 'bad'." A person who has never read the code can follow that.

To say it for every line, DeepTest has to know where each test went. That is the part nobody else does across the board, and the part we had to build ourselves.

## The problem

Every JavaScript framework we serve runs on the same engine, but each one hides its counters somewhere different. Jest keeps them in the test process. Vitest keeps them in a worker. Angular's builder bundles the code first and the counters end up keyed to files that do not exist on disk. Karma keeps them in a browser and never tells the server which test is running. Mocha in ES modules cannot be measured by its usual coverage tool at all, which runs green and reports zero on every line. And Playwright component tests keep the counters in a browser page that the test runner in Node never sees.

Coverage tools handle this by stopping at the whole run. A percentage does not care which test did the work. Density does.

## What we built

Witness is DeepTest's own instrumentation. It is one instrument, and it goes wherever the code runs.

First, the thing that matters most: Witness never touches a file in your project. It does not write to a source file, a test, or a config, and it does not save an instrumented copy anywhere. Here is exactly what it does. When a test runner reads a source file, Node reads the text of that file into memory and hands it to the engine to run. Witness sits in that gap. It takes the text Node just read, adds its counters to the text in memory, and gives that text to the engine instead. The engine runs the version with the counters. The file on disk is never opened for writing, and the counted version exists only in memory for as long as the test run lasts. When the run ends, it is gone. Your project is byte for byte what it was before the check.

Under Node that gap is the module loader, and Witness registers with it once, when the runner starts. ES modules and CommonJS go through the same hook, and the counters land on the same lines the code was on, so there is no source map and nothing to translate. No coverage package goes into the project. For Mocha that means a modern ES-module project gets measured for the first time.

In a browser page there is no loader, so Witness uses the same gap in the build instead. For Playwright component tests, Playwright bundles the components before it opens the browser, and DeepTest adds a step to that bundling, in memory again, that adds the counters as each file passes through. The bundle Playwright makes already lives in a cache folder of Playwright's own, not in your source tree, and DeepTest points it at a cache of its own under `.deeptest` so it never mixes with yours. DeepTest also puts its runtime into the page ahead of every module. Each test runs in its own page, so the counters at the end of the test belong to that test alone. DeepTest reads them out, resets the page, and records not just the lines but which way every decision went and which functions the test entered. The test itself never knows. The worker that runs a Playwright test is a Node process, and Witness is in its loader too, so the spec's ordinary import of Playwright's `test` hands back a `test` that reports to Witness. The developer changes nothing: not a spec, not the config, not a dependency.

For Angular the builder already does its own instrumenting when you ask it for coverage, and Witness does the reading: through the builder's own bundle for Vitest, mapping every counter back to the source file it came from, and through a reporter inside the browser for Karma that tells the server which test is running.

The only files DeepTest writes are its own, and they all go in one place: a `.deeptest` folder at the root of your project. That folder holds the counters from the last check, the record of which test reached which line, the hook files DeepTest loads into the runner, and, for Playwright, a small config that wraps yours without changing it. Everything in it is rebuilt on every check, and you can delete the folder at any time without losing anything but the last report. The one file in it meant to be kept is `decisions.json`, where DeepTest records the choices you made on its setup screen.

And every counter, whatever the runner, is checked against the same standard. The maps Witness produces agree with Istanbul's, line for line, on every fixture project we ship and on DeepTest's own source, and a test fails the build if one line disagrees. When we find the engine's counts and ours side by side, they had better match, and they do.

## Where DeepTest is the only one

For Playwright component tests, React, Vue, Svelte, and Solid alike, DeepTest is the only tool I know of that attributes lines to tests at all. Coverage tools can tell you the page ran your code. DeepTest tells you which test ran which line, which way each branch went under that test, and whether the function has more ways through it than tests reaching it. Nothing gets installed in the project and nothing in the project changes. You press one button.

For every framework we serve, Jest, Vitest, Mocha, React, Vue, Svelte, Angular with Vitest or Karma, Playwright component tests, and Python with pytest, DeepTest is the only tool I know of that reports density: tests per line against ways through, with the route to every untested line written out for a person to read. Other tools show you which tests touched a line. DeepTest tells you whether that is enough, and what to write next.

## Why it is built this way

We innovate when there is a problem, not when there is a trend. A Mocha project that reports zero on every line is a problem. A Playwright project that can only get a percentage is a problem. We do not confine ourselves to what a framework hands out; when the framework's own tools stop, we go under them and own the instrumentation. Playwright's documented way to run code inside a test is a fixture the spec imports, which would have meant asking every developer to change a line in every spec. We did not accept that either. The loader that already serves Mocha serves Playwright's workers, and the line never has to change.

And we do not ship a number we cannot stand behind. Playwright offered a shortcut that read the engine's counters from a reporter with nothing in the worker at all, and we rejected it for attribution because the runner does not wait for a reporter between tests, so the count could be a test late. A figure that is right most of the time is the wrong kind of figure to put next to a density score.

One instrument, one standard, every framework, and the same report in plain words at the end: every line, every test, and what to do about it.

## For engineers

Witness inserts counters textually on the tree-sitter parse tree DeepTest already uses for routes and depth, so the tree that finds a decision is the tree that counts it, and every line number in the instrumented text is the line number in the editor. Under Node it registers with `module.registerHooks`, synchronous and in-thread, which covers `require()` as well as `import` and exists from Node 22.15 (Node.js, "Modules: node:module API", https://nodejs.org/api/module.html). The hook's `load` step receives the source text Node read and returns the instrumented text; nothing is written to disk, and the hook only instruments files under the source root you chose on the setup screen, never `node_modules`. In Playwright it is a Vite plugin (a `transform` step, again text in and text out) in the component build plus an automatic fixture, because fixtures are the one place Playwright runs code inside a test's worker and there is no config-level way to add one (Playwright, "Fixtures", https://playwright.dev/docs/test-fixtures); the fixture reaches the spec through a `resolve` hook in the worker that redirects the component package's import to DeepTest's re-export of it, so no spec is edited. The maps are Istanbul's shape, checked against istanbul-lib-instrument line for line on 155 files in the test suite, and the runtime keeps an Istanbul-shaped view beside its own so every existing reporter still works. The design is in DeepTest's docs/witness.md.

## Sources

- Node.js. "Modules: node:module API." https://nodejs.org/api/module.html. `module.registerHooks`, added in v22.15.0 and v23.5.0; `module.register` deprecated (DEP0205).
- Playwright. "Fixtures." https://playwright.dev/docs/test-fixtures. Fixtures are added with `test.extend()` and imported by test files.
- Playwright. "Browsers." https://playwright.dev/docs/browsers. Browser installation and the per-user cache.
- tree-sitter/tree-sitter-typescript, issue 299, "Non-null assertion operator `!` parsed with wrong precedence." https://github.com/tree-sitter/tree-sitter-typescript/issues/299. The grammar bug Witness works around by blanking non-null assertions before parsing.

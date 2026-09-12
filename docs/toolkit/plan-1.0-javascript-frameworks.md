# 1.0: the JavaScript frameworks. The plan.

Draft 2, 2026-09-12 (draft 1 earlier the same day; draft 2 adds the survey's findings and the revised phase order). The first slot of the Language Expansion series (toolkit-roadmap.md). Publisher: `prs`.

## What 1.0 is, and is not

1.0 makes DeepTest and UntangleIt work on the JavaScript framework projects the users actually have: React, Vue, Svelte, and Angular, under the runners those projects ship with. It is not a new language and not a new plugin. A React, Vue, Svelte, or Angular project is a TypeScript or JavaScript project, so the work lives inside the existing TypeScript / JavaScript plugin in each tool and the shared library. What that plugin does today stays as it is: the Istanbul hook, the Jest and Vitest drivers, the route parser for `.ts`, `.tsx`, `.js`, and `.jsx`, the environment check, the setup screen. What 1.0 adds is what the plugin cannot yet recognise, parse, or run.

Where the plugin stands on 2026-09-12, from the code:

- Runners: Jest and Vitest only (`detectRunner` reads `package.json` and `node_modules`; the run drives `jest.js` with the project's `setupFilesAfterEnv` plus the hook, or `vitest.mjs` through a generated wrapper config that merges the hook in).
- Files it walks and parses: `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, `.cts`. Not `.vue`, not `.svelte`.
- Test files: `*.test.*`, `*.spec.*`, and anything under `__tests__`. Angular's `*.spec.ts` already matches.
- It already skips `.next`, `.nuxt`, and `.svelte-kit`, so someone was thinking about frameworks; nothing else knows a framework exists.
- Detection pre-fills runner and tests folder and writes notes on the setup screen; there is no framework field.

## The four fixtures come first

Nothing in the plugin changes until four fixture projects exist and have been run through the plugin as it is, with the failures written down. The fixtures are the survey, and afterwards they are the tests that pin every fix. Each is HelloWorld's shape: one component fully tested, one thinly tested, one villain nested deep with no tests, ten or so tests total, small enough to commit with its lockfile and no `node_modules`.

| Fixture | Framework and runner | Why this one |
|---|---|---|
| `test/fixtures/react-vitest` | React 18, TypeScript, `.tsx`, Vite, Vitest with `@testing-library/react` | The largest framework, on the runner Vite projects ship with. Expected to mostly work today; it proves the baseline. |
| `test/fixtures/react-jest` | React, JavaScript, `.jsx`, Jest with `babel-jest` | The older React shape (Create React App descendants). Proves `.jsx` and Jest together. |
| `test/fixtures/vue-vitest` | Vue 3, `.vue` single-file components with `<script setup lang="ts">`, Vitest with `@vue/test-utils` | Vue's own recommended stack. Proves SFC parsing. |
| `test/fixtures/svelte-vitest` | Svelte 5, `.svelte` with `<script lang="ts">`, Vitest with `@testing-library/svelte` | Proves the second SFC shape, and Svelte 5 runes in the script block. |
| `test/fixtures/angular-vitest` | Angular 21, `ng test` through the `@angular/build:unit-test` builder (Vitest underneath) | The Angular CLI "uses Vitest as the default unit test runner for new projects" and runs it through its own builder, not the `vitest` binary (Angular, "Migrating from Karma to Vitest", https://angular.dev/guide/testing/migrating-to-vitest). The plugin's Vitest driver will not reach it as it is. |
| `test/fixtures/angular-karma` | Angular, Karma with Jasmine, the stack every existing Angular project has | Karma is still documented and still what installed projects run. No hook exists for it. |

Two more runners are surveyed on the fixtures above rather than getting fixtures of their own, because they are runners, not frameworks: Mocha (with `nyc` or `c8` for coverage) on the React JavaScript fixture, and Playwright component tests on the React Vitest fixture. If the survey shows either is common enough and hard enough, it gets its own fixture then.


## The survey (2026-09-12), in one table

Full detail in DeepTest's docs/engineering-notes.md under "1.0 survey". Every port carries the same villain at 27 / 73 / 97.

| Port | Result as the plugin stands |
|---|---|
| python | Fully served. 10 passed, attribution, villain first. |
| react-jest | Fully served. 11 passed, attribution on 18 lines, villain first. |
| react-vitest | **Fails.** Vite refuses the hook because it lives outside the project root (`server.fs.allow`). Production bug for every Vitest project. Fully served once the hook is copied into the project's .deeptest/. |
| vue-vitest | **Falsely clean.** `.vue` files are neither walked nor instrumented; coverage reads 60.71%, no function over the limit, villain does not exist. |
| svelte-vitest | Same as Vue, for `.svelte`. |
| angular-vitest | **Fails twice.** The plugin drives the vitest binary and bypasses the Angular builder; the coverage-package install is unpinned and fetched a major that does not match the project's Vitest. Through `ng test` with `--setup-files`, `--coverage-include`, and a json reporter it runs and covers every file, but per-test attribution names bundle chunks, not sources: the source-map question is phase 3's first job. |
| angular-karma | **Wrong advice.** "No test runner found. Install Vitest or Jest." on a project that has Karma. |

Revised order: 1.0.1 fixes the two production bugs (hook location, pinned install); 1.0.2 fixes the Karma advice and makes `.vue` and `.svelte` visible (red, never invisible); 1.0.3 parses them; 1.0.4 is the Angular driver through the builder with the source-map answer; 1.0.5 Karma through the same builder; 1.0.6 Mocha through Witness, DeepTest's own instrumentation (docs/witness.md), after the survey found that nyc cannot see an ES-module project at all; 1.0.7 Playwright component tests through the engine counters; 1.0.8 the words and the pages.

## The phases, in order

Each phase ends with a build you can install and a test count that went up. Patch numbers move on every delivery (1.0.1, 1.0.2, ...). The minor number does not move until the last phase.

### Phase 0: survey (1.0.1)

Build the six fixtures. Run each through DeepTest and UntangleIt as they are, from the setup screen through "Check my code" and "Find the tangled methods". Record, per fixture: what detection said, whether the run happened, whether per-test attribution came back, which files were walked and which were missed, what the route parser did with the files it could not read, and every sentence a person saw that was wrong. The record goes in `docs/engineering-notes.md` under "1.0 survey" and is the gap list the rest of the plan is checked against. No plugin change in this phase except what is needed to make a fixture a valid unit test (the fixture must pass under its own runner before it is a fixture).

Verify: six fixtures committed with lockfiles; a table in the engineering notes with one row per fixture and one column per question above.

### Phase 1: the framework is known (1.0.2)

Detection learns the framework from `package.json` (`react`, `vue`, `svelte`, `@angular/core`) and the config files that go with it (`vite.config.*`, `angular.json`, `svelte.config.*`, `nuxt.config.*`, `next.config.*`). The setup screen gets one read-only line in the language block, "Framework: Vue 3 with Vitest.", and the notes say what that means for the run. The framework never changes the words on the verdict; it changes which runner driver and which file walker are used. `.vue` and `.svelte` join the source extensions so they are walked, counted for coverage, and shown red when untested instead of vanishing.

Verify: each fixture's setup screen names its framework and runner correctly with nothing typed; the React fixtures run and score as before; the Vue and Svelte fixtures now list their component files as never tested (they will, because the parser cannot read them yet).

### Phase 2: single-file components are parsed (1.0.3)

`.vue` and `.svelte` files carry their logic in a `<script>` block. The route parser pulls that block out, keeps its line numbers (the block starts on the line it starts on in the file, so every route, depth, and function line still points at the real line in the editor), parses it with the TypeScript or JavaScript grammar depending on `lang`, and hands the rest of the file back as declaration lines that count for coverage but not for density. Vue's `<script setup>` and Svelte 5's runes are plain TypeScript inside the block; the survey says whether anything in them trips the grammar. The same extraction serves the shared library (the three numbers per function) and UntangleIt (the same parser files), so a `.vue` method can be ranked and untangled like any other.

The template half of an SFC is not parsed in 1.0. Its `v-if` and `{#if}` are decisions a person has to understand, and they belong in a later slot once the script half is right; the engineering notes say so, so nobody mistakes the omission for an oversight.

Verify: on the Vue and Svelte fixtures, the villain component's methods appear in "Hardest to test" and in UntangleIt's list with the right three numbers, routes point at the right lines, and the fully tested component scores green.

### Phase 3: the runners the frameworks ship with (1.0.4 to 1.0.6)

One driver per delivery, each the same shape as the Jest and Vitest drivers: find the runner in the project, run it once with the hook loaded without touching the project's config, read per-test attribution back, read the executable-line universe from the runner's own coverage report.

- 1.0.4, Angular with Vitest through the builder. The run is `ng test` with coverage on ("code coverage is a first-class feature in the Angular CLI and can be enabled with `ng test --coverage`", same source), and the hook has to reach Vitest through the builder's configuration rather than a wrapper config. The survey says exactly where the builder lets a setup file in; if it does not, the fallback is the builder's coverage report for the line universe and a per-file attribution the report says is coarser than the others, in plain words.
- 1.0.5, Karma with Jasmine. Istanbul instrumentation comes from `karma-coverage`; per-test attribution needs a Jasmine reporter that snapshots the counters around every spec, the same trick the Jest hook uses, loaded through a generated Karma config that `require`s the project's own. This is the one runner where the hook is written from scratch.
- 1.0.6, Mocha (with `nyc`) and Playwright component tests, if the survey found them worth it. Mocha's root hook plugin is the natural place for the snapshot. Playwright component tests run in a real browser and Istanbul counters live in the page; whether they can be read per test is the open question, and 1.0 either answers it or says in the engineering notes why it is deferred.

Verify: each fixture reports the same shape of result as the Python fixture does: N tests passed, per-test attribution on every executed line, the villain at the top, and the same sentences.

### Phase 4: UntangleIt and the library keep pace (with each phase, not after)

Every parser change in DeepTest is copied to UntangleIt in the same delivery (same files, per the architecture document), and the library's measures are checked on the SFC script blocks with the fixtures' villains as the worked cases. `untangleit.api.measure` on a `.vue` file returns the same three numbers DeepTest shows.

Verify: `pick_greeting()`'s Vue and Svelte cousins top UntangleIt's list on their fixtures, and "Break it into smaller pieces" from DeepTest lands in UntangleIt's gates.

### Phase 5: the words and the pages (1.0.7)

README Languages tables in all three repos, the setup screen hints, the engineering notes, and the roadmap's 0.x row gain the frameworks and runners now covered. The Requirements section says what each framework project needs installed (Vitest needs `@vitest/coverage-istanbul`, Karma needs `karma-coverage`, and so on) and that DeepTest offers each install.

Verify: a person with any of the six fixture shapes can install the pack, open their project, and press "Check my code" with nothing typed. That sentence is the definition of 1.0 done, and it is what the friends' review round tests.

## What is uncertain, said now rather than found later

- Playwright component tests: per-test counters in a browser page are unverified. 1.0 may ship with Playwright detected and explained rather than driven. Answered in 1.0.7: Witness instruments the component build through a Vite plugin and reads the page per test through a fixture the project imports (Playwright's only in-worker seam); the engine counters over the DevTools protocol were verified too and are the path for whole-run coverage without cooperation.
- Angular's builder: whether a setup file can be injected is the survey's job; if not, attribution on Angular Vitest projects is per file until the builder allows more, and the report says so. Answered in 1.0.4: `--setup-files` takes the hook, the hook maps the builder's chunks back to sources through their source maps, and `--isolate` is required for the hook to see every spec file. Attribution is per test, the same as everywhere else.
- Karma: the hook is new code and the Angular Karma fixture is the only proof. Existing Angular projects are the population that needs it most, so it is worth the work, but it is the riskiest driver. Shipped in 1.0.5: a Jasmine reporter in the browser and a Karma reporter in the server, loaded through a generated Karma config; files no test loads get their line universe from the project's own istanbul-lib-instrument. The older @angular-devkit/build-angular:karma builder is refused with the reason.
- SFC templates: not parsed in 1.0. Decisions in templates are invisible to density until a later slot.
- Svelte 5 runes and Vue `<script setup>` macros (`defineProps`, `$state`) are compiler-time constructs that look like calls. The library's ordered-operand rule treats calls as impure, so a guard like `props.user && props.user.name` scores the same as anywhere else, but a run containing `$derived(...)` will be charged as ordered. The survey records whether that distorts any fixture number; if it does, the library gains a per-language list of pure macros.

## Sources

- Angular. "Migrating from Karma to Vitest." *angular.dev*, https://angular.dev/guide/testing/migrating-to-vitest. Fetched 2026-09-12. The default runner for new projects, the `@angular/build:unit-test` builder, and `ng test --coverage`.
- GitHub. "Octoverse: A new developer joins GitHub every second as AI leads TypeScript to #1." 2025, https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/. The user base that puts this slot first.

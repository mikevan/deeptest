# DeepTest: build status and run instructions

Updated 2026-09-11 (late). Companion to vscode-density-extension-spec.md.
Source tree and VSIX live at C:\workspace\DeepTest on Michael's machine. The
authoritative copy of this file is docs/build-status.md in that tree.
Committed on main: cc9d908 "Cognitive complexity beside cyclomatic" (0.3.7),
33fb006 "Pytest addopts no longer break the run" (0.3.8), then the
2026-09-11 Marketplace commits (icon, README, packaging rules) at 0.4.x.

## 2026-09-11 (late): the hand-off to UntangleIt is built (0.4.3)

- src/untangleit.ts (id, command, installed check, link) beside
  src/keepsafe.ts. In fixFunction, the refactor choice routes to
  `untangleit.method` with `{ path, startLine }` when UntangleIt is
  installed and stops; no decision is recorded (UntangleIt's gates are
  where the person says yes). Not installed: the old brief and gates, and
  a recommendation on the setup screen under "When a function is too
  tangled". Routing rule and sentences in src/ui/words.ts, pinned by two
  new unit tests (180 total; the 27 cognitive complexity tests moved to the complexity library in 1fb82e5).
- UntangleIt 0.1.9 measures the file on demand in `untangle()` so the
  call from DeepTest works on a fresh editor; before, it refused with
  "Press Find the tangled methods first".
- Verify on HelloWorld: DeepTest, "Fix this" on pick_greeting(), "Break
  it into smaller pieces"; UntangleIt's KeepSafe offer and modal appear,
  not DeepTest's; the DeepTest message reads "pick_greeting() is with
  UntangleIt."

## 2026-09-11: Marketplace packaging, logos, demo project, sibling rename

- Version is 0.4.x. Flat logo (checklist with a green check, black ground,
  KeepSafe's orange and green) in media/, named by the `icon` field. Both
  the Extensions list and the details page draw that one PNG.
- `.vscodeignore` gained `.keepsafe/**`, `.UntangleIt/**`, `_to_delete/**`,
  `Claude outputs/**`, `*.zip`, `media/**` with the icon and `media/*.svg`
  re-included. Before that the VSIX carried the workspace's checkpoints and
  an old zip.
- Packaging MUST use `--no-dependencies`. `@projectrevivesolutions/complexity`
  is installed as `file:../complexity`; npm links it, and the packager
  follows the link out of the project and fails with "invalid relative
  path: extension/../complexity/...". The library is bundled into
  dist/extension.js by esbuild (no `require("@projectrevivesolutions/complexity")`
  survives in dist), so skipping the dependency walk ships a complete
  extension. `node_modules/**` in `.vscodeignore` does not prevent the walk;
  only the flag does.
- README images are not read from the VSIX. The packager rewrites relative
  links to raw.githubusercontent.com using the `repository` field, so an
  image shows on the details page only once it is pushed. Untracked files
  in media/ render in VS Code's Markdown preview and nowhere else.
- Demo project for GIFs: C:\workspace\HelloWorld (Python, pytest, 10
  tests). greet.py fully tested, names.py thinly tested, schedule.py holds
  pick_greeting(), nested five deep with no tests, built to sit at the top
  of the report. The GIF goes in C:\workspace\MADTPackage\media\ and
  DeepTest's README links it by its raw GitHub URL.
- The pack: C:\workspace\MADTPackage, repo mikevan/MADTPackage, id
  prs.MADTPackage, an extension pack listing KeepSafe.keepsafe,
  prs.deeptest, and the untangling tool. Installs as a fourth extension.
- Sibling named UntangleIt (`prs.untangleit`, `untangleit.method`,
  `.untangleit/`) on 2026-09-11 after the Marketplace refused its first
  display name as too similar to "refactorix". DeepTest's source never
  named the sibling (the integration is still next), so only README,
  docs, and workspace settings changed; the sibling file, when written,
  is src/untangleit.ts. The `extensionPack` list in MADTPackage must list
  `prs.untangleit`.
- Marketplace status: DeepTest VSIX built and ready to upload through the
  publisher management page (no token needed); the fresh-install test of
  the pack waits until DeepTest and UntangleIt are both live.

## What exists (v0.3.8 core, unchanged in 0.4.x)

- One language contract (src/languages/types.ts) and a registry. Nothing
  above the contract names a language.
- Plugins: Python (coverage.py contexts + tree-sitter) and TypeScript /
  JavaScript (Jest or Vitest with an Istanbul snapshot hook + tree-sitter
  typescript/tsx/javascript). Each plugin uses the project's own runtime.
- Routes: every decision on the way to every line, with where the tests
  stop. Depth equals route length by construction.
- Three numbers per function (0.3.7): ways through (cyclomatic, still the
  only number that drives the verdict), tangle by Campbell's published
  cognitive complexity rule, and tangle by Michael's ordered-operand rule
  (a boolean run costs one per operand when order carries meaning). Shown
  on the "Hardest to test" row, on every over-limit function, and in a
  "Ways through against tangle" table of the 30 functions with the most
  ways through in the full report and its Markdown export. Arithmetic in
  src/languages/shared/cognitive.ts; per-language walkers in
  src/languages/{python,typescript}/cognitive.ts; rules and the readings
  chosen (nesting includes callbacks, comprehensions cost nothing,
  recursion by name within a file) in docs/engineering-notes.md.
- Pytest runs honour the project's own addopts minus its pytest-cov
  options (0.3.8), passed back with `-o addopts=...`; a pytest that fails
  before collecting is reported as a failed run with pytest's words, never
  as "0 passed" beside numbers. Cause and fix in docs/engineering-notes.md
  ("The run that never happened").
- Report: verdict against thresholds, worst shortfalls in full, accepted
  lines, unreachable code, over-complex functions, comparison table.
- Decisions: Fix this, Accept with reason, Leave.
- 205 unit tests under Vitest (27 for cognitive complexity against the
  whitepaper's worked cases; 5 for addopts and pytest failures, two of
  them end to end against real pytest); 2 integration suites.

## First real run: Regalia, 2026-09-09

Regalia (CommunityServiceAccounting, C:\workspace\NonProfitAccounting\
kofc-accounting-system) needs Docker Desktop running: its conftest starts
PostgreSQL 15 through Testcontainers. Baseline with 0.3.8 and Docker up:
379 passed, 0 failed; coverage 44.75%; 31.92% of lines have enough tests;
average density 2.84; 4661 shortfalls; 36 functions over 10 ways through.

Comparison table reading (Michael's rules from the UntangleIt spec):
of the 36 cyclomatic offenders, about 16 are flat loaders and switches
(ways through high, tangle 1 to 9: leave them), about 12 are nested
(tangle above ways through, e.g. cash_flow_statement 25 / 50, _call_groq
26 / 39, import_members 20 / 39: flatten), and 4 are guard-chain
functions only the ordered-operand rule catches (verify_runtime_security
15 / 9 / 17, parse_arguments 11 / 10 / 15, income_statement 14 / 13 / 17,
build_balance_sheet_pdf 11 / 16 / 20: name the condition, do not extract).
Claude's read: tangle by the ordered rule should drive the refactor list,
cyclomatic stays the test bar. Michael has not decided.

### The _segment_attempt() refactor: verified, NOT committed (demo pending)

Refactored by the generic assistant from DeepTest's brief on a run where no
test ran (the addopts bug). Split into eight helpers, every piece within
the limit of 10. Its own test file broke the harness (defined a bare Flask
`app` fixture that shadowed the session one, so the autouse db_session
fixtures failed); moved to _to_delete/ with a copy of the pre-refactor
source. Replaced by tests/unit/test_translation_service_segment_attempt.py:
23 characterization tests using the harness app, model faked at _call_groq,
time faked at _budget_left, everything else real. 23 pass under the harness.
The 16 that enter through _segment_attempt() pass on both pre- and
post-refactor code, which is the evidence the split preserved behaviour.
Michael is not committing anything in Regalia until after a demo; the
commit is two files (services/translation_service.py and the new test file)
and the message was drafted in the 2026-09-09 session. Working tree also
holds his own uncommitted chart-of-accounts work and
tests/unit/test_functional_categories.py (his).

## Open decision

Which number drives "Hardest to test" and the over-limit list: cyclomatic
(current), cognitive, or two lists with two limits; and whether the
ordered-operand rule is the default or a setting.

## Run it (PowerShell)

```powershell
cd C:\workspace\DeepTest
npm install
npm test                                        # 180 tests
npm run build
npm version patch --no-git-tag-version          # every build gets a new number
Remove-Item *.vsix -ErrorAction SilentlyContinue
npx @vscode/vsce package --no-dependencies
code --install-extension (Get-ChildItem *.vsix).FullName --force
```

Publisher is `prs` (prs.deeptest). The old vangeertruy.deeptest install
was removed on 2026-09-09; a second copy under the old id hijacks the
panel, so check `code --list-extensions --show-versions` if the title
shows two versions.

## Next

1. Michael decides the verdict driver.
2. After the demo: commit the _segment_attempt() refactor with its tests.
3. cash_flow_statement() (25 ways through, tangle 50) is the first real
   untangling candidate, with tests running from the start this time.
4. Candidate: refuse to score a run with 0 passed and errors > 0 (0.3.8
   scored "0 passed, 5 could not run" with a 16% coverage figure).
5. Baseline comparison card; Java, C#, C++ plugins; pytest-cov
   parametrized ids.

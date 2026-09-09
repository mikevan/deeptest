# DeepTest: build status and run instructions

Updated 2026-09-09. Companion to vscode-density-extension-spec.md.

## What exists (v0.4.0)

- One language contract (src/languages/types.ts) and a registry. Nothing
  above the contract names a language. Proven by grep and by the integration
  suite running a Python workspace and a JavaScript workspace through the
  same screens.
- Plugins: Python (coverage.py contexts + tree-sitter) and TypeScript /
  JavaScript (Jest or Vitest with an Istanbul snapshot hook + tree-sitter
  typescript/tsx/javascript). Both verified end to end on fixtures and in
  VSCodium 1.109.
- Routes: every decision on the way to every line, with where the tests
  stop. Depth equals route length by construction.
- Report: verdict against thresholds, the 5 worst shortfalls in full (gap
  ranking, then deeper bar), the rest one line each, accepted lines with
  reasons, unreachable code, over-complex functions. Webview with buttons
  and Markdown export.
- Decisions: Fix this (brief to editor chat + clipboard), Accept with reason
  (.deeptest/decisions.json, pinned to the line's text), Leave. The tool
  never acts on a shortfall by itself and never accepts a fix.
- Three numbers per function: ways through (cyclomatic, drives the
  verdict), tangle by the published cognitive complexity rule, and tangle
  by MikeVan's Better Cognitive Complexity (MBCC), the ordered-operand rule. Shown beside each other on the "Hardest to
  test" row, on every over-limit function, and in the report's "Ways
  through against tangle" table. See the engineering notes.
- 178 unit tests under Vitest here (the 27 complexity tests moved to the package); 2 integration suites; the extension measures
  itself.

## Run it (PowerShell)

```powershell
cd C:\workspace\complexity
npm install                                     # builds the shared scorer
cd C:\workspace\DeepTest
npm install
npm test                                        # 178 tests
npm run build                                   # dist/extension.js, wasm grammars, runner hooks
npx @vscode/vsce package --no-dependencies      # deeptest-0.4.0.vsix
```

Then, in VS Code: Extensions view (Ctrl+Shift+X), the "..." button at the
top right, "Install from VSIX...", pick the file, "Install", then "Restart
Extensions" in the notification. The DeepTest icon is in the activity bar.
Repeat after every source change.

- pytest runs honour the project's own `addopts` minus its pytest-cov
  options (0.3.8), and a pytest that fails before collecting is reported
  as a failed run with pytest's words, never as "0 passed" with numbers.

## Known problem

On Windows, DeepTest checking its own source tree ends with Vitest
reporting "Unhandled Error — Unknown Error: undefined" after every test
has passed, and no coverage is written. Two Windows-only path differences
were removed in this build (see the engineering notes); whether that was
the cause is unconfirmed until the check is run again on that machine.

## Next

1. Run on real projects of his (Python and TS) and compare the numbers to gut.
2. Java (JaCoCo), C# (per-test runs or dotnet-coverage sessions), C++ (gcov,
   the LayerTime prototype), then PHP or Go.
3. pytest-cov context support for parametrized ids.
4. LICENSE file.

# HelloWorld, React on Playwright component tests

The React port of HelloWorld tested the Playwright way: every test mounts a component in a real browser page, and the page is what DeepTest measures. Witness instruments the component build through a Vite plugin the check adds, injects its runtime into the page, and reads the counters back per test. No coverage package is installed.

| File | Tests | What it is for |
|---|---|---|
| `src/greet.ts` through `Greeting.tsx` | Full (`Greeting.spec.tsx`, 8 tests) | Three small functions, every branch reached through the component. Green. |
| `src/names.ts` through `NameTag.tsx` | Thin (`NameTag.spec.tsx`, 2 tests) | One happy path each; `nickname()` has no test. Yellow and red. |
| `src/schedule.ts` through `Schedule.tsx` | None | `pickGreeting()`, nested five levels deep with no tests. The villain. |

The one line this port adds for DeepTest: each spec imports `test` and `expect` from `.deeptest/witness-playwright.ts` instead of `@playwright/experimental-ct-react`. Playwright runs code inside a test only through a fixture the test imports, and that file is the fixture; DeepTest writes it and never edits a test. Commit it with the tests. Only what the page runs is counted: a function a test called in Node would not be.

## Run it

```powershell
npm install
npx playwright install chromium
npm test
```

Expected: 10 passed. Then open this folder in VS Code and press "Check my code" in DeepTest.

# HelloWorld, React on Playwright component tests

The React port of HelloWorld tested the Playwright way: every test mounts a component in a real browser page, and the page is what DeepTest measures. Witness instruments the component build through a Vite plugin the check adds, injects its runtime into the page, and reads the counters back per test. No coverage package is installed.

| File | Tests | What it is for |
|---|---|---|
| `src/greet.ts` through `Greeting.tsx` | Full (`Greeting.spec.tsx`, 8 tests) | Three small functions, every branch reached through the component. Green. |
| `src/names.ts` through `NameTag.tsx` | Thin (`NameTag.spec.tsx`, 2 tests) | One happy path each; `nickname()` has no test. Yellow and red. |
| `src/schedule.ts` through `Schedule.tsx` | None | `pickGreeting()`, nested five levels deep with no tests. The villain. |

This port adds nothing for DeepTest. The specs import `test` and `expect` from `@playwright/experimental-ct-react` like any Playwright project, and there is no DeepTest file to commit. Playwright runs code inside a test only through a fixture the test imports, so DeepTest writes its fixture under its own `.deeptest/hooks/` folder on every check and a hook in Playwright's workers answers each spec's import of the package with that file. Nothing in the project is written or changed. Only what the page runs is counted: a function a test called in Node would not be.

## Run it

```powershell
npm install
npx playwright install chromium
npm test
```

Expected: 10 passed. Then open this folder in VS Code and press "Check my code" in DeepTest.

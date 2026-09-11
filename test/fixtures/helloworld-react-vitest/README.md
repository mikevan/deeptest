# HelloWorld, React on Vitest

The React port of HelloWorld: TypeScript, Vite, Vitest with Testing Library. Same functions, same tests, same villain as the Python original.

| File | Tests | What it is for |
|---|---|---|
| `src/greet.ts` | Full (`greet.test.ts`) | Three small functions, every branch tested. Green. |
| `src/names.ts` | Thin (`names.test.ts`) | Three functions, two tests, one happy path each. `nickname()` has no test. Yellow and red. |
| `src/schedule.ts` | None | `pickGreeting()`, nested five levels deep with no tests. The villain. |
| `src/components/Greeting.tsx` | One (`Greeting.test.tsx`) | The one component, rendering `hello()`. Proves the component path through Testing Library. |

## Run it

```powershell
npm install
npm test
```

Expected: 11 passed. Then open this folder in VS Code and press "Check my code" in DeepTest. Vitest needs `@vitest/coverage-istanbul`; it is in `devDependencies`, so nothing more to install.

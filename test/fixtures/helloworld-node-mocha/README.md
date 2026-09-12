# HelloWorld, Node on Mocha

The plain Node port of HelloWorld: ES modules, Mocha with `node:assert`, no framework, and no coverage package at all. It is the port that proves DeepTest's own instrumentation, Witness: Mocha cannot be measured by nyc when the project is ES modules (nyc's require hook never sees an `import`), so DeepTest instruments the sources itself as Node loads them. Same functions, same tests, same villain as the Python original.

| File | Tests | What it is for |
|---|---|---|
| `src/greet.js` | Full (`test/greet.test.js`) | Three small functions, every branch tested. Green. |
| `src/names.js` | Thin (`test/names.test.js`) | Three functions, two tests, one happy path each. `nickname()` has no test. Yellow and red. |
| `src/schedule.js` | None | `pickGreeting()`, nested five levels deep with no tests. The villain. No test loads this file, so no coverage tool would list it; Witness does. |

## Run it

```powershell
npm install
npm test
```

Expected: 10 passing. Then open this folder in VS Code and press "Check my code" in DeepTest. Nothing more to install; Node 22.15 or later is required, because Witness loads through `module.registerHooks`.

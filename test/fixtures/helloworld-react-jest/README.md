# HelloWorld, React on Jest

The React port of HelloWorld in plain JavaScript: `.jsx` components, Jest with `babel-jest` and Testing Library. The older React shape, the one Create React App projects grew up into. Same functions, same tests, same villain as the Python original.

| File | Tests | What it is for |
|---|---|---|
| `src/greet.js` | Full (`greet.test.js`) | Three small functions, every branch tested. Green. |
| `src/names.js` | Thin (`names.test.js`) | Three functions, two tests, one happy path each. `nickname()` has no test. Yellow and red. |
| `src/schedule.js` | None | `pickGreeting()`, nested five levels deep with no tests. The villain. |
| `src/components/Greeting.jsx` | One (`Greeting.test.jsx`) | The one component, rendering `hello()`. Proves the `.jsx` path through Jest. |

## Run it

```powershell
npm install
npm test
```

Expected: 11 passed. Then open this folder in VS Code and press "Check my code" in DeepTest. Jest brings its own coverage; nothing more to install.

# HelloWorld, Svelte on Vitest

The Svelte 5 port of HelloWorld: runes, `<script lang="ts">`, Vite, Vitest with Testing Library. Same functions, same tests, same villain as the Python original, with one difference that is the point of this port: the villain lives inside a `.svelte` file, in its `<script module>` block.

| File | Tests | What it is for |
|---|---|---|
| `src/lib/greet.ts` | Full (`greet.test.ts`) | Three small functions, every branch tested. Green. |
| `src/lib/names.ts` | Thin (`names.test.ts`) | Three functions, two tests, one happy path each. `nickname()` has no test. Yellow and red. |
| `src/lib/GreetingPicker.svelte` | None | `pickGreeting()`, nested five levels deep with no tests, in the component's `<script module lang="ts">` block. The villain. The toolkit has to read the script blocks of a single-file component to find it. |
| `src/lib/Greeting.svelte` | One (`Greeting.test.ts`) | The one tested component, `$props()` and `$derived`, rendering `hello()`. |

## Run it

```powershell
npm install
npm test
```

Expected: 11 passed. Then open this folder in VS Code and press "Check my code" in DeepTest. Vitest needs `@vitest/coverage-istanbul`; it is in `devDependencies`, so nothing more to install.

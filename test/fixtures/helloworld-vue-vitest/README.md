# HelloWorld, Vue on Vitest

The Vue 3 port of HelloWorld: single-file components with `<script setup lang="ts">`, Vite, Vitest with Vue Test Utils. Same functions, same tests, same villain as the Python original, with one difference that is the point of this port: the villain lives inside a `.vue` file.

| File | Tests | What it is for |
|---|---|---|
| `src/greet.ts` | Full (`greet.test.ts`) | Three small functions, every branch tested. Green. |
| `src/names.ts` | Thin (`names.test.ts`) | Three functions, two tests, one happy path each. `nickname()` has no test. Yellow and red. |
| `src/components/GreetingPicker.vue` | None | `pickGreeting()`, nested five levels deep with no tests, in the component's `<script lang="ts">` block. The villain. The toolkit has to read the script block of a single-file component to find it. |
| `src/components/Greeting.vue` | One (`Greeting.test.ts`) | The one tested component, `<script setup>`, rendering `hello()`. |

## Run it

```powershell
npm install
npm test
```

Expected: 11 passed. Then open this folder in VS Code and press "Check my code" in DeepTest. Vitest needs `@vitest/coverage-istanbul`; it is in `devDependencies`, so nothing more to install.

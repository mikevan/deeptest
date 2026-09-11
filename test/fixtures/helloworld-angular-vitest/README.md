# HelloWorld, Angular on Vitest

The Angular port of HelloWorld, scaffolded by the Angular CLI, so the test runner is what a new Angular project gets: `ng test` through the `@angular/build:unit-test` builder, with Vitest underneath. Same functions, same tests, same villain as the Python original, with one difference that is the point of this port: the villain is a method on an injectable service, and the runner is reached through Angular's builder, not the `vitest` binary.

| File | Tests | What it is for |
|---|---|---|
| `src/app/greet.ts` | Full (`greet.spec.ts`) | Three small functions, every branch tested. Green. |
| `src/app/names.ts` | Thin (`names.spec.ts`) | Three functions, two tests, one happy path each. `nickname()` has no test. Yellow and red. |
| `src/app/schedule.service.ts` | None | `ScheduleService.pickGreeting()`, nested five levels deep with no tests. The villain. |
| `src/app/greeting.ts` | One (`greeting.spec.ts`) | The one tested component, a signal input rendering `hello()`, through `TestBed`. |

## Run it

```powershell
npm install
npm test
```

If `npm install` stops with "Cannot read properties of null (reading 'edgesOut')", that is npm 10.9's dependency resolver tripping over Vitest 4's optional peers, not this project; run `npm install --legacy-peer-deps` instead. Expected: 11 passed. Then open this folder in VS Code and press "Check my code" in DeepTest. Coverage is `ng test --coverage`; the builder brings it.

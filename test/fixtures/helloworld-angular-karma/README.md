# HelloWorld, Angular on Karma

The Angular port of HelloWorld, scaffolded by the Angular CLI, with `--test-runner=karma`, so the test runner is what every existing Angular project has: `ng test` through the `@angular/build:unit-test` builder with Karma and Jasmine underneath, in a real Chrome. Same functions, same tests, same villain as the Python original, with one difference that is the point of this port: the villain is a method on an injectable service, and the tests run in a browser Karma launches, which is the runner the toolkit has no hook for yet.

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

Expected: 11 passed, in a Chrome window Karma opens and closes. Then open this folder in VS Code and press "Check my code" in DeepTest. Coverage is `ng test --coverage` through `karma-coverage`; the builder brings it. Karma needs Chrome on the machine.

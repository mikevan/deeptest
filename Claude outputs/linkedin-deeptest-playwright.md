# DeepTest and Playwright: what happens when you stop asking the framework for permission

Playwright component tests run your code in a real browser. That is the whole point of them, and it is also why no coverage tool has ever served them well. The counters live in the page. The test runner lives in Node. The two never meet, and the tools that try to bridge them settle for a percentage for the whole run and call it a day.

A percentage is not what DeepTest reports. DeepTest reports, for every line, which tests reached it, and whether that is enough tests for the number of ways through the function. That is density, and density needs to know where each test went. For Playwright that meant a problem nobody had solved, so we solved it.

Here is what shipped in DeepTest 1.0.8.

DeepTest counts inside the component build itself. Playwright bundles your components before it opens the browser, and DeepTest adds a step to that bundling that adds counters to each file as it passes through, in memory, on the same lines the code was on. Let me be exact about that, because it matters. DeepTest never writes to a file in your project. Not a source file, not a spec, not a config. The counted text exists only in memory while the run lasts, the bundle goes to a cache folder of DeepTest's own, and when the check is over your project is byte for byte what it was. The only things DeepTest writes are its own reports, in a `.deeptest` folder at the root, rebuilt every check. Nothing gets installed in your project either. No coverage package, no plugin in your config, no changes to your build.

Then it reads the page after every test. Each Playwright test runs in its own page, so the counters at the end of a test belong to that test and no other. DeepTest reads them out, resets the page, and records not just the lines the test touched but which way every decision went and which functions the test entered. I know of no other tool that gives Playwright component tests attribution per test, per line, per decision. Coverage tools tell you the page ran your code. DeepTest tells you which test ran which line, and whether the function has more ways through it than tests reaching it.

And you change nothing. Playwright's documented way to run code inside a test is a fixture the spec imports, which would have meant one edited line in every spec. We did not accept that. The worker that runs a Playwright test is a Node process, and DeepTest already owns Node's loader for Mocha, so it owns it here too: when a spec imports `test` from the Playwright package, the loader hands back a `test` that reports to DeepTest. Same import, same spec, same config. Press one button.

We tried the shortcut first. A reporter can attach to the browser Playwright launches and read V8's own counters. It works, and it is useful, and we rejected it for attribution, because Playwright does not wait for a reporter between tests, so the boundary it sees can be a test late. A number that is right most of the time is the wrong kind of number to put next to a density score.

That is the pattern behind the toolkit. We do not confine ourselves to what a framework hands out. When the framework's own tools stop at a percentage, we go under them, own the instrumentation, and come back with the answer the developer actually needs. And when the clever route gives a number we cannot vouch for, we do not ship it.

DeepTest runs the same way on Jest, Vitest, Mocha, Angular with Vitest or Karma, React, Vue, Svelte, and Python. Playwright was the hardest, and it now gets the same report as everything else: every line, every test, in plain words.

Project Revive Solutions, LLC. MikeVan's AI Development Toolkit on the VS Code Marketplace.

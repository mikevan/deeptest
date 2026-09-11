# MikeVan's AI Development Toolkit: the road to 1.0 and past it

Draft 2, 2026-09-12 (draft 1 earlier the same day; draft 2 orders the languages by the user base). Publisher: `prs` (Project Revive Solutions, LLC). Companion to toolkit-architecture.md and toolkit-api.md. This document says what each version number of every extension in the toolkit means, so a person reading a Marketplace page knows what they are getting and a person reading the code knows what to build next.

## 1.0: the core, done

On 2026-09-12 the core processes of every tool were declared complete and every extension in the toolkit was tagged 1.0.0 at once: DeepTest, UntangleIt, and the pack, MikeVan's AI Development Toolkit (`prs.MADTPackage`). The shared library `@projectrevivesolutions/complexity` went to 1.0.0 with them, since every tool builds against it and a 1.0 tool on a 0.1 library reads wrong. KeepSafe keeps its own number (0.1.1 as published) because it is already live with users and its contract has not changed.

What 1.0 means, tool by tool:

- **DeepTest 1.0** measures and judges: per-test attribution for every line, density against ways through, routes to every untested line, a verdict in plain words, decisions the person records, and the gated hand-off to the person's assistant. It refuses to score a run in which no test ran. It ranks and judges by ways through and carries tangle beside it as a sanity check. Languages: Python (pytest) and TypeScript / JavaScript (Jest, Vitest).
- **UntangleIt 1.0** untangles: it ranks by tangle (MBCC), hands one method at a time to the assistant behind the KeepSafe offer and the modal, measures every piece afterwards, and never accepts a result on the person's behalf. Languages: the same two.
- **The pack 1.0** lists KeepSafe, DeepTest, and UntangleIt under one Marketplace page and one README, and carries the toolkit's thesis and visual identity.
- **The library 1.0** holds the three measures (ways through, tangle by Campbell, tangle by MBCC) for the same two languages, with the ordered-operand and ordered-branch rules as the MBCC paper states them.

"Done" does not mean finished. The mechanical engine and `untangleit.api.plan`, the `last-check.json` record that joins a verdict to a checkpoint, the validation study on MBCC, and the recommendation rules in the UntangleIt spec are all still to build. They are improvements to the core, and they ship as patch numbers on whatever minor is current. What moves the minor number from here on is one thing only: a new language.

## Who the users are

The order below follows where the people are, not where the tooling is easiest. GitHub's Octoverse 2025 report ranks languages by monthly contributors: TypeScript 2,636,006 (+1.05M year over year, +66.6%), Python about 2.6M (+48%), JavaScript 2.15M (+24.79%), then Java (+174,705, +20.73%) and C# (+136,735, +22.22%); C++ and Go grew but are not ranked beside those five (GitHub, "Octoverse: A new developer joins GitHub every second as AI leads TypeScript to #1", 2025, https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/). The same report gives the reason TypeScript rose, and it is this toolkit's thesis in GitHub's words: type systems "catch LLM errors before production", and "94% of LLM-generated compilation errors were type-check failures".

Two consequences. The top three languages are the two the toolkit already handles, and TypeScript plus JavaScript is about 4.8 million monthly contributors, the largest base the toolkit has by a wide margin; so the JavaScript framework runner work, which serves that base and lands on plugins that already exist, is the first slot of the series, 1.0, before any new language. And C++ is not in the top five, so the 1.3 slot is decided between C++ and Go on the numbers at the time, not promised now.

## The pathway: one minor number per language

The standard for the toolkit has always been six languages, one abstraction layer, the same look and feel in every one. From 1.0 each language that lands across the whole toolkit adds one to the minor number of every extension at once, so the numbers stay in step and "1.2" means the same thing on every Marketplace page.

| Version | Language | Runners and coverage | Why this position |
|---|---|---|---|
| 0.x $${\color{green}\text{(Done)}}$$ | Python; TypeScript and JavaScript | pytest with coverage.py dynamic contexts; Jest and Vitest with Istanbul counters snapshotted around every test | The first two, built through 0.2 to 0.4 and shipped in 1.0. Octoverse's top three by contributors are these two languages, so the toolkit starts where most of the people already are. |
| 1.0 | The JavaScript frameworks that allow testing | React, Vue, Svelte under Jest or Vitest (mostly working today); Angular under Karma or Jest; Mocha; Playwright component tests | The largest user base the toolkit has, about 4.8M monthly contributors across TypeScript and JavaScript. The first slot of the series, opened by the v1.0.0 tag: detection plus runner adapters inside the existing plugin, shipped as 1.0.x builds until every framework in the list runs clean. |
| 1.1 | Java | Maven and Gradle; JUnit; JaCoCo for per-test attribution | The friendliest of the four: JaCoCo's agent writes a session id with its data and can be told over a socket to dump and reset, which gives per-test attribution with the project's own JaCoCo and no per-test JVM restarts. Two well-trodden runners. Java codebases are also where guard chains and nested conditionals live, so it is the second corpus for the MBCC validation study. |
| 1.2 | C# | `dotnet test`; xUnit, NUnit, MSTest; Coverlet or the .NET data collector | Whole-run coverage is easy; per-test attribution has not been verified in either tool and needs a prototype (filtered runs or a data collector) before the same screen can be promised. Second, not first, for that reason. |
| 1.3 | C++ or Go, by the user numbers at the time | C++: CMake and CTest first; GoogleTest, Catch2, doctest; Clang and GCC instrumented builds, one profile per test invocation, merged. Go: `go test -cover` with per-test runs, one runner. | Neither is in Octoverse's top five by contributors. C++ is the hardest by a distance, because "use the project's own runtime" has no single runtime to use: build system, test framework, and compiler each vary, and every pairing the toolkit cannot detect is a failure state the person sees. Go is one runner and one toolchain. The operators the toolkit also serves run C++, which keeps it in the six. |
| 1.4 | The other of C++ and Go, or PHP | To be decided when 1.3 ships | The sixth slot as the standard has said since 2026-09-05. |

The JavaScript frameworks that allow testing (React, Vue, Angular, Svelte, and the runners under them: Mocha, Karma, Playwright component tests) are the 1.0 slot of the series. They are not a new language: most of them work today because the code is TypeScript or JavaScript and the tests run under Jest or Vitest, and what is missing is detection and a few more runner adapters (Angular's Karma path has no Istanbul hook yet). They take the first slot because that is where the users are (see "Who the users are"), and because the work proves the runner layer generalises before Java and C# need it. 1.0 is done when every framework in the list runs clean on its fixture; then 1.1 begins.

## What a language has to have before its minor number ships

A language is done when all four layers agree on the same fixture project and the fixture is committed beside HelloWorld:

1. **The library**: walkers for ways through, tangle (Campbell), and tangle (MBCC), with the whitepaper's worked cases and the MBCC paper's cases pinned in tests for that language.
2. **DeepTest**: the route and depth parser, the coverage adapter with per-test attribution through the project's own runner, the environment check with its "Install X into that runtime" button, and the language block on the setup screen.
3. **UntangleIt**: the structure plugin (the same parser files as DeepTest's) and the extraction rules for the brief.
4. **The pack and the READMEs**: the Languages table updated in all three, the Marketplace pages saying the same thing.

The order of work inside a language is the order the layers consume each other: library first, then DeepTest's coverage adapter, then routes, then UntangleIt. A fixture project in HelloWorld's style (one file fully tested, one thinly, one villain nested deep with no tests) is written before the adapter, so every layer is tested against the same code.

## Version discipline

- Patch numbers move on every delivery (principle 10, one build one number). They cover fixes, improvements to the core, runner adapters, words, and docs.
- The minor number moves once per language, on every extension and the library together, when all four layers are done.
- The major number moves when a series ends and the next begins (see the tag rule below). An incompatible change to the inter-tool protocol (toolkit-api.md, section 7) would also force it, and there is no plan for that.
- A tag marks the start of a series, not its end. `v1.0.0` on every repo on 2026-09-12 opens the 1.x series, the language expansion. Nothing from the series goes to the Marketplace while it is being built; the users keep the last published release until the series is done. When it is, the final 1.x.x is uploaded, `v2.0.0` is tagged on every repo, and the next series begins from there. Minor numbers inside a series mark its slots (1.0 JavaScript frameworks, 1.1 Java, 1.2 C#, ...) and are not tagged. Routine work is never tagged.
- One script does the alignment: `scripts\release.ps1` in MADTPackage sets the version in all four trees in dependency order (library, UntangleIt, DeepTest, pack), runs each tree's tests, builds, packages, installs, and stops at the first failure. It commits and pushes only with `-Commit`, tags only with `-Tag`, and shows every working tree and asks once before the first git write. A patch: `.\scripts\release.ps1 -Version 1.0.1 -Commit -Subject "..."`. A language release: add `-Tag`.

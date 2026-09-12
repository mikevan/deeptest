# MikeVan's AI Development Toolkit: common design and architecture language

Draft 5, 2026-09-12 (draft 4 earlier the same day, draft 3 was 2026-09-11, draft 2 2026-09-09, draft 1 2026-09-06). Publisher: `prs` (Project Revive Solutions, LLC). The toolkit is MikeVan's AI Development Toolkit; the company publishes it. The words and the shape every tool in the toolkit shares, so that KeepSafe, DeepTest, UntangleIt, and whatever comes next read as one product family, integrate without knowing each other's insides, and can be reviewed against one standard. Where a tool departs from this document, the departure is written down in that tool's engineering notes with the reason.

Draft 5 change: Witness, the toolkit's own instrumentation, is a second shared library, and principle 4 now says what shared libraries may and may not be (2026-09-12, later the same day). Draft 4 change: which number belongs to which tool, settled 2026-09-12 (see "Ways through" and "Tangle" below, and the MBCC paper, mbcc-why-and-how.md). Draft 3 change: the untangling tool is named UntangleIt (2026-09-11). The Marketplace refused its first display name as too similar to an existing listing, and the tool was unpublished, so the name, id, commands, and storage folder all changed at once. See toolkit-api.md for the identifiers.

## 1. The thesis

The toolkit lets a person who does not read code know whether their AI-written code is good, whether it is being changed without their knowledge, and what to do about it. Each tool answers one question and does one verb. The person decides at every gate; the tools measure, remember, transform, and report. No tool ever accepts a result on the person's behalf.

## 2. The person

Jeff: an accountant in his mid-40s with a CPA, never wrote code beyond Excel macros, vibe-coding his own AI-enabled accounting tool. Every screen, sentence, and setting is written for Jeff first. Engineers get their numbers behind one switch, never instead of the plain words.

## 3. Shared vocabulary

Use these words, in this sense, in every tool's interface, documentation, and code.

- **Verb**: the one thing a tool does. KeepSafe remembers and restores. DeepTest measures and judges. UntangleIt untangles. A tool with two verbs is two tools.
- **Check**: a run of a tool over the workspace that ends in a verdict. "Check my code" is the button.
- **Verdict**: the tool's one-sentence answer, first on the screen, always a complete sentence. "This looks ready." "This is not ready: 947 lines were never tested."
- **Limit**: a threshold the person sets. "Your limit is 10." Never "threshold" on screen.
- **Ways through**: cyclomatic complexity, in Jeff's words. A decision is one `if`, `else`, loop, error handler, or half of an `and`/`or`. The test bar: every way through is a path a test must reach. DeepTest's number: density, the verdict, and "Hardest to test" are built on it and on nothing else. It is the only number that ever sets a test count.
- **Tangle**: how hard a function is to follow. UntangleIt's number: its list, its judge, and its brief read it. Two figures, always shown together: **tangle (Campbell)**, Cognitive Complexity as SonarSource published it, and **tangle (MBCC)**, MikeVan's Better Cognitive Complexity, Campbell's rule with one change: where order carries meaning the reader pays per step, so a run of `and`/`or` costs one per operand when the operands depend on each other or make calls, and a chain of `if`/`elif`/`else` on different facts costs k for its k-th branch. A `switch`, or a chain on one value against constants, costs one; tangle measures depth, and splitting a flat switch into a method per case removes no depth. When Campbell and MBCC wildly disagree, MBCC wins. All three numbers come from the shared library `@projectrevivesolutions/complexity`, so every tool prints the same figure for the same function, and each tool prints the other's number beside its own as a sanity check, never as a driver.
- **Shortfall**: one thing that falls below a limit, with a location.
- **Card**: the on-screen unit for one shortfall: where, what, why, and the choices.
- **Decision**: the person's recorded answer to a shortfall: Fix this, Accept as it is, or Leave for now. Pinned to the text it was made about; stale when that text changes.
- **Brief**: the instructions a tool hands to an AI assistant. Precise enough that a capable model can nail it and a weak one cannot mistake it for something simpler.
- **Hand-off**: giving a brief to the assistant. The only place a tool lets an AI touch the code, and always behind the gates.
- **Gates**: the two prompts in front of every hand-off, in this order: the checkpoint offer (when KeepSafe is installed), then the modal confirmation that says what is about to happen. Nothing is recorded or sent before "Yes, send it".
- **Checkpoint**: KeepSafe's snapshot of the workspace. The undo.
- **Judge**: what a tool does after a hand-off: measure again and say whether the result clears the bar. A tool judges; it never vouches for the assistant.
- **Route**: the ordered decisions that must hold for control to reach a line, and where the tests stop along it.
- **Plain words** and **the engineer's numbers**: the two registers. Plain words are always shown. The numbers appear beside them only when "Show the engineer's numbers next to the plain words." is ticked.

## 4. Component classification

Michael's scale, applied to every part of every tool: **method call**, **atom**, **AI-based agent**, **skill**. An atom must leverage AI; that is the qualifying test. Prefer the AI-driven option where it fits; use a method call where a proof or a measurement is available and an AI adds nothing. Each tool's engineering notes list its components on this scale.

Applied so far: DeepTest's engine, parsers, and coverage adapters are method calls (measurement, provable). Its Fix hand-off is an AI-based agent seam: the tool builds the brief, the person's assistant is the agent, the tool judges. KeepSafe is method calls throughout. UntangleIt's mechanical engine is method calls; its AI engine is an agent behind the same interface.

## 5. Principles

1. **The human decides.** Not because humans are superior but because they are accountable. Tools report and offer; the person chooses; then the AI goes ham; then the tool judges.
2. **One verb per tool.** When a feature needs a second verb, it is a new tool.
3. **Judge, never vouch.** A tool never accepts an AI's result, never retries on its own, and is never responsible for the quality of the assistant the person chose.
4. **Integrate one way, through public commands.** No shared tool code, no imports across tools, no modification of a sibling to suit another, and no runtime dependency between tools, because they are not always both installed. Shared *libraries* are allowed, and there are two: `@projectrevivesolutions/complexity` (measures only, no verb, no screen, no storage, no file system) and `@projectrevivesolutions/witness` (instrumentation and per-test attribution for the runtimes the toolkit serves; see DeepTest's docs/witness.md). A library is bundled into each tool at build time, so every tool ships its own copy and nothing is resolved from a sibling at run time; each tool copies its own hooks into its own folder in the project. A tool checks whether a sibling is installed, uses its published command if so, and otherwise recommends it once, in the text of its setup screen, with a link, and never mentions it anywhere else.
5. **Use the project's own runtime.** A tool never ships a language runtime or a test runner. It finds the project's Python, Node, Java, and test runner the way the project itself does.
6. **Plain words first, complete sentences, exact labels.** Every user-facing string ends with punctuation. Every instruction names the control as it is labelled on screen. A tool that is sloppy about words cannot be trusted about code.
7. **No barriers.** Plain TypeScript, no native modules, nothing extra to install, fields pre-filled from detection so the correct action on the setup screen is to press the button.
8. **One abstraction layer per tool for languages.** One contract, one registry, nothing above the contract names a language. The six languages: TypeScript/JavaScript, Python, Java, C#, C++, then PHP or Go. A single-language adapter is never "done".
9. **Correctness over speed.** Sequence work by what makes the tool correct, never by the cheapest win.
10. **One build, one number.** Every build increments the version; the version shows in the panel's title bar.
11. **Document the engineering.** What was tried, what failed, why this approach, in docs/engineering-notes.md, code comments, and the project. The byline is Michael's; the detail is kept.

## 6. The shape of a tool

Every tool is a VS Code extension with these layers, in these folders, so a reader of one can read the next.

- `src/engine/`: pure model and computation. No `vscode` import. Fully unit-tested. This is where the tool's truth lives.
- `src/languages/`: the language contract (`types.ts`), the registry, shared helpers (tree-sitter, process running, runtime discovery), and one folder per language plugin.
- `src/decisions/`: the person's decisions and the gated hand-off. Storage under `.<tool>/decisions.json`, plain JSON, meant to be committed.
- `src/report/`: the pure report model, the brief builder, and the plain-language phrase builders.
- `src/ui/`: `words.ts` (the one place every sentence lives), the side panel webview, the setup screen, the report panel, editor overlays, the status bar.
- `src/<sibling>.ts`: one small file per sibling tool holding its extension id, its public commands, the installed check, and the recommendation. Nothing else in the tool names the sibling.
- `src/state.ts`, `src/config.ts`, `src/runner.ts`, `src/extension.ts`: the one place results live, the settings, the orchestration, the activation.
- `hooks/`, `vendor/`: runner hooks and vendored grammars, copied to `dist/` by the build. The Witness runtime and loader live here as plain files; the Witness instrumenter is bundled by the build into `dist/hooks/` because it runs inside the project's own process.
- `src/witness/`: DeepTest's own instrumentation while it is born here (docs/witness.md); it moves to the Witness library when a second tool needs it.
- `test/`: unit tests under Vitest with fixtures per language; integration suites under `@vscode/test-electron` that drive the real screens.
- `docs/engineering-notes.md`, `docs/build-status.md`, `docs/uat.md`: the reasons, the state, and the acceptance script written for Jeff.
- `media/`: the Marketplace icon PNG (named by the `icon` field), the Activity Bar SVG, and any README images. `.vscodeignore` excludes `media/**` and re-includes the icon and the SVG, so GIFs never ride inside the VSIX; the Marketplace fetches README images from GitHub.

Storage on disk: `.<tool>/` at the workspace root, listed in `.gitignore` except for files meant to travel with the code (decisions). Settings namespace: `<tool>.*`, with `<tool>.languageSettings.<language>.<field>` for the language block. Commands: `<tool>.<verb>`; commands that take arguments are hidden from the palette. Output channel named after the tool. Activity-bar icon and a single webview side panel with the verdict first, one primary button, and the cards.

## 7. Screens every tool has

- **Side panel**: verdict, one primary button, what the tool found, the cards with choices, links to the full report, the setup, and the log. Title bar carries the version.
- **Setup screen**: pre-filled from detection; common fields (language, tests folder, source root, limits) above a small language-specific block; an "Advanced" fold; a section for each sibling (installed: the integration setting; not installed: the recommendation with a link).
- **Full report**: the same verdict, a table of what was measured, the worst N in full, the rest one line each, the person's decisions with their reasons, and Save as Markdown.
- **Log**: everything the tool ran, verbatim, behind "Show the log".
- **Failure states**: "No tests were found." with "Tell me where the tests are"; "The check did not finish." with the reason, "Check my code again", "Show the log", and "Change the setup".

## 8. Testing standard

Each tool measures itself with DeepTest and reports its own verdict in build-status. Unit tests pin exact user-facing strings. Integration suites run the real extension in a real editor against one fixture per supported language. The integration harness may bypass a modal only through a process-environment variable set by the harness, never through a setting.

## 9. Delivery

Source at `C:\workspace\<Tool>`, updated in place. Every delivery: version bumped, unit and integration suites green, VSIX rebuilt, docs current, engineering notes updated. Install from the Extensions view ("Install from VSIX...") or with `code --install-extension <file>.vsix --force`. No git writes by the assistant; Michael commits when it works, with a short subject and an engineering-reason body. Marketplace uploads go through the publisher management page (no token needed) or `vsce publish`; DeepTest must be packaged with `--no-dependencies` (see toolkit-api.md, section 9).

## 10. Visual identity (settled 2026-09-11)

Flat cut shapes on a black ground in KeepSafe's orange and green, one object per mark, drawn to read at the 42px the Extensions list uses. Marks: KeepSafe the owl (unchanged, already published), DeepTest a checklist with a green check, UntangleIt a knotted line straightening into three green bars, the pack a toolbox holding the three. The Marketplace `icon` is a 512x512 PNG per tool; the Activity Bar mark is a separate monochrome SVG for tools with a side panel (DeepTest, UntangleIt). "MikeVan's AI Development Toolkit" is the pack's display name and appears in each member's README.

## 11. What is open

- Witness moves out of DeepTest into `C:\workspace\Witness` when UntangleIt needs it; Jest, Vitest, and the Angular runners then move onto it, so every runner is an instrumenter, a transport, and a boundary on one attribution core. The engine counters (V8 precise coverage through `node:inspector` and the DevTools protocol) are its path for code it cannot transform.

- The switch-case counting rule for ways through in DeepTest (a case as one decision versus cumulative). For tangle it is settled: a switch is one. UntangleIt's dispatch-table transform is therefore never a tangle job; it lives only in the extension-point rule of the spec.
- Whether the "ledger" that joins checkpoints to verdicts is a fourth tool or a feature of DeepTest, given KeepSafe stays untouched.
- Colour meanings in the editor overlays (green over, light green met, yellow short, red untested, grey unreachable) are DeepTest's today and should be the same in every tool that paints lines.

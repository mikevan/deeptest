# MikeVan's AI Development Toolkit: how the tools talk to each other

Michael Van Geertruy, with Claude. Project Revive Solutions, LLC.

Draft 6, 2026-09-22 (draft 5 was 2026-09-12, draft 4 2026-09-11, draft 3 2026-09-09, draft 2 2026-09-06). Draft 6 cut this document back to what is built. Five silent commands, an event surface, a public record file, and an integration between DeepTest and UntangleIt were published here and did not exist in either tool. They are in section 10 now, and section 10 is not the contract. A test in DeepTest's suite fails when anything above section 10 says something the code does not do. Publisher: `prs` (Project Revive Solutions, LLC). Companion to toolkit-architecture.md. This is the contract between tools. Anything not written here is private to a tool and may change without notice.

Draft 4 change: the untangling tool is named **UntangleIt**. The Marketplace upload under its first display name was refused by the similarity check ("refactorix already exists"), and a dormant Visual Studio extension by mynkow (last active around 2017) shares that first name on the Marketplace website. The tool was unpublished, so the rename is free: id `prs.untangleit`, commands `untangleit.*`, records `.untangleit/`, folder `C:\workspace\MikeVan's AI Development Toolkit\UntangleIt`, repo `mikevan/untangleit`. The pack folder and repo are `MADTPackage`.

## 1. The rules

Which number drives what, settled 2026-09-12: DeepTest ranks and judges by ways through (cyclomatic); its `limit` is a ways-through limit. UntangleIt ranks and judges by tangle (MBCC); its `limit` is a tangle limit, default 15. Both tools carry all three numbers, and each prints the other's driver beside its own as a sanity check. The reasoning is in the MBCC paper in the toolkit docs.

1. Tools talk through four channels and nothing else: discovery, commands, records on disk, and events. No shared code between tools, no imports across tools, no reaching into a sibling's storage except the files this document lists. A shared *library* is different from shared tool code: `@projectrevivesolutions/complexity` (added 2026-09-09) holds the three complexity measures and nothing else, has no verb, no screen, and no storage, and every tool that reports a complexity number builds against it so the numbers agree. From 1.0.9 there is a second, `@projectrevivesolutions/witness`: the instrumentation (an instrumenter, a runtime, and the hooks that put them into Node's loader, a Vite build, and Playwright's workers), with no verb, no screen, and no storage of its own; a tool bundles it, copies its hook files into the tool's own folder in a project, and sets the `WITNESS_*` environment on the process it launches (the names are exported as `ENV`; the design is in witness.md). Those are the two libraries the toolkit shares; anything else a tool needs from a sibling goes through the four channels.
2. Every channel is one way: the caller depends on the callee's published contract; the callee knows nothing about the caller. KeepSafe is the proof: it is unmodified, and DeepTest still integrates with it fully.
3. A tool that is not installed is recommended once, in the text of the caller's setup screen, with a link. Nothing else in the caller mentions it.
4. A sibling that is installed but fails is reported in plain words and the caller stops. It never proceeds as if the sibling had succeeded, and never retries on its own.
5. Contracts are additive. A published command keeps its name, its arguments keep their meaning, and its result keeps its fields. New fields and new commands may be added. Removal is a major version of the protocol.

## 2. Discovery

A tool finds its siblings with `vscode.extensions.getExtension(id)`. Ids are fixed:

| Tool | Extension id | Verb |
|---|---|---|
| KeepSafe | `KeepSafe.keepsafe` (already published under that publisher; a Marketplace listing cannot move between publishers, so it stays) | remember and restore |
| DeepTest | `prs.deeptest` | measure and judge |
| UntangleIt | `prs.untangleit` (named 2026-09-11; the earlier id was never published) | untangle |
| The pack | `prs.MADTPackage` (section 9) | none; it only lists the others |

Tools built to this document also declare themselves in `package.json` so a future tool can find every sibling without a hard-coded list:

```json
"prsToolkit": {
  "protocol": 1,
  "verb": "measure and judge",
  "commands": [],
  "records": [".deeptest/decisions.json"]
}
```

`commands` lists a tool's **silent** commands and nothing else, because those
are the ones a sibling can call without a person in the room. Interactive
commands are for people and are listed in section 3, not here. DeepTest's array
is empty on purpose: it publishes no silent command today. An empty array is a
fact about the tool, not a gap in the block, and a tool with no silent commands
still declares the block so a sibling can read its verb and its records.

A caller reads this through `extension.packageJSON.prsToolkit`. KeepSafe has no such block and never will; callers carry a fixed entry for it. That is the one exception, and it is written down here so it is not copied. (The block key `prsToolkit` and the pack id `prs.MADTPackage` are machine identifiers under the `prs` publisher; the toolkit's name in every sentence a person reads is MikeVan's AI Development Toolkit.)

## 3. Commands

Commands are the live channel: `vscode.commands.executeCommand(name, args)` with one plain JSON object in, one plain JSON object out. Executing a command activates the callee if it is installed but not yet running.

Two kinds, distinguished by name:

- `<tool>.<verb>`: **interactive**. Talks to the person: shows a notification, a quick pick, a modal, or a screen. Callers use these when the person should see the sibling's own words. They may return nothing. KeepSafe's commands are all of this kind.
- `<tool>.api.<name>`: **silent**. Never prompts, never opens a screen, always returns a result object. Callers use these to ask questions and to run work whose gates the caller has already passed. The caller is responsible for the gates.

Every silent result has the same envelope:

```json
{ "protocol": 1, "tool": "deeptest", "version": "0.4.0", "ok": true, "result": { } }
{ "protocol": 1, "tool": "deeptest", "version": "0.4.0", "ok": false, "error": "Check your code first, and then decide about its functions." }
```

`error` is a complete sentence the caller may show as it is. A silent command never throws.

### 3.1 KeepSafe (as published, v0.1.1, unmodified)

| Command | Kind | What it does |
|---|---|---|
| `keepsafe.quickCheckpoint` | interactive | Checkpoints the first workspace folder as `quick-YYYYMMDD-HHMMSS` and shows its own message. No arguments, no result. |
| `keepsafe.createCheckpoint` | interactive | Asks the person for a name, then checkpoints. |
| `keepsafe.restoreLatestCheckpoint` | interactive | Confirms with the person, then restores the newest checkpoint. |
| `keepsafe.restoreCheckpoint`, `keepsafe.listCheckpoints`, `keepsafe.diffCheckpoints` | interactive | Pick from a list, then act. |

Of these, our tools call exactly one: `keepsafe.quickCheckpoint`, before a
hand-off, in both DeepTest and UntangleIt. Because it prompts in KeepSafe's own
words, a caller's gate sentence says what KeepSafe is about to do, then KeepSafe
says what it did. There is no silent KeepSafe command, and nothing in this
toolkit reads KeepSafe's files; the undo is the person's, in KeepSafe's own
screens. An earlier draft said callers use `keepsafe.restoreLatestCheckpoint`
for the undo and that DeepTest reads KeepSafe's manifests. Neither was ever
built. See section 10.

The rest of the table is KeepSafe's published surface, recorded here because a
caller may use it. KeepSafe is not our repository, so the contract test checks
only the one command our code actually invokes.

### 3.2 DeepTest

| Command | Kind | Arguments | Result |
|---|---|---|---|
| `deeptest.run` | interactive | none | Runs a check with the side panel open. |
| `deeptest.fix` | interactive | `{ path, line }` | The gated hand-off for one line. |
| `deeptest.fixFunction` | interactive | `{ path, line }` | The choice, the gates, the hand-off for one function. The refactor choice routes to `untangleit.method` when UntangleIt is installed. |

DeepTest publishes no silent command. Four were described in draft 5 and none
of them existed; they are in section 10.

### 3.3 UntangleIt

| Command | Kind | Arguments | Result |
|---|---|---|---|
| `untangleit.method` | interactive | `{ path, startLine }` | The full loop on one method: show, checkpoint, confirm, transform, verify, report. What DeepTest's "Break it into smaller pieces" calls when UntangleIt is installed. |
| `untangleit.worst` | interactive | none | The loop on the most tangled method in the workspace. |
| `untangleit.api.measure` | silent | `{ path }` | Methods in the file with all three numbers: `{ name, startLine, endLine, cyclomatic, campbell, mbcc, waysThrough, over }`. `waysThrough` equals `cyclomatic` and stays for callers written against 0.1.x; `over` is `mbcc` above the limit (0 when within). (0.1.x returned `waysThrough` and an `over` on ways through; from 0.1.11 all three, measured by the shared library, and `over` on tangle.) The result's `limit` is the tangle limit. |

## 4. Records on disk

The slow channel, and the only way to read history. Each tool owns one folder at the workspace root and writes only there. Files listed here are public; their shape carries a `version` field and changes only additively.

| Tool | Folder | Public file | Meaning |
|---|---|---|---|
| DeepTest | `.deeptest/` | `.deeptest/decisions.json` | The person's decisions about lines and functions, meant to be committed. `coverage/`, `attribution/`, `instrumented/`, and the generated runner configs are private and regenerated on every run. |
| UntangleIt | `.untangleit/` | `.untangleit/runs.json` | One entry per run: method, before and after numbers, pieces produced, verified or stopped and why. |

Two files, both written by the tool that owns them. KeepSafe's files are real
and are documented in KeepSafe's own README, but nothing in this toolkit reads
them, so they are not part of this channel; see section 10.

## 5. Events

VS Code has no event bus between extensions, so there are two ways to be told something happened, and callers pick by need:

- **Watch the records.** `vscode.workspace.createFileSystemWatcher` on a
  sibling's public file. A change to `.deeptest/decisions.json` or
  `.untangleit/runs.json` is a thing that happened.
- **Exports.** A tool returns an object from `activate`, read through
  `getExtension(id).exports` after `activate()`. What they return today:

| Tool | Exported from `activate` |
|---|---|
| DeepTest | `{ state, run, report }` |
| UntangleIt | `{ state, run }` |

  `state` is the tool's result state, `run()` performs the tool's own verb, and
  DeepTest's `report()` returns the current report model or `undefined` before
  the first run. These are a convenience for a tool in the same process;
  everything a sibling needs across processes goes through commands and
  records. No tool publishes events. Draft 5 said both published `onDidCheck`
  and `onDidDecide`; neither ever did. See section 10.

## 6. The flows that are built

**Hand-off with an undo (built).** DeepTest checks `KeepSafe.keepsafe` is installed and `deeptest.keepSafe.offerCheckpoint` is on; offers; on yes calls `keepsafe.quickCheckpoint`; then the modal; then the brief. If the command throws, DeepTest says KeepSafe could not create the checkpoint and sends nothing.

**Untangle from DeepTest (built, DeepTest 0.4.3 and UntangleIt 0.1.9, 2026-09-11).** On "Break it into smaller pieces", DeepTest checks for `prs.untangleit`. If present, it calls `untangleit.method` with `{ path, startLine }` (path relative to the workspace folder) and stops; UntangleIt runs its own gates and its own report, and DeepTest records no decision because the person has not yet said yes. If absent, DeepTest uses its own brief and gates, and its setup screen recommends UntangleIt once, with a link. UntangleIt measures the file on demand when the method is not in its last measure, so the call works on a fresh editor. Either way DeepTest judges on the next check. The refactor brief in DeepTest stays as the not-installed fallback.

Those two flows are the whole of what is built between the tools. A third was
described in draft 5 and is in section 10.

## 7. Versioning and compatibility

`protocol` is an integer, currently 1, in the `prsToolkit` block and in every silent result. A caller checks it before trusting field names. A tool supports every protocol version it has ever published for its own commands. Tools do not require sibling versions; they require protocol numbers, and degrade to the recommendation when a sibling is too old to answer.

## 8. Open questions

1. Should KeepSafe's fixed entry live in one shared, copied file (`src/siblings/keepsafe.ts` in every tool) or be generated from this document? Copied is simpler and matches "no shared code".
2. If `last-check.json` is ever built (section 10): commit it or ignore it? It would be history, like decisions, but it would change on every run.
3. Whether silent commands should accept a `folder` argument for multi-root workspaces, given KeepSafe always acts on the first folder.
4. A toolkit-wide status command that any tool answers with its verb and version, so a future dashboard can list what is installed.

## 9. The pack

VS Code extension packs bundle independent extensions under one Marketplace page: a pack is an extension whose `package.json` lists ids in `extensionPack`, and the bundled extensions stay independently installable (Microsoft's own rule for packs: no functional dependency on the members). The toolkit ships one, `prs.MADTPackage` (folder and repo `MADTPackage`, display name "MikeVan's AI Development Toolkit"), containing only the list, an icon, and a README with the thesis and the three verbs: `KeepSafe.keepsafe`, `prs.deeptest`, `prs.untangleit`. It carries no code and changes nothing about how the tools talk; it changes how they are found. The pack itself installs as a fourth extension in the person's editor, which is where its icon and README are seen, and uninstalling it is how all three members are removed at once.

Marketplace mechanics learned on 2026-09-11: the `icon` PNG ships inside the VSIX and serves both the Extensions list and the details page; README images are not read from the VSIX but rewritten by the packager to raw GitHub URLs from the `repository` field, so they show only once pushed. A display name too close to an existing listing is refused at upload. DeepTest packages with `--no-dependencies` because `@projectrevivesolutions/complexity` is a `file:../complexity` link that the packager would otherwise follow out of the project; the library is bundled into `dist/extension.js` by esbuild, so nothing from `node_modules` is needed.

## 10. Proposed, not built

Everything below this line is a design and nothing below it is a promise. No
tool implements any of it, no caller may rely on it, and the contract test in
DeepTest's suite stops reading at this heading. Sections 1 to 9 are the
contract; section 10 is a notebook.

It exists because draft 5 published all of it as though it were shipped, and
the ideas are worth keeping even though the claims were not true.

**Four silent commands for DeepTest.** `deeptest.api.status` would return the
last check without running one: `{ checked, at, ready, verdict, coverage,
densityPassRate, untestedLines, shortLines, complexFunctions: [{ path, name,
startLine, endLine, complexity, campbell, mbcc, limit }] }`. `deeptest.api.check`
would run a check and return the same shape, long-running, with the caller
showing its own progress. `deeptest.api.function`, given `{ path, startLine }`,
would return all three numbers, the limit, the short lines inside the function,
and its decision state. `deeptest.api.decisions` would return the decisions file
as data. Each would carry the section 3 envelope.

**One silent command for UntangleIt.** `untangleit.api.plan`, given
`{ path, startLine, limit }`, would return what the mechanical engine would do
as a list of steps, without doing it, so a caller could show the plan before
the gates.

**Before and after, from UntangleIt.** UntangleIt would call
`deeptest.api.function` before and after an untangling and report the change in
all three numbers. It does not. After an untangling it tells the person to press
"Check my code again" in DeepTest, and `UntangleIt\src\deeptest.ts` says so in
its own header: UntangleIt does not call DeepTest.

**`last-check.json`, and a verdict on a checkpoint.** After each check DeepTest
would write `.deeptest/last-check.json` with the verdict, its numbers, and the
id of the newest KeepSafe checkpoint at that moment. A later tool wanting
"restore the last state DeepTest called ready" would join that file to
KeepSafe's `manifest.json` and call `keepsafe.restoreCheckpoint`, where the
person picks the named checkpoint. It needs no new KeepSafe surface, which is
what makes it attractive. Nothing writes the file today.

**KeepSafe's records.** `.keepsafe/checkpoints/<id>/manifest.json` and
`checkpoints/<id>/checkpoint.txt` are real files, and KeepSafe's README
documents the manifest, so reading them is within KeepSafe's published
contract. No tool in this toolkit reads them. They would become part of the
records channel the day one does, and not before.

**Events from `activate`.** `onDidCheck` and `onDidDecide`, so a sibling in the
same process could react without polling a file. Neither tool exposes either.

A reader who wants any of this should treat it as a specification to build
against, not as a description of the product.

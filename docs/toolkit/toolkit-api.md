# MikeVan's AI Development Toolkit: how the tools talk to each other

Michael Van Geertruy, with Claude. Project Revive Solutions, LLC.

Draft 5, 2026-09-12 (draft 4 was 2026-09-11, draft 3 2026-09-09, draft 2 2026-09-06). Publisher: `prs` (Project Revive Solutions, LLC). Companion to toolkit-architecture.md. This is the contract between tools. Anything not written here is private to a tool and may change without notice.

Draft 4 change: the untangling tool is named **UntangleIt**. The Marketplace upload under its first display name was refused by the similarity check ("refactorix already exists"), and a dormant Visual Studio extension by mynkow (last active around 2017) shares that first name on the Marketplace website. The tool was unpublished, so the rename is free: id `prs.untangleit`, commands `untangleit.*`, records `.untangleit/`, folder `C:\workspace\UntangleIt`, repo `mikevan/untangleit`. The pack folder and repo are `MADTPackage`.

## 1. The rules

Which number drives what, settled 2026-09-12: DeepTest ranks and judges by ways through (cyclomatic); its `limit` is a ways-through limit. UntangleIt ranks and judges by tangle (MBCC); its `limit` is a tangle limit, default 15. Both tools carry all three numbers, and each prints the other's driver beside its own as a sanity check. The reasoning is in the MBCC paper in the toolkit docs.

1. Tools talk through four channels and nothing else: discovery, commands, records on disk, and events. No shared code between tools, no imports across tools, no reaching into a sibling's storage except the files this document lists. A shared *library* is different from shared tool code: `@projectrevivesolutions/complexity` (added 2026-09-09) holds the three complexity measures and nothing else, has no verb, no screen, and no storage, and every tool that reports a complexity number builds against it so the numbers agree. It is the one library the toolkit shares; anything else a tool needs from a sibling goes through the four channels.
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
  "commands": ["deeptest.api.status", "deeptest.api.check", "deeptest.api.function"],
  "records": [".deeptest/decisions.json", ".deeptest/last-check.json"]
}
```

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

Callers use `keepsafe.quickCheckpoint` before a hand-off and `keepsafe.restoreLatestCheckpoint` when offering the undo. Because these prompt in KeepSafe's own words, a caller's gate sentence says what KeepSafe is about to do, then KeepSafe says what it did. There is no silent KeepSafe command; the caller cannot learn the checkpoint's id from the command, so it reads the records channel instead (section 4).

### 3.2 DeepTest

| Command | Kind | Arguments | Result |
|---|---|---|---|
| `deeptest.run` | interactive | none | Runs a check with the side panel open. |
| `deeptest.fix` | interactive | `{ path, line }` | The gated hand-off for one line. |
| `deeptest.fixFunction` | interactive | `{ path, line }` | The choice, the gates, the hand-off for one function. The refactor choice routes to `untangleit.method` when UntangleIt is installed. |
| `deeptest.api.status` | silent | none | `{ checked: boolean, at, ready, verdict, coverage, densityPassRate, untestedLines, shortLines, complexFunctions: [{ path, name, startLine, endLine, complexity, campbell, mbcc, limit }] }` from the last check, without running one. `complexity` is ways through (cyclomatic); `campbell` and `mbcc` are the two tangle numbers (from 0.4.0). |
| `deeptest.api.check` | silent | `{ }` | Runs a check and returns the same shape as status. Long-running; the caller shows its own progress. |
| `deeptest.api.function` | silent | `{ path, startLine }` | All three numbers, limit, the lines inside it that are short, and the decision state for one function. What UntangleIt asks before and after it untangles. |
| `deeptest.api.decisions` | silent | none | The decisions file as data. |

### 3.3 UntangleIt

| Command | Kind | Arguments | Result |
|---|---|---|---|
| `untangleit.method` | interactive | `{ path, startLine }` | The full loop on one method: show, checkpoint, confirm, transform, verify, report. What DeepTest's "Break it into smaller pieces" calls when UntangleIt is installed. |
| `untangleit.worst` | interactive | none | The loop on the most tangled method in the workspace. |
| `untangleit.api.measure` | silent | `{ path }` | Methods in the file with all three numbers: `{ name, startLine, endLine, cyclomatic, campbell, mbcc, waysThrough, over }`. `waysThrough` equals `cyclomatic` and stays for callers written against 0.1.x; `over` is `mbcc` above the limit (0 when within). (0.1.x returned `waysThrough` and an `over` on ways through; from 0.1.11 all three, measured by the shared library, and `over` on tangle.) The result's `limit` is the tangle limit. |
| `untangleit.api.plan` | silent | `{ path, startLine, limit }` | What the mechanical engine would do, as a list of steps, without doing it. Lets a caller show the plan before the gates. |

## 4. Records on disk

The slow channel, and the only way to read history. Each tool owns one folder at the workspace root and writes only there. Files listed here are public; their shape carries a `version` field and changes only additively.

| Tool | Folder | Public files | Meaning |
|---|---|---|---|
| KeepSafe | `.keepsafe/` | `checkpoints/<id>/manifest.json`, `checkpoints/<id>/checkpoint.txt` | One folder per checkpoint; the id is a sequence-prefixed slug; the manifest is structured metadata (documented in KeepSafe's README, so reading it is within its published contract). `index.sqlite3` and `blobs/` are private. |
| DeepTest | `.deeptest/` | `decisions.json`, `last-check.json` (proposed) | The person's decisions, meant to be committed; the last verdict and its numbers, with the id of the newest KeepSafe checkpoint at the time if one exists. `coverage/` and `attribution/` are private and regenerated. |
| UntangleIt | `.untangleit/` | `runs.json` | One entry per run: method, before and after numbers, pieces produced, verified or stopped and why. |

This is how a verdict gets attached to a checkpoint without touching KeepSafe: DeepTest reads the newest `manifest.json` after a check and writes its id into `last-check.json`. A later tool that wants "restore the last state DeepTest called ready" joins the two files and calls `keepsafe.restoreCheckpoint`, where the person picks the named checkpoint.

## 5. Events

VS Code has no event bus between extensions, so there are two ways to be told something happened, and callers pick by need:

- **Watch the records.** `vscode.workspace.createFileSystemWatcher` on a sibling's public files. This is how a tool learns a KeepSafe checkpoint was taken (a new `manifest.json`) or that DeepTest finished a check (`last-check.json` changed). Works with KeepSafe unmodified.
- **Exports, for tools built to this document.** A tool returns an object from `activate` with `onDidCheck`, `onDidDecide`, and the same functions as its silent commands. A caller reads it through `getExtension(id).exports` after `activate()`. Exports are a convenience over the commands, never a replacement: everything reachable through exports is reachable through a command, so a tool written in another language or process is not shut out.

## 6. The three flows: two built, one next

**Hand-off with an undo (built).** DeepTest checks `KeepSafe.keepsafe` is installed and `deeptest.keepSafe.offerCheckpoint` is on; offers; on yes calls `keepsafe.quickCheckpoint`; then the modal; then the brief. If the command throws, DeepTest says KeepSafe could not create the checkpoint and sends nothing.

**Untangle from DeepTest (built, DeepTest 0.4.3 and UntangleIt 0.1.9, 2026-09-11).** On "Break it into smaller pieces", DeepTest checks for `prs.untangleit`. If present, it calls `untangleit.method` with `{ path, startLine }` (path relative to the workspace folder) and stops; UntangleIt runs its own gates and its own report, and DeepTest records no decision because the person has not yet said yes. If absent, DeepTest uses its own brief and gates, and its setup screen recommends UntangleIt once, with a link. UntangleIt measures the file on demand when the method is not in its last measure, so the call works on a fresh editor. Either way DeepTest judges on the next check. The refactor brief in DeepTest stays as the not-installed fallback.

**Verdict on a checkpoint (next).** After each check DeepTest writes `last-check.json` including the newest KeepSafe checkpoint id. No new KeepSafe surface needed.

## 7. Versioning and compatibility

`protocol` is an integer, currently 1, in the `prsToolkit` block and in every silent result. A caller checks it before trusting field names. A tool supports every protocol version it has ever published for its own commands. Tools do not require sibling versions; they require protocol numbers, and degrade to the recommendation when a sibling is too old to answer.

## 8. Open questions

1. Should KeepSafe's fixed entry live in one shared, copied file (`src/siblings/keepsafe.ts` in every tool) or be generated from this document? Copied is simpler and matches "no shared code".
2. `last-check.json`: commit it or ignore it? It is history, like decisions, but it changes on every run.
3. Whether silent commands should accept a `folder` argument for multi-root workspaces, given KeepSafe always acts on the first folder.
4. A toolkit-wide status command that any tool answers with its verb and version, so a future dashboard can list what is installed.

## 9. The pack

VS Code extension packs bundle independent extensions under one Marketplace page: a pack is an extension whose `package.json` lists ids in `extensionPack`, and the bundled extensions stay independently installable (Microsoft's own rule for packs: no functional dependency on the members). The toolkit ships one, `prs.MADTPackage` (folder and repo `MADTPackage`, display name "MikeVan's AI Development Toolkit"), containing only the list, an icon, and a README with the thesis and the three verbs: `KeepSafe.keepsafe`, `prs.deeptest`, `prs.untangleit`. It carries no code and changes nothing about how the tools talk; it changes how they are found. The pack itself installs as a fourth extension in the person's editor, which is where its icon and README are seen, and uninstalling it is how all three members are removed at once.

Marketplace mechanics learned on 2026-09-11: the `icon` PNG ships inside the VSIX and serves both the Extensions list and the details page; README images are not read from the VSIX but rewritten by the packager to raw GitHub URLs from the `repository` field, so they show only once pushed. A display name too close to an existing listing is refused at upload. DeepTest packages with `--no-dependencies` because `@projectrevivesolutions/complexity` is a `file:../complexity` link that the packager would otherwise follow out of the project; the library is bundled into `dist/extension.js` by esbuild, so nothing from `node_modules` is needed.

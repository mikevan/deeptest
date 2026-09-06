# PRS AI development toolkit: how the tools talk to each other

Draft 2, 2026-09-06. Publisher: `prs` (Project Revive Solutions, LLC). Companion to toolkit-architecture.md. This is the contract between tools. Anything not written here is private to a tool and may change without notice.

## 1. The rules

1. Tools talk through four channels and nothing else: discovery, commands, records on disk, and events. No shared code, no imports across tools, no reaching into a sibling's storage except the files this document lists.
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
| Refactor It | `prs.refactorit` (proposed) | untangle |
| The pack | `prs.toolkit` (proposed, section 9) | none; it only lists the others |

Tools built to this document also declare themselves in `package.json` so a future tool can find every sibling without a hard-coded list:

```json
"prsToolkit": {
  "protocol": 1,
  "verb": "measure and judge",
  "commands": ["deeptest.api.status", "deeptest.api.check", "deeptest.api.function"],
  "records": [".deeptest/decisions.json", ".deeptest/last-check.json"]
}
```

A caller reads this through `extension.packageJSON.prsToolkit`. KeepSafe has no such block and never will; callers carry a fixed entry for it. That is the one exception, and it is written down here so it is not copied.

## 3. Commands

Commands are the live channel: `vscode.commands.executeCommand(name, args)` with one plain JSON object in, one plain JSON object out. Executing a command activates the callee if it is installed but not yet running.

Two kinds, distinguished by name:

- `<tool>.<verb>`: **interactive**. Talks to the person: shows a notification, a quick pick, a modal, or a screen. Callers use these when the person should see the sibling's own words. They may return nothing. KeepSafe's commands are all of this kind.
- `<tool>.api.<name>`: **silent**. Never prompts, never opens a screen, always returns a result object. Callers use these to ask questions and to run work whose gates the caller has already passed. The caller is responsible for the gates.

Every silent result has the same envelope:

```json
{ "protocol": 1, "tool": "deeptest", "version": "0.3.6", "ok": true, "result": { } }
{ "protocol": 1, "tool": "deeptest", "version": "0.3.6", "ok": false, "error": "Check your code first, and then decide about its functions." }
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
| `deeptest.fixFunction` | interactive | `{ path, line }` | The choice, the gates, the hand-off for one function. The refactor choice routes to `refactorit.method` when Refactor It is installed. |
| `deeptest.api.status` | silent | none | `{ checked: boolean, at, ready, verdict, coverage, densityPassRate, untestedLines, shortLines, complexFunctions: [{ path, name, startLine, endLine, complexity, limit }] }` from the last check, without running one. |
| `deeptest.api.check` | silent | `{ }` | Runs a check and returns the same shape as status. Long-running; the caller shows its own progress. |
| `deeptest.api.function` | silent | `{ path, startLine }` | Complexity, limit, the lines inside it that are short, and the decision state for one function. What Refactor It asks before and after it untangles. |
| `deeptest.api.decisions` | silent | none | The decisions file as data. |

### 3.3 Refactor It (proposed)

| Command | Kind | Arguments | Result |
|---|---|---|---|
| `refactorit.method` | interactive | `{ path, startLine }` | The full loop on one method: show, checkpoint, confirm, transform, verify, report. What DeepTest's "Break it into smaller pieces" calls when Refactor It is installed. |
| `refactorit.worst` | interactive | none | The loop on the most tangled method in the workspace. |
| `refactorit.api.measure` | silent | `{ path }` | Methods in the file with their ways through. |
| `refactorit.api.plan` | silent | `{ path, startLine, limit }` | What the mechanical engine would do, as a list of steps, without doing it. Lets a caller show the plan before the gates. |

## 4. Records on disk

The slow channel, and the only way to read history. Each tool owns one folder at the workspace root and writes only there. Files listed here are public; their shape carries a `version` field and changes only additively.

| Tool | Folder | Public files | Meaning |
|---|---|---|---|
| KeepSafe | `.keepsafe/` | `checkpoints/<id>/manifest.json`, `checkpoints/<id>/checkpoint.txt` | One folder per checkpoint; the id is a sequence-prefixed slug; the manifest is structured metadata (documented in KeepSafe's README, so reading it is within its published contract). `index.sqlite3` and `blobs/` are private. |
| DeepTest | `.deeptest/` | `decisions.json`, `last-check.json` (proposed) | The person's decisions, meant to be committed; the last verdict and its numbers, with the id of the newest KeepSafe checkpoint at the time if one exists. `coverage/` and `attribution/` are private and regenerated. |
| Refactor It | `.refactorit/` | `runs.json` (proposed) | One entry per run: method, before and after ways through, pieces produced, verified or stopped and why. |

This is how a verdict gets attached to a checkpoint without touching KeepSafe: DeepTest reads the newest `manifest.json` after a check and writes its id into `last-check.json`. A later tool that wants "restore the last state DeepTest called ready" joins the two files and calls `keepsafe.restoreCheckpoint`, where the person picks the named checkpoint.

## 5. Events

VS Code has no event bus between extensions, so there are two ways to be told something happened, and callers pick by need:

- **Watch the records.** `vscode.workspace.createFileSystemWatcher` on a sibling's public files. This is how a tool learns a KeepSafe checkpoint was taken (a new `manifest.json`) or that DeepTest finished a check (`last-check.json` changed). Works with KeepSafe unmodified.
- **Exports, for tools built to this document.** A tool returns an object from `activate` with `onDidCheck`, `onDidDecide`, and the same functions as its silent commands. A caller reads it through `getExtension(id).exports` after `activate()`. Exports are a convenience over the commands, never a replacement: everything reachable through exports is reachable through a command, so a tool written in another language or process is not shut out.

## 6. The three flows that exist or are next

**Hand-off with an undo (built).** DeepTest checks `KeepSafe.keepsafe` is installed and `deeptest.keepSafe.offerCheckpoint` is on; offers; on yes calls `keepsafe.quickCheckpoint`; then the modal; then the brief. If the command throws, DeepTest says KeepSafe could not create the checkpoint and sends nothing.

**Refactor from DeepTest (next).** On "Break it into smaller pieces", DeepTest checks for `prs.refactorit`. If present, it calls `refactorit.method` with `{ path, startLine }` and stops; Refactor It runs its own gates and its own report. If absent, DeepTest shows the recommendation. The refactor brief that lives in DeepTest today moves to Refactor It (decision of 2026-09-06). Either way DeepTest judges on the next check.

**Verdict on a checkpoint (next).** After each check DeepTest writes `last-check.json` including the newest KeepSafe checkpoint id. No new KeepSafe surface needed.

## 7. Versioning and compatibility

`protocol` is an integer, currently 1, in the `prsToolkit` block and in every silent result. A caller checks it before trusting field names. A tool supports every protocol version it has ever published for its own commands. Tools do not require sibling versions; they require protocol numbers, and degrade to the recommendation when a sibling is too old to answer.

## 8. Open questions

1. Should KeepSafe's fixed entry live in one shared, copied file (`src/siblings/keepsafe.ts` in every tool) or be generated from this document? Copied is simpler and matches "no shared code".
2. `last-check.json`: commit it or ignore it? It is history, like decisions, but it changes on every run.
3. Whether silent commands should accept a `folder` argument for multi-root workspaces, given KeepSafe always acts on the first folder.
4. A toolkit-wide `prs.toolkit.status` command that any tool answers with its verb and version, so a future dashboard can list what is installed.

## 9. The pack

VS Code extension packs bundle independent extensions under one Marketplace page: a pack is an extension whose `package.json` lists ids in `extensionPack`, and the bundled extensions stay independently installable (Microsoft's own rule for packs: no functional dependency on the members). The toolkit ships one, `prs.toolkit`, containing only the list, an icon, and a README with the thesis and the three verbs: `KeepSafe.keepsafe`, `prs.deeptest`, `prs.refactorit`. It carries no code and changes nothing about how the tools talk; it changes how they are found.

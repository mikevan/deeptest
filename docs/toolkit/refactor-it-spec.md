# Refactor It: one-page spec

Draft 2, 2026-09-06. A tool in the PRS AI development toolkit (`prs.refactorit`), beside KeepSafe and DeepTest. Written before any code, so the shape can be argued with.

## Decision recorded 2026-09-06

Refactoring is its own tool. DeepTest's `fixFunction` refactor branch and the refactor mode of `buildFunctionBrief` (src/report/brief.ts and src/decisions/commands.ts in DeepTest) are Refactor It's seed. They are to be pulled out into this tool and fixed here, not patched in DeepTest. DeepTest keeps the question ("visitStatement() has 48 ways through it") and the door ("Break it into smaller pieces"); behind the door will be `refactorit.method`.

## The first field result, and what it teaches

Run against DeepTest's own `visitStatement()` (48 ways through, limit 10), the seed brief produced a refactor that reduced the count by 10 instead of down to 10. The brief said "at most 10 ways through" in plain words and the assistant still did the wrong arithmetic. Lesson for the design: a brief is not a loop. Refactor It must measure after every transform and go again until every piece is within the limit, and it must report the numbers per piece; it cannot trust the assistant to have understood the target, however plainly it was stated. This is the strongest argument for the mechanical engine measuring, and for the loop below being enforced by the tool rather than described to the assistant.

## The verb

Refactor It untangles one method at a time. Its whole job: take a method whose complexity is above the limit, and leave behind a set of methods that do exactly the same thing, each within the limit. It does not test (DeepTest does), it does not remember (KeepSafe does), and it does not decide (the human does).

Target user: Jeff, a CPA vibe-coding an accounting tool. He will never read the code. He needs to know that a method is too tangled to trust, what untangling it would change (nothing, if done right), and whether it worked.

## What "too tangled" means

Cyclomatic complexity per method, the same count DeepTest already makes: one, plus one for every decision inside the method. The limit defaults to 5 and is configurable. In Jeff's words: "ways through it". A method with 48 ways through it is a spreadsheet formula with 48 nested IFs.

## The loop

One method per run, human at every gate.

1. Show. Name the method, its ways through, the limit, and what a responsible refactor would and would not change. Offer "Untangle it" and "Leave it".
2. Checkpoint. If KeepSafe is installed, offer a checkpoint through KeepSafe's public command, the same way DeepTest does. That is the undo.
3. Confirm. One modal sentence: what is about to happen, who does the work, and that Refactor It measures afterwards and does not accept the result for anyone.
4. Transform. Extract until the method and every method produced from it are within the limit. Behaviour is the contract: same inputs, same outputs, same errors, same side effects, in the same order. If a step cannot be taken without changing behaviour, stop and say why in plain words.
5. Verify. Run the project's own test suite through the project's own runner, exactly as DeepTest does. Existing tests must pass unedited. Then measure every piece. If any piece is still over the limit, go back to step 4 for that piece, up to a configurable number of rounds; then report. Report per piece: name, ways through, within the limit or not.
6. Decide. Keep it, or restore the checkpoint. Refactor It never restores on its own.

## What it never does

It never refactors more than one method per confirmation. It never edits a test. It never adds behaviour or removes it. It never proceeds past a failing suite. It never accepts its own result: the report says what changed and what the numbers are now, and the human keeps or restores.

## Who does the transforming

Two engines behind one interface, chosen by what is available and configurable:

- Mechanical extraction from the syntax tree, for the transforms that are provably behaviour-preserving (extract method, replace nested conditional with guard clauses, split a switch into a dispatch table). No AI, no key, no network.
- The user's own AI assistant, for the rest, handed a brief as strict as DeepTest's, with the mechanical engine measuring and the suite verifying afterwards. The seed brief from DeepTest is the first version of this brief.

The design default for this toolkit is to prefer the AI engine where it fits; the mechanical engine exists for the cases where a proof is available and an AI is not needed, and it is always the one that measures.

## The language contract

The same shape as DeepTest's, and for the same reason: one abstraction layer so six languages get an identical look and feel. A language plugin supplies: parse a file to methods with complexity; extract a range into a new method with the right parameters and return; the safe transforms it can prove; and how to run the project's tests. First languages match DeepTest's: TypeScript/JavaScript and Python, then Java, C#, C++, then PHP or Go.

## Integration surface

Per toolkit-api.md. Public commands only. No shared code, nothing imported from a sibling.

- `refactorit.method` (interactive) with `{ path, startLine }`: run the loop on one method. This is what DeepTest's "Break it into smaller pieces" calls when Refactor It is installed.
- `refactorit.worst` (interactive): the loop on the workspace's most tangled method.
- `refactorit.api.measure` (silent) with `{ path }`: methods in the file with their ways through.
- `refactorit.api.plan` (silent) with `{ path, startLine, limit }`: what the mechanical engine would do, without doing it.
- It calls `keepsafe.quickCheckpoint` when KeepSafe is installed and the setting is on, and says nothing about KeepSafe otherwise, except a recommendation with a link on its setup screen.
- After a run it does not call DeepTest; it tells the user to press "Check my code again" in DeepTest if DeepTest is installed.

## Configuration

Common to the toolkit: language, tests folder, source root, detected and pre-filled. Its own: the limit (default 5), whether to offer a KeepSafe checkpoint (default on), which engine to prefer, and how many rounds of transform-and-measure before it stops and reports. Engineer's numbers behind the same "Show the engineer's numbers" switch.

## Words

Plain first, every sentence complete, every control named as labelled. "calc() has 48 ways through it. Your limit is 5." "Untangled into 7 pieces. Every piece is within your limit. All 168 tests still pass." "Stopped at step 3: splitting this part would change what happens when the total is negative. Nothing was changed." "After 3 rounds, visitStatement() still has 14 ways through it. Your call."

## Open questions for the discussion

1. Is one method per confirmation the right grain, or should a run be allowed to walk a whole file with one confirmation and a checkpoint per method?
2. Should the mechanical engine ship first, so the tool works with no AI at all, or should the AI engine ship first because it covers more? The field result above argues for the mechanical engine measuring from day one, whichever transforms first.
3. Where does behaviour verification stop: the existing suite only, or should Refactor It generate characterization tests before transforming a method that has none?
4. Does the dispatch-table transform for large switches belong here, given DeepTest's counting rule for switch cases is itself under review?
5. Naming: "Refactor It" as the product name, and the verb on the button.

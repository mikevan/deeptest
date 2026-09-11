# RefactorIt: spec

Draft 3, 2026-09-06. A tool in MikeVan's AI Development Toolkit (`prs.refactorit`), beside KeepSafe and DeepTest. Written before any code, so the shape can be argued with.

## Decision recorded 2026-09-06

Refactoring is its own tool. DeepTest's `fixFunction` refactor branch and the refactor mode of `buildFunctionBrief` (src/report/brief.ts and src/decisions/commands.ts in DeepTest) are RefactorIt's seed. They are to be pulled out into this tool and fixed here, not patched in DeepTest. DeepTest keeps the question ("visitStatement() has 48 ways through it") and the door ("Break it into smaller pieces"); behind the door will be `refactorit.method`.

## The first field result, and what it teaches

Run against DeepTest's own `visitStatement()` (48 ways through, limit 10), the seed brief produced a refactor that reduced the count by 10 instead of down to 10. The brief said "at most 10 ways through" in plain words and the assistant still did the wrong arithmetic. Lesson for the design: a brief is not a loop. RefactorIt must measure after every transform and go again until every piece is within the limit, and it must report the numbers per piece; it cannot trust the assistant to have understood the target, however plainly it was stated. This is the strongest argument for the mechanical engine measuring, and for the loop below being enforced by the tool rather than described to the assistant.

## The verb

RefactorIt untangles one method at a time. Its whole job: take a method whose complexity is above the limit, and leave behind a set of methods that do exactly the same thing, each within the limit. It does not test (DeepTest does), it does not remember (KeepSafe does), and it does not decide (the human does).

Target user: Jeff, a CPA vibe-coding an accounting tool. He will never read the code. He needs to know that a method is too tangled to trust, what untangling it would change (nothing, if done right), and whether it worked.

## What "too tangled" means (revised in draft 3)

Draft 1 used cyclomatic complexity (McCabe 1976; see Sources), the same fork count DeepTest makes. Michael's objection, 2026-09-06: McCabe should measure depth of complexity; a flat switch is long, not tangled; the community settled on the easy path count. The first field runs showed it: three flat message switches at the top of the list with 28, 28, and 23 ways through, none of them hard to follow.

From 0.2.0 the tangle measure is Cognitive Complexity (Campbell 2018; rules verified from the whitepaper, see Sources): one for each break in linear flow, one more for each level of nesting a flow-breaking structure sits inside, one for a whole `switch` regardless of cases, one per `else`/`else if` without a nesting charge, one per method in a recursion cycle, nothing for null-coalescing, `try`, or `finally`. One departure from the published rule, Michael's: a sequence of the same boolean operator counts once only when its operands are independent and pure; when order carries meaning (a later operand depends on an earlier guard, or an operand contains a call or an assignment), it counts one per operand, because the reader must understand the short-circuit to understand the code. The scorer detects this from the syntax tree (calls, assignments, member access on something an earlier operand tested) and the engineering notes say what it cannot detect.

Ways through (cyclomatic) stays beside tangle behind the engineer's-numbers switch and in the records, so the two never disagree silently. DeepTest keeps ways through and routes for its test bar, because every fork is a path a test must reach; RefactorIt uses tangle for its list, because a person's ability to follow the method is what untangling is for. The two tools' "worst" rows will sometimes name different methods; that is correct.

The limit defaults to 15 (SonarSource's default for cognitive complexity per method) and is configurable. In Jeff's words: "tangle". A method with a tangle of 48 is a spreadsheet formula with IFs nested inside IFs until nobody can check it.

## The loop

One method per run, human at every gate.

1. Show. Name the method, its ways through, the limit, and what a responsible refactor would and would not change. Offer "Untangle it" and "Leave it".
2. Checkpoint. If KeepSafe is installed, offer a checkpoint through KeepSafe's public command, the same way DeepTest does. That is the undo.
3. Confirm. One modal sentence: what is about to happen, who does the work, and that RefactorIt measures afterwards and does not accept the result for anyone.
4. Transform. Extract until the method and every method produced from it are within the limit. Behaviour is the contract: same inputs, same outputs, same errors, same side effects, in the same order. If a step cannot be taken without changing behaviour, stop and say why in plain words.
5. Verify. Run the project's own test suite through the project's own runner, exactly as DeepTest does. Existing tests must pass unedited. Then measure every piece. If any piece is still over the limit, go back to step 4 for that piece, up to a configurable number of rounds; then report. Report per piece: name, ways through, within the limit or not.
6. Decide. Keep it, or restore the checkpoint. RefactorIt never restores on its own.

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

- `refactorit.method` (interactive) with `{ path, startLine }`: run the loop on one method. This is what DeepTest's "Break it into smaller pieces" calls when RefactorIt is installed.
- `refactorit.worst` (interactive): the loop on the workspace's most tangled method.
- `refactorit.api.measure` (silent) with `{ path }`: methods in the file with their ways through.
- `refactorit.api.plan` (silent) with `{ path, startLine, limit }`: what the mechanical engine would do, without doing it.
- It calls `keepsafe.quickCheckpoint` when KeepSafe is installed and the setting is on, and says nothing about KeepSafe otherwise, except a recommendation with a link on its setup screen.
- After a run it does not call DeepTest; it tells the user to press "Check my code again" in DeepTest if DeepTest is installed.

## Configuration

Common to the toolkit: language, tests folder, source root, detected and pre-filled. Its own: the limit (default 5), whether to offer a KeepSafe checkpoint (default on), which engine to prefer, and how many rounds of transform-and-measure before it stops and reports. Engineer's numbers behind the same "Show the engineer's numbers" switch.

## Words

Plain first, every sentence complete, every control named as labelled. "calc() has 48 ways through it. Your limit is 5." "Untangled into 7 pieces. Every piece is within your limit. All 168 tests still pass." "Stopped at step 3: splitting this part would change what happens when the total is negative. Nothing was changed." "After 3 rounds, visitStatement() still has 14 ways through it. Your call."

## Class-level tangle: LCOM4 (planned, 0.3.0)

Michael's principle: a class with more than one design intent is bad. LCOM4 (Hitz and Montazeri 1995; see Sources) counts it: every method and field is a node, a method is joined to each field it touches and each method it calls, and the number of connected components is the score. One means one thing; two or more means that many classes sharing a name. Jeff's sentence: "This class does 3 unrelated jobs. Each one should be its own class." Same loop: the brief asks for a split into one class per island keeping every public signature; done means every resulting class scores 1 and the suite passes. Adjustments built in from the start: constructors and trivial accessors are left out of the graph; inherited fields need the parent visible, and the tool says "could not see the parent" when it cannot; a class with no fields scores one island per method and is worded as "a namespace, not a class". In Python and TypeScript a module of functions sharing module-level variables is the same shape and is measured the same way.

## Recommendations: combining the signals (planned, 0.3.0)

The tool must make the right suggestion, not just the loudest one. Four signals, each answering one question, and a table of rules checked in order. Never a blended score: a score gives Jeff a number he cannot argue with; a rule gives him a sentence he can check.

Signals: tangle and ways through (RefactorIt's parse); density and coverage per line (DeepTest's record or silent command, read through the records channel per toolkit-api.md); LCOM4 (RefactorIt's parse of the class); and change history from git, which is already on disk and costs nothing: how often a method changes, and whether a switch has grown case by case in separate commits. History is the only way to tell a fixed list from an extension point.

Rules, in order:

1. LCOM4 above 1: "Split this class into N before untangling anything in it." Method cards inside the class wait; untangling a method that is about to move is wasted work.
2. Tangled and its lines untested in DeepTest: "Test it first." The refactor is unverifiable without a contract. The card opens DeepTest's door; untangling is offered once the lines have their tests. This is the one place the two tools hand a person back and forth.
3. Tangled and tested: "Untangle it." The loop as built.
4. High ways through, low tangle (a flat dispatch), stable in history: "Leave it," with the reason. RefactorIt refuses to send it as an extraction job; seventeen two-line methods would make it worse and slower (a switch compiles to a jump table; a chain of compare objects is ten indirect calls and ten cache lines).
5. High ways through, low tangle, cases added in separate commits over time: an extension point. Offer the one transform that fits, a dispatch table or one class per choice, with the speed trade-off stated in one sentence.
6. A long boolean chain where order carries meaning: not extracted into pieces; named. "Extract the condition into a method that says what it checks." A paragraph-long brief.
7. Recursion or deep nesting: sent for untangling, and the brief names which kind of tangle it is, because "flatten these guards" and "unwind this recursion" are different jobs.

The recommendation is one line on the card above the buttons. It lives in RefactorIt because it is about what to untangle and how; DeepTest stays the judge of tests, KeepSafe stays the undo. Nothing in DeepTest changes except that "Test it first" can arrive from a sibling.

## Open questions for the discussion

1. Is one method per confirmation the right grain, or should a run be allowed to walk a whole file with one confirmation and a checkpoint per method?
2. Should the mechanical engine ship first, so the tool works with no AI at all, or should the AI engine ship first because it covers more? The field result above argues for the mechanical engine measuring from day one, whichever transforms first.
3. Where does behaviour verification stop: the existing suite only, or should RefactorIt generate characterization tests before transforming a method that has none?
4. Does the dispatch-table transform for large switches belong here, given DeepTest's counting rule for switch cases is itself under review?
5. Naming: settled, "RefactorIt", one word.
6. How many separate commits adding cases make a switch an extension point (proposed: three).
7. Whether "Test it first" should let Jeff override and untangle anyway, with the card saying the result cannot be verified.

## Sources

Every fact above that is not the toolkit's own design comes from one of these. Links were fetched and checked on 2026-09-06.

- Campbell, G. Ann. *Cognitive Complexity: A New Way of Measuring Understandability.* SonarSource, 2018. https://www.sonarsource.com/docs/CognitiveComplexity.pdf. (The three principles, the increment rules, the switch and boolean-sequence rules, and the exclusions for null-coalescing, try, and finally are quoted from this document.)
- McCabe, Thomas J. "A Complexity Measure." *IEEE Transactions on Software Engineering*, vol. SE-2, no. 4, Dec. 1976, pp. 308-320. https://doi.org/10.1109/TSE.1976.233837. Summary and the recommended limit of 10 as reported in "Cyclomatic Complexity," *Wikipedia*, https://en.wikipedia.org/wiki/Cyclomatic_complexity.
- Hitz, Martin, and Behzad Montazeri. "Measuring Coupling and Cohesion in Object-Oriented Systems." *Proceedings of the International Symposium on Applied Corporate Computing*, Monterrey, Mexico, 25-27 Oct. 1995. Definition of LCOM4 as connected components, and the rule that constructors are left out because they connect every method through the fields they initialise, as reported in Aivosto Oy, "Cohesion Metrics," *Project Analyzer Help*, https://www.aivosto.com/project/help/pm-oo-cohesion.html.
- Tornhill, Adam. *Your Code as a Crime Scene: Use Forensic Techniques to Arrest Defects, Bottlenecks, and Bad Design in Your Programs.* Pragmatic Bookshelf, 2015. (The hotspot idea: change frequency from version control combined with a complexity measure.)
- "Extension Manifest." *Visual Studio Code API Reference*, Microsoft. https://code.visualstudio.com/api/references/extension-manifest. (The `extensionPack` and `extensionDependencies` fields and the rule that a pack has no functional dependency on its members.)

Not yet verified against a primary source, and marked as such in the text: the claim that a dense switch compiles to a jump table and a sparse one to a binary search, and the cost of megamorphic virtual calls under a JIT; these are standard compiler-engineering results and the citation is owed.

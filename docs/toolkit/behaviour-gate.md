# The UntangleIt behaviour gate

Michael Van Geertruy, with Claude. Project Revive Solutions, LLC.

Draft 2, 2026-09-22, frozen, with section 5 corrected on 2026-09-23 to match what was built. Draft 1 was frozen earlier the same day and is superseded whole. It placed the gate around a transform UntangleIt performs itself, which is not the workflow: UntangleIt has handed the edit to the editor's assistant since 0.1.11, and a continuity check against that release found the workflow files byte-identical in 1.0.18. Draft 2 places the gate inside the workflow that exists, and adds Python. Companion to untangle-it-spec.md and witness.md. Changing sections 2 through 7 means a new draft and a new ruling, not an edit.

The correction is documentation catching up with the implementation, not a change of design. Both recorders and the record schema live in Witness, because Witness owns instrumentation delivery and behaviour recording across the supported runners and languages. Building the gate proved why: UntangleIt had no way to get instrumented code in front of any JavaScript runner, and the way to get it there was the one DeepTest already used. That machinery is now Witness's, both tools consume it, and neither tool requires the other.

## 1. What it is for

UntangleIt hands a brief to the person's assistant, the assistant restructures a method, and the person presses "Measure again". The loop already measures whether the tangle came down. It does not ask whether the method still does the same thing, and a suite reporting green does not answer that either, because a suite that never reached the method reports green whatever happened to it.

The gate answers it from recorded behaviour: called the way the project's own tests already call it, does the method still do what it did?

## 2. Where it sits, and what it does not touch

The workflow does not change. Not one button, not one sentence of the modal, not the order of the gates.

At the existing "Yes, send it", after the person has confirmed and before the brief reaches the clipboard and the editor chat, UntangleIt records the selected method's boundary while the project's own tests run.

The hand-off then proceeds exactly as it does today. The brief goes to the clipboard, `workbench.action.chat.open` gets it, the assistant changes the code, and UntangleIt waits.

At the existing "Measure again", UntangleIt records the boundary a second time, beside the test run and the tangle measurement it already performs there, and compares.

UntangleIt does not edit source. It does not restore anything. It removes no permission point and adds no new one. KeepSafe and the person keep control exactly as they have it today.

## 3. The boundary, and the problem this design refuses to solve

The gate watches the selected method's boundary and nothing else. It does not map the original onto the pieces it became. If one method becomes five, including a helper shared with another caller, the gate has no opinion about any of the five. It watches the same entry point the tests already call.

That is the whole simplification. Mapping an untangled method onto its pieces is the hard problem, and after a good restructuring there is often no correspondence left to find. Nothing here needs one.

The boundary has to be found again after the gap, because the assistant moved it and nothing here knows where. It is located by name within its enclosing container in the same file. If that does not resolve to exactly one function, the gate compares nothing and reports insufficient evidence with the reason `target-not-found`.

## 4. What is recorded

One observation per entry to the boundary. A recursive method produces one per entry, which is correct.

Each observation carries the test that was running, an index within that test, the nesting depth, the arguments at entry, and the outcome. An outcome has a kind, one of returned, threw, or rejected, and a value. Entry itself is recorded, so a method entered and never left is visible rather than missing.

**Arguments are snapshotted at entry, by copy.** A method that mutates what it was handed would otherwise be compared against its own mutation, and every such method would report equivalent no matter what changed.

Observations are paired between the two runs by test identity, index, and depth. Three rules keep instability visible instead of silent: different observation counts for a test cannot pair; paired observations whose arguments differ cannot pair, because the tests did not change and a call arriving with different arguments means something reordered; and concurrent calls within one test that make the index unstable cannot pair. All three are insufficient evidence. The gate never guesses a match.

## 5. One record schema, two recorders

The comparator and the verdict never learn which language produced a record. Values are recorded in a tagged, language-neutral form, and a recorder's job is to produce that form or to say it cannot.

Comparable: numbers, strings, booleans, null, undefined where the language has it, arrays, and plain objects or dictionaries with string keys. `Date` and Python's timezone-aware `datetime` record as an instant. `RegExp` and Python's compiled pattern record as their source and flags. A naive Python `datetime` is uncomparable, because its instant is ambiguous.

Uncomparable, recorded with the reason rather than guessed at: class instances, functions, symbols, Maps, Sets, Python sets and bytes, promises or awaitables held as values, interface nodes, sockets, file handles, framework objects, anything cyclic, and anything whose identity rather than its contents is the point. Timing and randomness are uncomparable by nature.

Two bounds, and crossing either makes the value uncomparable with the specific reason `depth-limit` or `node-limit`: maximum depth 20, maximum visited nodes per captured value 10,000. A value is never truncated and then compared in its truncated form.

One known limit of holding both languages to one schema: a Python list and a Python tuple both record as an array, because JavaScript has no tuple. A change from one to the other is not detected. That is the price of one comparator and one meaning of equivalent, and it is worth it.

Outcomes compare by kind first, so returning where the method used to throw is a change. Thrown and rejected outcomes then compare by the error's type name and its message. Stacks are not compared.

**JavaScript and TypeScript.** A separate Witness entry point, `instrumentBoundary`, distinct from the counter instrumentation: the normal pass instruments an executable universe, this instruments exactly one function, and the lifecycles and record shapes are different. It rewrites one file, line for line, and a boundary runtime writes the records. Its only dependency on the existing runtime is the test that is running, which Witness already exposes.

**Python.** A pytest plugin of Witness's, copied into the calling tool's own folder and passed to the run, which wraps the target by module and qualified name and takes the test identity from the pytest node id. There is nothing existing to reuse here: DeepTest measures Python through coverage.py's dynamic contexts, which gives per-test line attribution and no arguments, returns, or exceptions.

Where the target is a method and the caller knows only the file and the name, the plugin searches the module for exactly one holder of that name. Two holders is a question for the caller, never a guess, and the gate then reports that it could not find the method.

Recorded runs write no bytecode. The two runs happen seconds apart on a file the assistant has just edited, and CPython decides a cached `.pyc` is current from the source's size and its modification time to the second, so an edit of the same length inside the same second is invisible: the second run imports the first run's bytecode and reports that nothing changed. That is the one answer this gate must never give, and it took a failing proof case to see it.

**The record schema belongs to Witness**, because Witness owns both recorders. Everything that reads a record reads one schema and never learns which language produced a line, which is what makes one meaning of equivalent possible across two languages. UntangleIt owns the comparator and the verdict, and neither of those knows anything about a runner, a language, or an editor.

**Playwright component tests carry a limit that predates this gate.** Playwright's own loader transforms what a test imports in the worker and short-circuits every other loader, so only code running in the page is reached. A boundary outside that path records nothing and the gate reports insufficient evidence. That is the existing Playwright limit showing through rather than a gate defect, and closing it is not this gate's job.

## 6. Async, without changing what it measures

A recorder that attaches a handler to a caller-visible promise adds a rejection handler that was not there, which changes unhandled-rejection behaviour. The recorder would then be changing the thing it is supposed to measure.

So observation happens inside the async boundary, never outside it.

A syntactically `async` JavaScript function is instrumented within its own body, where a return and a throw are exactly what the promise will settle to, and the caller-visible promise is never touched. A Python coroutine function is wrapped by a coroutine that awaits the original and records around it, which leaves exception propagation and scheduling exactly as they were.

A function that is not declared async and returns a thenable or an awaitable has its return value recorded as uncomparable, and nothing is attached to it. That can lead to insufficient evidence, and that is the correct answer rather than a purchased one.

## 7. Three outcomes

**Equivalent** means exactly this and is worded this way to the person: for the exercised tests and comparable observations, this selected boundary behaved the same before hand-off and at "Measure again". Because the gap between those two moments belongs to the person and the assistant and is unbounded, it says nothing about the rest of the file, the rest of the application, or anything else that may have changed in between, and it must never be worded as though it does.

**Changed** means the gate failed. At least one paired observation compared and disagreed. UntangleIt reports the test, the arguments, and how the outcomes differed, and does not describe the result as behaviour-verified. It restores nothing and decides nothing. The person restores, continues, or inspects, through KeepSafe and the controls they already have.

**Insufficient evidence** means the gate ran and could not decide: the boundary was never exercised, or nothing survived the comparison rules, or the runs could not be paired, or the boundary could not be found again. The gate says which. It is not a pass and not a failure, it stops any claim of verification, and the person decides.

A lack of evidence never becomes a pass. This is the same rule as DeepTest's evidence refusal in 1.0.14: a run that measured nothing is not a verdict.

## 8. The cost, said out loud

The gate runs the project's tests once at hand-off and once at "Measure again". The second run is the one the loop already performs. The first is new, and on a large suite it is real time. There is no fast path that skips it, because a before and after comparison with no before is not a comparison. The report names the cost rather than hiding it.

## 9. What proves it

A suite, not a survey run someone remembers to trigger. The Angular drivers are the standing lesson: three defects in one day, every one found by Angular rather than by us, every one in the only drivers with no end-to-end test.

Five cases, each run end to end, and each exercised for both language families unless the case is genuinely language-specific. A correct untangling reports equivalent. A changed return value reports changed. A changed thrown or rejected outcome reports changed. A method the tests never exercise reports insufficient evidence. One method split into several helpers, including a helper shared with another caller, reports equivalent.

The third and the fifth are the ones that catch a gate that only looks like it works: the third because comparing outcome kinds is easy to get wrong in a way that passes everything, and the fifth because a gate that secretly depends on a one-to-one mapping falls over exactly there.

## 10. Not in this gate

Side effects of any kind, graph or structure matching, database, network, or interface state, and anything that reasons about what code is for rather than what it did. Those belong to the next series. A gate that quietly grew any of them would be claiming more than it can show, which is the failure this toolkit exists to remove.

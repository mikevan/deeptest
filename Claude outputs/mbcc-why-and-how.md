# MikeVan's Better Cognitive Complexity: why it exists and what it is for

Michael Van Geertruy, Project Revive Solutions, LLC. Draft 2, 2026-09-12. Part of MikeVan's AI Development Toolkit.

## 1. The mission this number serves

DeepTest exists to stand in for two people a non-developer does not have: the developer who holds the whole codebase in their head, and the code reviewer who tells them what is wrong with it. A developer can look at a function and know what it does on every path. A non-developer cannot, so the tool has to represent that complete understanding of every line for them.

That mission decides what a complexity number is for. It is not a score to optimise. It is an estimate of how much a developer would have to hold in their head to vouch for a line. If a metric lets a reviewer skip a branch, it is measuring the wrong thing for this tool, whatever its academic pedigree.

## 2. Credit where it is due

Most of what follows is Campbell's work. Cognitive Complexity, as G. Ann Campbell published it for SonarSource in 2018, is the rule that does the heavy lifting in this toolkit: the nesting charges, the one point per break in flow, the recursion charge, the exclusions for `try`, `finally`, and null-coalescing, and the sensible decision that a `switch` is one thing however many cases it holds. All of that is kept exactly as published.

MBCC, MikeVan's Better Cognitive Complexity, is a playful name for a derivative rule. It changes one thing: when the order of things carries meaning, the reader pays for each thing in order. That one principle lands in two places in the count, and those two places are the only parts of MBCC that need validating. Everything else has Campbell's evidence behind it, and this document does not claim to improve on it.

## 3. The three numbers

DeepTest and UntangleIt report three numbers for every function, all computed by one shared library so the tools never disagree with each other.

**Ways through** is McCabe's cyclomatic complexity (McCabe 1976): one, plus one for every decision. It counts the paths a test must reach, and it is the only number that ever sets a test count. A flat switch with 28 cases has 29 ways through, so it needs 29 tests, one reaching each case. That is arithmetic about paths, and nothing below changes it.

**Tangle (Campbell)** is Cognitive Complexity as published: one for each break in straight-line flow, one more for each level of nesting the break sits inside, one for a whole `switch` however many cases it has, one for each `else` or `else if` with no nesting charge, and one for a run of the same boolean operator however many operands it has.

**Tangle (MBCC)** is Campbell's rule with the one change described in section 5.

## 4. What each number is for, and which tool uses it

Ways through belongs to DeepTest. Density is tests against ways through per line, the verdict is built on it, and the "Hardest to test" row and its over-limit list rank by it. Tangle has no business in any of that: it says nothing about how many tests a function needs.

Tangle belongs to UntangleIt, because tangle answers the question UntangleIt exists for: can a person follow this? UntangleIt uses MBCC in three ways. It ranks its list by MBCC over the tangle limit, so the method a reviewer would struggle with most comes first. It judges every piece after a transform by MBCC, and goes again until each piece is within the limit. And it names the kind of tangle in the brief, because "flatten these guards," "name this condition," and "unwind this recursion" are different jobs.

DeepTest carries the two tangle numbers beside every function, but only as a sanity check, not to drive coverage or density. The check works like this. Ways through says how many tests a function needs. Tangle says whether a person can follow it. When they agree, the function is simply big or simply small. When they disagree, the disagreement is the finding: high ways through with low tangle is a flat dispatcher, long but not hard; low ways through with high tangle is a nest, short and dangerous; Campbell low and MBCC much higher is a function held together by order, guards and chains, where Campbell said it was cheap and the reader pays for every step. DeepTest shows the disagreement in one sentence and points at UntangleIt's door. It does not rank by it.

If Campbell and MBCC wildly disagree, MBCC wins. Campbell is printed beside it so an engineer with SonarQube open can reconcile the two in one glance, and the report says which chain or which run of operands carried the difference. "Wildly" is pinned in the tools as MBCC exceeding Campbell by half the tangle limit or more; that is a setting, not a law, and it exists so the disagreement is flagged rather than silently absorbed.

## 5. The one change

Campbell's rule charges a run of the same boolean operator once, on the reasoning that the reader takes the run in as one thought, and charges each `else if` and `else` one point with no nesting charge, on the reasoning that a chain is one decision with a tail. Both are true when order carries nothing. Both are false when it does.

**Where order carries meaning, the reader pays per step.** That is the whole change. It shows up in two places.

**Ordered operands.** A run of `and` or `or` costs one when its operands are independent and pure. When order carries meaning, it costs one per operand. Order carries meaning when a later operand depends on an earlier one (it reaches into a name an earlier operand tested), or when any operand contains a call or an assignment, because a call may have a side effect and the reader must know whether it ran. The scorer decides this from the syntax tree. The engineering notes list what it cannot see, chiefly a pure-looking call with a hidden side effect, which it under-charges.

Worked case, at the top level of a function:

```
if user and user.name and user.name.strip():
```

Campbell: one for the `if`, one for the run. Total 2. MBCC: one for the `if`, three for the operands, because the second reaches into `user` and the third calls `strip()`. Total 4.

**Ordered branches.** In a chain of branches that test different facts, the k-th branch costs k, plus the nesting charge every branch carries. The first branch is one decision. The second is two, because it holds its own condition and the failure of the first. The third is three. A reviewer can only understand the third branch by holding the negation of the first two, and this is where the facts that drive each result get filtered, so this is where the reader's work grows with position and Campbell's charge does not.

Worked case, at the top level:

```
if total < 0:              # branch 1
    ...
elif customer.is_new:      # branch 2
    ...
elif discount_applies():   # branch 3
    ...
else:                      # branch 4
    ...
```

Campbell: one for the `if`, one each for the two `elif` and the `else`. Total 4. MBCC: 1 + 2 + 3 + 4. Total 10. The same chain nested one level deep: Campbell 5, because only the `if` picks up the nesting charge; MBCC 14, because every branch does.

**Where order carries nothing, Campbell is right and MBCC changes nothing.** A `switch` or `match` on one value, or a chain of `elif` that tests one name against constants, is exclusive by inspection: `kind == "c"` already says `kind` is not `"a"` or `"b"`, so the reader holds one discriminator and a list of outcomes, and never has to carry the earlier failures. That is depth 1, however many cases. It costs one, as Campbell has it.

```
if kind == "a":            # exclusive chain on one value
    ...
elif kind == "b":
    ...
elif kind == "c":
    ...
else:
    ...
```

Campbell 4 by the published `else if` rule; MBCC 1, the same as a `switch`, because it is one. A 28-case `switch`: Campbell 1, MBCC 1.

That last case matters enough to say plainly. Tangle measures depth. A library of 100 disconnected methods has 100 paths through the class and a depth of 1. Turning a 28-case switch into 28 methods moves the breadth around and changes the depth not at all, and a metric that rewarded it would send UntangleIt to do exactly the thing this toolkit exists to prevent. Under MBCC the switch scores one before and the 28 methods score one each after, so the loop counts that transform as no progress, and the only extraction that lowers the number is the one that removes nesting: pulling a nested block up into its own method, where its nesting resets to zero and the parent loses a level. The metric rewards the only kind of split that helps a reader, and is indifferent to the kind that only multiplies methods. What 100 disconnected methods actually are is a cohesion problem, and the spec measures that with LCOM4 at the class level.

## 6. What needs validating, and what does not

Because MBCC changes one thing, only that thing is a claim under test. The nesting charges, the break-in-flow charges, the switch rule, and the recursion charge are Campbell's, and they have evidence: a meta-analysis of about 24,000 understandability evaluations across 427 code snippets found that Cognitive Complexity "positively correlates with comprehension time and subjective ratings of understandability," and called it "the first validated and solely code-based metric which is able to reflect at least some aspects of code understandability" (Muñoz Barón, Wyrich, and Wagner 2020). The same study found the correlation with correctness of comprehension was inconsistent, which is exactly the gap the one change aims at: ordered operands and ordered branches are where a reader who took the same time still gets the answer wrong.

The two claims to validate are these. First, that a boolean run whose operands depend on each other or carry calls costs a reader per operand, not once. Second, that a chain of branches on different facts costs a reader per position, not once per branch. The first field evidence is the Regalia comparison table: the four guard-chain functions MBCC pulled above the limit (`verify_runtime_security` 15/9/17, `parse_arguments` 11/10/15, `income_statement` 14/13/17, `build_balance_sheet_pdf` 11/16/20) are, on inspection, the functions a reviewer would call hard to follow and Campbell's number waved through. That is one project. Every DeepTest run records all three numbers, so the data to test the two claims accumulates from every user at no cost, and the first question to ask of it is whether functions MBCC ranks above Campbell are the ones that later changed, broke, or were untangled.

The ordered-operand rule also needs a published set of worked cases, the way Campbell's whitepaper has, so a reader can check a count by hand. The cases in section 5 are the start of that set; the shared library's tests are the rest.

## 7. Objections, and the answers

*MBCC has no validation behind it.* Most of it does, because most of it is Campbell. The part that does not is one principle in two places, and section 6 says how it will be tested.

*It is a private number nobody can look up.* Every published metric was private on the day it shipped; Campbell's was a vendor whitepaper that became a standard because a tool with users reported it. MBCC carries its own name precisely so it is never mistaken for the published rule, the published rule sits beside it on every row, and this document is the lookup.

*It puts a readability opinion into a testing tool.* It does not. DeepTest ranks and judges by ways through and carries tangle only as a check. Tangle drives UntangleIt, whose verb is untangling, and nothing else.

*The ordered-operand rule is a heuristic.* Every complexity metric is a syntactic stand-in for a cognitive fact. McCabe counts branches; Campbell counts breaks and nesting. MBCC's rule is at least stated in terms of the thing it approximates, does the reader have to hold order in mind, and its blind spots are written down. `user and user.name` costing two is right: the reader does have to know the guard runs first.

*Two tangle numbers confuse the non-developer.* The non-developer never sees either by default. They see "pick_greeting() is too tangled to trust. Your limit is 15." The figures live behind the switch labelled "Show the engineer's numbers next to the plain words." That switch exists so an engineer can see both and argue. It costs the non-developer nothing.

*Charging chains per position will send UntangleIt after every big switch.* It will not, because a switch is not a chain on different facts. It scores one, it never reaches the list, and the loop gives no credit for splitting it. See section 5.

## Sources

Campbell, G. Ann. *Cognitive Complexity: A New Way of Measuring Understandability.* SonarSource, 2018. https://www.sonarsource.com/docs/CognitiveComplexity.pdf. The increment rules, the `switch` rule, the boolean-run rule, the `else`/`else if` rule with no nesting charge, and the exclusions for `try`, `finally`, and null-coalescing are taken from this document.

McCabe, Thomas J. "A Complexity Measure." *IEEE Transactions on Software Engineering*, vol. SE-2, no. 4, Dec. 1976, pp. 308-320. https://doi.org/10.1109/TSE.1976.233837.

Muñoz Barón, Marvin, Marvin Wyrich, and Stefan Wagner. "An Empirical Validation of Cognitive Complexity as a Measure of Source Code Understandability." *Proceedings of the 14th ACM/IEEE International Symposium on Empirical Software Engineering and Measurement (ESEM '20)*, 2020. https://arxiv.org/abs/2007.12520. Meta-analysis of about 24,000 understandability evaluations across 427 code snippets; positive correlation with comprehension time and subjective ratings; inconsistent results for correctness and physiological measures.

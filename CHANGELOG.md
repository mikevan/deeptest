# Changelog

## 1.0.14

A card is never drawn from evidence with a hole in it.

The runner's own test count is now held against the attribution records the
hooks wrote. A finished test that left no record, or a record whose test
boundary was cut off, and the panel shows "The check did not finish." with
the reason and the three controls, where 1.0.13 drew a card. The Windows
separator bug shipped four versions of a card with empty per-test
attribution, and nothing in the pipeline could have said so.

A file the instrumenter could not take is shown as unmeasured, out of every
number, with the reason, and the verdict is not ready while one exists;
before, it read as measured and never executed. Decisions the instrumenter
could not count are listed per file in the full report. `scripts\survey.cjs`
prints the same evidence line the panel checks.

## 1.0.10

The 1.x series is named Polyglot, and DeepTest carries it. The side panel header
and the Marketplace title read `DeepTest - Polyglot`, with the version still
appended to the header as before. The name is stamped by the build, because VS
Code will not let a panel header change at run time. Nothing else changes.

## 1.0.9

Witness moves out of DeepTest into its own library, `@projectrevivesolutions/witness`, and DeepTest bundles it the way it bundles the complexity library. Nothing measured changes: Mocha and Playwright component tests report the same lines, decisions, and functions per test as 1.0.8. The Witness hooks now read `WITNESS_*` environment names, which DeepTest sets beside its own.

## 1.0.0

The core is done. DeepTest measures and judges by ways through, refuses to score a run in which no test ran, names the Python it installs coverage into, and carries tangle (Campbell and MBCC) beside every function as a sanity check that points at UntangleIt. Python and TypeScript / JavaScript. Next: Java (1.1), C# (1.2), C++ (1.3); see docs/toolkit/toolkit-roadmap.md.


# Changelog

## 1.0.15

DeepTest checks that a tool will run before it drives it, and Angular with
Vitest measures source again.

Every npm package may declare which Node versions it supports, and nothing
read that. The setup screen said the environment was ok and the Angular CLI
then refused to start, because the CLI needs Node `^22.22.3 || ^24.15.0 ||
>=26.0.0` and the machine had 22.22.0. DeepTest now reads what each tool it
starts declares and refuses first, naming the package, what it needs, and
what is installed. A range it cannot parse lets the run proceed, because
refusing a project over a misread range is the same wrong answer pointed the
other way.

Angular with Vitest measured nothing at all from 1.0.12 until now, and said
so with a straight face. That delivery moved the path onto the Witness Vite
plugin, but the Angular builder bundles the application before Vitest is
involved, so the only files the plugin ever saw were built chunks outside the
source root, and it correctly declined every one. Eleven tests passed, every
coverage report was `{}`, every attribution record was empty, and the card
called a fully tested project 81 untested lines. The path is back to what
1.0.4 built, which measures through the builder's own instrumentation and
maps the chunks back to sources, and it reproduces 1.0.4's recorded figures
exactly: 21 attributed lines, 25.61% coverage on the Angular port.

That defect passed 1.0.14's evidence check, so the check was incomplete. It
counted records and never asked whether a record contained anything. A run is
now refused when it measured nothing at all, meaning no record carried a file
and no file had a line that ran. One empty record is ordinary and is still
allowed; a suite where every record is empty is not a verdict, it is a
measurement failure.

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


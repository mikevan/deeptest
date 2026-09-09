# DeepTest user acceptance test

Run through this as Jeff would: press what he would press, read what he
would read, and write down the exact words on screen wherever they do not
match. Every case ends with what you should see. If you see something
else, that is a finding, and the text you saw is the bug report.

Setup once, in PowerShell:

```powershell
cd C:\workspace\DeepTest
npm install
npm run build
npx @vscode/vsce package --no-dependencies
```

The last command prints "DONE  Packaged: C:\workspace\DeepTest\deeptest-0.3.8.vsix".
Then, in VS Code, press Ctrl+Shift+X to open the Extensions view. At the top
right of that view click the "..." button (its tooltip reads "Views and More
Actions..."), choose "Install from VSIX...", pick
`C:\workspace\DeepTest\deeptest-0.3.8.vsix`, and click "Install". A
notification says "Completed installing DeepTest extension from VSIX." and
offers "Restart Extensions"; click it. The DeepTest icon appears in the
activity bar on the left, and the panel's title bar reads "DeepTest" followed
by the build number, for example "DeepTest 0.3.8". Repeat these steps after every change to the
source. The version number on DeepTest's page in the Extensions view tells
you which build is running.

To remove it later: open DeepTest's page in the Extensions view and click "Uninstall".

Every case below happens in VS Code with a fixture project open. The
fixture projects live under `C:\workspace\DeepTest\test\fixtures\`.

## A. First contact

**A1. Nothing configured.** File, Open Folder, `test\fixtures\jsproject-jest`.
Click the DeepTest icon in the activity bar.
Expect: "This project has not been checked yet." followed by one sentence
saying what DeepTest does. One button, "Check my code". One link, "Tell me
where the tests are". No other words.

**A2. First press.** Press "Check my code".
Expect: the setup screen opens, not a run. Language: TypeScript /
JavaScript. Folder with the tests: `test`. Folder with the code: `src`.
Test runner: "Detect from package.json". The note says "Found jest". You
should not need to change anything.

**A3. Save and check.** Press "Save and check my code".
Expect, within ten seconds: the panel shows a red box, "This is not ready:
3 lines were never tested." Under it a sentence with counts and
percentages. Then "3 tests passed" and a time. Below the cards, one button,
"Check my code again", and three links: "Full report", "Change the setup",
and "Show the log".

## B. Reading the verdict as Jeff

**B1. Three lines.** Under "What the tests say", read the three rows.
Expect: each row is a sentence a CPA can check. "Tests reach 10 of 13 lines
(77%). You want 80%." The percentage must match the counts. Check it.

**B2. The first card.** Under "Look at these first".
Expect: `src/calc.js line 7`, badge "never tested", the code line
`} else if (y > 0 && x === 0) {`, then "Never tested. Needs 3 tests because
3 conditions guard it." Then a sentence that says where your tests stop and
names the condition `x > 0`.

**B3. No jargon.** Scan the whole panel.
Expect: none of these words anywhere: density, depth, bar, cyclomatic,
complexity, coverage, gap, declaration. If one appears, that is a finding.

**B4. Show the numbers.** Tick "Show the engineer's numbers next to the
plain words." at the bottom.
Expect: the same sentences, now with "(density 0, depth 3, bar 3)" after
them and a grey second line under each summary row. Untick it. They go.

## C. In the file

**C1. Colours.** Click "Open" on the first card.
Expect: `src/calc.js` opens with line 7 selected. Lines 2, 3, 6, 11 to 14,
18, and 20 tinted green; line 4 yellow; lines 7, 8, and 10 red; line 22
grey. The gutter shows a glyph on each: check, triangle, cross, dash.

**C2. Captions.** Read the end of each coloured line.
Expect: green lines say nothing. Line 4: "1 test. Needs 2." Line 7: "Never
tested. Needs 3 tests." Line 22: "This line can never run."

**C3. Hover.** Hover line 7.
Expect: bold "DeepTest: Never tested. Needs 3 tests because 3 conditions
guard it." Then where the tests stop. Then a link "Decide: fix, accept, or
leave". Hover line 4: the two test names that reach it are listed.

**C4. Edit.** Type a space anywhere in the file, do not save.
Expect: a note at the top of the file, "DeepTest: this file changed since
the last check", and the panel says "One file has changed since then."
Undo the edit.

## D. Your call

**D1. Accept.** On the first card press "Accept as it is". Type a reason
shorter than eight characters and press Enter.
Expect: it refuses and asks for a reason someone else could read later.
Type "integration suite covers this path" and press Enter.
Expect: the card leaves the list. "Accepted by a person: 1." appears; open
it and your reason is there with your Windows user name and today's date.
The verdict now says "This is not ready: 2 lines were never tested."

**D2. On disk.** Open `test\fixtures\jsproject-jest\.deeptest\decisions.json`
in the editor.
Expect: one entry, plain JSON, readable, with your reason.

**D3. Undo.** Press "Undo" in the accepted section.
Expect: the card is back, the file is empty of decisions.

**D4. Fix, declined.** Press "Fix this" on the first card.
Expect, if KeepSafe is installed: a notification, "Create a KeepSafe
checkpoint before the AI changes your code? You can restore it if the
change goes wrong." with the buttons "Create a checkpoint" and "Skip".
Press "Skip". If KeepSafe is not installed, this notification never
appears.
Expect next, either way: a dialog, "Send this to your AI assistant?", with
one sentence naming `calc.js line 7` and saying that the assistant may
change your code, and the buttons "Yes, send it" and "Cancel". Press
"Cancel".
Expect: nothing happens. The card is unchanged, the clipboard is unchanged,
and no decision was recorded.

**D4a. Fix, sent.** Press "Fix this" again. Press "Create a checkpoint" if
KeepSafe offers one; KeepSafe shows its own message with the checkpoint's
name. Press "Yes, send it".
Expect: a message that the brief is on your clipboard. Paste it into
Notepad. It names `src/calc.js` line 7, lists the three conditions, says
which one the tests never satisfy, and ends with "will not accept the fix
on your behalf". The card now shows "A fix was requested".

**D4b. Setup screen.** Press "Change the setup". Find the heading "Before
the AI changes your code".
Expect, with KeepSafe installed: a ticked box, "Before "Fix this" hands
work to your AI assistant, ask me whether to create a KeepSafe
checkpoint." Untick it, press "Save", and repeat D4a: no checkpoint
notification appears, only the "Send this to your AI assistant?" dialog.
Tick it again and save.
Expect, without KeepSafe: a paragraph recommending KeepSafe with a link,
and one button, "Show KeepSafe in the Extensions view", which opens
KeepSafe's page in the Extensions view. Nothing else in DeepTest mentions
KeepSafe.

**D5. Nothing changed.** Press "Check my code again" without fixing
anything.
Expect: the card says "A fix was requested on <date>. Still 3 tests short,
nothing changed. Your call again." DeepTest did not take your word for it.

**D6. Stale decision.** Accept line 8 with any reason. Then, in
`src/calc.js`, change line 8 from `return 'y only';` to
`return 'y-only';`, save, and press "Check my code again".
Expect: line 8's card says "You decided about this line on <date>, but the
line has changed since. Decide again." Put the line back and save.

**D7. The hardest function.** Under "What the tests say", read the
"Hardest to test" row.
Expect: "calc() has N ways through it. Your limit is 10." followed by two
buttons, "Fix this" and "Open", only when the function is over the limit.
Press "Fix this".
Expect: a list with two choices, "Break it into smaller pieces" and "Test
every way through it as it is", each with one sentence saying what the
assistant would do. Pick "Break it into smaller pieces". Then the same
KeepSafe offer (if installed) and the same "Send this to your AI
assistant?" dialog as D4, with the sentence naming the function. Press
"Yes, send it".
Expect: the brief on the clipboard starts "# DeepTest: bring calc() within
10 ways through", quotes the function with line numbers, lists the lines
inside it that are short of tests, and says the existing tests must pass
without being edited. The row now shows "A fix was requested on <date>.
Still N ways through over your limit, nothing changed. Your call again."
and an "Undo decision" button. Press "Undo decision"; the sentence goes.

## E. The report

**E1. Open it.** Press "Full report".
Expect: a page beside the editor. Verdict at the top in a red box, a
four-row table under "What the tests say", then "The 4 worst, in full":
each with the code, "No test reaches it, one for each of the 3 conditions
on the way", the numbered route with crosses, "What this means", "What to
do", and the buttons.

**E2. Save it.** Press "Save as Markdown", accept the default name.
Expect: `deeptest-report.md` in the project folder. Open it. It reads as a
document you could attach to a file; nothing in it needs a programmer.

## F. Same tool, other language

**F1. Python.** File, Open Folder, `test\fixtures\pyproject`. This step
needs Python on this machine with `coverage` and `pytest`; if the setup
screen says no Python was found, skip to G.
Expect: the same four screens with the same shape. Setup shows Language:
Python and the interpreter it found. Verdict: "This is not ready: 3 lines
were never tested." First card: `src/calc.py line 6`.

**F2. Missing tools.** If `coverage` or `pytest` is missing, DeepTest says
so in a message with an install button.
Expect: pressing it installs into the interpreter the setup screen named,
then the check runs. Declining it leaves the panel on "The check did not
finish." with the reason in plain words, a "Check my code again" button,
and the links "Show the log" and "Change the setup".

## G. Your own project

**G1.** Open a real project of yours, TypeScript or Python. Press "Check my
code". Do not touch the setup screen unless a field is wrong.
Record: was every field right? What did you have to change? How long did
the check take? What did the verdict say, and did you believe it?

**G2.** Read the first three cards.
Record: could you say, in your own words, what is wrong with each and what
you would do about it, without opening the code? Where you could not, copy
the sentence that lost you.

**G3.** Pick one card and press "Fix this". Hand the brief to whatever
assistant you use. When it says done, press "Check my code again".
Record: did the line go green? If not, what did the card say?

## H. Ways it should refuse

**H1. No tests.** Open Folder on any folder with code but no test files.
Expect: "No tests were found." with one sentence saying where DeepTest
looked, the button "Tell me where the tests are", and the links "Try again"
and "Show the log". No crash, no jargon.

**H2. No folder.** Close all folders and press the DeepTest button.
Expect: a message that DeepTest needs an open folder to check.

## When a check does not finish

The panel says "The check did not finish." and gives the reason in one
sentence. Press "Show the log" to open the Output panel with the whole test
run; the last lines usually say what went wrong. Press "Check my code again"
to retry, or "Change the setup" if a field on the setup screen was wrong.

## What to send back

For each case: pass, or the exact text on screen. G1 through G3 in full.
The findings that matter most are any sentence Jeff would have to ask an
engineer to explain.

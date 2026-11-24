---
name: team-verify
description: The evidence standard for every member — what counts as proof, how to handle a missing claim, and the checklist before a Lead answers.
whenToUse: Load before you accept a teammate result or report your own success; reload when a claim arrives without evidence.
---

# Verification standard

Both the Lead and every teammate are judged by this text. A teammate applies it to its own result; the Lead applies it to everyone's.

## Asking for evidence

- Ask for evidence, not narrative: the command and its output, the test name and its result, the file and line, the page you actually opened.
- If a teammate reports success without evidence, re-dispatch once asking for it. If it still cannot produce evidence, downgrade the claim and say so in the answer.
- Never present unverified state as verified. State what you checked, what you did not check, and what remains uncertain.
- A settled teammate is not a stopped one: settlement means the run ended, not that its side effects are complete. Confirm the deliverable before you rely on it.

## Verifying your own work

- Verify before you claim success: run the checks, read the result, and keep the command output you rely on.
- Say what you did not verify. Never present a guess as a result.

## The Lead's finishing checklist

- Never end a turn while a teammate still owes you a result the answer needs. Collect it with wait_agent, or use send_message to nudge a teammate that went quiet.
- Before you answer: every board task is completed or explicitly abandoned, the final diff is reviewed, and the checks you rely on were run.
- The answer states what changed, the evidence, the residual risk, and links to the files. If the goal is not met, say what remains instead of presenting partial work as complete.
- Reply in the language the user writes in.

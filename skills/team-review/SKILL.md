---
name: team-review
description: The Team Lead's review checklist for a teammate's diff — scope, correctness, side effects, test quality, and when to send work back.
whenToUse: Load before accepting a teammate's diff or before you answer with others' changes in it; reload when a claim looks right but you cannot point at the line that proves it.
---

# Reviewing a diff

Evidence says the work was checked. Review says the work is right. The Lead owes both, and the second one cannot be delegated to the member that wrote it.

## Read the change, not the report

- Open the diff yourself. A member's FINDINGS tell you where to look, never what to conclude.
- Follow one path end to end: the entry point that a user or caller reaches, through the changed lines, to the observable result. If you cannot trace it, the change is not reviewable yet.
- Check the boundaries the change does not mention: an empty input, a missing file, a failing dependency, a second call.

## The checklist

- **Scope**: only what the task asked for. Unrelated reformatting, renames, or dependency bumps are noise that hides the real diff — send them back.
- **Correctness**: the new branch actually does what the task says on the inputs the task names, not only on the happy path the member tried.
- **Side effects**: other callers, configuration, persisted data, and anything a consumer reads. A change is not local just because the file is.
- **Tests**: a test that cannot fail when the code breaks is not evidence. Prefer the assertion that would have caught the bug.
- **Consistency**: the repository's existing shape — its naming, its error style, its test layout — over a new pattern invented for one file.
- **Minimum**: no abstraction, option, or dependency the task did not need.

## Verdicts

- **Accept**: say which lines you read and which check you ran. Silence is not acceptance.
- **Send back**: name the failing item from the checklist and what would make it pass. Re-dispatch to the same member with the diff context, rather than fixing it yourself — editing a member's work silently makes the next report a lie.
- **Downgrade**: if the deadline matters more than the defect, ship it and say plainly what is weak and what remains. Never present a downgraded result as accepted.

## Do not

- Do not accept because the member is confident, fast, or already reported `done`.
- Do not review only the files you expected to change; the surprising file is where the defect lives.
- Do not turn a review note into a silent edit. A behaviour change is new work: board it, dispatch it.

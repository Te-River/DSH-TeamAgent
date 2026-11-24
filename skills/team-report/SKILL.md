---
name: team-report
description: How a teammate hands work back — the report shape the Lead relies on, when to escalate instead of guessing, and what the next member can inherit.
whenToUse: Load before you report back on a delegated task, when you are blocked, or when your scope turns out to be wrong.
---

# Reporting back

The report is the only thing the Lead can rely on, so it carries the same weight as the work.

## Escalation

- Do not create teammates of your own. If the work needs another hand, or you are blocked on something outside your scope, report it to the Lead with send_message and let the Lead dispatch.

## The shape

Report back in this shape, at most about 50 lines, with no whole files pasted in:

```
STATUS: done | blocked | failed
CHANGES: each file you wrote, one line each
FINDINGS: what the Lead must know that it cannot see from the diff
EVIDENCE: the commands and their results that prove the claim
HANDOFF: exactly what the next member can rely on
```

`STATUS: done` means the acceptance criteria you were given are met and evidence proves it; otherwise report `blocked` or `failed` and say why. A revision of the same task reports the same way — the Lead compares the new report with the previous one.

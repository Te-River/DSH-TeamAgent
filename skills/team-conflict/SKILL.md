---
name: team-conflict
description: What to do when two members collide — a stale board revision, two writers on one file, or a teammate leaves the tree broken.
whenToUse: Load when a board mutation reports a revision conflict, when a file you own changed under you, or when a teammate's work left the tree failing.
---

# Conflicts

Every conflict here comes from one thing: two members acted on the same fact at the same time. Resolve the fact, not just the symptom.

## A stale revision

- A refused mutation means someone else moved first. Re-read the task, redo the decision on the current revision, and only then write again. Never retry blind, and never write a revision you did not just read.
- If the new state makes your change pointless, say so in the task and stop. A conflict you no longer need is not a race to win.

## Two writers on one file

- This is a dispatch bug, not a merge problem. One file, one writer: narrow one side's scope to a different file, or hold it until the other finishes.
- Do not "merge by hand" while both turns are live, and do not assume the other member is done because it went quiet. Settlement is not completion.
- Before touching a shared file, re-read it. After touching it, run the check that proves the file still parses and still behaves.

## A tree that no longer passes

- Look before you revert: read the diff and name what broke. A blanket revert eats work you did not write and may eat the other member's fix.
- Revert only the change you can attribute, then re-run the check. If the breakage is another member's, message that member with the failing command and its output instead of repairing it yourself.
- After any resolution, tell both sides what the tree now holds. A member working from a stale assumption will break it again.

## Record it

- Put the resolution in the board task: what conflicted, who moved, what the tree holds now, and the command that proves it. The next member inherits the record, not a story.

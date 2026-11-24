---
name: team-board
description: The shared task board protocol for every member of a Team session — creating, claiming, and completing tasks, conflict handling, and write scopes.
whenToUse: Load before you create, claim, or complete a board task; reload when a mutation reports a stale revision or when two members turn out to own one file.
---

# Shared task board

The board is the only durable memory the team shares. Both the Lead and every teammate follow this text.

## Every ask becomes a task

- Every user ask becomes a board task before you act on it: team_task_create, then claim it or leave it unowned for a teammate.
- The workflow is list, get, claim with the current revision, do the work, complete. Every mutation is compare-and-set; on a conflict re-read the task and retry with the new revision.
- Record expected write scopes so overlapping work is flagged, and use blocked_by when work must be ordered. Overlap is advisory, not a lock: partition the files up front and never let two members edit one file at the same time.
- Task readiness never starts a teammate, and a task change wakes nobody. When a teammate must act on a change, send it a message.

## Claiming and completing

- Claim your board task before you start: team_task_list, team_task_get, then team_task_update with action claim and the current revision. Complete it with the revision you just read.

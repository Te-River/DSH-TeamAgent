---
name: team-dispatch
description: The dispatch contract the Team Lead keeps — choosing a backend, writing the brief, dispatching in parallel, and who owns which file.
whenToUse: Load before the first delegation of a Team session; reload before a second wave of dispatches or when two pieces of work may touch one file.
---

# Dispatch and write ownership

This is the Lead's side of the work: how a task becomes a teammate, and who may write what.

## Delegation

- `subagent` starts a fresh teammate on the same model and working directory; `subagent_fork` seeds one with this conversation. Give every teammate a short unique `name` and a `description` that states the deliverable.
- Start independent dispatches together in one assistant message so they run while you keep working. A wait is not parallelism: do not send one teammate, wait for it, then send the next.
- Write the contract into each prompt: the exact files or directories it owns, the interface or convention it must honor, the checks it must run, and what it must report back.
- Route paths, task ids, and short summaries between members. Never paste a whole file into a prompt. Teammates can reach each other with send_message once they know the names that list_agents shows.
- Do not re-dispatch work a live teammate already owns. Extend an in-flight task with send_message instead.

## Write ownership

- Partition ownership before you parallelize, and review the final diff yourself before you answer. Your teammates share one checkout, so their edits are already in your working directory.
- You may edit directly only for trivial, non-behavioral touches: a typo, a formatting fix, a configuration value, or a documentation line of about ten lines or less. Behavior changes are dispatched; hand-editing them yourself is a routing bug, not efficiency.
- Assume another member may be writing the same file: re-read before you edit, and leave the tree in a state the checks accept.

## Program-based tool calls

This preset runs the PTC executor: `run_code` is the only tool you call directly, and every other tool is a same-named SDK binding. Load the `ptc-programs` skill for how to plan programs, what crosses a step, and how to handle a long or failing binding.

---
name: team-model-routing
description: How to pick a teammate's model and reasoning effort, how many to run at once, and when a dispatch costs more than doing the work.
whenToUse: Load before dispatching a teammate that needs an unusual model or effort, before a wide parallel wave, or when a task looks too small to delegate.
---

# Routing work

A dispatch costs a fresh context, a full system prompt, and the model's tokens. Spend that on work that needs it.

## Choosing a model and effort

- The default teammate inherits this session's model. Change it only for a reason you can name: a mechanical edit needs less than a hard diagnosis.
- Use low effort for search, renames, and formatting. Use high effort for a failure that resists reproduction, a design trade-off, or a change that touches an interface other code depends on.
- When a task is mostly reading and judging, the effort matters more than the model; when a task is mostly writing correct code, the model matters more.
- Say in the dispatch why you chose that route. A later reader must be able to see the reasoning, not guess it.

## How wide to go

- Parallelism is bounded twice: by the worker slots the team allows, and by the program's binding limit (this preset allows ten bindings at once). Neither limit makes more work exist.
- Give each teammate a distinct file or directory. Two members on one checkout share the tree, so a wide wave without partitioned scopes trades speed for conflicts.
- Batch small related edits into one dispatch instead of one dispatch per file.

## When not to dispatch

- If you already know the answer, or the change is a trivial, non-behavioural touch you may edit yourself, do it now. A dispatch round trip is slower than the edit.
- Do not dispatch the same work twice because the first teammate is quiet; check whether it is still live first.
- Do not dispatch a question you could answer by reading one file yourself — reading is cheaper than a round trip.

## Recording the choice

- The dispatch prompt carries: the deliverable, the scope, the checks, and the model or effort if it is not the default. A report you cannot attribute to a route is hard to reproduce.

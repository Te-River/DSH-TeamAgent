---
name: ptc-programs
description: How to work in a PTC session — run_code is the only direct tool, the rest are SDK bindings, and one program should finish one unit of work.
whenToUse: Load before your first program in a model-call/binding session (this preset), or when a program is slow, times out, or returns more than you can read.
---

# Programs instead of calls

This preset runs the PTC executor: `run_code` is the only tool you call directly, and every other tool named in this brief is a same-named binding in the generated SDK. That changes how you plan, not what you may do.

## One program, one unit of work

- Put a whole unit in one program: list the board, claim what is ready, write the files, run the check, then return the ids and paths the next step needs.
- A program occupies a step. Keep each one short enough that you can read its output and still answer.
- Independent bindings run in parallel up to the configured limit. Do not hand-write concurrency for work the executor already parallelizes.

## What crosses a step

- Only what a program prints or returns crosses into the next step. Carry task ids, paths, and verdicts forward — not file bodies.
- Print a summary you would paste into a report, not the raw result of every binding. A program that returns everything has returned nothing you can read.

## Long and failing bindings

- Bounded bindings such as a wait need an explicit timeout. Return what is still running instead of blocking a program indefinitely.
- When one binding fails, catch it inside the program and retry that binding alone. Re-running the whole program repeats the effects that already landed.
- Treat a program timeout as a partial result: inspect what it wrote before retrying, and say in your report what was and was not applied.

## Which surface to use

- Reading, searching, and small edits: call the bindings directly in one program.
- A shell command that may outlive the step: start it as a job and read it on a later step rather than blocking here.
- Work that needs a full conversation of its own: dispatch a teammate instead of writing a longer program.

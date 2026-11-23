# DSH TeamAgent

A DeepSeek Harness bundle that adds a **Team** agent preset beside the shipped Standard, PTC, Minimal and Creator presets, built for DSH `0.2.2-rc.5`.

The design ports the load-bearing ideas of `Opencode-TeamMode` (one lead role + worker roles, a lead-owned task ledger as the only state memory, evidence-based verification, hook-level enforcement where a prompt sentence would otherwise be the only guard) onto DSH's own Agent Teams runtime instead of inventing a parallel one.

## What the preset does

| Requirement | Implementation |
|---|---|
| A Team mode beside the standard presets | `packages/team-mode/cordis.patch.yml` inserts a `@deepseek-ai/dsh-agent-preset` declaration with `id: team`, `name: Team`, `order: 5`. Its child list mirrors the shipped `standard` preset. |
| The agent receives Leader instructions | `packages/team-mode/index.js` registers `team:lead-role` (order 560, literal text) on the root agent of the session, after the plan policy and beside the first-party Team policy. Teammates receive `team:teammate-role` instead, so a child never reads the Lead brief. |
| DSH Agent Teams turns on with the mode and cannot be turned off | The same plugin reads and writes the official `ctx.agentTeams` selection: it enables Agent Teams before a root agent's first step, enables it again for a resumed session, and reverts any `team/mode { enabled: false }` record committed later in the run. Leaving Team mode is a preset switch. |
| No context governance | The `compaction` group (`compaction-basic`, `command-compact`, `tool-result-pruner`) is omitted from the preset's child list. |

Nothing about the official Team runtime is reimplemented: teammates are ordinary continuable subagents, messaging is `send_message`/`list_agents`/`wait_agent`, and the board is `team_task_create`/`list`/`get`/`update` over `ctx.agentTeams`. `interrupt_agent` is enabled so a Lead can stop a stuck teammate.

## Layout

| Path | Role |
|---|---|
| `packages/team-mode/package.json` | Bundle manifest (`dsh.bundle.patch`, exports, locale, icon) |
| `packages/team-mode/cordis.patch.yml` | The `preset-team` declaration and its 22 plugin rows |
| `packages/team-mode/index.js` | Preset-scoped plugin: role sections, Agent Teams lock, agent lifecycle |
| `packages/team-mode/locale/{en,zh}.json` | Plugin Manager title and description |
| `packages/team-mode/icon.svg`, `README.md` | Icon and the bundle detail fallback |
| `tests/team-mode.logic.test.mjs` | Logic checks against a fake Cordis context |

## Install and use

1. Restart DeepSeek Harness so the Host loads the plugin's current module generation (the bundle is installed as a link to this checkout).
2. Open **Plugins** and confirm the **Team mode** bundle, or install this directory with the `plugin_manager` `install_bundle` action.
3. Start a new task and choose **Team** in the Agent presets picker.

## Verification status

Verified against a real Host (`@deepseek-ai/dsh` `0.2.2-rc.5`, web surface) booted from a scratch profile with its own `DSH_HOME`, using the throwaway probe bundle in `dev/probe` (never installed in the user's profile):

| Observation | Result |
|---|---|
| Preset roster | `team / Team / order 5` beside `standard, ptc, minimal, cordis`, with no activation diagnostic |
| Active revision modules | includes `@local/dsh-team-mode`; every child row `fiberState: 2` (active); `leakedServices: []` |
| Context governance | no `compaction-basic`, `command-compact`, or `tool-result-pruner` row in the composition |
| Root agent prompt | sections include `team:lead-role` (4,293 chars) between `plan:policy` and `team:policy`; the worker section is absent |
| Teammate prompt | a Session whose header says `subagent` gets `team:teammate-role` (1,248 chars, with the `STATUS/CHANGES/FINDINGS/EVIDENCE/HANDOFF` contract) and no Lead section |
| Agent Teams | on at creation, and the team tools (`team_task_*`, `subagent`, `send_message`, `wait_agent`, `list_agents`) are in the step's tool set |
| Disable lock | a committed `team/mode { enabled: false }` produces records `[true, false, true]` — the plugin re-enables the mode in about 25 ms |

Two defects were found and fixed through that harness, both invisible to prompt review:

- The revert first read the mode before the projection had folded the new record, so it saw `true` and did nothing.
- The first working revert wrote inside the session's own append-publication window and was rejected with `session append cannot reenter while another append is being published`; the write now leaves that window and retries.

Still unverified: the rendered roster entry and toggle appearance in the Web UI, which needs a browser-driven session.

## Development harness

`dev/probe` is a diagnostic bundle used only for the verification above: it writes the roster, each revision's modules, and a live composition report, then creates and disposes one `team` Session. To reuse it, copy `dev/probe` into a scratch profile's dependencies and bundles (with its own `DSH_HOME`) and boot that profile; set `DSH_TEAM_MODE_TRACE=<file>` to trace the plugin's guards and reverts. Do not install it in a normal profile.

## Notes and limits

- Role text is prompt policy. Only the Agent Teams selection is enforced; file ownership, write scopes and "dispatch behavior changes instead of editing them yourself" are guidance, not guards.
- Do not mount `@deepseek-ai/dsh-agent-team` inside the preset: the Host owns that service and the task tools, and a preset-realm second instance would not serve the Host tool adapter.

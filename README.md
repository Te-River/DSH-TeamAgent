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

- Verified: bundle installation (`application: applied`), the `preset-team` Loader row active in the desktop profile, the patch YAML structure (231 entry count, 22 child rows), and nine logic checks over the plugin.
- Not verified in this checkout: the rendered roster entry and a live Team session, which need a browser-driven new session. If the preset picker shows the preset with an activation diagnostic instead of starting a session, the mount failed — read that diagnostic before anything else.

## Notes and limits

- Role text is prompt policy. Only the Agent Teams selection is enforced; file ownership, write scopes and "dispatch behavior changes instead of editing them yourself" are guidance, not guards.
- Do not mount `@deepseek-ai/dsh-agent-team` inside the preset: the Host owns that service and the task tools, and a preset-realm second instance would not serve the Host tool adapter.

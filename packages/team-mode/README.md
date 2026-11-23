# @local/dsh-team-mode

A DeepSeek Harness bundle that inserts one agent preset, **Team**, beside the shipped presets, and one preset-scoped plugin that the preset mounts.

## What it adds

- **Team preset** (`id: team`, roster order 5). Selecting it in the **Agent presets** picker gives the session's root agent the Team Lead instructions and every subagent of that tree the teammate instructions. The tool set mirrors the shipped `standard` preset — shell, filesystem, search, web, goals, plan mode, skills, todo, jobs, office, and the delegation group (`subagent`, `subagent_fork`, `list_agents`, `send_message`, `wait_agent`, `interrupt_agent`, `workflow`) — with two changes: `interrupt_agent` is enabled so a Lead can stop a stuck teammate, and the `compaction` group is absent, so the preset carries no context governance.
- **Agent Teams lock.** The preset's plugin reads and writes the official `ctx.agentTeams` selection. A root agent of a Team session always runs with Agent Teams on: the plugin enables it before the first step, re-enables it when a resumed session starts with it off, and reverts an off selection written later in the run. `Use Agent Teams` therefore cannot stay off while the session remains on this preset; switching the session to another preset is how you leave Team mode.
- **Role sections.** `team:lead-role` (root) and `team:teammate-role` (subagents), order 560, `interpolate: false`. They sit after the plan policy and beside the first-party Team policy, and they cost a fixed number of prompt tokens on every request of every member.

## Install

Install the directory that contains this `package.json` — for example with `plugin_manager` `install_bundle`, or **Plugins** > **Add plugin** in the Web UI. Installation adds the package to the profile and selects the bundle; the preset row appears in the roster immediately and a new session composes it.

## Notes and limits

- Agent Teams' own service and task tools stay where the Host mounts them. This bundle deliberately does not mount `@deepseek-ai/dsh-agent-team` or `@deepseek-ai/dsh-tool-agent-team` inside the preset: a second service instance in the preset realm would not serve the Host tool adapter, and the shipped rows already activate per root Session from the same selection.
- The role text is prompt policy. Only the Agent Teams selection is enforced; file ownership, write scopes, and the Lead's "dispatch behavior changes instead of editing them" rule are guidance, not guards. Two members can still write one file.
- Without the `compaction` group a long Team session reaches the model's context limit instead of summarizing. Add the group back to `cordis.patch.yml` when you want governance in this preset.
- The preset's `name` is `Team`, so the picker renders it under the custom group and does not translate it.

## Source map

| File | Role |
|---|---|
| `cordis.patch.yml` | The `preset-team` declaration and its plugin rows |
| `index.js` | Preset-scoped plugin: role sections, Agent Teams lock, agent lifecycle |
| `locale/*.json` | Plugin Manager display metadata |

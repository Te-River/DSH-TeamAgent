# dsh-team-mode

A DeepSeek Harness bundle that inserts one agent preset, **Team**, beside the shipped presets. The preset mounts one scoped plugin that carries a fixed Team Lead base prompt, ships the long part of the brief as two playbook skills, and keeps the official Agent Teams session mode on.

## What it adds

- **Team preset** (`id: team`, roster order 5, rendered as `Team 模式` under the custom group). Selecting it in the **Agent presets** picker gives the session's root agent the Team Lead base prompt and every subagent of that tree the teammate base prompt. The tool set mirrors the shipped `standard` preset with these differences: `interrupt_agent` is enabled so a Lead can stop a stuck teammate, the `compaction` group is absent (no context governance), the **PTC executor** replaces native dispatch so `run_code` is the only directly callable tool and the `workflow` tool is disabled the way the shipped `ptc` preset disables it.
- **Base prompt + on-demand skills.** `team:lead-role` (root) and `team:teammate-role` (subagents) are fixed, hardcoded sections at order 560, `interpolate: false`, holding the identity, the operating loop, the PTC note, and the reply-language rule. The long part of the brief — dispatch contract, board workflow, write ownership, verification standard, PTC program patterns, finishing checklist, and the teammate's claiming/escalation rules — ships as the `team-lead` and `team-worker` skills in `skills/`, discovered by `skill-filesystem` and loaded with the `skill` tool only when a session needs them.
- **Agent Teams lock.** The preset's plugin reads and writes the official `ctx.agentTeams` selection. A root agent of a Team session always runs with Agent Teams on: the plugin enables it before the first step, enables it when a session switches onto or resumes with the preset, and reverts an off selection committed later in the run. The revert listens on the root Agent's own context, because the Session publishes `session/event` to the context that entered it; it waits for the projection to fold the disable, and its write retries across the session's append-publication window. An `agent/pre-step` listener is the last line of defence. `Use Agent Teams` therefore cannot stay off while the session remains on this preset; switching the session to another preset is how you leave Team mode.

## Install

From GitHub — the repository root is the bundle package (`dsh-team-mode`):

```
plugin_manager install_bundle  target: github:Te-River/DSH-TeamAgent
```

or **Plugins** > **Add plugin** with the same GitHub URL. Installation adds the package to the profile's dependencies and bundle list; restart DSH so the Host loads the plugin module, then start a new task and pick **Team**.

A local checkout works the same way: pass the directory that contains this `package.json` as the install target.

## Notes and limits

- Agent Teams' own service and task tools stay where the Host mounts them. This bundle deliberately does not mount `@deepseek-ai/dsh-agent-team` or `@deepseek-ai/dsh-tool-agent-team` inside the preset: a second service instance in the preset realm would not serve the Host tool adapter, and the shipped rows already activate per root Session from the same selection.
- The role text and both skills are prompt policy. Only the Agent Teams selection is enforced; file ownership, write scopes, and the Lead's "dispatch behavior changes instead of editing them" rule are guidance, not guards. Two members can still write one file.
- Without the `compaction` group a long Team session reaches the model's context limit instead of summarizing. Add the group back to `cordis.patch.yml` when you want governance in this preset.
- Under PTC the generated SDK prompt lists every binding, so the session pays a larger fixed prompt than a native-team preset would; that is the cost of the PTC surface.
- The preset's `name` is `Team 模式`, so the picker renders it under the custom group and does not translate it.

## Versions and updates

Releases are git tags; nothing is published to npm. This bundle's own Plugins page shows a version card: the installed version, the newest tag on GitHub, when it last checked, and a copyable `github:Te-River/DSH-TeamAgent#<commit>` spec when a newer tag exists. The check runs in the browser against the public GitHub API, so the repository must stay public and an unauthenticated rate limit applies to repeated checks.

To release: bump `version` in this manifest, commit, `git tag v0.0.x`, and push the tag. The card compares the newest tag with the installed version.

## Source map

| File | Role |
|---|---|
| `cordis.patch.yml` | The `preset-team` declaration, its plugin rows, and the no-op Host row the client scanner needs |
| `index.js` | Package root: the no-op Host row (mounting the preset plugin here would leak it profile-wide) |
| `preset.js` | Preset-scoped plugin: base prompts, playbooks, Agent Teams lock, agent lifecycle |
| `client.js` | Browser half: the GitHub version card on this bundle's Plugins page |
| `skills/team-lead/SKILL.md`, `skills/team-worker/SKILL.md` | The on-demand playbooks |
| `locale/*.json` | Plugin Manager display metadata |
| `docs/DESIGN.md` | How this design was verified, with the measured results |

## Development

- `node tests/team-mode.logic.test.mjs` — logic checks over the plugin against a fake Cordis context.
- `dev/probe` — the throwaway bundle used for the end-to-end verification in a scratch profile; never install it in a normal profile.

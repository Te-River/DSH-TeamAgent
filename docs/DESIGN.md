# Design and verification

How `dsh-team-mode` is built and how it was measured. The bundle targets DeepSeek Harness `0.2.2-rc.5`.

## Requirements and where they live

| Requirement | Implementation |
|---|---|
| Adapts to the current DSH release | Only documented public seams are used: an `@deepseek-ai/dsh-agent-preset` declaration, `@deepseek-ai/dsh-persona`, `ctx.systemPrompt.section()`, `ctx.skills.register()`, `ctx.agentTeams`, and the `agent/created` / `agent-preset/selected` / `session/event` / `agent/pre-step` events. |
| A Team mode beside the shipped presets | `cordis.patch.yml` inserts the declaration with `id: team`, `name: Team 模式`, `order: 5`, rendered in the Agent presets picker after the four shipped presets (Standard, PTC, Minimal, Creator). |
| The agent is injected with a Leader prompt | The plugin registers `team:lead-role` (order 560, `interpolate: false`) on the root agent and `team:teammate-role` on every subagent, so a teammate never reads the Lead brief. |
| Deep integration with the official team mode, on and unstoppable | The plugin reads and writes the official `ctx.agentTeams` selection: on before the first step, on when a session switches onto or resumes with the preset, and any later `team/mode { enabled: false }` is reverted. Leaving Team mode is a preset switch. |
| No context governance | The `compaction` group is absent from the child list. |
| PTC available inside Team mode | `tool-executor-ptc` is a row of the preset, so `run_code` is the only directly callable tool and the team tools become same-named SDK bindings. `workflow-ptc` / `tool-workflow` are disabled the way the shipped `ptc` preset disables them. |
| Prompt split: base + skills on demand | The role sections hold only the identity, the operating loop, the PTC note, the reply-language rule, and the pointer to the playbooks. The long half ships as `skills/team-lead/SKILL.md` and `skills/team-worker/SKILL.md`, registered by the plugin as scoped runtime skills that a session loads with the `skill` tool only when it needs them. |

## Why the split is a relocation, not a rewrite

The two playbooks hold the original brief's own sentences — delegation rules, board workflow, write ownership, verification standard, PTC patterns, finishing checklist for the Lead; claiming, escalation, and verification for a teammate. Nothing new was invented and no rule was dropped: the base prompt keeps the operating loop and the pointer, and the skill carries the rest of the same text.

Measured prompt cost, per request and per member:

| Section | Before the split | After the split |
|---|---|---|
| `team:lead-role` | 4,293 chars | 1,396 chars |
| `team:teammate-role` | 1,248 chars | 1,073 chars |
| `team-lead` playbook | always in the prompt | 0 until loaded (≈5.0 KB on demand) |
| `team-worker` playbook | always in the prompt | 0 until loaded (≈1.3 KB on demand) |

## Paths

No file in this repository hardcodes a checkout, user, or installation path. The plugin resolves `skills/` from its own `import.meta.url`; the single `customSkillDirs` entry in the patch resolves the DSH bundled skills through `createRequire(baseUrl)`, the same expression every shipped preset uses. The development harness derives its scratch directory from its own module URL too.

## Verification

Verified against a real Host (`@deepseek-ai/dsh` `0.2.2-rc.5`, web surface) booted from a scratch profile with its own `DSH_HOME`, using the throwaway probe bundle in `dev/probe` (never installed in a user profile).

| Observation | Result |
|---|---|
| Preset roster | `team / Team / order 5` beside `standard, ptc, minimal, cordis`, no activation diagnostic |
| Active revision modules | include `dsh-team-mode`; every child row `fiberState: 2`; `leakedServices: []` |
| Composition rows | `tool-executor-ptc` active; `workflow-ptc` and `tool-workflow` disabled; no `compaction-*` row |
| Root agent surface | assembled tools = `run_code` only; sections include `team:lead-role` (1,396 chars) between `plan:policy` and `team:policy`; `tools:sdk` carries the generated SDK |
| Teammate surface | a Session whose header says `subagent` gets `team:teammate-role` (1,073 chars) and no Lead section |
| Skill catalog (eight) | with the agent's scope key, `skills.list()` returns `team-board`, `team-dispatch`, `team-verify` and `team-report` for the root *and* for a teammate, beside the bundled and user skills; `skills.get()` loads all four |
| Agent Teams | enabled at creation; a committed disable yields records `[true, false, true]` and the mode is on again within about 25 ms |
| Picker path | a Session created on `standard` and switched to `team` goes from mode `false` to `true` and gains `team:lead-role` |
| Restart route | on the isolated host, `GET /dsh-team-mode/restart` answers `405 {"ok":false,"error":"POST only"}` and a POST without the header answers `403`; the spawn helper is unit-tested against a fake spawner, and the card's restart button plus warning are covered by the render smoke test |`n| Browser half | `clientModules.clientPath('dsh-team-mode')` returns the shipped `client.js`, the boot graph carries the package, and the card's render path runs under `tests/client.smoke.test.mjs`; the card's 更新 button calls `remote.pluginManager.installBundle` with the pinned commit |

Three defects were found and fixed through that harness, all invisible to prompt review:

1. The revert read the mode before the projection had folded the new record, saw `true`, and did nothing.
2. The first working revert wrote inside the session's own append-publication window and was rejected with `session append cannot reenter while another append is being published`.
3. The same rejection hit the picker path, because the preset switch is emitted from a `session/event` listener; the enable helper now retries across that window for every caller.

Still unverified: the rendered roster entry, the toggle snapping back, the version card's own rendering and GitHub request, and a real `run_code` program that dispatches a teammate — those need a browser-driven session with a model route.

## Re-running the harness

1. Create a scratch profile with its own `DSH_HOME`, depending on this repository by `link:` and on `dev/probe`, with both in `dsh.profile.bundles`.
2. `dsh plugin --profile <scratch> install`, then boot `dsh --profile <scratch> --no-open`.
3. The probe writes `.probe/report.json` with the roster, each revision's modules, the composition rows, the live composition, the skill catalog, and the mode/switch results. Set `DSH_TEAM_MODE_TRACE=<file>` to trace the plugin's guards.
4. Delete the scratch `DSH_HOME` and `.probe/` afterwards.

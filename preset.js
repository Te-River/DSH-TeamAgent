/**
 * Team mode preset plugin.
 *
 * Mounted inside the `team` agent preset only. It contributes the two role
 * sections of the preset — the fixed Team Lead base prompt for a root agent and
 * the teammate base prompt for any subagent of that tree — registers the long
 * playbooks as scoped skills that a session loads only when it needs them, and
 * keeps the official Agent Teams session mode on for every root run of the
 * preset, so leaving Team mode is a preset switch rather than a toggle.
 *
 * Every path here is derived from this module's own location; nothing depends on
 * the machine that installed the bundle.
 *
 * @module dsh-team-mode
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Preset id this row belongs to. */
const TEAM_PRESET_ID = 'team'

/** Section name installed on a root agent. */
const LEAD_SECTION = 'team:lead-role'

/** Section name installed on a teammate. */
const WORKER_SECTION = 'team:teammate-role'

/**
 * Section order: after the plan policy (500) and beside the first-party Team
 * policy (600), before any tool guidance, so the role frames the tools below it.
 */
const ROLE_ORDER = 560

/** Role framing for the root agent of a Team session. */
const LEAD_PROMPT = [
  'You are the Team Lead of this session. Every other agent in this tree is a teammate you create and steer. You own the goal, the decomposition, the review, and the final answer; your teammates own the execution.',
  '',
  '## Operating loop',
  '',
  '1. Restate the goal in one or two sentences and write down the acceptance criteria: what observable evidence will prove the goal is met.',
  '2. Decompose the work into tasks that can be verified on their own. If you cannot say how a teammate result will be checked, the work is not ready to delegate.',
  '3. Record the tasks on the shared board with team_task_create, including the expected write scopes, then dispatch a teammate per task.',
  '4. Verify. Read the diff, run the checks, and compare each result against its acceptance criterion. A "done" claim from a teammate is a progress note, not proof.',
  '5. Integrate the parts and answer.',
  '',
  'This session runs the PTC executor: `run_code` is the only tool you call directly, and every other tool is a same-named binding in the generated SDK.',
  '',
  'Reply in the language the user writes in.',
  '',
  'Load the `team-lead` skill with the skill tool before your first delegation. It carries the rest of this brief — the dispatch contract, the shared-board workflow, write ownership, the verification standard, the PTC program patterns, and the finishing checklist — kept out of the prompt so a session that does not need it does not pay for it.',
].join('\n')

/** Role framing for a teammate of a Team session. */
const WORKER_PROMPT = [
  'You are a teammate on this session\'s Agent Team. The Team Lead owns the goal, the routing, and the final answer; you own the task you were given.',
  '',
  '- Work only inside the scope you were given. Treat every file outside your write scope as read-only, and do not reformat or "clean up" code you were not asked to change.',
  '- This session runs the PTC executor: `run_code` is the only tool you call directly.',
  '',
  'Report back in this shape, at most about 50 lines, with no whole files pasted in:',
  '',
  'STATUS: done | blocked | failed',
  'CHANGES: each file you wrote, one line each',
  'FINDINGS: what the Lead must know that it cannot see from the diff',
  'EVIDENCE: the commands and their results that prove the claim',
  'HANDOFF: exactly what the next member can rely on',
  '',
  'Reply in the language the Lead writes in.',
  '',
  'Load the `team-worker` skill with the skill tool before you claim your task. It carries the rest of this brief — claiming and completing the board task, escalation, and how to verify before claiming success — kept out of the prompt so a teammate that does not need it does not pay for it.',
].join('\n')

/**
 * Whether an agent is a teammate rather than a tree root.
 * @param agent - live agent.
 * @returns true for a subagent-originated session.
 */
function isTeammate(agent) {
  return agent?.session?.header?.origin === 'subagent'
}

/** Playbooks shipped beside this module, loaded by a session only when it asks. */
const PLAYBOOKS = ['team-lead', 'team-worker']

/** Directory of the shipped playbooks, derived from this module's own URL. */
const PLAYBOOK_DIR = join(dirname(fileURLToPath(import.meta.url)), 'skills')

/**
 * Read one shipped playbook and split its frontmatter from its body.
 * @param name - playbook directory name.
 * @returns a runtime skill registration.
 */
function readPlaybook(name) {
  const text = readFileSync(join(PLAYBOOK_DIR, name, 'SKILL.md'), 'utf8')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (match === null) return { name, description: name, content: text }
  const meta = {}
  for (const line of match[1].split(/\r?\n/)) {
    const at = line.indexOf(': ')
    if (at > 0) meta[line.slice(0, at).trim()] = line.slice(at + 2).trim()
  }
  return {
    name: meta.name ?? name,
    description: meta.description ?? name,
    ...meta.whenToUse === undefined ? {} : { whenToUse: meta.whenToUse },
    // `source` is prompt-visible metadata and is required: the registry's load
    // validator rejects a definition without it even though registration passes.
    source: 'bundled',
    content: match[2].replace(/^\s+/, ''),
  }
}

/**
 * Preset plugins export this form; registrations live in the preset scope and
 * are disposed with it.
 * @param ctx - the preset revision scope.
 */
export function apply(ctx) {
  /** Agents that already carry a role section. */
  const sectioned = new WeakSet()
  /** Section disposers, so a disposed agent leaves no registration behind. */
  const disposers = new WeakMap()
  /** Agents that already watch their own session for a committed disable. */
  const guards = new WeakMap()

  const logger = ctx.logger

  const warn = (message) => {
    if (typeof logger?.warn === 'function') logger.warn(message)
  }

  /** Optional file trace for field diagnosis; off unless DSH_TEAM_MODE_TRACE is set. */
  const trace = (message) => {
    if (process.env.DSH_TEAM_MODE_TRACE === undefined) return
    try {
      process.getBuiltinModule('node:fs').appendFileSync(process.env.DSH_TEAM_MODE_TRACE, `${new Date().toISOString()} ${message}\n`)
    } catch { /* tracing must never affect the session */ }
  }

  // The long half of the brief lives in shipped playbooks, registered as scoped
  // runtime skills: only a Session running this preset sees them, and only a
  // Session that asks for one pays for its text.
  const skills = ctx.get('skills')
  if (skills === undefined) {
    warn('team-mode: no skill registry in this composition; the playbooks stay unread')
  } else {
    for (const playbook of PLAYBOOKS) {
      try {
        skills.register(readPlaybook(playbook))
      } catch (error) {
        warn(`team-mode: could not register the ${playbook} playbook: ${String(error)}`)
      }
    }
  }

  /**
   * Whether this agent runs the team preset. An unrecorded or unreadable
   * selection is treated as ours, because the scope already restricts delivery.
   * @param agent - live agent.
   * @returns true when the role section belongs on this agent.
   */
  function belongsToPreset(agent) {
    const presets = ctx.get('agentPresets')
    if (presets === undefined) return true
    let recorded
    try {
      recorded = presets.presetForSession(agent.session)
    } catch {
      return true
    }
    return recorded === undefined || recorded === null || recorded === TEAM_PRESET_ID
  }

  /**
   * Install the role section on one agent, once.
   * @param agent - live agent.
   */
  function installRole(agent) {
    if (sectioned.has(agent)) return
    const systemPrompt = agent?.ctx?.systemPrompt
    if (systemPrompt === undefined) {
      warn('team-mode: this agent exposes no system prompt registry; role section skipped')
      return
    }
    const teammate = isTeammate(agent)
    try {
      const dispose = systemPrompt.section({
        name: teammate ? WORKER_SECTION : LEAD_SECTION,
        order: ROLE_ORDER,
        text: teammate ? WORKER_PROMPT : LEAD_PROMPT,
        // The role text is literal markdown; never treat braces in it as variables.
        interpolate: false,
      })
      disposers.set(agent, dispose)
      sectioned.add(agent)
    } catch (error) {
      warn(`team-mode: could not install the role section: ${String(error)}`)
    }
  }

  /**
   * Drop a role section that outlived its agent.
   * @param agent - disposed agent.
   */
  function removeRole(agent) {
    const dispose = disposers.get(agent)
    if (dispose !== undefined) {
      try {
        dispose()
      } catch (error) {
        warn(`team-mode: could not remove the role section: ${String(error)}`)
      }
    }
    const guard = guards.get(agent)
    if (guard !== undefined) {
      try {
        guard()
      } catch (error) {
        warn(`team-mode: could not remove the session guard: ${String(error)}`)
      }
    }
    disposers.delete(agent)
    guards.delete(agent)
    sectioned.delete(agent)
  }

  /**
   * Watch one root agent's own session for a committed disable.
   *
   * The session publishes `session/event` to the context that entered it, so a
   * listener on the Agent's own context is the one place that reliably receives
   * the record; a preset-scope listener does not.
   * @param agent - live root agent.
   */
  function installModeGuard(agent) {
    if (guards.has(agent) || isTeammate(agent)) return
    const agentCtx = agent?.ctx
    if (typeof agentCtx?.on !== 'function') return
    try {
      const dispose = agentCtx.on('session/event', (session, event) => {
        // Every session event reaches this listener, so classify before tracing.
        if (event?.type !== 'team/mode') return
        if (event.data?.enabled !== false) {
          trace(`guard: enable record on ${String(session.id).slice(-8)}`)
          return
        }
        if (session !== agent.session) return
        void revertDisable(agent, 'guard-event')
      })
      guards.set(agent, dispose)
      trace(`guard: installed on agent=${String(agent.id)}`)
    } catch (error) {
      warn(`team-mode: could not watch the session mode: ${String(error)}`)
    }
  }

  /**
   * Write the Agent Teams selection on for a root agent.
   *
   * A caller can run inside the session's own append publication — the preset
   * switch is emitted from a `session/event` listener, and the disable revert
   * observes the very record it must answer — and a session refuses an append
   * from inside another append's publication. A rejected write therefore waits
   * for the publication to finish and retries instead of giving up.
   * @param agent - candidate root agent.
   * @param signal - optional control signal.
   */
  async function enableTeamMode(agent, signal) {
    if (agent === undefined || isTeammate(agent)) return
    const teams = ctx.get('agentTeams')
    if (teams === undefined) return
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        if (teams.isEnabled(agent)) return
        await teams.setEnabled(agent, true, signal)
        trace(`enable: wrote for ${String(agent.id)} (attempt ${attempt + 1})`)
        return
      } catch (error) {
        const message = String(error)
        if (!message.includes('reenter')) {
          warn(`team-mode: could not enable Agent Teams: ${message}`)
          return
        }
        await new Promise((resolve) => { setTimeout(resolve, 20) })
      }
    }
    warn('team-mode: Agent Teams stayed off after repeated writes')
  }

  /**
   * Undo a committed disable. The post-commit event is dispatched before the
   * projection folds the new record, so reading the mode immediately still
   * reports the previous value; wait for the disable to become visible, then
   * write the enable that the projection reports back.
   * @param agent - root agent whose session was disabled.
   */
  async function revertDisable(agent, origin) {
    const teams = ctx.get('agentTeams')
    trace(`revert(${String(origin)}): enter agent=${String(agent?.id)} teammates=${String(teams === undefined)}`)
    if (teams === undefined || agent === undefined || isTeammate(agent)) return
    try {
      const deadline = Date.now() + 4000
      while (Date.now() < deadline && teams.isEnabled(agent)) {
        await new Promise((resolve) => { setTimeout(resolve, 50) })
      }
      trace(`revert(${String(origin)}): after wait enabled=${String(teams.isEnabled(agent))}`)
      if (teams.isEnabled(agent)) {
        warn('team-mode: a committed disable never became visible; Agent Teams may be off')
        return
      }
      await enableTeamMode(agent)
      const confirmation = Date.now() + 2000
      while (Date.now() < confirmation && !teams.isEnabled(agent)) {
        await new Promise((resolve) => { setTimeout(resolve, 50) })
      }
      if (!teams.isEnabled(agent)) warn('team-mode: the Agent Teams re-enable was not observed')
      else trace(`revert(${String(origin)}): confirmed enabled`)
    } catch (error) {
      trace(`revert(${String(origin)}): error ${String(error)}`)
      warn(`team-mode: could not re-enable Agent Teams: ${String(error)}`)
    }
  }

  ctx.on('agent/created', async ({ agent, signal }) => {
    if (!belongsToPreset(agent)) return
    installRole(agent)
    installModeGuard(agent)
    await enableTeamMode(agent, signal)
  })

  // Switching the session to another preset must also take the role text away:
  // the Agent keeps its context for this run, so the section is removed here
  // rather than waiting for the retired revision to be collected.
  ctx.on('agent-preset/selected', (sessionId, agentPreset) => {
    const agent = ctx.get('agents')?.get(sessionId)
    if (agent === undefined) return
    if (agentPreset !== TEAM_PRESET_ID) {
      removeRole(agent)
      return
    }
    installRole(agent)
    installModeGuard(agent)
    void enableTeamMode(agent)
  })

  ctx.on('agent/disposed', ({ agent }) => {
    removeRole(agent)
  })

  // Last line of defence: no step of a root agent starts while the mode is off,
  // even if a disable landed while the projection was still folding.
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    if (!isTeammate(agent) && ctx.get('agentTeams')?.isEnabled(agent) === false) {
      await enableTeamMode(agent)
    }
    return next()
  })

  // Agents that were already live when this revision activated.
  for (const agent of ctx.get('agents')?.list() ?? []) {
    if (!belongsToPreset(agent)) continue
    installRole(agent)
    installModeGuard(agent)
  }
}

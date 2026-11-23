/**
 * Team mode preset plugin.
 *
 * Mounted inside the `team` agent preset only. It contributes the two role
 * sections of the preset — the Team Lead instructions for a root agent and the
 * teammate instructions for any subagent of that tree — and it keeps the
 * official Agent Teams session mode on for every root run of the preset, so
 * leaving Team mode is a preset switch rather than a toggle.
 *
 * @module @local/dsh-team-mode
 */

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
  '1. Restate the goal in one or two sentences and write down the acceptance criteria: what observable evidence will prove the goal is met. A criterion that no evidence can settle is not a criterion — replace it.',
  '2. Decompose the work into tasks that can be verified on their own. If you cannot say how a teammate result will be checked, the work is not ready to delegate.',
  '3. Record the tasks on the shared board with team_task_create, including the expected write scopes, then dispatch a teammate per task.',
  '4. Verify. Read the diff, run the checks, and compare each result against its acceptance criterion. A "done" claim from a teammate is a progress note, not proof.',
  '5. Integrate the parts and answer.',
  '',
  '## Delegation',
  '',
  '- `subagent` starts a fresh teammate on the same model and working directory; `subagent_fork` seeds one with this conversation. Give every teammate a short unique `name` and a `description` that states the deliverable.',
  '- Start independent dispatches together in one assistant message so they run while you keep working. A wait is not parallelism: do not send one teammate, wait for it, then send the next.',
  '- Write the contract into each prompt: the exact files or directories it owns, the interface or convention it must honor, the checks it must run, and what it must report back.',
  '- Route paths, task ids, and short summaries between members. Never paste a whole file into a prompt. Teammates can reach each other with send_message once they know the names that list_agents shows.',
  '- Do not re-dispatch work a live teammate already owns. Extend an in-flight task with send_message instead.',
  '',
  '## Shared task board',
  '',
  '- Every user ask becomes a board task before you act on it: team_task_create, then claim it or leave it unowned for a teammate.',
  '- The workflow is list, get, claim with the current revision, do the work, complete. Every mutation is compare-and-set; on a conflict re-read the task and retry with the new revision.',
  '- Record expected write scopes so overlapping work is flagged, and use blocked_by when work must be ordered. Overlap is advisory, not a lock: partition the files up front and never let two members edit one file at the same time.',
  '- Task readiness never starts a teammate, and a task change wakes nobody. When a teammate must act on a change, send it a message.',
  '',
  '## Write ownership',
  '',
  '- Partition ownership before you parallelize, and review the final diff yourself before you answer. Your teammates share one checkout, so their edits are already in your working directory.',
  '- You may edit directly only for trivial, non-behavioral touches: a typo, a formatting fix, a configuration value, or a documentation line of about ten lines or less. Behavior changes are dispatched; hand-editing them yourself is a routing bug, not efficiency.',
  '- Assume another member may be writing the same file: re-read before you edit, and leave the tree in a state the checks accept.',
  '',
  '## Verification standard',
  '',
  '- Ask for evidence, not narrative: the command and its output, the test name and its result, the file and line, the page you actually opened.',
  '- If a teammate reports success without evidence, re-dispatch once asking for it. If it still cannot produce evidence, downgrade the claim and say so in the answer.',
  '- Never present unverified state as verified. State what you checked, what you did not check, and what remains uncertain.',
  '- A settled teammate is not a stopped one: settlement means the run ended, not that its side effects are complete. Confirm the deliverable before you rely on it.',
  '',
  '## Finishing',
  '',
  '- Never end a turn while a teammate still owes you a result the answer needs. Collect it with wait_agent, or use send_message to nudge a teammate that went quiet.',
  '- Before you answer: every board task is completed or explicitly abandoned, the final diff is reviewed, and the checks you rely on were run.',
  '- The answer states what changed, the evidence, the residual risk, and links to the files. If the goal is not met, say what remains instead of presenting partial work as complete.',
  '- Reply in the language the user writes in.',
].join('\n')

/** Role framing for a teammate of a Team session. */
const WORKER_PROMPT = [
  'You are a teammate on this session\'s Agent Team. The Team Lead owns the goal, the routing, and the final answer; you own the task you were given.',
  '',
  '- Work only inside the scope you were given. Treat every file outside your write scope as read-only, and do not reformat or "clean up" code you were not asked to change.',
  '- Claim your board task before you start: team_task_list, team_task_get, then team_task_update with action claim and the current revision. Complete it with the revision you just read.',
  '- Do not create teammates of your own. If the work needs another hand, or you are blocked on something outside your scope, report it to the Lead with send_message and let the Lead dispatch.',
  '- Verify before you claim success: run the checks, read the result, and keep the command output you rely on.',
  '- Report back in this shape, at most about 50 lines, with no whole files pasted in:',
  '',
  'STATUS: done | blocked | failed',
  'CHANGES: each file you wrote, one line each',
  'FINDINGS: what the Lead must know that it cannot see from the diff',
  'EVIDENCE: the commands and their results that prove the claim',
  'HANDOFF: exactly what the next member can rely on',
  '',
  '- Say what you did not verify. Never present a guess as a result. Reply in the language the Lead writes in.',
].join('\n')

/**
 * Whether an agent is a teammate rather than a tree root.
 * @param agent - live agent.
 * @returns true for a subagent-originated session.
 */
function isTeammate(agent) {
  return agent?.session?.header?.origin === 'subagent'
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
        trace(`guard: event type=${String(event?.type)} enabled=${String(event?.data?.enabled)} same=${String(session === agent.session)}`)
        if (event?.type !== 'team/mode') return
        if (event.data?.enabled !== false) return
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
   * Keep the official Agent Teams session mode on for a root agent.
   * @param agent - candidate root agent.
   * @param signal - optional control signal.
   */
  async function lockTeamMode(agent, signal) {
    if (agent === undefined || isTeammate(agent)) return
    const teams = ctx.get('agentTeams')
    if (teams === undefined) return
    try {
      if (teams.isEnabled(agent)) return
      await teams.setEnabled(agent, true, signal)
    } catch (error) {
      warn(`team-mode: could not enable Agent Teams for this session: ${String(error)}`)
    }
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
      // The disable is observed while the session is still publishing it, and a
      // session refuses an append from inside another append's publication. Step
      // out of that window first, then let the projection fold the record.
      await new Promise((resolve) => { setTimeout(resolve, 10) })
      const deadline = Date.now() + 4000
      while (Date.now() < deadline && teams.isEnabled(agent)) {
        await new Promise((resolve) => { setTimeout(resolve, 50) })
      }
      trace(`revert(${String(origin)}): after wait enabled=${String(teams.isEnabled(agent))}`)
      if (teams.isEnabled(agent)) {
        warn('team-mode: a committed disable never became visible; Agent Teams may be off')
        return
      }
      // A publication can still be in flight for another record: retry the write.
      let written = false
      for (let attempt = 0; attempt < 20 && !written; attempt += 1) {
        try {
          await teams.setEnabled(agent, true)
          written = true
        } catch (error) {
          const message = String(error)
          if (!message.includes('reenter') || attempt === 19) throw error
          await new Promise((resolve) => { setTimeout(resolve, 25) })
        }
      }
      trace(`revert(${String(origin)}): wrote enable`)
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
    await lockTeamMode(agent, signal)
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
    void lockTeamMode(agent)
  })

  ctx.on('agent/disposed', ({ agent }) => {
    removeRole(agent)
  })

  // Last line of defence: no step of a root agent starts while the mode is off,
  // even if a disable landed while the projection was still folding.
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    await lockTeamMode(agent)
    return next()
  })

  // Agents that were already live when this revision activated.
  for (const agent of ctx.get('agents')?.list() ?? []) {
    if (!belongsToPreset(agent)) continue
    installRole(agent)
    installModeGuard(agent)
  }
}

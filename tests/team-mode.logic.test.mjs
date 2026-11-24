/**
 * Logic harness for the Team preset plugin.
 *
 * Loads `packages/team-mode/index.js` with a fake Cordis context and asserts the
 * behavior the live preset relies on: role sections, the Agent Teams lock, the
 * disable revert on the agent's own session, the pre-step belt, and the preset
 * filter. No DSH runtime is involved.
 *
 * Run: node tests/team-mode.logic.test.mjs
 */
import assert from 'node:assert/strict'
import { apply, playbookProblems } from '../preset.js'

/** Let the plugin's asynchronous revert settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

/** Collected registrations and calls for one fake context. */
function harness({ presetId = 'team', teamsPresent = true, enabled = false } = {}) {
  const presetListeners = new Map()
  const agentListeners = new Map()
  const sections = []
  const skills = []
  const calls = { setEnabled: [], isEnabled: [] }
  const agents = new Map()

  const teams = {
    isEnabled(agent) {
      calls.isEnabled.push(agent)
      return enabled
    },
    async setEnabled(agent, value) {
      calls.setEnabled.push([agent, value])
      enabled = value
    },
  }

  const presets = { presetForSession: (session) => session.preset }

  const ctx = {
    logger: { warn(message) { throw new Error(`unexpected warning: ${message}`) } },
    on(name, handler, options) {
      const list = presetListeners.get(name) ?? []
      list.push({ handler, options })
      presetListeners.set(name, list)
      return () => {
        const current = presetListeners.get(name) ?? []
        presetListeners.set(name, current.filter((entry) => entry.handler !== handler))
      }
    },
    get(name) {
      if (name === 'agentTeams') return teamsPresent ? teams : undefined
      if (name === 'agentPresets') return presets
      if (name === 'agents') return { get: (id) => agents.get(String(id)), list: () => [...agents.values()] }
      if (name === 'skills') return { register(skill) { skills.push(skill); return () => {} } }
      return undefined
    },
  }

  apply(ctx)

  /** Build one fake agent in this preset. */
  const makeAgent = (id, origin) => {
    const listeners = new Map()
    const agent = {
      id,
      session: { id, header: { origin }, preset: presetId },
      ctx: {
        systemPrompt: {
          section(definition) {
            sections.push(definition)
            return () => {
              const index = sections.indexOf(definition)
              if (index >= 0) sections.splice(index, 1)
            }
          },
        },
        on(name, handler) {
          const list = listeners.get(name) ?? []
          list.push(handler)
          listeners.set(name, list)
          return () => listeners.set(name, (listeners.get(name) ?? []).filter((entry) => entry !== handler))
        },
      },
    }
    agents.set(String(id), agent)
    agentListeners.set(agent, listeners)
    return agent
  }

  /** Fire one preset-scope listener. */
  const fire = async (name, ...args) => {
    const results = []
    for (const { handler } of presetListeners.get(name) ?? []) results.push(await handler(...args))
    return results
  }

  /**
   * Commit one `team/mode` record the way the session service does: fold the
   * record first, then publish it to the listeners collected for that session.
   */
  const fireSessionEvent = async (agent, event) => {
    if (event.type === 'team/mode') enabled = event.data.enabled
    for (const handler of agentListeners.get(agent)?.get('session/event') ?? []) handler(agent.session, event)
    await settle()
  }

  return {
    skills,
    listeners: presetListeners,
    agentListeners,
    sections,
    calls,
    agents,
    makeAgent,
    fire,
    fireSessionEvent,
    isEnabled: () => enabled,
  }
}

// A root agent gets the Lead section, watches its own session, and turns Agent Teams on.
{
  const h = harness()
  const agent = h.makeAgent('s1', 'user')
  await h.fire('agent/created', { agent, source: 'startup' })
  assert.equal(h.sections.length, 1)
  assert.equal(h.sections[0].name, 'team:lead-role')
  assert.equal(h.sections[0].order, 560)
  assert.equal(h.sections[0].interpolate, false)
  assert.match(h.sections[0].text, /Team Lead/)
  assert.match(h.sections[0].text, /run_code/)
  assert.match(h.sections[0].text, /team-dispatch`/)
  assert.match(h.sections[0].text, /team-board`/)
  assert.match(h.sections[0].text, /team-verify`/)
  assert.ok(h.sections[0].text.length < 1900, 'Lead role section stays short; the playbook lives in the skill')
  assert.deepEqual(h.calls.setEnabled, [[agent, true]])
  assert.equal(h.isEnabled(), true)
  assert.equal((h.agentListeners.get(agent).get('session/event') ?? []).length, 1)
  assert.deepEqual(h.skills.map((s) => s.name), ['team-board', 'team-conflict', 'team-dispatch', 'team-model-routing', 'team-report', 'team-review', 'team-verify', 'ptc-programs'])
  // Every playbook keeps the sentences it was split from.
  const byName = Object.fromEntries(h.skills.map((s) => [s.name, s]))
  assert.match(byName['team-dispatch'].content, /## Delegation/)
  assert.match(byName['team-dispatch'].content, /## Program-based tool calls/)
  assert.match(byName['team-board'].content, /team_task_update with action claim/)
  assert.match(byName['team-verify'].content, /Never present unverified state as verified/)
  assert.match(byName['team-report'].content, /STATUS: done \| blocked \| failed/)
  assert.match(byName['team-conflict'].content, /One file, one writer/)
  assert.match(byName['team-review'].content, /cannot be delegated to the member that wrote it/)
  assert.match(byName['team-model-routing'].content, /When not to dispatch/)
  assert.match(byName['ptc-programs'].content, /One program, one unit of work/)
  assert.ok(h.skills[0].description.length > 20)
  assert.equal(h.skills[0].source, 'bundled')
  console.log('ok: root agent gets the Lead section, a session guard, Agent Teams on, and both playbooks as skills')
}

// A teammate gets the teammate section, never writes the mode, and gets no guard.
{
  const h = harness()
  const agent = h.makeAgent('s2', 'subagent')
  await h.fire('agent/created', { agent, source: 'startup' })
  assert.equal(h.sections.length, 1)
  assert.equal(h.sections[0].name, 'team:teammate-role')
  assert.match(h.sections[0].text, /STATUS: done \| blocked \| failed/)
  assert.match(h.sections[0].text, /run_code/)
  assert.match(h.sections[0].text, /team-report`/)
  assert.match(h.sections[0].text, /team-board`/)
  assert.ok(h.sections[0].text.length < 1500, 'teammate role section stays short; the playbook lives in the skill')
  assert.deepEqual(h.calls.setEnabled, [])
  assert.equal((h.agentListeners.get(agent).get('session/event') ?? []).length, 0)
  console.log('ok: a teammate gets the worker section, no mode write, and no guard')
}

// An already-enabled root agent is not written again.
{
  const h = harness({ enabled: true })
  await h.fire('agent/created', { agent: h.makeAgent('s3', 'user'), source: 'resume' })
  assert.deepEqual(h.calls.setEnabled, [])
  console.log('ok: an enabled root agent costs one read and no write')
}

// A disable committed later in the run is reverted by the agent's own guard.
{
  const h = harness({ enabled: true })
  const agent = h.makeAgent('s4', 'user')
  await h.fire('agent/created', { agent, source: 'startup' })
  await h.fireSessionEvent(agent, { type: 'team/mode', data: { enabled: false } })
  assert.deepEqual(h.calls.setEnabled, [[agent, true]])
  assert.equal(h.isEnabled(), true)
  console.log('ok: a committed disable is reverted')
}

// An enable event, another session's record, and other event types are ignored.
{
  const h = harness({ enabled: true })
  const agent = h.makeAgent('s5', 'user')
  await h.fire('agent/created', { agent, source: 'startup' })
  await h.fireSessionEvent(agent, { type: 'team/mode', data: { enabled: true } })
  await h.fireSessionEvent(agent, { type: 'goal/change', data: {} })
  const other = h.makeAgent('s5b', 'user')
  await h.fire('agent/created', { agent: other, source: 'startup' })
  const enabledBefore = h.calls.setEnabled.length
  for (const handler of h.agentListeners.get(agent).get('session/event') ?? []) {
    handler(other.session, { type: 'team/mode', data: { enabled: false } })
  }
  await settle()
  assert.equal(h.calls.setEnabled.length, enabledBefore)
  console.log('ok: enable records, other sessions, and other events are ignored')
}

// A session of another preset never receives the role section.
{
  const h = harness({ enabled: true })
  const other = h.makeAgent('s6', 'user')
  other.session.preset = 'standard'
  await h.fire('agent/created', { agent: other, source: 'startup' })
  assert.equal(h.sections.length, 0)
  console.log('ok: another preset is left alone')
}

// A step cannot start while the mode is off.
{
  const h = harness({ enabled: false })
  const agent = h.makeAgent('s7', 'user')
  let nextRan = false
  await h.fire('agent/pre-step', { agent }, async () => { nextRan = true; return { kind: 'continue' } })
  assert.equal(nextRan, true)
  assert.deepEqual(h.calls.setEnabled, [[agent, true]])
  console.log('ok: the pre-step belt re-enables the mode before a step')
}

// Disposing an agent drops its section and its guard.
{
  const h = harness()
  const agent = h.makeAgent('s8', 'user')
  await h.fire('agent/created', { agent, source: 'startup' })
  assert.equal(h.sections.length, 1)
  await h.fire('agent/disposed', { agent })
  assert.equal(h.sections.length, 0)
  assert.equal((h.agentListeners.get(agent).get('session/event') ?? []).length, 0)
  console.log('ok: a disposed agent loses its section and guard')
}

// Selecting the preset installs the section; leaving it removes the section.
{
  const h = harness({ enabled: true })
  const agent = h.makeAgent('s9', 'user')
  await h.fire('agent-preset/selected', 's9', 'team')
  assert.equal(h.sections.length, 1)
  await h.fire('agent-preset/selected', 's9', 'ptc')
  assert.equal(h.sections.length, 0)
  assert.deepEqual(h.calls.setEnabled, [])
  console.log('ok: selecting the preset installs the role section, leaving it removes the section')
}

// A profile without the Team packages does not break agent creation.
{
  const h = harness({ teamsPresent: false })
  await h.fire('agent/created', { agent: h.makeAgent('s10', 'user'), source: 'startup' })
  assert.equal(h.sections.length, 1)
  console.log('ok: a missing agentTeams service degrades to prompt-only')
}

// The load validator is stricter than registration: a missing field must be caught here.
{
  const problems = playbookProblems({ name: 'team-lead', description: 'd', content: 'c' })
  assert.deepEqual(problems, ['source must be a non-empty string'])
  assert.deepEqual(playbookProblems({ name: 'Team Lead', description: 'd', content: 'c', source: 'bundled' }), ['name "Team Lead" is not kebab-case'])
  assert.deepEqual(playbookProblems({ name: 'team-lead', description: '', content: 'c', source: 'bundled' }), ['description must be a non-empty string'])
  assert.deepEqual(playbookProblems({ name: 'team-lead', description: 'd', content: 'c', source: 'bundled', whenToUse: 3 }), ['whenToUse must be a string'])
  assert.deepEqual(playbookProblems({ name: 'team-lead', description: 'd', content: 'c', source: 'bundled' }), [])
  console.log('ok: an incomplete playbook registration is reported instead of registered')
}

console.log('\nall team-mode logic checks passed')

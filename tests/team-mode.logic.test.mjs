/**
 * Logic harness for the Team preset plugin.
 *
 * Loads `packages/team-mode/index.js` with a fake Cordis context and asserts the
 * behavior the live preset relies on: role sections, the Agent Teams lock, the
 * disable revert, and the preset filter. No DSH runtime is involved.
 *
 * Run: node tests/team-mode.logic.test.mjs
 */
import assert from 'node:assert/strict'
import { apply } from '../packages/team-mode/index.js'

/** Collected registrations and calls for one fake context. */
function harness({ presetId = 'team', teamsPresent = true, enabled = false } = {}) {
  const listeners = new Map()
  const sections = []
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

  const presets = {
    presetForSession(session) {
      return session.preset
    },
  }

  const systemPrompt = {
    section(definition) {
      sections.push(definition)
      return () => {
        const index = sections.indexOf(definition)
        if (index >= 0) sections.splice(index, 1)
      }
    },
  }

  const ctx = {
    logger: { warn(message) { throw new Error(`unexpected warning: ${message}`) } },
    on(name, handler, options) {
      const list = listeners.get(name) ?? []
      list.push({ handler, options })
      listeners.set(name, list)
      return () => {}
    },
    get(name) {
      if (name === 'agentTeams') return teamsPresent ? teams : undefined
      if (name === 'agentPresets') return presets
      if (name === 'agents') {
        return {
          get: (id) => agents.get(String(id)),
          list: () => [...agents.values()],
        }
      }
      return undefined
    },
  }

  apply(ctx)

  /** Build one fake agent in this preset. */
  const makeAgent = (id, origin) => {
    const agent = {
      id,
      session: { id, header: { origin }, preset: presetId },
      ctx: { systemPrompt },
    }
    agents.set(String(id), agent)
    return agent
  }

  /** Fire one registered listener. */
  const fire = async (name, ...args) => {
    // A committed `team/mode` record is what the service reads back, so the fake
    // folds the record before the post-commit fan-out runs.
    if (name === 'session/event' && args[1]?.type === 'team/mode') enabled = args[1].data.enabled
    const results = []
    for (const { handler } of listeners.get(name) ?? []) results.push(await handler(...args))
    return results
  }

  return { ctx, listeners, sections, calls, agents, makeAgent, fire, isEnabled: () => enabled }
}

// A root agent gets the Lead section and turns Agent Teams on.
{
  const h = harness()
  const agent = h.makeAgent('s1', 'user')
  await h.fire('agent/created', { agent, source: 'startup' })
  assert.equal(h.sections.length, 1)
  assert.equal(h.sections[0].name, 'team:lead-role')
  assert.equal(h.sections[0].order, 560)
  assert.equal(h.sections[0].interpolate, false)
  assert.match(h.sections[0].text, /Team Lead/)
  assert.deepEqual(h.calls.setEnabled, [[agent, true]])
  assert.equal(h.isEnabled(), true)
  console.log('ok: root agent gets the Lead section and Agent Teams is enabled')
}

// A teammate gets the teammate section and never writes the mode.
{
  const h = harness()
  const agent = h.makeAgent('s2', 'subagent')
  await h.fire('agent/created', { agent, source: 'startup' })
  assert.equal(h.sections.length, 1)
  assert.equal(h.sections[0].name, 'team:teammate-role')
  assert.match(h.sections[0].text, /STATUS: done \| blocked \| failed/)
  assert.deepEqual(h.calls.setEnabled, [])
  console.log('ok: a teammate gets the worker section and never toggles the mode')
}

// An already-enabled root agent is not written again.
{
  const h = harness({ enabled: true })
  await h.fire('agent/created', { agent: h.makeAgent('s3', 'user'), source: 'resume' })
  assert.deepEqual(h.calls.setEnabled, [])
  console.log('ok: an enabled root agent costs one read and no write')
}

// A disable written later in the run is reverted.
{
  const h = harness({ enabled: true })
  const agent = h.makeAgent('s4', 'user')
  await h.fire('agent/created', { agent, source: 'startup' })
  await h.fire('session/event', agent.session, { type: 'team/mode', data: { enabled: false } })
  assert.deepEqual(h.calls.setEnabled, [[agent, true]])
  console.log('ok: a committed disable is reverted')
}

// An enable event, another session, and another preset are left alone.
{
  const h = harness({ enabled: true })
  const agent = h.makeAgent('s5', 'user')
  await h.fire('session/event', agent.session, { type: 'team/mode', data: { enabled: true } })
  await h.fire('session/event', { id: 'other', preset: 'ptc' }, { type: 'team/mode', data: { enabled: false } })
  await h.fire('session/event', agent.session, { type: 'goal/change', data: {} })
  assert.deepEqual(h.calls.setEnabled, [])

  const other = h.makeAgent('s6', 'user')
  other.session.preset = 'standard'
  await h.fire('agent/created', { agent: other, source: 'startup' })
  assert.equal(h.sections.length, 0)
  console.log('ok: enable events, other sessions, other presets and other events are ignored')
}

// Disposing an agent drops its section.
{
  const h = harness()
  const agent = h.makeAgent('s7', 'user')
  await h.fire('agent/created', { agent, source: 'startup' })
  assert.equal(h.sections.length, 1)
  await h.fire('agent/disposed', { agent })
  assert.equal(h.sections.length, 0)
  console.log('ok: a disposed agent loses its section')
}

// Selecting the preset installs the section on a live agent; leaving it removes the section.
{
  const h = harness({ enabled: true })
  const agent = h.makeAgent('s8', 'user')
  await h.fire('agent-preset/selected', 's8', 'team')
  assert.equal(h.sections.length, 1)
  await h.fire('agent-preset/selected', 's8', 'ptc')
  assert.equal(h.sections.length, 0)
  assert.deepEqual(h.calls.setEnabled, [])
  console.log('ok: selecting the preset installs the role section, leaving it removes the section')
}

// A profile without the Team packages does not break agent creation.
{
  const h = harness({ teamsPresent: false })
  await h.fire('agent/created', { agent: h.makeAgent('s9', 'user'), source: 'startup' })
  assert.equal(h.sections.length, 1)
  console.log('ok: a missing agentTeams service degrades to prompt-only')
}

// The durable revert listener is a global one, so it sees root Sessions of this preset.
{
  const h = harness()
  const [entry] = h.listeners.get('session/event')
  assert.equal(entry.options?.global, true)
  console.log('ok: the disable listener is registered globally')
}

console.log('\nall team-mode logic checks passed')

/**
 * Temporary diagnostic for the Team preset.
 *
 * Phase 1 writes the live preset roster, retained revisions, and composition
 * rows. Phase 2 creates one Session on the `team` preset in this isolated Host,
 * then reports whether Agent Teams is on, whether the Lead role section reached
 * prompt assembly, and finally disposes the agent. Nothing here touches a model
 * route, and the bundle is uninstalled after the report is read.
 *
 * @module @local/dsh-team-probe
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

/** Where the report lands. */
const REPORT_PATH = 'D:/Github/DSH-TeamAgent/.probe/report.json'

/** Wait long enough for the profile Loader to settle after this row activates. */
const DELAY_MS = 5000

/** Scratch directory the probe Session owns. */
const CWD = 'D:/Github/DSH-TeamAgent/.probe/workspace'

/**
 * Load `scopeOf` from the running installation's own scope package. A plugin
 * module cannot resolve installation packages by bare name, so the absolute
 * URL is derived from the Electron resource root instead.
 * @returns the `scopeOf` helper.
 */
async function loadScopeOf() {
  const candidates = []
  if (typeof process.resourcesPath === 'string') {
    candidates.push(join(process.resourcesPath, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-scope', 'lib', 'index.js'))
  }
  candidates.push('D:/DSH/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-scope/lib/index.js')
  let last
  for (const candidate of candidates) {
    try {
      const module = await import(pathToFileURL(candidate).href)
      if (typeof module.scopeOf === 'function') return module.scopeOf
    } catch (error) {
      last = error
    }
  }
  throw new Error(`cannot load dsh-scope: ${String(last)}`)
}

/**
 * Read the roster and composition state of this Host.
 * @param ctx - host plugin context.
 * @returns serializable roster, revisions, and composition rows.
 */
async function rosterReport(ctx) {
  const out = { presets: [], inspections: [], compositions: [] }
  const presets = ctx.get('agentPresets')
  if (presets === undefined) {
    out.error = 'agentPresets service is absent'
    return out
  }
  out.presets = (await presets.list()).map((p) => ({ id: p.id, name: p.name, order: p.order, broken: p.broken }))
  out.inspections = presets.inspectCompositions().map((i) => ({
    id: i.id,
    modules: i.modules.map((m) => m.moduleName),
    leakedServices: i.leakedServices,
  }))
  out.compositions = (await presets.compositionInventory()).map((c) => ({
    id: c.id,
    name: c.name,
    broken: c.broken,
    rows: c.rows.map((r) => `${r.entryId}:${r.moduleName}:${String(r.enabled)}:${String(r.fiberState)}`),
  }))
  return out
}

/**
 * Create one Session on the team preset and read what its Agent received.
 * @param ctx - host plugin context.
 * @param out - object the observations are written into, so a late failure keeps earlier ones.
 */
async function liveReport(ctx, out) {
  const presets = ctx.get('agentPresets')
  const agents = ctx.get('agents')
  const teams = ctx.get('agentTeams')
  const prompts = ctx.get('systemPrompt')
  if (presets === undefined || agents === undefined) {
    out.error = 'preset registry or agent service is absent'
    return
  }
  mkdirSync(CWD, { recursive: true })
  const resolvedId = (await presets.resolve('team')).id
  out.resolvedPreset = resolvedId
  const handle = await agents.create({
    sessionId: `session-${randomUUID()}`,
    meta: { cwd: CWD, agentPreset: resolvedId },
    setup: async (agentCtx) => { await presets.mount(agentCtx, resolvedId) },
  })
  try {
    const agent = handle.agent
    out.sessionId = String(agent.session.id)
    out.sessionHeaderPreset = agent.session.header.agentPreset
    out.teamModeEnabled = teams === undefined ? 'no agentTeams service' : teams.isEnabled(agent)
    const scopeOf = await loadScopeOf()
    const assembly = await prompts.assemble({ scope: scopeOf(agent.ctx) })
    out.sections = assembly.sections.map((s) => s.name)
    const lead = assembly.sections.find((s) => s.name === 'team:lead-role')
    out.leadSection = lead === undefined ? null : {
      chars: lead.text.length,
      firstLine: lead.text.split('\n')[0],
      mentionsSharedTaskBoard: lead.text.includes('team_task_create'),
      mentionsTeammates: lead.text.includes('subagent_fork'),
    }
    const role = assembly.sections.find((s) => s.name === 'team:teammate-role')
    out.teammateSectionOnRoot = role === undefined ? 'absent' : 'present'
    out.tools = assembly.tools.map((t) => t.name).filter((n) => n.startsWith('team_task') || n === 'subagent' || n === 'send_message' || n === 'wait_agent' || n === 'list_agents')

    // A committed disable must be reverted by the preset plugin, not merely ignored.
    /** Every durable `team/mode` record this Session has committed. */
    const modeRecords = () => (agent.session.snapshotEvents(0) ?? [])
      .filter((e) => e.type === 'team/mode')
      .map((e) => e.data?.enabled)
    let agentCtxSaw = 0
    let sameSessionObject = null
    agent.ctx.on('session/event', (session, event) => {
      if (event?.type !== 'team/mode') return
      agentCtxSaw += 1
      sameSessionObject = session === agent.session
    })
    if (teams !== undefined) {
      out.modeRecordsBeforeDisable = modeRecords()
      await teams.setEnabled(agent, false)
      out.modeRecordsAfterDisable = modeRecords()
      await new Promise((resolve) => setTimeout(resolve, 2500))
      out.modeRecordsAfterRevert = modeRecords()
      out.teamModeAfterRevert = teams.isEnabled(agent)
      out.agentCtxListenerSaw = agentCtxSaw
      out.sameSessionObject = sameSessionObject
    }

    // A teammate (a Session whose header says `subagent`) must receive the other role section.
    const child = await agents.create({
      sessionId: `session-${randomUUID()}`,
      meta: { cwd: CWD, agentPreset: resolvedId, origin: 'subagent', delegationDepth: 1 },
      setup: async (agentCtx) => { await presets.mount(agentCtx, resolvedId) },
    })
    try {
      const childScopeOf = await loadScopeOf()
      const childAssembly = await prompts.assemble({ scope: childScopeOf(child.agent.ctx) })
      out.teammateSections = childAssembly.sections.map((s) => s.name).filter((n) => n.startsWith('team:'))
      const teammate = childAssembly.sections.find((s) => s.name === 'team:teammate-role')
      out.teammateSection = teammate === undefined ? null : {
        chars: teammate.text.length,
        mentionsReportSkeleton: teammate.text.includes('STATUS: done | blocked | failed'),
        mentionsClaim: teammate.text.includes('team_task_update'),
      }
      out.teammateTeamMode = teams === undefined ? 'no agentTeams service' : teams.isEnabled(child.agent)
    } finally {
      await child.dispose()
    }
  } finally {
    await handle.dispose()
    out.disposed = true
  }
}

async function report(ctx) {
  const out = { at: new Date().toISOString(), services: {}, error: undefined }
  try {
    for (const name of ['agentPresets', 'agentTeams', 'subagents', 'systemPrompt', 'sessions']) {
      out.services[name] = ctx.get(name) !== undefined
    }
    Object.assign(out, await rosterReport(ctx))
    out.live = {}
    try {
      await liveReport(ctx, out.live)
    } catch (error) {
      out.live.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    }
  } catch (error) {
    out.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  }
  try {
    mkdirSync(dirname(REPORT_PATH), { recursive: true })
    writeFileSync(REPORT_PATH, JSON.stringify(out, undefined, 2))
  } catch (error) {
    ctx.logger?.warn?.(`team-mode-probe: cannot write ${REPORT_PATH}: ${String(error)}`)
  }
}

/**
 * Plugin entry: schedule one report and forget about it.
 * @param ctx - host plugin context.
 */
export function apply(ctx) {
  const seen = { scoped: [], global: [] }
  ctx.on('session/event', (session, event) => {
    if (event?.type === 'team/mode') seen.scoped.push(event.data?.enabled)
  })
  ctx.on('session/event', (session, event) => {
    if (event?.type === 'team/mode') seen.global.push(event.data?.enabled)
  }, { global: true })
  ctx.effect(() => {
    const timer = setTimeout(() => {
      void report(ctx).then(() => {
        try {
          const current = JSON.parse(readFileSync(REPORT_PATH, 'utf8'))
          current.hostListeners = seen
          writeFileSync(REPORT_PATH, JSON.stringify(current, undefined, 2))
        } catch { /* the first write already reported the failure */ }
      })
    }, DELAY_MS)
    return () => { clearTimeout(timer) }
  }, 'team-mode-probe.report')
}

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
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Repository root, derived from this module so no checkout path is hardcoded. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Where the report lands. */
const REPORT_PATH = join(REPO_ROOT, '.probe', 'report.json')

/** Wait long enough for the profile Loader to settle after this row activates. */
const DELAY_MS = 5000

/** Scratch directory the probe Session owns. */
const CWD = join(REPO_ROOT, '.probe', 'workspace')

/**
 * Load `scopeOf` from the running installation's own scope package. A plugin
 * module cannot resolve installation packages by bare name, so the absolute URL
 * is derived from the Electron resource root instead.
 * @returns the `scopeOf` helper.
 */
async function loadScopeOf() {
  const candidates = []
  if (typeof process.resourcesPath === 'string') {
    candidates.push(join(process.resourcesPath, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-scope', 'lib', 'index.js'))
    candidates.push(join(process.resourcesPath, 'app', 'node_modules', '@deepseek-ai', 'dsh-scope', 'lib', 'index.js'))
  }
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
    // Runtime skills registered by a preset plugin live in that preset's scope,
    // so the catalog only answers with the agent's scope key.
    try {
      const listed = await ctx.get('skills').list({ cwd: CWD, scope: scopeOf(agent.ctx) })
      out.skillCatalogForAgent = listed.map((s) => s.name)
    } catch (error) {
      out.skillCatalogForAgent = `error: ${String(error?.message ?? error)}`
    }
    // Loading is stricter than registration: this is the path the skill tool uses.
    out.skillLoad = {}
    for (const skillName of ['team-board', 'team-dispatch', 'team-verify', 'team-report']) {
      try {
        const loaded = await ctx.get('skills').get(skillName, { cwd: CWD, scope: scopeOf(agent.ctx) })
        out.skillLoad[skillName] = loaded === undefined
          ? 'undefined'
          : { chars: loaded.content.length, source: loaded.source, description: loaded.description.slice(0, 60) }
      } catch (error) {
        out.skillLoad[skillName] = `error: ${String(error?.message ?? error)}`
      }
    }
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
    out.toolNames = assembly.tools.map((t) => t.name)
    /** Which prompt contribution carries the skill catalog, and whether our skills are in it. */
    const findSkill = (assemblyPart, needle) => {
      const hits = []
      for (const part of assemblyPart) {
        if (part.text.includes(needle)) hits.push({ name: part.name, chars: part.text.length })
      }
      return hits
    }
    out.skillHitsSections = findSkill(assembly.sections, 'team-lead')
    out.skillHitsContexts = findSkill(assembly.contexts ?? [], 'team-lead')
    out.workerSkillVisibleToLead = assembly.sections.some((s) => s.text.includes('team-worker'))
    out.sdkSections = assembly.sections
      .filter((s) => s.text.includes('team_task_create') && s.name !== 'team:lead-role')
      .map((s) => ({ name: s.name, chars: s.text.length, hasRunCode: s.text.includes('run_code') }))

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

    // Switching an existing Session onto the team preset (the picker path) must
    // enable the mode as well: that write runs inside the session's own
    // append publication, which is where the earlier implementation failed.
    const switched = await agents.create({
      sessionId: `session-${randomUUID()}`,
      meta: { cwd: CWD, agentPreset: 'standard' },
      setup: async (agentCtx) => { await presets.mount(agentCtx, 'standard') },
    })
    try {
      out.switchModeBefore = teams === undefined ? 'no agentTeams service' : teams.isEnabled(switched.agent)
      await presets.select(switched.agent, 'team')
      await new Promise((resolve) => setTimeout(resolve, 1500))
      out.switchModeAfter = teams === undefined ? 'no agentTeams service' : teams.isEnabled(switched.agent)
      const switchedScopeOf = await loadScopeOf()
      const switchedAssembly = await prompts.assemble({ scope: switchedScopeOf(switched.agent.ctx) })
      out.switchSections = switchedAssembly.sections.map((s) => s.name).filter((n) => n.startsWith('team:'))
      out.switchModeRecords = (switched.agent.session.snapshotEvents(0) ?? [])
        .filter((e) => e.type === 'team/mode')
        .map((e) => e.data?.enabled)
    } finally {
      await switched.dispose()
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
      try {
        const childScopeOf = await loadScopeOf()
        const childCatalog = await ctx.get('skills').list({ cwd: CWD, scope: childScopeOf(child.agent.ctx) })
        out.teammateCatalog = childCatalog.map((s) => s.name)
      } catch (error) {
        out.teammateCatalog = `error: ${String(error?.message ?? error)}`
      }
      out.teammateToolNames = childAssembly.tools.map((t) => t.name)
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
  out.env = {
    bundledSkillDir: process.env.DSH_BUNDLED_SKILL_DIR ?? null,
    dshHome: process.env.DSH_HOME ?? null,
  }
  out.skillResolution = []
  const profile = ctx.get('profileContext')
  // Evaluate the deployment expressions exactly as the Loader does: `with (ctx)`,
  // baseUrl from the profile tree, and the runtime package interception.
  const evaluate = new Function('ctx', 'expr', 'with (ctx) { return eval(expr) }')
  for (const spec of ['@deepseek-ai/dsh-agent-preset/package.json', 'dsh-team-mode/package.json']) {
    const expr = `process.getBuiltinModule('node:path').join(process.getBuiltinModule('node:path').dirname(process.getBuiltinModule('node:module').createRequire(baseUrl).resolve('${spec}')), 'skills')`
    try {
      const { baseUrl } = ctx
      const resolved = evaluate({ baseUrl, get: (name) => ctx.get(name) }, expr)
      let hasLead = false
      try { readFileSync(join(resolved, 'team-lead', 'SKILL.md')) ; hasLead = true } catch { hasLead = false }
      out.skillResolution.push({ spec, resolved, hasLeadSkill: hasLead })
    } catch (error) {
      out.skillResolution.push({ spec, error: String(error?.message ?? error) })
    }
  }
  out.skillCatalog = 'not read'
  try {
    const skills = ctx.get('skills')
    if (skills === undefined) {
      out.skillCatalog = 'no skills service'
    } else {
      let list
      try { list = await skills.list({ cwd: CWD }) } catch { list = await skills.list() }
      out.skillCatalog = list.map((s) => s.name)
    }
  } catch (error) {
    out.skillCatalog = `error: ${String(error?.message ?? error)}`
  }
  out.clientModules = 'not read'
  try {
    const clientModules = ctx.get('clientModules')
    if (clientModules === undefined) {
      out.clientModules = 'no client modules service'
    } else {
      const graph = clientModules.graph()
      out.clientModules = {
        registersBundle: JSON.stringify(graph).includes('dsh-team-mode'),
        clientPath: clientModules.clientPath('dsh-team-mode') ?? null,
        baseline: clientModules.artifactBaseline('dsh-team-mode') ?? null,
      }
    }
  } catch (error) {
    out.clientModules = `error: ${String(error?.message ?? error)}`
  }
  try {
    for (const name of ['agentPresets', 'agentTeams', 'subagents', 'systemPrompt', 'sessions', 'skills']) {
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

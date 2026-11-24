/**
 * Package root: the Host half this bundle mounts in the profile.
 *
 * Two jobs:
 *
 * 1. The client module scanner discovers a package's browser half through a
 *    Loader row that names the package *root* — a subpath entry is not a client
 *    row — so the profile mounts this module and gets the version card.
 * 2. The card's "restart now" button needs a Host action. DSH exposes no restart
 *    Remote to plugins (only the client text "please restart"), so this module
 *    registers one HTTP route and, on request, spawns a detached helper that
 *    waits for the response to land, stops this application, and starts it again.
 *
 * The preset must own everything else: mounting the preset plugin here would
 * register the role sections, the playbooks, and the Agent Teams lock for every
 * session in the profile. That plugin lives in `./preset`; the card lives in
 * `./client`.
 *
 * @module dsh-team-mode
 */

import { spawn } from 'node:child_process'
import { mkdirSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Route the card posts to. Same origin as the page that serves it. */
export const RESTART_ROUTE = '/dsh-team-mode/restart'
/** Header the card must send, so another local page cannot trigger a restart. */
export const RESTART_HEADER = 'x-dsh-team-mode'

/** Base name used to stop the running application on Windows. */
const WINDOWS_PROCESS_NAME = 'deepseek harness'

/**
 * Build the route handler.
 *
 * Kept as a factory so the restart side effect can be replaced in tests.
 * @param options - restart mechanism and where to log it.
 * @returns a handler owning the response lifecycle.
 */
export function createRestartHandler(options) {
  const { restart, logPath } = options
  /** Append one diagnostic line; a logging failure never fails the request. */
  const log = (line) => {
    if (logPath === undefined) return
    try {
      mkdirSync(dirname(logPath), { recursive: true })
      appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`, 'utf8')
    } catch {
      // Diagnostics only.
    }
  }
  return async function handleRestart(request, response) {
    /** Answer one JSON body and close. */
    const reply = (status, body) => {
      const text = JSON.stringify(body)
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      response.end(text)
    }
    if (request.method !== 'POST') {
      reply(405, { ok: false, error: 'POST only' })
      return
    }
    if (request.headers[RESTART_HEADER] === undefined) {
      reply(403, { ok: false, error: `missing ${RESTART_HEADER} header` })
      return
    }
    try {
      const outcome = await restart()
      log(`restart requested (${outcome.mode})`)
      reply(202, { ok: true, mode: outcome.mode })
    } catch (error) {
      log(`restart failed: ${String(error?.message ?? error)}`)
      reply(500, { ok: false, error: String(error?.message ?? error) })
    }
  }
}

/**
 * Stop this application and start it again from one detached helper process.
 *
 * The helper is spawned before the reply is sent, then waits 1.5 s so the
 * response reaches the page and the card can say what is happening. It is
 * detached and unref'd so stopping the application does not stop it.
 * @param options - executable to relaunch, process name to stop, or an injectable spawner.
 * @returns the mode that was started.
 */
export async function spawnDetachedRestart(options = {}) {
  const platform = options.platform ?? process.platform
  const executable = options.executable ?? process.execPath
  const processName = options.processName ?? WINDOWS_PROCESS_NAME
  const spawnImpl = options.spawnImpl ?? spawn
  const env = options.env ?? process.env
  const isElectron = options.isElectron ?? process.versions.electron !== undefined
  if (platform !== 'win32') {
    throw new Error(`restart is implemented for Windows only, this host is ${platform}`)
  }
  if (isElectron !== true) {
    throw new Error('restart needs the desktop application; this host runs plain Node, so restart DSH by hand')
  }
  if (typeof executable !== 'string' || !/\.exe$/i.test(executable)) {
    throw new Error(`unexpected host executable ${JSON.stringify(executable)}; expected the application's .exe`)
  }
  const script = [
    'Start-Sleep -Milliseconds 1500',
    `Get-Process -Name '${processName}' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue`,
    'Start-Sleep -Milliseconds 1200',
    'Start-Process -FilePath $env:DSH_TEAM_MODE_RESTART_EXE',
  ].join('; ')
  const helper = spawnImpl(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...env, DSH_TEAM_MODE_RESTART_EXE: executable },
    },
  )
  helper.unref?.()
  return { mode: 'detached-helper' }
}

/**
 * Plugin entry: publish the restart route when the profile serves HTTP.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  const logPath = process.env.DSH_PROFILE_DIR === undefined
    ? undefined
    : join(process.env.DSH_PROFILE_DIR, '.dsh-team-mode', 'restart.log')
  // The web server may mount after this row, so wait for the service instead of
  // reading it once: a headless profile never gets one, and then there is no page
  // with a button to answer.
  ctx.inject(['webServer'], (webCtx) => {
    const handler = createRestartHandler({
      logPath,
      restart: () => spawnDetachedRestart({ executable: process.execPath }),
    })
    webCtx.effect(
      () => webCtx.webServer.register({ kind: 'exact', path: RESTART_ROUTE, handler }),
      'dsh-team-mode: restart route',
    )
  })
}

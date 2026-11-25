/**
 * Package root: the Host half this bundle mounts in the profile.
 *
 * Two jobs:
 *
 * 1. The client module scanner discovers a package's browser half through a
 *    Loader row that names the package *root* — a subpath entry is not a client
 *    row — so the profile mounts this module and gets the version card.
 * 2. The card needs facts and one action that DSH does not expose to plugins:
 *    whether the running code is older than the files on disk, and a way to
 *    restart. So this module registers two exact routes under `webServer`:
 *    `GET /dsh-team-mode/status` reports the comparison, and
 *    `POST /dsh-team-mode/restart` spawns a detached helper that stops this
 *    application and starts it again.
 *
 * The version comparison is exact rather than heuristic: this module reads its
 * own `package.json` once at load (the version the running code came from) and
 * again per request (the version now on disk). A difference means a restart is
 * pending, whatever the install call reported.
 *
 * The preset must own everything else: mounting the preset plugin here would
 * register the role sections, the playbooks, and the Agent Teams lock for every
 * session in the profile. That plugin lives in `./preset`; the card lives in
 * `./client`.
 *
 * @module dsh-team-mode
 */

import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

/** Route the card posts to. Same origin as the page that serves it. */
export const RESTART_ROUTE = '/dsh-team-mode/restart'
/** Route the card reads to learn whether the running code is stale. */
export const STATUS_ROUTE = '/dsh-team-mode/status'
/** Header the card must send, so another local page cannot trigger a restart. */
export const RESTART_HEADER = 'x-dsh-team-mode'

/** This module's own manifest, so the comparison needs no configuration. */
const MANIFEST_PATH = join(dirname(fileURLToPath(import.meta.url)), 'package.json')

/** Base name used to stop the running application on Windows. */
const WINDOWS_PROCESS_NAME = 'deepseek harness'

/**
 * Read one field from a manifest.
 * @param path - manifest to read.
 * @returns the parsed version, or undefined when it cannot be read.
 */
function readVersion(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return typeof parsed?.version === 'string' ? parsed.version : undefined
  } catch {
    return undefined
  }
}

/** The version this module was loaded from, captured once. */
const LOADED_VERSION = readVersion(MANIFEST_PATH)

/**
 * Answer whether the running code matches the files on disk.
 * @param options - version to report as loaded, and where to read the current one.
 * @returns the comparison body.
 */
export function statusOf(options = {}) {
  const loadedVersion = options.loadedVersion ?? LOADED_VERSION ?? null
  // An injected reader is authoritative: a caller testing the "unreadable disk"
  // case must not be answered from the real manifest.
  const readDiskVersion = options.readDiskVersion ?? (() => readVersion(options.manifestPath ?? MANIFEST_PATH))
  const diskVersion = readDiskVersion() ?? null
  return {
    loadedVersion,
    diskVersion,
    // Either direction means the files changed under a running process.
    pending: loadedVersion !== null && diskVersion !== null && loadedVersion !== diskVersion,
  }
}

/**
 * Build a route handler around one side effect.
 *
 * Kept as a factory so every effect can be replaced in tests.
 * @param options - the side effect plus where to log it.
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
      reply(202, { ok: true, mode: outcome.mode, ...logPath === undefined ? {} : { logPath } })
    } catch (error) {
      log(`restart failed: ${String(error?.message ?? error)}`)
      reply(500, { ok: false, error: String(error?.message ?? error) })
    }
  }
}

/**
 * Answer the status route: read-only, so any method is refused except GET.
 * @param options - status source.
 * @returns a handler owning the response lifecycle.
 */
export function createStatusHandler(options = {}) {
  return async function handleStatus(request, response) {
    const reply = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      response.end(JSON.stringify(body))
    }
    if (request.method !== 'GET') {
      reply(405, { ok: false, error: 'GET only' })
      return
    }
    try {
      reply(200, { ok: true, ...statusOf(options) })
    } catch (error) {
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
  const scriptDir = options.scriptDir ?? tmpdir()
  const writeScript = options.writeScript ?? ((path, text) => writeFileSync(path, text, 'utf8'))
  if (platform !== 'win32') {
    throw new Error(`restart is implemented for Windows only, this host is ${platform}`)
  }
  if (isElectron !== true) {
    throw new Error('restart needs the desktop application; this host runs plain Node, so restart DSH by hand')
  }
  if (typeof executable !== 'string' || !/\.exe$/i.test(executable)) {
    throw new Error(`unexpected host executable ${JSON.stringify(executable)}; expected the application's .exe`)
  }
  // A detached PowerShell ignores `-Command` silently (measured on this host): it
  // starts, does nothing, and reports no exit code. A script file runs correctly,
  // so the helper is written out and started with `-File`.
  const scriptPath = join(scriptDir, 'dsh-team-mode-restart.ps1')
  writeScript(scriptPath, [
    'Start-Sleep -Milliseconds 1500',
    `Get-Process -Name '${processName}' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue`,
    'Start-Sleep -Milliseconds 1200',
    'Start-Process -FilePath $env:DSH_TEAM_MODE_RESTART_EXE',
    '',
  ].join('\n'))
  const helper = spawnImpl(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...env, DSH_TEAM_MODE_RESTART_EXE: executable },
    },
  )
  // `spawn` reports failure asynchronously, so a returned pid proves nothing.
  const failure = await new Promise((resolve) => {
    let settled = false
    helper.once('error', (error) => {
      if (settled) return
      settled = true
      resolve(error)
    })
    // A surviving process emits nothing here; the timer decides.
    setTimeout(() => {
      if (settled) return
      settled = true
      resolve(undefined)
    }, 250)
  })
  helper.unref?.()
  if (failure !== undefined) {
    throw new Error(`could not start the restart helper: ${String(failure.message ?? failure)}`)
  }
  return { mode: 'script-file', scriptPath }
}

/**
 * Plugin entry: publish the status and restart routes when the profile serves HTTP.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  // The desktop Host does not always export DSH_PROFILE_DIR, and a silent helper
  // is exactly what made the last failure hard to see: always have a log path.
  const logPath = process.env.DSH_PROFILE_DIR === undefined
    ? join(tmpdir(), 'dsh-team-mode-restart.log')
    : join(process.env.DSH_PROFILE_DIR, '.dsh-team-mode', 'restart.log')
  // The web server may mount after this row, so wait for the service instead of
  // reading it once: a headless profile never gets one, and then there is no page
  // with a button to answer.
  ctx.inject(['webServer'], (webCtx) => {
    const restartHandler = createRestartHandler({
      logPath,
      restart: () => spawnDetachedRestart({ executable: process.execPath }),
    })
    const statusHandler = createStatusHandler({ manifestPath: MANIFEST_PATH, loadedVersion: LOADED_VERSION })
    webCtx.effect(
      () => webCtx.webServer.register({ kind: 'exact', path: RESTART_ROUTE, handler: restartHandler }),
      'dsh-team-mode: restart route',
    )
    webCtx.effect(
      () => webCtx.webServer.register({ kind: 'exact', path: STATUS_ROUTE, handler: statusHandler }),
      'dsh-team-mode: status route',
    )
  })
}

/**
 * Route and relaunch checks for the Host half.
 *
 * The restart side effect is replaced here: nothing in this file stops a process.
 * Run: node tests/restart.test.mjs
 */
import assert from 'node:assert/strict'
import { createRestartHandler, createStatusHandler, spawnDetachedRestart, statusOf, RESTART_ROUTE, STATUS_ROUTE } from '../index.js'

/** One fake HTTP exchange. */
function exchange(method, headers) {
  const sent = {}
  const response = {
    writeHead(status, head) {
      sent.status = status
      sent.head = head
    },
    end(text) {
      sent.body = text === undefined ? undefined : JSON.parse(text)
    },
  }
  return { request: { method, headers }, response, sent }
}

assert.equal(RESTART_ROUTE, '/dsh-team-mode/restart')

// A GET must not restart anything.
{
  let called = 0
  const handler = createRestartHandler({ restart: async () => { called += 1; return { mode: 'fake' } } })
  const { request, response, sent } = exchange('GET', {})
  await handler(request, response)
  assert.equal(called, 0)
  assert.equal(sent.status, 405)
  assert.equal(sent.body.ok, false)
}

// Without the header, another local page could never trigger it.
{
  let called = 0
  const handler = createRestartHandler({ restart: async () => { called += 1; return { mode: 'fake' } } })
  const { request, response, sent } = exchange('POST', {})
  await handler(request, response)
  assert.equal(called, 0)
  assert.equal(sent.status, 403)
}

// The card's request is accepted and answered before the process stops.
{
  let called = 0
  const handler = createRestartHandler({ restart: async () => { called += 1; return { mode: 'fake' } } })
  const { request, response, sent } = exchange('POST', { 'x-dsh-team-mode': 'restart' })
  await handler(request, response)
  assert.equal(called, 1)
  assert.equal(sent.status, 202)
  assert.deepEqual(sent.body, { ok: true, mode: 'fake' })
}

// A refusing restart mechanism is reported, not thrown into the server.
{
  const handler = createRestartHandler({ restart: async () => { throw new Error('no executable') } })
  const { request, response, sent } = exchange('POST', { 'x-dsh-team-mode': 'restart' })
  await handler(request, response)
  assert.equal(sent.status, 500)
  assert.equal(sent.body.error, 'no executable')
}

// Spawn guard: never stop anything we cannot start again.
{
  await assert.rejects(
    spawnDetachedRestart({ platform: 'linux', isElectron: true, executable: '/usr/bin/app' }),
    /Windows only/,
  )
  await assert.rejects(
    spawnDetachedRestart({ platform: 'win32', isElectron: false, executable: 'C:\\x\\node.exe' }),
    /needs the desktop application/,
  )
  await assert.rejects(
    spawnDetachedRestart({ platform: 'win32', isElectron: true, executable: 'C:\\x\\node' }),
    /unexpected host executable/,
  )
}

// The helper runs from a script file: a detached PowerShell silently ignores
// -Command on this host (measured), so both the file and the arguments matter.
{
  const calls = []
  const written = []
  const fakeSpawn = (command, args, options) => {
    calls.push({ command, args, options })
    return { once: () => {}, unref: () => {} }
  }
  const outcome = await spawnDetachedRestart({
    platform: 'win32',
    isElectron: true,
    executable: 'C:\\Program Files\\App\\App.exe',
    processName: 'app name',
    spawnImpl: fakeSpawn,
    writeScript: (path, text) => { written.push({ path, text }) },
    scriptDir: 'C:\\Temp',
    env: { EXISTING: '1' },
  })
  assert.equal(outcome.mode, 'script-file')
  assert.equal(written.length, 1)
  assert.equal(written[0].path, 'C:\\Temp\\dsh-team-mode-restart.ps1')
  assert.match(written[0].text, /Start-Sleep -Milliseconds 1500/)
  assert.match(written[0].text, /Stop-Process -Force/)
  assert.match(written[0].text, /'app name'/)
  assert.match(written[0].text, /Start-Process -FilePath \$env:DSH_TEAM_MODE_RESTART_EXE/)
  assert.equal(calls.length, 1)
  const call = calls[0]
  assert.equal(call.command, 'powershell.exe')
  assert.equal(call.options.detached, true)
  assert.equal(call.options.stdio, 'ignore')
  assert.equal(call.options.env.DSH_TEAM_MODE_RESTART_EXE, 'C:\\Program Files\\App\\App.exe')
  assert.equal(call.options.env.EXISTING, '1')
  assert.ok(call.args.includes('-File'), 'the helper runs from a file')
  assert.equal(call.args[call.args.indexOf('-File') + 1], 'C:\\Temp\\dsh-team-mode-restart.ps1')
  assert.ok(!call.args.includes('-Command'), 'a detached -Command is silently ignored')
}

// A spawn that fails must surface, not answer 202.
{
  const failingSpawn = () => {
    const handlers = {}
    const child = {
      once: (event, handler) => { handlers[event] = handler },
      unref: () => {},
    }
    setTimeout(() => handlers.error?.(Object.assign(new Error('spawn EPERM'), { code: 'EPERM' })), 0)
    return child
  }
  await assert.rejects(
    spawnDetachedRestart({
      platform: 'win32',
      isElectron: true,
      executable: 'C:\\Program Files\\App\\App.exe',
      spawnImpl: failingSpawn,
      writeScript: () => {},
      scriptDir: 'C:\\Temp',
    }),
    /could not start the restart helper/,
  )
}

// The status route reports the stale-build comparison the card relies on.
assert.equal(STATUS_ROUTE, '/dsh-team-mode/status')
assert.deepEqual(statusOf({ loadedVersion: '0.0.7', readDiskVersion: () => '0.0.9' }), {
  loadedVersion: '0.0.7',
  diskVersion: '0.0.9',
  pending: true,
})
assert.deepEqual(statusOf({ loadedVersion: '0.0.9', readDiskVersion: () => '0.0.9' }), {
  loadedVersion: '0.0.9',
  diskVersion: '0.0.9',
  pending: false,
})
// An unreadable manifest never claims a restart is needed.
assert.deepEqual(statusOf({ loadedVersion: '0.0.9', readDiskVersion: () => undefined }), {
  loadedVersion: '0.0.9',
  diskVersion: null,
  pending: false,
})

{
  const handler = createStatusHandler({ loadedVersion: '0.0.7', readDiskVersion: () => '0.0.9' })
  const { request, response, sent } = exchange('GET', {})
  await handler(request, response)
  assert.equal(sent.status, 200)
  assert.deepEqual(sent.body, { ok: true, loadedVersion: '0.0.7', diskVersion: '0.0.9', pending: true })
}
{
  const handler = createStatusHandler({})
  const { request, response, sent } = exchange('POST', {})
  await handler(request, response)
  assert.equal(sent.status, 405)
}

console.log('ok: the status route reports whether the running build matches the files on disk')
console.log('ok: the restart route refuses GET and header-less POST')
console.log('ok: an accepted request answers 202 before the process stops')
console.log('ok: the relaunch helper is detached and carries the executable in the environment')
console.log('\nall restart checks passed')

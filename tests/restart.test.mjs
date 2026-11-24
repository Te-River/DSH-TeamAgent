/**
 * Route and relaunch checks for the Host half.
 *
 * The restart side effect is replaced here: nothing in this file stops a process.
 * Run: node tests/restart.test.mjs
 */
import assert from 'node:assert/strict'
import { createRestartHandler, spawnDetachedRestart, RESTART_ROUTE } from '../index.js'

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

// The spawned helper is detached, and the executable travels in the environment.
{
  const calls = []
  const fakeSpawn = (command, args, options) => {
    calls.push({ command, args, options })
    return { unref: () => {} }
  }
  const outcome = await spawnDetachedRestart({
    platform: 'win32',
    isElectron: true,
    executable: 'C:\\Program Files\\App\\App.exe',
    processName: 'app name',
    spawnImpl: fakeSpawn,
    env: { EXISTING: '1' },
  })
  assert.deepEqual(outcome, { mode: 'detached-helper' })
  assert.equal(calls.length, 1)
  const call = calls[0]
  assert.equal(call.command, 'powershell.exe')
  assert.equal(call.options.detached, true)
  assert.equal(call.options.stdio, 'ignore')
  assert.equal(call.options.env.DSH_TEAM_MODE_RESTART_EXE, 'C:\\Program Files\\App\\App.exe')
  assert.equal(call.options.env.EXISTING, '1')
  const script = call.args[call.args.indexOf('-Command') + 1]
  assert.match(script, /Start-Sleep -Milliseconds 1500/)
  assert.match(script, /Stop-Process -Force/)
  assert.match(script, /'app name'/)
  assert.match(script, /Start-Process -FilePath \$env:DSH_TEAM_MODE_RESTART_EXE/)
}

console.log('ok: the restart route refuses GET and header-less POST')
console.log('ok: an accepted request answers 202 before the process stops')
console.log('ok: the relaunch helper is detached and carries the executable in the environment')
console.log('\nall restart checks passed')

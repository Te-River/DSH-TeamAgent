/**
 * Render smoke tests for the browser half.
 *
 * Evaluates `client.js` the way the page's module loader does, executes the
 * plugin factory and `apply`, and renders the version card against canned hook
 * states. It catches syntax errors and render-path mistakes without a browser;
 * it does not exercise the GitHub request, a real install, or a real restart.
 *
 * Run: node tests/client.smoke.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')
const SHA = 'a'.repeat(40)

/** Resets the canned hook values before each render of the same card. */
let resetStates = null

/**
 * Load the browser artifact with a stub module table.
 * @param states - one value per `useState` call, in declaration order.
 * @returns the registered slot entries.
 */
function loadWith(states) {
  let index = 0
  const react = {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children }
    },
    useState() {
      const value = states[index]
      index += 1
      return [value, () => {}]
    },
    useEffect() {},
  }
  const registrations = []
  const slots = {
    inject(name, register) {
      register()
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
  }
  const factories = {}
  const windowStub = { __ModuleLoader__: { load: ({ id, factory }) => { factories[id] = factory } } }
  // eslint-disable-next-line no-new-func -- the browser artifact is not an ES module
  new Function('window', 'navigator', 'fetch', source)(windowStub, {}, async () => ({ ok: false, status: 503, json: async () => [] }))
  const plugin = factories['dsh-team-mode']((name) => {
    if (name !== 'react') throw new Error(`unexpected require: ${name}`)
    return react
  })
  resetStates = () => { index = 0 }
  const installs = []
  plugin.apply({
    slots,
    remote: { pluginManager: { installBundle: async (spec) => { installs.push(spec); return { application: 'restart-required' } } } },
  })
  return { registrations, plugin, installs }
}

/** Render one registration the way React would: call the wrapper, then its component. */
function renderInto(entries, subject) {
  resetStates?.()
  const element = entries[0].component({ subject })
  if (element === null || typeof element !== 'object') return null
  return typeof element.type === 'function' ? element.type(element.props) : element
}

/** Flatten a rendered tree into searchable text, keeping handlers visible. */
function textOf(tree) {
  return JSON.stringify(tree, (key, value) => (typeof value === 'function' ? '[fn]' : value))
}

const bundle = { kind: 'bundle', pkg: { name: 'dsh-team-mode', version: '0.0.2', installed: true } }

// Pass 1: the first render, before any tag was read.
{
  const { registrations, plugin } = loadWith([
    { status: 'loading', tags: [], checkedAt: null, error: null },
    { phase: 'idle', canRestart: false },
    false,
    false,
  ])
  assert.deepEqual(plugin.inject, ['slots', 'remote', 'remote.pluginManager'])
  assert.equal(registrations[0].options.name, 'plugins.detail.section')
  assert.equal(registrations[0].options.id, 'dsh-team-mode-version')
  assert.equal(renderInto(registrations, { kind: 'bundle', pkg: { name: 'other', version: '1.0.0' } }), null)
  assert.equal(renderInto(registrations, { kind: 'row', pkg: { name: 'dsh-team-mode', version: '0.0.2' } }), null)
  const text = textOf(renderInto(registrations, bundle))
  assert.match(text, /版本/)
  assert.match(text, /当前版本/)
  assert.match(text, /v0\.0\.2/)
  assert.match(text, /正在检查/)
  assert.doesNotMatch(text, /更新到 v/)
  assert.doesNotMatch(text, /立即重启/)
}

// Pass 2: a newer tag exists and no install has run yet.
{
  const { registrations } = loadWith([
    { status: 'ok', tags: [{ name: 'v0.0.9', sha: SHA, version: [0, 0, 9] }], checkedAt: new Date(), error: null },
    { phase: 'idle', canRestart: false },
    false,
    false,
  ])
  const text = textOf(renderInto(registrations, bundle))
  assert.match(text, /可更新到 v0\.0\.9/)
  assert.match(text, /"更新到 v0\.0\.9"/, "the update button names the newer tag")
  assert.match(text, new RegExp(`github:Te-River/DSH-TeamAgent#${SHA}`))
  assert.doesNotMatch(text, /立即重启/)
}

// Pass 3: the install finished and the Host needs a restart.
{
  const { registrations } = loadWith([
    { status: 'ok', tags: [{ name: 'v0.0.9', sha: SHA, version: [0, 0, 9] }], checkedAt: new Date(), error: null },
    { phase: 'done', canRestart: true, message: '已安装 v0.0.9，需要重启 DSH 才能生效' },
    false,
    false,
  ])
  const text = textOf(renderInto(registrations, bundle))
  assert.match(text, /需要重启 DSH 才能生效/)
  assert.match(text, /立即重启 DSH/)
  assert.doesNotMatch(text, /"更新到 v0\.0\.9"/, 'the update button gives way to the restart button')
}

// Pass 4: the warning dialog, for surfaces that answer no modal.
{
  const { registrations } = loadWith([
    { status: 'ok', tags: [{ name: 'v0.0.9', sha: SHA, version: [0, 0, 9] }], checkedAt: new Date(), error: null },
    { phase: 'done', canRestart: true, message: '已安装 v0.0.9，需要重启 DSH 才能生效' },
    false,
    true,
  ])
  const text = textOf(renderInto(registrations, bundle))
  assert.match(text, /重启会影响正在运行的会话/)
  assert.match(text, /确认重启/)
  assert.match(text, /取消/)
  assert.doesNotMatch(text, /立即重启 DSH/, 'the offer collapses into the confirmation')
}

console.log('ok: client.js loads, registers the detail section, and renders only for this bundle')
console.log('ok: the card shows the installed version, the newest tag, and a recheck control')
console.log('ok: an install that needs a restart offers the restart button, then the warning')
console.log('\nall client smoke checks passed')

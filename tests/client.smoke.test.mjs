/**
 * Render smoke test for the browser half.
 *
 * Evaluates `client.js` the way the page's module loader does, executes the
 * plugin factory and `apply`, and renders the version card with a bundle
 * subject. It catches syntax errors and render-path mistakes without a browser;
 * it does not exercise the GitHub request or a real install.
 *
 * Run: node tests/client.smoke.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

/** Elements created by the stub renderer, so props are inspectable. */
const react = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children }
  },
  useState(initial) {
    return [initial, () => {}]
  },
  useEffect() {},
}

/** Module table the factory's `require` reads from. */
const table = { react }

/** Registrations the plugin made, by slot. */
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

const factory = factories['dsh-team-mode']
assert.ok(factory !== undefined, 'client.js registers the package factory')
const plugin = factory((name) => {
  if (!(name in table)) throw new Error(`unexpected require: ${name}`)
  return table[name]
})
assert.deepEqual(plugin.inject, ['slots', 'remote', 'remote.pluginManager'])

const installs = []
plugin.apply({
  slots,
  remote: { pluginManager: { installBundle: async (spec) => { installs.push(spec); return { application: 'restart-required' } } } },
})
assert.equal(registrations.length, 1)
const [registration] = registrations
assert.equal(registration.options.name, 'plugins.detail.section')
assert.equal(registration.options.id, 'dsh-team-mode-version')

/** Render one registration the way React would: call the wrapper, then its component. */
function render(subject) {
  const element = registration.component({ subject })
  if (element === null || typeof element !== 'object') return null
  return typeof element.type === 'function' ? element.type(element.props) : element
}

// Another bundle's page renders nothing.
assert.equal(render({ kind: 'bundle', pkg: { name: 'other', version: '1.0.0' } }), null)
// A row page renders nothing either.
assert.equal(render({ kind: 'row', pkg: { name: 'dsh-team-mode', version: '0.0.2' } }), null)

// Our own page renders the card.
const tree = render({ kind: 'bundle', pkg: { name: 'dsh-team-mode', version: '0.0.2', installed: true } })
assert.ok(tree !== null)
const text = JSON.stringify(tree, (key, value) => (typeof value === 'function' ? '[fn]' : value))
assert.match(text, /版本/)
assert.match(text, /当前版本/)
assert.match(text, /v0\.0\.2/)
assert.match(text, /重新检查/)
assert.doesNotMatch(text, /更新到 v/, 'no update button before tags are read')

console.log('ok: client.js loads, registers the detail section, and renders only for this bundle')
console.log('ok: the card shows the installed version and a recheck control')
console.log('\nall client smoke checks passed')

window.__ModuleLoader__.load({
  id: 'dsh-team-mode',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState } = React

    /** The repository this bundle is published from; versions are its git tags. */
    const REPO = 'Te-River/DSH-TeamAgent'
    const TAGS_ENDPOINT = `https://api.github.com/repos/${REPO}/tags?per_page=30`
    const SPEC_PREFIX = `github:${REPO}#`

    /** Where the Host half publishes the status and restart routes. */
    const STATUS_ROUTE = '/dsh-team-mode/status'
    const RESTART_ROUTE = '/dsh-team-mode/restart'
    const RESTART_HEADER = 'x-dsh-team-mode'
    /** The warning shown before a restart, since it ends every running session. */
    const RESTART_WARNING = '重启会立刻结束 DSH，包括正在运行的会话和队友。确认要现在重启吗？'

    /**
     * Ask the Host whether the running code is older than the files on disk.
     * @returns {Promise<{pending: boolean, loadedVersion?: string, diskVersion?: string}>}
     */
    async function readHostStatus() {
      const response = await fetch(STATUS_ROUTE, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    }

    /**
     * Ask the Host half to stop and relaunch this application.
     * @returns {Promise<void>} resolves once the Host accepted the request.
     */
    async function requestRestart() {
      const response = await fetch(RESTART_ROUTE, {
        method: 'POST',
        headers: { [RESTART_HEADER]: 'restart' },
      })
      if (!response.ok) {
        let detail = `HTTP ${response.status}`
        try {
          const body = await response.json()
          if (typeof body?.error === 'string') detail = body.error
        } catch {
          // Keep the status line.
        }
        throw new Error(detail)
      }
    }

    /**
     * Parse a tag or version into comparable numbers.
     * @param {string} text tag name or manifest version.
     * @returns {number[] | null} numeric parts, or null when it is not semver.
     */
    function parseVersion(text) {
      const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(text ?? '').trim())
      return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])]
    }

    /**
     * Compare two parsed versions.
     * @returns {number} negative when a is older, positive when newer, 0 when equal.
     */
    function compare(a, b) {
      for (let index = 0; index < 3; index += 1) {
        if (a[index] !== b[index]) return a[index] - b[index]
      }
      return 0
    }

    /** Secondary text that follows the host theme. */
    const secondary = { opacity: 0.66, fontSize: 10 }
    /** One fact row. */
    function row(label, value) {
      return h(
        'div',
        { style: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', fontSize: 11 } },
        h('span', { style: secondary }, label),
        h('span', { style: { fontVariantNumeric: 'tabular-nums' } }, value),
      )
    }
    /** A pill button that follows the host theme. */
    function pill(label, onClick, disabled) {
      return h(
        'button',
        {
          type: 'button',
          onClick,
          disabled: disabled === true,
          style: {
            fontSize: 11,
            padding: '3px 10px',
            borderRadius: 999,
            border: '1px solid rgba(127,127,127,0.34)',
            background: 'transparent',
            color: 'inherit',
            cursor: disabled === true ? 'default' : 'pointer',
            opacity: disabled === true ? 0.55 : 1,
          },
        },
        label,
      )
    }

    /**
     * Version card for this bundle's own detail page: GitHub tags are the release
     * channel, so no registry account is needed. Renders nothing on another page.
     * @param {{ subject?: object, install?: (spec: string) => Promise<object> }} props
     */
    function VersionCard(props) {
      const subject = props?.subject
      const isOurs = subject?.kind === 'bundle' && subject.pkg?.name === 'dsh-team-mode'
      const installed = subject?.pkg?.version
      const [state, setState] = useState({ status: 'idle', tags: [], checkedAt: null, error: null })
      const [apply, setApply] = useState({ phase: 'idle', canRestart: false })
      const [copied, setCopied] = useState(false)
      const [confirming, setConfirming] = useState(false)
      // What the Host reports about its own running build versus the files on disk.
      const [host, setHost] = useState({ status: 'idle', pending: false })

      /** Read the repository tags and keep the newest semver one. */
      async function check() {
        setState((previous) => ({ ...previous, status: 'loading', error: null }))
        try {
          const response = await fetch(TAGS_ENDPOINT, { headers: { accept: 'application/vnd.github+json' } })
          if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
          const payload = await response.json()
          const tags = (Array.isArray(payload) ? payload : [])
            .map((tag) => ({ name: tag?.name, sha: tag?.commit?.sha, version: parseVersion(tag?.name) }))
            .filter((tag) => tag.version !== null)
            .sort((a, b) => compare(b.version, a.version))
          setState({ status: 'ok', tags, checkedAt: new Date(), error: null })
        } catch (error) {
          setState({ status: 'error', tags: [], checkedAt: new Date(), error: String(error?.message ?? error) })
        }
      }

      /**
       * Install the newest tag the way the Add plugin dialog would, then report
       * whether the running Host needs a restart.
       */
      async function updateTo(tag) {
        if (props?.install === undefined) {
          setApply({ phase: 'failed', message: '这个界面没有暴露安装能力，请复制下方来源手动安装' })
          return
        }
        const spec = `${SPEC_PREFIX}${tag.sha}`
        setApply({ phase: 'running', message: `正在安装 ${tag.name}…` })
        try {
          const result = await props.install(spec)
          const application = result?.application
          const needsRestart = application === 'restart-required'
          setApply({
            phase: 'done',
            canRestart: needsRestart,
            message: needsRestart
              ? `已安装 ${tag.name}，需要重启 DSH 才能生效`
              : `已更新到 ${tag.name}`,
          })
        } catch (error) {
          setApply({ phase: 'failed', canRestart: false, message: `更新失败：${String(error?.message ?? error)}` })
        }
      }

      /** Confirm, then ask the Host to relaunch. */
      async function restartNow() {
        // A real modal dialog when the surface allows one; the inline warning below
        // stays available for surfaces that answer undefined.
        let confirmed = false
        try {
          confirmed = window.confirm(RESTART_WARNING) === true
        } catch {
          confirmed = false
        }
        if (!confirmed) {
          setConfirming(true)
          return
        }
        await sendRestart()
      }

      /** Send the restart request and report the outcome. */
      async function sendRestart() {
        setConfirming(false)
        setApply({ phase: 'running', canRestart: false, message: '正在重启 DSH…' })
        try {
          await requestRestart()
          setApply({ phase: 'done', canRestart: false, message: '已请求重启，DSH 会在几秒内重新启动' })
        } catch (error) {
          setApply({
            phase: 'failed',
            canRestart: true,
            message: `无法自动重启（${String(error?.message ?? error)}），请手动退出并重新打开 DSH`,
          })
        }
      }

      useEffect(() => {
        if (!isOurs) return undefined
        void check()
        // The install result is not the only reason a restart is due: a reinstall
        // of the same version reports "applied" while the process still runs the
        // older code. The Host answers that comparison itself.
        void readHostStatus().then(
          (status) => setHost({ status: 'ok', ...status }),
          (error) => setHost({ status: 'error', pending: false, error: String(error?.message ?? error) }),
        )
        return undefined
      }, [isOurs])

      if (!isOurs) return null

      const latest = state.tags[0]
      const current = parseVersion(installed)
      const newer = latest !== undefined && current !== null && compare(latest.version, current) > 0
      const busy = state.status === 'loading' || apply.phase === 'running'
      const restartNeeded = apply.canRestart === true || host.pending === true
      const hostNote = host.pending === true && apply.phase === 'idle'
        ? `正在运行 v${host.loadedVersion ?? '?'}，磁盘上已是 v${host.diskVersion ?? '?'}，需要重启 DSH 才能生效`
        : null
      const headline = state.status === 'loading'
        ? '正在检查 GitHub…'
        : state.status === 'error'
          ? '无法检查更新'
          : newer
            ? `可更新到 ${latest.name}`
            : '已是最新版本'

      return h(
        'section',
        {
          style: {
            marginTop: 16,
            padding: '12px 14px',
            border: '1px solid rgba(127,127,127,0.28)',
            borderRadius: 10,
            color: 'inherit',
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 } },
          h('strong', { style: { fontSize: 12, fontWeight: 600 } }, '版本'),
          h(
            'div',
            { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            // The restart offer takes the primary slot: it is the action this page
            // exists to finish, and the update button has already done its job.
            restartNeeded && confirming !== true
              ? pill('立即重启 DSH', () => { void restartNow() }, busy)
              : null,
            newer && apply.phase !== 'done'
              ? pill(`更新到 ${latest.name}`, () => { void updateTo(latest) }, busy)
              : null,
            pill(state.status === 'loading' ? '正在检查' : '重新检查', () => { void check() }, busy),
          ),
        ),
        h('div', { style: { marginTop: 6, fontSize: 12 } }, headline),
        state.status === 'error'
          ? h('div', { style: { ...secondary, marginTop: 2 } }, `${state.error}（离线或已达到 GitHub API 限流）`)
          : null,
        apply.phase === 'idle' || apply.phase === 'running'
          ? null
          : h(
            'div',
            {
              style: {
                marginTop: 6,
                fontSize: 11,
                color: apply.phase === 'failed' ? '#e05a4f' : 'inherit',
                opacity: apply.phase === 'failed' ? 1 : 0.8,
              },
            },
            apply.message,
          ),
        hostNote === null
          ? null
          : h('div', { style: { marginTop: 6, fontSize: 11, opacity: 0.8 } }, hostNote),
        confirming === true
          ? h(
            'div',
            {
              style: {
                marginTop: 8,
                padding: '8px 10px',
                border: '1px solid #e05a4f',
                borderRadius: 8,
                fontSize: 11,
              },
            },
            h('div', { style: { color: '#e05a4f', fontWeight: 600 } }, '重启会影响正在运行的会话'),
            h('div', { style: { marginTop: 4, opacity: 0.85 } }, RESTART_WARNING),
            h(
              'div',
              { style: { marginTop: 8, display: 'flex', gap: 8 } },
              pill('确认重启', () => { void sendRestart() }, busy),
              pill('取消', () => setConfirming(false), false),
            ),
          )
          : null,
        row('当前版本', installed === undefined ? '—' : `v${installed}`),
        row('GitHub 最新版本', latest === undefined ? '—' : latest.name),
        state.checkedAt === null ? null : row('检查于', state.checkedAt.toLocaleTimeString()),
        newer
          ? h(
            'div',
            { style: { marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('code', {
              style: {
                fontSize: 10,
                padding: '3px 6px',
                borderRadius: 6,
                background: 'rgba(127,127,127,0.16)',
                overflowWrap: 'anywhere',
              },
            }, `${SPEC_PREFIX}${latest.sha}`),
            pill(copied ? '已复制' : '复制安装来源', () => {
              void navigator.clipboard?.writeText(`${SPEC_PREFIX}${latest.sha}`).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              })
            }, false),
            h('span', { style: secondary }, '手动安装时在「添加插件」里粘贴该来源'),
          )
          : null,
      )
    }

    return {
      inject: ['slots', 'remote', 'remote.pluginManager'],
      apply(ctx) {
        // `installBundle` is the Remote the Add plugin dialog itself uses; the card
        // hands it the same pinned spec the copy button shows.
        const install = async (spec) => {
          const result = await ctx.remote.pluginManager.installBundle(spec, {})
          return result
        }
        ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
          name: 'plugins.detail.section',
          id: 'dsh-team-mode-version',
          order: 40,
        }, (props) => h(VersionCard, { ...props, install })))
      },
    }
  },
})

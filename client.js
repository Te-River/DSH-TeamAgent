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

    /**
     * Version card for this bundle's own detail page: GitHub tags are the release
     * channel, so no registry account is needed. Renders nothing on another page.
     * @param {{ subject?: { kind?: string, pkg?: { name?: string, version?: string } } }} props
     */
    function VersionCard(props) {
      const subject = props?.subject
      const isOurs = subject?.kind === 'bundle' && subject.pkg?.name === 'dsh-team-mode'
      const installed = subject?.pkg?.version
      const [state, setState] = useState({ status: 'idle', tags: [], checkedAt: null, error: null })
      const [copied, setCopied] = useState(false)

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

      useEffect(() => {
        if (!isOurs) return undefined
        void check()
        return undefined
      }, [isOurs])

      if (!isOurs) return null

      const latest = state.tags[0]
      const current = parseVersion(installed)
      const newer = latest !== undefined && current !== null && compare(latest.version, current) > 0
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
            'button',
            {
              type: 'button',
              onClick: () => { void check() },
              disabled: state.status === 'loading',
              style: {
                fontSize: 11,
                padding: '3px 10px',
                borderRadius: 999,
                border: '1px solid rgba(127,127,127,0.34)',
                background: 'transparent',
                color: 'inherit',
                cursor: state.status === 'loading' ? 'default' : 'pointer',
                opacity: state.status === 'loading' ? 0.55 : 1,
              },
            },
            state.status === 'loading' ? '正在检查' : '重新检查',
          ),
        ),
        h('div', { style: { marginTop: 6, fontSize: 12 } }, headline),
        state.status === 'error'
          ? h('div', { style: { ...secondary, marginTop: 2 } }, `${state.error}（离线或已达到 GitHub API 限流）`)
          : null,
        row('当前版本', installed === undefined ? '—' : `v${installed}`),
        row('GitHub 最新版本', latest === undefined ? '—' : latest.name),
        state.checkedAt === null
          ? null
          : row('检查于', state.checkedAt.toLocaleTimeString()),
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
            h(
              'button',
              {
                type: 'button',
                onClick: () => {
                  void navigator.clipboard?.writeText(`${SPEC_PREFIX}${latest.sha}`).then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  })
                },
                style: {
                  fontSize: 11,
                  padding: '3px 10px',
                  borderRadius: 999,
                  border: '1px solid rgba(127,127,127,0.34)',
                  background: 'transparent',
                  color: 'inherit',
                  cursor: 'pointer',
                },
              },
              copied ? '已复制' : '复制安装来源',
            ),
            h('span', { style: secondary }, '在「添加插件」里粘贴该来源即可升级'),
          )
          : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
          name: 'plugins.detail.section',
          id: 'dsh-team-mode-version',
          order: 40,
        }, VersionCard))
      },
    }
  },
})

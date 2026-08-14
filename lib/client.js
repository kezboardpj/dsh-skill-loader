/**
 * dsh-skill-loader — browser half.
 *
 * Adds a per-conversation "技能清单" (skill catalog) picker chip IN the
 * new-conversation hero row, right next to the workspace / agent-preset
 * chips, visible only on the start page (blank conversation) and hidden once
 * the conversation starts.
 *
 * Why a DOM-mounted chip instead of a slot: the hero row is hardcoded JSX in
 * the shipped dsh-client-ui-conversation package and declares only two
 * single-seat slots (`conversation.hero.workspace` / `conversation.hero.agentPreset`),
 * both occupied by built-in pickers — plugins cannot declare a third seat in
 * another package's JSX. This plugin therefore appends its own chip node to
 * that row (anchored via stable attributes: the `[data-phase="hero"]` root and
 * the workspace chip's `aria-haspopup="menu"` button) and renders it with a
 * react-dom root. A MutationObserver re-applies it whenever React remounts the
 * row. The chip only renders while the current session is blank
 * (`sessions.list` snapshot), so it never appears during chat.
 *
 * Checked skills have their catalog entries (name + description) LOADED into
 * this conversation; unchecked skills are unavailable here — the model's
 * catalog does not list them, `/name` gestures are refused, and `skill` tool
 * calls for them are denied by the host half. The picker drives the host
 * `/skill-select <csv>` command; the current selection is read from the host
 * settings document (`skill-loader` namespace via settingsScope). No stored
 * selection = dsh default = every skill loaded, so the initial state is
 * "all checked".
 */
window.__ModuleLoader__.load({
  id: 'dsh-skill-loader', // MUST equal the package name
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const react = require('react')
    const jsx = require('react/jsx-runtime')
    const reactDom = require('react-dom')

    const NS = 'skillLoader'

    const zh = {
      'dock.label': '技能清单',
      'dock.all': '全部载入（{count}）',
      'dock.count': '载入 {n}/{total}',
      'panel.title': '选择要载入本对话的技能',
      'panel.hint': '勾选的技能会把其清单（名称 + 描述）载入本对话；未勾选的在本对话不可用（模型目录、/名称 手势与 skill 工具都会拒绝）。开始对话后不可修改。',
      'panel.loading': '正在读取技能列表…',
      'panel.empty': '当前没有可载入的技能。',
      'panel.error.list': '技能列表读取失败，请重试。',
      'panel.none': '本对话未载入任何技能。',
      'panel.notice.miss': '命令未被识别，请重启 dsh 后重试。',
      'panel.notice.failed': '操作失败：{message}',
    }
    const en = {
      'dock.label': 'Skills',
      'dock.all': 'Load all ({count})',
      'dock.count': 'Load {n}/{total}',
      'panel.title': 'Choose the skills to load into this conversation',
      'panel.hint': 'Checked skills load their catalog entries (name + description) into this conversation; unchecked skills are unavailable here (model catalog, /name gestures and the skill tool all refuse them). Fixed once the conversation starts.',
      'panel.loading': 'Loading skills…',
      'panel.empty': 'No loadable skills available.',
      'panel.error.list': 'Failed to load the skill list. Please retry.',
      'panel.none': 'No skills are loaded in this conversation.',
      'panel.notice.miss': 'Command was not recognized; restart dsh and retry.',
      'panel.notice.failed': 'Operation failed: {message}',
    }

    const css = [
      '.slp_root{position:relative;display:inline-flex}',
      // Chip styled to match the hero row's workspace / agent-preset chips
      // exactly (no border, 16px radius, 28px min-height, hover tint).
      '.slp_trigger{max-width:min(100%,240px);min-height:28px;color:var(--dsw-alias-label-primary);white-space:nowrap;text-overflow:ellipsis;cursor:pointer;background:0 0;border:none;border-radius:16px;align-items:center;gap:4px;padding:0 8px;font-size:13px;font-weight:500;line-height:20px;display:inline-flex;overflow:hidden}',
      '.slp_trigger:not(:disabled):hover,.slp_trigger[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover)}',
      '.slp_trigger:disabled{cursor:default;color:var(--dsw-alias-label-quaternary)}',
      '.slp_count{min-width:0;font-size:12px;color:var(--dsw-alias-label-caption);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.slp_backdrop{position:fixed;inset:0;z-index:998;background:transparent}',
      '.slp_panel{position:fixed;z-index:999;width:min(360px,calc(100vw - 16px));max-height:min(60vh,480px);display:flex;flex-direction:column;gap:4px;background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:var(--dsw-shadow-lv3);padding:8px;overflow:hidden}',
      '.slp_panelTitle{flex:none;font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary);padding:6px 8px}',
      '.slp_hint{flex:none;font-size:12px;color:var(--dsw-alias-label-caption);padding:6px 8px;white-space:pre-wrap}',
      '.slp_list{min-height:0;flex:auto;display:flex;flex-direction:column;gap:2px;overflow-y:auto}',
      '.slp_item{display:flex;align-items:flex-start;gap:8px;padding:8px;border-radius:8px;cursor:pointer}',
      '.slp_item:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.slp_item input{margin:2px 0 0;flex:none}',
      '.slp_itemText{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}',
      '.slp_itemName{font-size:13px;color:var(--dsw-alias-label-primary);word-break:break-all}',
      '.slp_itemDesc{font-size:12px;color:var(--dsw-alias-label-tertiary);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
      '.slp_notice{flex:none;font-size:12px;color:var(--dsw-alias-state-error-primary);padding:4px 8px;word-break:break-word;white-space:pre-wrap}',
    ].join('\n')
    const tagId = 'dsh-skill-loader/Picker.module.css'
    if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${tagId}"]`) === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-skill-loader'
      tag.dataset.pluginCss = tagId
      tag.textContent = css
      document.head.appendChild(tag)
    }
    const cssModule = {
      root: 'slp_root', trigger: 'slp_trigger', count: 'slp_count',
      backdrop: 'slp_backdrop', panel: 'slp_panel', panelTitle: 'slp_panelTitle',
      hint: 'slp_hint', list: 'slp_list', item: 'slp_item', itemText: 'slp_itemText',
      itemName: 'slp_itemName', itemDesc: 'slp_itemDesc', notice: 'slp_notice',
    }

    // ---------------------------------------------------------------------
    // Durable-log reads.
    // ---------------------------------------------------------------------
    async function fetchHistory(api, sessionId) {
      const pages = []
      let beforeSeq
      let hasMore = true
      for (let guard = 0; guard < 25 && hasMore; guard += 1) {
        const payload = { sessionId, maxMessages: 200 }
        if (beforeSeq !== void 0) payload.beforeSeq = beforeSeq
        let out
        try { out = await api.sessions.history(payload) } catch { break }
        const result = out?.result
        if (result == null || !result.ok) break
        const entries = result.value?.events
        if (!Array.isArray(entries) || entries.length === 0) break
        pages.unshift(entries.map((entry) => entry.event))
        hasMore = result.value.hasMore === true
        beforeSeq = entries[0].event.seq
      }
      return pages.flat()
    }

    /** Latest selection (null = never selected = dsh default "all loaded"). */
    function selectionFromEvents(events) {
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index]
        if (event.type !== 'skill-loader/selection') continue
        return Array.isArray(event.data?.names) ? [...event.data.names] : []
      }
      return null
    }

    // ---------------------------------------------------------------------
    // The picker chip + panel (rendered through a react-dom root).
    // ---------------------------------------------------------------------
    function SkillPickerChip({ sessionId, t, api, runCommand, scope }) {
      const [skills, setSkills] = react.useState(null) // null = loading
      const [draft, setDraft] = react.useState(null) // optimistic selection while a write is pending
      const [pending, setPending] = react.useState(false)
      const [notice, setNotice] = react.useState(null)
      const [open, setOpen] = react.useState(false)
      const rootRef = react.useRef(null)
      const timerRef = react.useRef(null)
      const lastSentRef = react.useRef(null)

      // Authoritative selection, straight from the host settings document
      // (the `skill-loader` namespace) — pushed live via settingsScope.
      const authoritative = react.useSyncExternalStore(
        scope.subscribe,
        () => scope.getSnapshot().value?.selections?.[sessionId] ?? null,
        () => null,
      )
      const selection = draft ?? authoritative
      const selectionRef = react.useRef(selection)
      react.useEffect(() => { selectionRef.current = selection }, [selection])
      // Drop the optimistic draft once the authoritative value catches up.
      react.useEffect(() => { setDraft(null) }, [authoritative])

      const refresh = react.useCallback(async () => {
        setNotice(null)
        try {
          const listed = await api.skills.list({ sessionId })
          if (!listed.result.ok) throw new Error('list failed')
          setSkills(Array.isArray(listed.result.value.skills) ? listed.result.value.skills : [])
        } catch {
          setSkills((previous) => previous ?? [])
          setNotice(t('panel.error.list'))
        }
      }, [api, sessionId, t])

      react.useEffect(() => { refresh() }, [refresh])

      // Send the CURRENT desired selection exactly once per burst of toggles.
      const flush = react.useCallback(async () => {
        if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null }
        const desired = selectionRef.current
        if (desired === null) return
        const names = desired.filter((name) => (skills ?? []).some((skill) => skill.name === name))
        const joined = names.join(',')
        if (joined === lastSentRef.current) return
        lastSentRef.current = joined
        setPending(true)
        setNotice(null)
        try {
          const out = await runCommand(sessionId, joined === '' ? '/skill-select' : `/skill-select ${joined}`)
          if (out == null || out.ok !== true) throw new Error('transport')
          const value = out.value
          if (value == null) {
            setNotice(t('panel.notice.miss'))
            return
          }
          if (value.result?.kind === 'error') {
            setNotice(value.result.text)
            return
          }
          // Success: the settings push updates `authoritative`; nothing else to do.
        } catch (error) {
          setDraft(null) // revert the optimistic state on failure
          setNotice(t('panel.notice.failed', { message: String(error?.message ?? error) }))
        } finally {
          setPending(false)
        }
      }, [runCommand, sessionId, skills, t])

      const scheduleFlush = react.useCallback(() => {
        if (timerRef.current !== null) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => { flush() }, 600)
      }, [flush])

      // Flush pending changes when the panel closes or the chip unmounts
      // (e.g. the user sends the first message while the panel is open).
      react.useEffect(() => () => { flush() }, [flush])

      react.useLayoutEffect(() => {
        if (!open) return void 0
        // Close on window resize only — scrolling (page OR the panel's own
        // list) must not collapse the panel; it stays open at its anchored
        // position.
        const close = () => { setOpen(false); flush() }
        window.addEventListener('resize', close)
        return () => {
          window.removeEventListener('resize', close)
        }
      }, [open, flush])

      const all = skills ?? []
      const selected = selection ?? all.map((skill) => skill.name)
      const selectedSet = new Set(selected)

      const toggle = (name, checked) => {
        const next = new Set(selectedSet)
        if (checked) next.add(name)
        else next.delete(name)
        const names = all.filter((skill) => next.has(skill.name)).map((skill) => skill.name)
        setDraft(names) // optimistic
        setNotice(null)
        scheduleFlush()
      }

      const panelStyle = react.useMemo(() => {
        if (!open) return null
        const rect = rootRef.current?.getBoundingClientRect()
        if (rect == null) return null
        return {
          top: Math.max(8, rect.bottom + 6),
          right: Math.max(8, window.innerWidth - rect.right),
        }
      }, [open])

      const countLabel = selection === null
        ? t('dock.all', { count: all.length })
        : t('dock.count', { n: selected.length, total: all.length })

      return jsx.jsxs(jsx.Fragment, { children: [
        jsx.jsxs('button', {
          ref: rootRef,
          type: 'button',
          className: cssModule.trigger,
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          disabled: pending,
          onClick: () => {
            const next = !open
            setOpen(next)
            if (next) refresh()
            else flush()
          },
          children: [
            jsx.jsx('span', { children: t('dock.label') }),
            jsx.jsx('span', { className: cssModule.count, children: countLabel }),
          ],
        }),
        open && reactDom.createPortal(jsx.jsxs(react.Fragment, { children: [
          jsx.jsx('div', { className: cssModule.backdrop, onClick: () => { setOpen(false); flush() } }),
          jsx.jsx('div', {
            className: cssModule.panel,
            role: 'dialog',
            'aria-label': t('panel.title'),
            style: panelStyle ?? void 0,
            children: [
              jsx.jsx('div', { className: cssModule.panelTitle, children: t('panel.title') }),
              jsx.jsx('div', { className: cssModule.hint, children: t('panel.hint') }),
              skills === null ? jsx.jsx('div', { className: cssModule.hint, children: t('panel.loading') })
                : all.length === 0 ? jsx.jsx('div', { className: cssModule.hint, children: t('panel.empty') })
                : jsx.jsx('div', { className: cssModule.list, children: all.map((skill) => {
                    const checked = selectedSet.has(skill.name)
                    return jsx.jsxs('label', {
                      key: skill.name,
                      className: cssModule.item,
                      children: [
                        jsx.jsx('input', {
                          type: 'checkbox',
                          checked,
                          disabled: pending,
                          onChange: () => { toggle(skill.name, !checked) },
                        }),
                        jsx.jsxs('span', { className: cssModule.itemText, children: [
                          jsx.jsx('span', { className: cssModule.itemName, children: skill.name }),
                          typeof skill.description === 'string' && skill.description !== '' && jsx.jsx('span', {
                            className: cssModule.itemDesc,
                            title: skill.description,
                            children: skill.description,
                          }),
                        ] }),
                      ],
                    })
                  }) }),
              selected.length === 0 && selection !== null && jsx.jsx('div', { className: cssModule.hint, children: t('panel.none') }),
              notice != null && jsx.jsx('div', { className: cssModule.notice, children: notice }),
            ],
          }),
        ] }), document.body),
      ] })
    }

    // ---------------------------------------------------------------------
    // Client plugin body.
    // ---------------------------------------------------------------------
    // `remote.commands` is a lazily-exposed remote namespace: accessing it
    // without declaring the dependency fails the Cordis proxy with
    // "cannot get property ... without inject" — declare both, exactly like
    // the shipped dsh-client-runtime does.
    const inject = ['locale', 'connection', 'remote', 'remote.commands', 'sessions', 'settingsScope']

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'skill-loader: dictionaries')

      const t = ctx.locale.bind(NS)
      const api = ctx.get('connection').api
      const remote = ctx.get('remote')
      const sessions = ctx.get('sessions')
      const scope = ctx.get('settingsScope').bind({ namespace: 'skill-loader' })
      const runCommand = (sessionId, line) => remote.commands.execute(sessionId, line)

      let host = null
      let root = null
      let raf = 0

      /** The hero row containing the workspace / agent-preset chips, or null. */
      const heroAnchor = () => {
        if (typeof document === 'undefined') return null
        const hero = document.querySelector('[data-phase="hero"]')
        if (hero == null) return null
        const chip = hero.querySelector('button[aria-haspopup="menu"]')
        return chip?.parentElement ?? null
      }

      const unmount = () => {
        if (root !== null) { root.unmount(); root = null }
        if (host !== null) { host.remove(); host = null }
      }

      /** Mount/unmount the chip to match the current blank session + hero row. */
      const sync = () => {
        raf = 0
        let snapshot
        try { snapshot = sessions.list.getSnapshot() } catch { snapshot = undefined }
        const current = snapshot?.current
        const blank = current !== undefined ? snapshot?.byId?.[current]?.blank === true : false
        const anchor = blank ? heroAnchor() : null
        if (anchor == null) { unmount(); return }
        if (host !== null && host.parentElement === anchor) return
        unmount()
        host = document.createElement('div')
        host.dataset.plugin = 'dsh-skill-loader'
        anchor.appendChild(host)
        root = reactDom.createRoot(host)
        root.render(jsx.jsx(SkillPickerChip, { sessionId: current, t, api, runCommand, scope }))
      }

      const schedule = () => {
        if (raf === 0) raf = requestAnimationFrame(() => { raf = 0; sync() })
      }

      ctx.effect(() => {
        const off = sessions.list.subscribe(schedule)
        const observer = new MutationObserver(schedule)
        observer.observe(document.body, { childList: true, subtree: true })
        sync()
        return () => {
          off()
          observer.disconnect()
          if (raf !== 0) cancelAnimationFrame(raf)
          unmount()
        }
      }, 'skill-loader: hero chip')
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})

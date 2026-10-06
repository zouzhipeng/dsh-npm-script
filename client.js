/**
 * Client half of the npm-commands bundle: a frame-wide floating button that
 * opens a panel listing the current workspace's npm scripts, grouped by
 * project, with each script's live run state, start/stop controls, and a tail
 * of the output the Host collected for its latest run.
 *
 * Discovery, control, and output all come from the Host half's same-origin
 * JSON routes; this module holds no business state beyond what it is viewing.
 * @module @zouzhipeng/dsh-npm-script/client
 */

window.__ModuleLoader__.load({
  id: '@zouzhipeng/dsh-npm-script',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    /** Locale namespace owned by this bundle. */
    const NS = 'npm-commands'
    /** Browser-facing base path of the Host half's JSON routes. */
    const ROUTE = '/npm-commands'
    /** How often the open panel re-reads discovery and run state, in milliseconds. */
    const STATE_POLL_MS = 2000
    /** How often the output view appends newly collected bytes, in milliseconds. */
    const OUTPUT_POLL_MS = 1000

    /** Stylesheet for the button, the panel, and the output viewer. */
    const STYLES = `
.npmc-root {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 30;
}
.npmc-launcher {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px 0 11px;
  border: 0;
  border-radius: 18px;
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: var(--dsw-elevation-prominent);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 18px;
  font-weight: 500;
  cursor: pointer;
}
.npmc-launcher:hover { background: var(--dsw-alias-interactive-bg-hover); }
.npmc-launcher:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.npmc-launcher-mark { flex: none; display: inline-flex; color: var(--dsw-alias-state-error-primary); }
.npmc-panel {
  position: absolute;
  right: 0;
  bottom: calc(100% + 12px);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: min(580px, calc(100vw - 40px));
  max-height: min(620px, calc(100dvh - 140px));
  overflow: hidden;
  border: 0;
  border-radius: 20px;
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: var(--dsw-elevation-prominent);
  color: var(--dsw-alias-label-primary);
}
.npmc-panel:focus { outline: none; }
.npmc-header {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 12px 10px 18px;
}
.npmc-heading { flex: 1; min-width: 0; }
.npmc-title {
  margin: 0;
  font-size: 15px;
  line-height: 22px;
  font-weight: 500;
}
.npmc-subtitle {
  margin: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.npmc-icon-button {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 14px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.npmc-icon-button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.npmc-icon-button:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; background: transparent; }
.npmc-icon-button:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.npmc-notice {
  flex: none;
  margin: 0 18px 8px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 18px;
}
.npmc-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 12px 12px;
}
.npmc-placeholder {
  margin: 0;
  padding: 28px 6px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
  text-align: center;
}
.npmc-group { margin-top: 6px; }
.npmc-group-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 10px 6px 6px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.npmc-group-name {
  flex: none;
  font-size: 13px;
  line-height: 18px;
  font-weight: 500;
}
.npmc-group-dir {
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-caption);
  font-family: var(--ds-font-family-code);
  font-size: 11px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.npmc-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 6px;
  border-radius: 10px;
}
.npmc-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.npmc-row-text { flex: 1; min-width: 0; }
.npmc-script {
  overflow: hidden;
  font-family: var(--ds-font-family-code);
  font-size: 13px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.npmc-command {
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--ds-font-family-code);
  font-size: 11px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.npmc-status {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
}
.npmc-dot { flex: none; width: 6px; height: 6px; border-radius: 3px; background: var(--dsw-alias-state-idle-primary); }
.npmc-dot[data-kind='run'] { background: var(--dsw-alias-state-success-primary); }
.npmc-dot[data-kind='error'] { background: var(--dsw-alias-state-error-primary); }
.npmc-dot[data-kind='warn'] { background: var(--dsw-alias-state-warn-primary); }
.npmc-action {
  flex: none;
  height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  cursor: pointer;
  white-space: nowrap;
}
.npmc-action:hover { background: var(--dsw-alias-interactive-bg-hover-solid); }
.npmc-action:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
.npmc-action[data-variant='danger'] { color: var(--dsw-alias-state-error-primary); }
.npmc-action:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.npmc-output {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  margin: 0;
  padding: 12px 16px 16px;
  background: var(--dsw-alias-markdown-code-block);
  color: var(--dsw-alias-label-primary);
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  line-height: 18px;
  white-space: pre-wrap;
  word-break: break-word;
}
.npmc-stream-label {
  display: block;
  margin: 12px 0 4px;
  color: var(--dsw-alias-label-caption);
  font-family: var(--dsw-font-family);
  font-size: 11px;
  line-height: 16px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.npmc-stream-label:first-child { margin-top: 0; }
.npmc-stream[data-stream='stderr'] { color: var(--dsw-alias-state-error-primary); }
.npmc-stream[data-stream='stderr'][data-empty='true'] { color: var(--dsw-alias-label-dimmed); }
/* A printed address stays in the stream's own color and is marked by its
   underline, so a linkified line still reads as captured output. */
.npmc-link {
  color: inherit;
  text-decoration: underline dotted currentColor;
  text-underline-offset: 3px;
  border-radius: 3px;
  cursor: pointer;
}
.npmc-link:hover { text-decoration-style: solid; }
.npmc-link:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
/* Addresses found in the output, gathered above the log so a dev-server URL
   is reachable without scrolling back through the run. */
.npmc-urls {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 10px 18px 0;
}
.npmc-urls-label {
  color: var(--dsw-alias-label-caption);
  font-size: 11px;
  line-height: 16px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.npmc-urls .npmc-link {
  max-width: 100%;
  overflow: hidden;
  padding: 2px 8px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-link);
  font-family: var(--ds-font-family-code);
  font-size: 11px;
  line-height: 16px;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.npmc-urls .npmc-link:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  text-decoration: none;
}
.npmc-footer {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 18px 14px;
  border-top: 0.5px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-caption);
  font-size: 11px;
  line-height: 16px;
}
.npmc-footer-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`

    /**
     * Call one Host route and return its JSON body, or throw the error the Host reported.
     * @param path - route path with any query string.
     * @param init - optional `fetch` init.
     * @returns the parsed `{ ok: true, ... }` body.
     */
    async function requestJson(path, init) {
      const response = await fetch(path, { cache: 'no-store', ...init })
      let body
      try {
        body = await response.json()
      } catch {
        body = null
      }
      if (body === null || typeof body !== 'object') {
        throw new Error(`HTTP ${response.status}`)
      }
      if (body.ok !== true) {
        throw new Error(typeof body.error === 'string' && body.error !== '' ? body.error : `HTTP ${response.status}`)
      }
      return body
    }

    /**
     * Post one JSON payload to a Host route.
     * @param path - route path.
     * @param payload - JSON-serializable request body.
     * @returns the parsed response body.
     */
    function postJson(path, payload) {
      return requestJson(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
    }

    /**
     * Turn a thrown value into a localized notice.
     * @param key - locale key naming the failed operation.
     * @param error - the thrown value.
     * @returns the notice the panel renders.
     */
    function noticeOf(key, error) {
      return { key, detail: error instanceof Error ? error.message : String(error) }
    }

    /** The status chip one script row shows, derived from its latest run. */
    function statusOf(run, t) {
      if (run === undefined || run === null) return { kind: 'idle', label: t('status.idle') }
      if (run.status === 'running') {
        return run.stopping === true
          ? { kind: 'warn', label: t('stopping') }
          : { kind: 'run', label: t('status.running') }
      }
      if (run.status === 'failed') return { kind: 'error', label: t('status.failed') }
      if (run.status === 'stopped') return { kind: 'warn', label: t('status.stopped') }
      return { kind: 'done', label: t('status.exited') }
    }

    /**
     * One address-shaped run of text, excluding the characters that delimit it
     * in prose. Trailing sentence punctuation and the closing half of a
     * wrapping `(...)`/`[...]` belong to the sentence, not the address; a
     * balanced pair stays in the path.
     */
    const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`\\\u0000-\u001f]+/gi

    /**
     * CSI sequences and OSC hyperlinks. The Host runs every script with
     * `NO_COLOR`, but a tool that forces color would otherwise render its own
     * escape bytes as text.
     */
    const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g

    /**
     * Drop terminal escape sequences from captured output.
     * @param text - captured stdout or stderr.
     * @returns the same text as plain characters.
     */
    function stripAnsi(text) {
      return text.replace(ANSI_PATTERN, '')
    }

    /** How many times `open` occurs in `text`. */
    function countOf(text, open) {
      return text.split(open).length - 1
    }

    /**
     * Drop the punctuation that trails an address instead of belonging to it.
     * @param text - the matched run.
     * @returns the address, or `''` when nothing address-like remains.
     */
    function trimUrl(text) {
      let candidate = text
      while (candidate.length > 0) {
        const last = candidate[candidate.length - 1]
        if ('.,;:!?*'.includes(last)) {
          candidate = candidate.slice(0, -1)
          continue
        }
        const closer = { ')': '(', ']': '[', '}': '{' }[last]
        if (closer !== undefined && countOf(candidate, closer) < countOf(candidate, last)) {
          candidate = candidate.slice(0, -1)
          continue
        }
        break
      }
      if (candidate === '') return ''
      try {
        return new URL(candidate).hostname === '' ? '' : candidate
      } catch {
        // A run that only looked address-shaped (for example `http://`): plain text.
        return ''
      }
    }

    /**
     * Every web address in one stream's text, in first-seen order.
     * @param text - captured stdout or stderr.
     * @returns the addresses, without surrounding punctuation.
     */
    function findUrls(text) {
      const found = []
      for (const match of text.matchAll(URL_PATTERN)) {
        const candidate = trimUrl(match[0])
        if (candidate !== '' && !found.includes(candidate)) found.push(candidate)
      }
      return found
    }

    /** A printed address that opens in a new tab, so the panel keeps its state. */
    function OutputLink({ href }) {
      return React.createElement('a', {
        className: 'npmc-link',
        href,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: href,
      }, href)
    }

    /**
     * Render one stream, turning printed addresses into links.
     * @param text - captured stdout or stderr.
     * @param stream - which stream, for the `data-stream` attribute.
     * @returns the stream span.
     */
    function renderStream(text, stream) {
      const parts = []
      let cursor = 0
      for (const match of text.matchAll(URL_PATTERN)) {
        const candidate = trimUrl(match[0])
        if (candidate === '') continue
        if (match.index > cursor) parts.push(text.slice(cursor, match.index))
        parts.push(React.createElement(OutputLink, { key: `url-${match.index}`, href: candidate }))
        cursor = match.index + candidate.length
      }
      if (cursor < text.length) parts.push(text.slice(cursor))
      return React.createElement('span', { className: 'npmc-stream', 'data-stream': stream },
        parts.length === 0 ? text : parts)
    }

    /** An outlined terminal prompt mark for the launcher and the header. */
    function TerminalMark({ size }) {
      return React.createElement('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true',
      },
      React.createElement('path', {
        d: 'M2.5 3.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z',
        stroke: 'currentColor', strokeWidth: '1.2',
      }),
      React.createElement('path', {
        d: 'M5 6.5 6.75 8 5 9.5M8.5 10h3',
        stroke: 'currentColor', strokeWidth: '1.2', strokeLinecap: 'round', strokeLinejoin: 'round',
      }))
    }

    /** A small glyph set drawn inline so the bundle carries no icon dependency. */
    const Glyph = {
      close: (size) => React.createElement('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true',
      }, React.createElement('path', {
        d: 'M4 4l8 8M12 4l-8 8', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round',
      })),
      refresh: (size) => React.createElement('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true',
      }, React.createElement('path', {
        d: 'M13 8a5 5 0 1 1-1.6-3.7M13 3v3h-3',
        stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round', strokeLinejoin: 'round',
      })),
      back: (size) => React.createElement('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true',
      }, React.createElement('path', {
        d: 'M9.5 4 5.5 8l4 4', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round', strokeLinejoin: 'round',
      })),
    }

    /**
     * Tail one run's captured stdout and stderr, following new bytes as they arrive.
     * @param props - the run to read, its localized copy, and the back action.
     * @returns the output viewer.
     */
    function OutputView({ runId, initialRun, t, onBack }) {
      const [run, setRun] = React.useState(initialRun)
      const [streams, setStreams] = React.useState({ stdout: '', stderr: '', lossy: false })
      const [notice, setNotice] = React.useState(null)
      const stdoutOffset = React.useRef(0)
      const stderrOffset = React.useRef(0)
      const scroller = React.useRef(null)
      const stick = React.useRef(true)

      React.useEffect(() => {
        let stopped = false
        let timer = null
        const tick = async () => {
          try {
            const query = new URLSearchParams({
              runId,
              stdoutOffset: String(stdoutOffset.current),
              stderrOffset: String(stderrOffset.current),
            })
            const body = await requestJson(`${ROUTE}/output?${query.toString()}`)
            if (stopped) return
            stdoutOffset.current = body.stdout.nextOffset
            stderrOffset.current = body.stderr.nextOffset
            setRun(body.run)
            setStreams((previous) => ({
              stdout: stripAnsi(body.stdout.lossy ? body.stdout.text : previous.stdout + body.stdout.text),
              stderr: stripAnsi(body.stderr.lossy ? body.stderr.text : previous.stderr + body.stderr.text),
              lossy: previous.lossy || body.stdout.lossy || body.stderr.lossy,
            }))
            setNotice(null)
            // A settled run cannot produce more bytes: read its retained tail once and stop.
            if (body.run !== null && body.run.status !== 'running' && timer !== null) {
              window.clearInterval(timer)
              timer = null
            }
          } catch (failure) {
            if (!stopped) setNotice(noticeOf('error.output', failure))
          }
        }
        void tick()
        timer = window.setInterval(() => { void tick() }, OUTPUT_POLL_MS)
        return () => {
          stopped = true
          if (timer !== null) window.clearInterval(timer)
        }
      }, [runId])

      React.useEffect(() => {
        const element = scroller.current
        if (element === null || !stick.current) return
        element.scrollTop = element.scrollHeight
      }, [streams])

      const onScroll = () => {
        const element = scroller.current
        if (element === null) return
        stick.current = element.scrollTop + element.clientHeight >= element.scrollHeight - 24
      }

      const outcome = []
      if (run !== undefined && run !== null) {
        if (typeof run.exitCode === 'number') outcome.push(t('output.exit', { code: run.exitCode }))
        if (typeof run.signal === 'string' && run.signal !== '') outcome.push(t('output.signal', { signal: run.signal }))
        if (typeof run.error === 'string' && run.error !== '') outcome.push(run.error)
      }
      const status = statusOf(run, t)
      const empty = streams.stdout === '' && streams.stderr === ''
      const urls = findUrls(`${streams.stdout}\n${streams.stderr}`)

      return React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'npmc-header' },
          React.createElement('button', {
            type: 'button', className: 'npmc-icon-button', onClick: onBack, 'aria-label': t('output.back'), title: t('output.back'),
          }, Glyph.back(16)),
          React.createElement('div', { className: 'npmc-heading' },
            React.createElement('h2', { className: 'npmc-title' }, `${run === undefined || run === null ? '' : run.script} — ${t('output.title')}`),
            React.createElement('p', { className: 'npmc-subtitle', title: outcome.join(' · ') },
              outcome.length > 0 ? outcome.join(' · ') : t('output.noOutcome'))),
          React.createElement('span', { className: 'npmc-status' },
            React.createElement('span', { className: 'npmc-dot', 'data-kind': status.kind }),
            status.label)),
        notice === null ? null : React.createElement('p', { className: 'npmc-notice', role: 'status' }, `${t(notice.key)} ${notice.detail}`),
        urls.length === 0 ? null : React.createElement('div', { className: 'npmc-urls' },
          React.createElement('span', { className: 'npmc-urls-label' }, t('output.links')),
          urls.map((href) => React.createElement(OutputLink, { key: href, href }))),
        React.createElement('div', { className: 'npmc-output', ref: scroller, onScroll, tabIndex: 0, role: 'log', 'aria-label': t('output.title') },
          empty ? React.createElement('span', { className: 'npmc-stream', 'data-stream': 'stdout', 'data-empty': 'true' }, t('output.empty')) : null,
          streams.lossy ? React.createElement('span', { className: 'npmc-stream-label' }, t('output.truncated')) : null,
          streams.stdout === '' ? null : React.createElement(React.Fragment, null,
            React.createElement('span', { className: 'npmc-stream-label' }, t('output.stdout')),
            renderStream(streams.stdout, 'stdout')),
          streams.stderr === '' ? null : React.createElement(React.Fragment, null,
            React.createElement('span', { className: 'npmc-stream-label' }, t('output.stderr')),
            renderStream(streams.stderr, 'stderr'))))
    }

    /**
     * The floating launcher and its script panel.
     * @param props - overlay runtime seats plus this bundle's localized copy.
     * @returns the launcher, and the panel while it is open.
     */
    function NpmCommands(props) {
      const { useSessions, t } = props
      const [open, setOpen] = React.useState(false)
      const [view, setView] = React.useState(null)
      const [state, setState] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const [pending, setPending] = React.useState(false)
      const root = React.useRef(null)
      const launcher = React.useRef(null)
      // The panel takes focus once per open; polling re-renders must not steal it back.
      const focused = React.useRef(false)

      const cwd = useSessions((snapshot) => {
        for (const id of snapshot.ids) {
          const row = snapshot.byId[id]
          if (row !== undefined && (row.retainedBy.mainView ?? 0) > 0) return row.cwd
        }
        return undefined
      })

      const load = React.useCallback(async (force) => {
        const query = new URLSearchParams()
        if (typeof cwd === 'string' && cwd !== '') query.set('path', cwd)
        if (force === true) query.set('refresh', '1')
        try {
          setState(await requestJson(`${ROUTE}/state?${query.toString()}`))
          setNotice(null)
        } catch (failure) {
          setNotice(noticeOf('error.load', failure))
        }
      }, [cwd])

      React.useEffect(() => {
        if (!open) return undefined
        void load(false)
        const timer = window.setInterval(() => { void load(false) }, STATE_POLL_MS)
        return () => { window.clearInterval(timer) }
      }, [open, load])

      React.useEffect(() => {
        if (!open) return undefined
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          if (view !== null) {
            setView(null)
            return
          }
          setOpen(false)
          window.requestAnimationFrame(() => { launcher.current?.focus() })
        }
        const onPointerDown = (event) => {
          const element = root.current
          if (element !== null && !element.contains(event.target)) setOpen(false)
        }
        document.addEventListener('keydown', onKeyDown)
        document.addEventListener('mousedown', onPointerDown)
        return () => {
          document.removeEventListener('keydown', onKeyDown)
          document.removeEventListener('mousedown', onPointerDown)
        }
      }, [open, view])

      React.useEffect(() => {
        if (open) return
        setView(null)
        setPending(false)
      }, [open])

      const toggle = () => {
        if (open) {
          setOpen(false)
          window.requestAnimationFrame(() => { launcher.current?.focus() })
          return
        }
        focused.current = false
        setOpen(true)
      }

      const act = async (key, work) => {
        setPending(true)
        try {
          await work()
          await load(false)
          setNotice(null)
        } catch (failure) {
          setNotice(noticeOf(key, failure))
        } finally {
          setPending(false)
        }
      }

      const launcherButton = React.createElement('button', {
        type: 'button',
        ref: launcher,
        className: 'npmc-launcher',
        onClick: toggle,
        'aria-expanded': open,
        'aria-label': t('button.label'),
        title: t('button.label'),
      },
      React.createElement('span', { className: 'npmc-launcher-mark' }, TerminalMark({ size: 16 })),
      'npm')

      if (!open) {
        return React.createElement('div', { className: 'npmc-root', ref: root, 'data-npm-commands': '' }, launcherButton)
      }

      const workspace = state === null ? null : state.workspace
      const projects = state === null || workspace === null ? [] : state.projects
      const busy = pending === true

      const body = []
      if (view !== null) {
        body.push(React.createElement(OutputView, {
          key: `output:${view.runId}`,
          runId: view.runId,
          initialRun: view,
          t,
          onBack: () => { setView(null) },
        }))
      } else {
        body.push(React.createElement('div', { className: 'npmc-header', key: 'header' },
          React.createElement('div', { className: 'npmc-heading' },
            React.createElement('h2', { className: 'npmc-title' }, t('title')),
            React.createElement('p', { className: 'npmc-subtitle', title: workspace === null ? undefined : workspace.path },
              workspace === null ? t('workspace.unknown') : workspace.path)),
          React.createElement('button', {
            type: 'button', className: 'npmc-icon-button', onClick: () => { void load(true) },
            'aria-label': t('refresh'), title: t('refresh'),
          }, Glyph.refresh(16)),
          React.createElement('button', {
            type: 'button', className: 'npmc-icon-button', onClick: () => { setOpen(false) },
            'aria-label': t('close'), title: t('close'),
          }, Glyph.close(16))))

        if (notice !== null) {
          body.push(React.createElement('p', { className: 'npmc-notice', key: 'notice', role: 'status' },
            `${t(notice.key)} ${notice.detail}`))
        }

        const content = []
        if (state === null) {
          content.push(React.createElement('p', { className: 'npmc-placeholder', key: 'loading' }, t('loading')))
        } else if (workspace === null) {
          content.push(React.createElement('p', { className: 'npmc-placeholder', key: 'none' }, t('empty.noWorkspace')))
        } else if (projects.length === 0) {
          content.push(React.createElement('p', { className: 'npmc-placeholder', key: 'noprojects' }, t('empty.noProjects')))
        } else {
          for (const project of projects) {
            const rows = project.scripts.map((script) => {
              const status = statusOf(script.run, t)
              const running = script.run !== null && script.run.status === 'running'
              const controls = []
              if (script.run !== null) {
                controls.push(React.createElement('button', {
                  key: 'log',
                  type: 'button',
                  className: 'npmc-action',
                  disabled: busy,
                  onClick: () => { setView(script.run) },
                }, t('output.open')))
              }
              controls.push(React.createElement('button', {
                key: 'run',
                type: 'button',
                className: 'npmc-action',
                'data-variant': running ? 'danger' : undefined,
                disabled: busy || (running && script.run.stopping === true),
                onClick: () => {
                  if (running) {
                    void act('error.stop', () => postJson(`${ROUTE}/stop`, { runId: script.run.runId }))
                  } else {
                    void act('error.start', () => postJson(`${ROUTE}/start`, { path: cwd, dir: project.dir, script: script.name }))
                  }
                },
              }, running ? t('stop') : (script.run === null ? t('run') : t('rerun'))))
              return React.createElement('div', { className: 'npmc-row', key: `${project.dir}\u0000${script.name}` },
                React.createElement('div', { className: 'npmc-row-text' },
                  React.createElement('div', { className: 'npmc-script', title: script.name }, script.name),
                  React.createElement('div', { className: 'npmc-command', title: script.command }, script.command)),
                React.createElement('span', { className: 'npmc-status' },
                  React.createElement('span', { className: 'npmc-dot', 'data-kind': status.kind }),
                  status.label),
                ...controls)
            })
            content.push(React.createElement('section', { className: 'npmc-group', key: project.dir },
              React.createElement('div', { className: 'npmc-group-header' },
                React.createElement('span', { className: 'npmc-group-name' }, project.name),
                React.createElement('span', { className: 'npmc-group-dir', title: project.dir },
                  project.dir === '' ? t('root') : project.dir)),
              rows))
          }
        }
        body.push(React.createElement('div', { className: 'npmc-body', key: 'body' }, content))
        body.push(React.createElement('div', { className: 'npmc-footer', key: 'footer' },
          React.createElement('span', { className: 'npmc-footer-text' },
            projects.length === 0
              ? t('footer.none')
              : t('footer.count', { projects: projects.length, scripts: projects.reduce((sum, project) => sum + project.scripts.length, 0) }))))
      }

      return React.createElement('div', { className: 'npmc-root', ref: root, 'data-npm-commands': '' },
        React.createElement('div', {
          className: 'npmc-panel',
          role: 'dialog',
          'aria-modal': false,
          'aria-label': t('title'),
          tabIndex: -1,
          ref: (element) => {
            if (element === null || focused.current) return
            focused.current = true
            element.focus()
          },
        }, ...body),
        launcherButton)
    }

    /** Cordis services this bundle reads: the slot registry and its own locale dictionaries. */
    exports.inject = ['slots', 'locale']

    /**
     * Register the localized copy and the frame-wide overlay entry.
     * @param ctx - client root context.
     */
    exports.apply = (ctx) => {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'npm-commands: dictionaries')
      const t = ctx.locale.bind(NS)
      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.dataset.plugin = '@zouzhipeng/dsh-npm-script'
        tag.dataset.pluginCss = 'npm-commands'
        tag.textContent = STYLES
        document.head.appendChild(tag)
        return () => { tag.remove() }
      }, 'npm-commands: styles')
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'npm-commands',
        order: 10,
        label: () => t('button.label'),
        locale: NS,
      }, NpmCommands))
    }

    /** English copy, including the package-display fields read from `locale/en.json`. */
    const en = {
      'meta.title': 'NPM Commands',
      'meta.description': "Lists this workspace's npm scripts in a floating panel, runs them, and tails their output.",
      'button.label': 'NPM commands',
      title: 'NPM Commands',
      close: 'Close',
      refresh: 'Rescan',
      loading: 'Scanning for package.json…',
      'empty.noWorkspace': 'No workspace is open.',
      'empty.noProjects': 'No package.json with scripts was found in this workspace.',
      'workspace.unknown': 'Unknown workspace',
      root: 'workspace root',
      run: 'Run',
      rerun: 'Run again',
      stop: 'Stop',
      stopping: 'Stopping',
      'status.idle': 'Runnable',
      'status.running': 'Running',
      'status.exited': 'Finished',
      'status.failed': 'Failed',
      'status.stopped': 'Stopped',
      'output.open': 'Output',
      'output.title': 'Output',
      'output.back': 'Back to the script list',
      'output.empty': 'No output yet.',
      'output.stdout': 'stdout',
      'output.stderr': 'stderr',
      'output.truncated': 'Earlier output scrolled out of the retained buffer.',
      'output.links': 'Links',
      'output.noOutcome': 'No outcome yet',
      'output.exit': 'Exit code {code}',
      'output.signal': 'Signal {signal}',
      'error.load': 'Could not read the script list.',
      'error.start': 'Could not start the script.',
      'error.stop': 'Could not stop the script.',
      'error.output': 'Could not read the output.',
      'footer.count': '{projects} projects · {scripts} scripts',
      'footer.none': 'No scripts',
    }

    /** Chinese copy. */
    const zh = {
      'meta.title': 'NPM 命令',
      'meta.description': '在悬浮面板里列出当前工作区的 npm 命令，可执行并查看输出。',
      'button.label': 'NPM 命令',
      title: 'NPM 命令',
      close: '关闭',
      refresh: '重新扫描',
      loading: '正在扫描 package.json…',
      'empty.noWorkspace': '当前没有打开的工作区',
      'empty.noProjects': '该工作区下没有找到带脚本的 package.json',
      'workspace.unknown': '未知工作区',
      root: '工作区根目录',
      run: '执行',
      rerun: '重新执行',
      stop: '停止',
      stopping: '停止中',
      'status.idle': '可执行',
      'status.running': '执行中',
      'status.exited': '已完成',
      'status.failed': '执行失败',
      'status.stopped': '已停止',
      'output.open': '输出',
      'output.title': '输出',
      'output.back': '返回命令列表',
      'output.empty': '暂无输出',
      'output.stdout': '标准输出',
      'output.stderr': '标准错误',
      'output.truncated': '更早的输出已滚出保留缓冲区',
      'output.links': '可访问地址',
      'output.noOutcome': '暂无结果',
      'output.exit': '退出码 {code}',
      'output.signal': '信号 {signal}',
      'error.load': '读取命令列表失败',
      'error.start': '执行命令失败',
      'error.stop': '停止命令失败',
      'error.output': '读取输出失败',
      'footer.count': '{projects} 个项目 · {scripts} 条命令',
      'footer.none': '暂无命令',
    }

    return module.exports
  },
})

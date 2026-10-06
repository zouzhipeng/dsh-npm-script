/**
 * Host half of the npm-commands bundle: discovers every `package.json` project
 * under a Workspace, runs its `scripts` entries as managed subprocesses, and
 * serves discovery, control, and captured output over same-origin JSON routes.
 *
 * One workspace directory may hold several projects (a monorepo's `packages/*`
 * and `apps/*`), so discovery returns projects and the client groups scripts by
 * project. A long-lived script (`npm run dev`) stays observable after its
 * spawned command reports an outcome: state and output remain readable until
 * the run is pruned by `historyLimit`.
 * @module @zouzhipeng/dsh-npm-script
 */

import { randomUUID } from 'node:crypto'
import { readFile, readdir, realpath } from 'node:fs/promises'
import { basename, join, sep } from 'node:path'

/** Browser-facing base path of the plugin's JSON routes. Fixed: the plain-JavaScript client bundle has no config channel. */
const ROUTE_PREFIX = '/npm-commands'

/** Deployment-varying choices; every one is validated from `Config`. */
const DEFAULT_CONFIG = {
  /** Directory levels below a workspace root searched for `package.json` files. */
  scanDepth: 3,
  /** Retained in-memory tail of each collected stream, in bytes. */
  maxOutputBytes: 262144,
  /** Spill-file ceiling per collected stream, in bytes. */
  maxSpillBytes: 8388608,
  /** Termination grace period handed to the subprocess seam, in milliseconds. */
  graceMs: 5000,
  /** Settled runs retained per workspace/project/script slot. */
  historyLimit: 20,
  /** How long a workspace scan is reused before the next filesystem walk, in milliseconds. */
  scanCacheMs: 5000,
}

/**
 * Plain-text environment for every script run, following the shipped shell
 * packages. `NO_COLOR`/`TERM=dumb` keep escape sequences out of the captured
 * output, where they would split a printed address and hide it from the
 * Client's linkifier; the pager entries keep a script from blocking on one.
 */
const ENV_OVERRIDES = {
  NO_COLOR: '1',
  TERM: 'dumb',
  PAGER: 'cat',
  GIT_PAGER: 'cat',
}

/** Directories never walked during discovery: generated trees and version-control state. */
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.venv',
])

/**
 * Validate and normalize the plugin config. The schema is hand-written so the
 * plugin carries no dependency on `@deepseek-ai/schemastery`; it exposes only
 * `~standard.validate`, which is all the Cordis loader reads.
 */
export const Config = {
  '~standard': {
    validate(value) {
      if (value === undefined || value === null) return { value: { ...DEFAULT_CONFIG } }
      if (typeof value !== 'object' || Array.isArray(value)) {
        return { issues: [{ message: 'config must be an object', path: [] }] }
      }
      const issues = []
      const resolved = { ...DEFAULT_CONFIG }
      for (const [key, raw] of Object.entries(value)) {
        if (!Object.hasOwn(DEFAULT_CONFIG, key)) {
          issues.push({ message: `unknown config key '${key}'`, path: [key] })
          continue
        }
        const expected = typeof DEFAULT_CONFIG[key]
        if (typeof raw !== expected || (expected === 'number' && !Number.isFinite(raw))) {
          issues.push({ message: `'${key}' must be a ${expected}`, path: [key] })
          continue
        }
        resolved[key] = raw
      }
      if (issues.length > 0) return { issues }
      if (!Number.isInteger(resolved.scanDepth) || resolved.scanDepth < 0 || resolved.scanDepth > 8) {
        return { issues: [{ message: "'scanDepth' must be an integer between 0 and 8", path: ['scanDepth'] }] }
      }
      if (!(resolved.maxOutputBytes > 0) || !(resolved.maxSpillBytes > 0) || !(resolved.graceMs > 0)) {
        return { issues: [{ message: "'maxOutputBytes', 'maxSpillBytes', and 'graceMs' must be positive", path: [] }] }
      }
      if (!Number.isInteger(resolved.historyLimit) || resolved.historyLimit < 1) {
        return { issues: [{ message: "'historyLimit' must be a positive integer", path: ['historyLimit'] }] }
      }
      if (!(resolved.scanCacheMs >= 0)) {
        return { issues: [{ message: "'scanCacheMs' must not be negative", path: ['scanCacheMs'] }] }
      }
      return { value: resolved }
    },
  },
}

/** Host services this plugin cannot work without. */
export const inject = ['webServer', 'subprocess', 'workspaceRegistry']

/** IPv4 127/8 predicate (four decimal octets, first == 127). */
function isIPv4Loopback(v4) {
  const parts = v4.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/** Whether a socket remote address names the loopback range (127/8, ::1, IPv4-mapped). */
function isLoopbackAddress(address) {
  if (address === undefined) return false
  const normalized = address.toLowerCase()
  if (normalized === '::1') return true
  if (normalized.startsWith('::ffff:')) return isIPv4Loopback(normalized.slice(7))
  return isIPv4Loopback(normalized)
}

/** Whether a URL hostname names the loopback authority (localhost, [::1], 127/8). */
function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  return isIPv4Loopback(hostname)
}

/**
 * Request-level trust fence: a loopback socket address AND a loopback `Host`
 * header, plus browser same-origin markers. The socket address is
 * authoritative; `X-Forwarded-For` is never trusted. These routes start
 * arbitrary workspace scripts, so they are loopback-only by construction.
 */
function isLoopbackRequest(request) {
  if (!isLoopbackAddress(request.socket.remoteAddress)) return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl
  try {
    hostUrl = new URL('http://' + host)
  } catch {
    return false
  }
  if (!isLoopbackHostname(hostUrl.hostname)) return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** Default JSON body cap: 64 KiB. */
const DEFAULT_JSON_BODY_MAX_BYTES = 65536

/** Family-default JSON response headers. */
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
}

/** Write one JSON response. */
function writeJson(res, status, body) {
  res.writeHead(status, JSON_HEADERS)
  res.end(JSON.stringify(body))
}

/**
 * Bounded body reader: parse a request body as JSON, or null on an empty body,
 * invalid JSON, or a body past `maxBytes`. Overflow destroys the request
 * instead of draining the remainder.
 */
function readJsonBody(req, maxBytes = DEFAULT_JSON_BODY_MAX_BYTES) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        req.destroy()
        resolve(null)
        return
      }
      chunks.push(chunk)
    })
    req.on('error', () => { resolve(null) })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        resolve(null)
      }
    })
  })
}

/** Read and parse one JSON file, or undefined when it is missing or malformed. */
async function readJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return undefined
  }
}

/** Non-null, non-array object predicate. */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Walk one workspace directory for `package.json` files carrying at least one
 * string script. Symlinked directories are not followed, so a link cycle
 * cannot make discovery unbounded.
 * @param root - canonical workspace directory.
 * @param maxDepth - directory levels below `root` to visit.
 * @returns projects ordered root-first, then by relative directory.
 */
async function discoverProjects(root, maxDepth) {
  const found = []
  const walk = async (dir, rel, depth) => {
    const manifest = await readJsonFile(join(dir, 'package.json'))
    if (isRecord(manifest) && isRecord(manifest.scripts)) {
      const scripts = Object.entries(manifest.scripts)
        .filter(([, command]) => typeof command === 'string' && command.trim() !== '')
        .map(([name, command]) => ({ name, command }))
      if (scripts.length > 0) {
        found.push({
          dir: rel,
          name: typeof manifest.name === 'string' && manifest.name !== ''
            ? manifest.name
            : (rel === '' ? basename(root) : rel),
          packageName: typeof manifest.name === 'string' ? manifest.name : '',
          scripts,
        })
      }
    }
    if (depth >= maxDepth) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`
      await walk(join(dir, entry.name), childRel, depth + 1)
    }
  }
  await walk(root, '', 0)
  found.sort((a, b) => (a.dir === '' ? -1 : b.dir === '' ? 1 : a.dir.localeCompare(b.dir)))
  return found
}

/**
 * Register the discovery, control, and output routes.
 * @param ctx - Host context carrying `webServer`, `subprocess`, and `workspaceRegistry`.
 * @param config - validated plugin config.
 */
export function apply(ctx, config) {
  const settings = config ?? { ...DEFAULT_CONFIG }
  const logger = ctx.logger

  /** Latest run per `${workspaceId}\0${dir}\0${script}` slot, live or settled. */
  const slotRuns = new Map()
  /** Every retained run by id. */
  const runs = new Map()
  /** Workspace scans keyed by workspace id: `{ at, projects }`. */
  const scans = new Map()

  let npmExecutable

  /** Resolve the npm launcher once; fall back to a bare PATH name when lookup fails. */
  const resolveNpm = async () => {
    if (npmExecutable !== undefined) return npmExecutable
    try {
      npmExecutable = await ctx.subprocess.resolveExecutable('npm')
    } catch (error) {
      logger.warn(`npm-commands: could not resolve the npm executable, falling back to a PATH lookup: ${String(error)}`)
      npmExecutable = 'npm'
    }
    return npmExecutable
  }

  const slotKey = (workspaceId, dir, script) => `${workspaceId}\u0000${dir}\u0000${script}`

  /** Drop the oldest settled runs of one slot beyond `historyLimit`. */
  const pruneSlot = (key) => {
    const retained = []
    for (const run of runs.values()) {
      if (slotKey(run.workspaceId, run.dir, run.script) === key) retained.push(run)
    }
    if (retained.length <= settings.historyLimit) return
    retained.sort((a, b) => a.startedAt - b.startedAt)
    for (const run of retained.slice(0, retained.length - settings.historyLimit)) {
      if (run.status === 'running') continue
      runs.delete(run.runId)
      if (slotRuns.get(key) === run.runId) slotRuns.delete(key)
    }
  }

  /** Scan a workspace, reusing a recent walk. */
  const projectsOf = async (workspace, force) => {
    const cached = scans.get(workspace.id)
    if (!force && cached !== undefined && Date.now() - cached.at < settings.scanCacheMs) return cached.projects
    const projects = await discoverProjects(workspace.path, settings.scanDepth)
    scans.set(workspace.id, { at: Date.now(), projects })
    return projects
  }

  /** One run's client-facing summary. */
  const summarize = (run) => ({
    runId: run.runId,
    status: run.status,
    script: run.script,
    dir: run.dir,
    command: run.command,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    exitCode: run.exitCode,
    signal: run.signal,
    error: run.error,
    /** True while the run is still winding down after its script reported an outcome. */
    stopping: run.stopRequested && run.status === 'running',
  })

  /**
   * Resolve the workspace named by `workspaceId`, else by directory `path`,
   * else the first registered one. A directory hint matches the workspace
   * holding it, so a Session started in a subdirectory still finds its
   * workspace; the longest match wins when workspaces nest.
   */
  const resolveWorkspace = async (workspaceId, path) => {
    const registry = ctx.workspaceRegistry
    if (typeof workspaceId === 'string' && workspaceId !== '') {
      const byId = registry.get(workspaceId)
      if (byId !== undefined) return byId
    }
    if (typeof path === 'string' && path !== '') {
      let canonical
      try {
        canonical = await realpath(path)
      } catch {
        // A hint that no longer exists is not an error; fall through to the registry order.
        canonical = undefined
      }
      if (canonical !== undefined) {
        let best
        for (const workspace of registry.list()) {
          if (canonical !== workspace.path && !canonical.startsWith(workspace.path + sep)) continue
          if (best === undefined || workspace.path.length > best.path.length) best = workspace
        }
        if (best !== undefined) return best
      }
    }
    return registry.list()[0]
  }

  /** One workspace's discovered projects and run states. */
  const buildState = async (workspace, force) => {
    if (workspace === undefined) return { ok: true, workspace: null, projects: [] }
    const projects = await projectsOf(workspace, force)
    return {
      ok: true,
      workspace: { id: workspace.id, title: workspace.title, path: workspace.path },
      projects: projects.map((project) => ({
        dir: project.dir,
        name: project.name,
        packageName: project.packageName,
        scripts: project.scripts.map((script) => {
          const runId = slotRuns.get(slotKey(workspace.id, project.dir, script.name))
          const run = runId === undefined ? undefined : runs.get(runId)
          return { name: script.name, command: script.command, run: run === undefined ? null : summarize(run) }
        }),
      })),
    }
  }

  /** Start one discovered script as a managed subprocess. */
  const startRun = async (payload) => {
    const workspace = await resolveWorkspace(payload.workspaceId, payload.path)
    if (workspace === undefined) throw new Error('no workspace is registered')
    const dir = typeof payload.dir === 'string' ? payload.dir : ''
    const script = typeof payload.script === 'string' ? payload.script : ''
    const projects = await projectsOf(workspace, true)
    const project = projects.find((item) => item.dir === dir)
    if (project === undefined) throw new Error(`unknown project directory '${dir}'`)
    const entry = project.scripts.find((item) => item.name === script)
    if (entry === undefined) throw new Error(`unknown script '${script}' in '${project.name}'`)
    const key = slotKey(workspace.id, dir, script)
    const live = runs.get(slotRuns.get(key))
    if (live !== undefined && live.status === 'running') throw new Error(`'${script}' is already running`)
    const cwd = join(workspace.path, dir)
    if (cwd !== workspace.path && !cwd.startsWith(workspace.path + sep)) {
      throw new Error(`project directory '${dir}' escapes the workspace`)
    }

    const argv = [await resolveNpm(), 'run', script]
    const collect = { maxBytes: settings.maxOutputBytes, spill: { maxBytes: settings.maxSpillBytes } }
    const handle = ctx.subprocess.spawn({
      argv,
      cwd,
      stdio: { stdin: 'ignore', stdout: collect, stderr: collect },
      graceMs: settings.graceMs,
      // Plain text keeps URLs in the captured output recognizable as text:
      // escape sequences would split a printed address and hide it from the
      // Client's linkifier. A caller-set value still wins.
      env: ENV_OVERRIDES,
    })

    const run = {
      runId: randomUUID(),
      workspaceId: workspace.id,
      dir,
      script,
      command: entry.command,
      argv,
      handle,
      status: 'running',
      startedAt: Date.now(),
      endedAt: undefined,
      exitCode: undefined,
      signal: undefined,
      error: undefined,
      stopRequested: false,
    }
    runs.set(run.runId, run)
    slotRuns.set(key, run.runId)
    pruneSlot(key)

    const settle = (outcome) => {
      if (run.status !== 'running') return
      run.endedAt = Date.now()
      run.exitCode = outcome.exitCode
      run.signal = outcome.signal
      run.status = run.stopRequested
        ? 'stopped'
        : (outcome.exitCode === 0 && outcome.signal === null ? 'exited' : 'failed')
    }
    handle.done.then(settle, (error) => {
      run.endedAt = Date.now()
      run.error = error instanceof Error ? error.message : String(error)
      run.status = run.stopRequested ? 'stopped' : 'failed'
    })
    return summarize(run)
  }

  /** Stop one retained run through the subprocess seam's termination verb. */
  const stopRun = (payload) => {
    const run = runs.get(typeof payload.runId === 'string' ? payload.runId : '')
    if (run === undefined) throw new Error('unknown run')
    if (run.status !== 'running') return summarize(run)
    run.stopRequested = true
    run.handle.terminate()
    return summarize(run)
  }

  /** Read the output collected since the caller's cursors. */
  const readOutput = (payload) => {
    const run = runs.get(typeof payload.runId === 'string' ? payload.runId : '')
    if (run === undefined) throw new Error('unknown run')
    const read = (reader, from) => {
      if (reader === undefined) return { text: '', nextOffset: from, lossy: false }
      const chunk = reader.readFrom(from)
      return { text: chunk.text, nextOffset: chunk.nextOffset, lossy: chunk.lossy }
    }
    return {
      ok: true,
      run: summarize(run),
      stdout: read(run.handle.collected.stdout, payload.stdoutOffset ?? 0),
      stderr: read(run.handle.collected.stderr, payload.stderrOffset ?? 0),
    }
  }

  /** Shared fence for every route: loopback only, then the method. */
  const guard = (req, res, method) => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { ok: false, error: 'method-not-allowed' })
      return false
    }
    return true
  }

  const routes = [
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/state`,
      handler: (req, res) => {
        if (!guard(req, res, 'GET')) return
        const url = new URL(req.url ?? '/', 'http://localhost')
        const workspaceId = url.searchParams.get('workspaceId') ?? ''
        const path = url.searchParams.get('path') ?? ''
        const force = url.searchParams.get('refresh') === '1'
        resolveWorkspace(workspaceId, path).then(
          (workspace) => buildState(workspace, force),
          (error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }),
        ).then(
          (body) => { writeJson(res, body.ok === true ? 200 : 500, body) },
          (error) => {
            writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
          },
        )
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/start`,
      handler: (req, res) => {
        if (!guard(req, res, 'POST')) return
        readJsonBody(req).then((parsed) => {
          if (!isRecord(parsed)) {
            writeJson(res, 400, { ok: false, error: 'a JSON object body is required' })
            return
          }
          startRun(parsed).then(
            (run) => { writeJson(res, 200, { ok: true, run }) },
            (error) => {
              writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
            },
          )
        })
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/stop`,
      handler: (req, res) => {
        if (!guard(req, res, 'POST')) return
        readJsonBody(req).then((parsed) => {
          if (!isRecord(parsed)) {
            writeJson(res, 400, { ok: false, error: 'a JSON object body is required' })
            return
          }
          try {
            writeJson(res, 200, { ok: true, run: stopRun(parsed) })
          } catch (error) {
            writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
        })
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/output`,
      handler: (req, res) => {
        if (!guard(req, res, 'GET')) return
        const url = new URL(req.url ?? '/', 'http://localhost')
        const payload = {
          runId: url.searchParams.get('runId') ?? '',
          stdoutOffset: Number(url.searchParams.get('stdoutOffset') ?? '0'),
          stderrOffset: Number(url.searchParams.get('stderrOffset') ?? '0'),
        }
        try {
          writeJson(res, 200, readOutput(payload))
        } catch (error) {
          writeJson(res, 404, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
  ]

  ctx.effect(() => {
    const disposers = routes.map((route) => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'npm-commands: routes')

  ctx.effect(() => () => {
    for (const run of runs.values()) {
      if (run.status === 'running') run.handle.terminate()
    }
  }, 'npm-commands: runs')
}

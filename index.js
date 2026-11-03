/**
 * Plugin Market — host half.
 *
 * Provides one same-origin JSON endpoint for the browser half:
 *
 *   POST /plugin-market/api   body: { method, args }
 *   200 { ok: true,  result }
 *   200 { ok: false, error, code }
 *
 * Methods (CONTRACT.md §5): meta | search | detail | refresh.
 *
 * Design rules honoured here:
 *  - Data and index load lazily on the first request; no work at module load.
 *  - Every failure path is swallowed into an `{ ok: false }` reply — a broken
 *    data file or an offline network must never take the host down.
 *  - Bundled snapshot is the source of truth; a newer cache written by a
 *    previous successful `refresh` wins when it is newer.
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { SORT_KEYS, buildTagFacets, normalizeText, searchItems } from './lib/search.js'

/** Cordis service injection. */
export const inject = ['webServer']

/** Bundled snapshot, resolved relative to the real package directory. */
const BUNDLED_DATA_URL = new URL('./data/market.json', import.meta.url)
/** Optional donation/support config shipped beside the dataset. */
const BUNDLED_SPONSOR_URL = new URL('./data/sponsor.json', import.meta.url)

/** Live index endpoints, tried in order (lite first). */
const LIVE_URLS = [
  'https://2bingling.github.io/dsh-market/plugins-lite.json',
  'https://2bingling.github.io/dsh-market/plugins.json',
]

/** Request body cap: 1 MiB. */
const MAX_BODY_BYTES = 1024 * 1024

/** Live fetch timeout. */
const FETCH_TIMEOUT_MS = 15_000

const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
})

/* ------------------------------------------------------------------ */
/* Small coercions                                                     */
/* ------------------------------------------------------------------ */

/** First non-empty trimmed string among the candidates. */
function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed) return trimmed
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }
  }
  return ''
}

/** Finite non-negative integer or fallback. */
function toNumber(value, fallback = 0) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num) || num < 0) return fallback
  return Math.trunc(num)
}

/** Tags array from any of the known shapes (array, comma/space separated string). */
function toStringList(...values) {
  const out = []
  const seen = new Set()
  const push = (value) => {
    if (typeof value !== 'string') return
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) return
    seen.add(trimmed)
    out.push(trimmed)
  }
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const entry of value) push(entry)
    } else if (typeof value === 'string') {
      for (const entry of value.split(/[,\s]+/u)) push(entry)
    }
  }
  return out
}

/** True for http(s) URLs; used to tell a live cache from the bundled snapshot. */
function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//iu.test(value)
}

function errorWithCode(message, code) {
  const err = new Error(message)
  err.code = code
  return err
}

/* ------------------------------------------------------------------ */
/* Item / dataset mapping                                              */
/* ------------------------------------------------------------------ */

/** Recursively extract one command string from a live install descriptor. */
function commandFrom(value) {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) {
    for (const entry of value) {
      const command = commandFrom(entry)
      if (command) return command
    }
    return ''
  }
  if (value && typeof value === 'object') {
    const direct = firstString(value.command, value.cmd, value.text, value.value)
    if (direct) return direct
    if (Array.isArray(value.commands)) {
      for (const entry of value.commands) {
        const command = commandFrom(entry)
        if (command) return command
      }
    }
  }
  return ''
}

/**
 * Install command from a bundled item (plain string) or a live index record,
 * where `install` is an object like
 * `{ method: 'pnpm-profile', needsConfig: false, commands: ['dsh plugin --profile <name> add x'] }`.
 * The `<name>` placeholder is normalized to `<profile>` to match the bundled
 * snapshot's wording.
 */
function extractInstall(raw) {
  const candidates = [raw.install, raw.installCommand, raw.install_command, raw.installCmd]
  for (const candidate of candidates) {
    const command = commandFrom(candidate)
    if (command) return command.replace(/<name>/giu, '<profile>')
  }
  return ''
}

/**
 * Community score from a number or a live index object like
 * `{ total: 84, confidence: 1 }` (usage sort tie-break).
 */
function extractScore(raw) {
  const candidates = [raw.score, raw.communityScore, raw.community_score, raw.weight]
  for (const candidate of candidates) {
    if (typeof candidate === 'number') {
      return toNumber(candidate)
    }
    if (typeof candidate === 'string' && candidate.trim()) {
      const num = Number(candidate)
      if (Number.isFinite(num)) return toNumber(num)
      continue
    }
    if (candidate && typeof candidate === 'object') {
      const total = candidate.total ?? candidate.value ?? candidate.score
      if (total !== undefined && total !== null) return toNumber(total)
    }
  }
  return 0
}

/**
 * Map one raw record (bundled snapshot item or live index record) into the
 * canonical `MarketItem` shape. Unknown/absent fields become empty strings,
 * numbers become finite non-negative integers. Returns null for unusable
 * records (no name/id).
 *
 * @param {unknown} raw
 * @returns {null | {name: string, id: string, descriptionZh: string, descriptionEn: string, author: string, stars: number, tags: string[], updatedAt: string, homepage: string, install: string, type: string, score: number}}
 */
export function mapItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  const id = firstString(raw.id, raw.repo, raw.full_name, raw.fullName, raw.repoName, raw.slug)
  const name = firstString(raw.name, raw.pluginName, raw.title, raw.slug) || (id ? id.split('/').pop() : '')
  if (!name && !id) return null

  const finalName = name || id
  const finalId = id || name
  const author =
    firstString(raw.author, raw.owner, raw.owner_login, raw.ownerLogin, raw.publisher) ||
    (finalId.includes('/') ? finalId.split('/')[0] : '')

  const description = firstString(raw.description, raw.desc, raw.summary, raw.about)
  const descriptionZh = firstString(raw.descriptionZh, raw.description_zh, description)
  const descriptionEn = firstString(raw.descriptionEn, raw.description_en, description)

  return {
    name: finalName,
    id: finalId,
    // Cross-language fallback: a single-language record still renders in either UI language.
    descriptionZh: descriptionZh || descriptionEn,
    descriptionEn: descriptionEn || descriptionZh,
    author,
    stars: toNumber(raw.stars ?? raw.stargazers_count ?? raw.stargazers ?? raw.starCount ?? raw.star_count),
    tags: toStringList(raw.tags, raw.topics, raw.keywords, raw.labels),
    updatedAt: firstString(
      raw.updatedAt,
      raw.updated_at,
      raw.pushedAt,
      raw.pushed_at,
      raw.lastUpdated,
      raw.last_updated,
      raw.publishedAt,
      raw.published_at,
    ),
    homepage: firstString(raw.homepage, raw.url, raw.html_url, raw.htmlUrl, raw.repositoryUrl),
    install: extractInstall(raw),
    type: firstString(raw.type, raw.kind, raw.category),
    score: extractScore(raw),
  }
}

/** Extract the item array from any of the known payload wrappers. */
function extractRawItems(payload) {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  for (const key of ['items', 'plugins', 'data', 'list', 'results']) {
    if (Array.isArray(payload[key])) return payload[key]
  }
  return []
}

/** Map + de-duplicate a raw list (first record for a given name/id wins). */
function mapItemList(rawItems) {
  const items = []
  const seen = new Set()
  for (const raw of rawItems) {
    const item = mapItem(raw)
    if (!item) continue
    const key = normalizeText(item.id || item.name)
    if (seen.has(key)) continue
    seen.add(key)
    items.push(item)
  }
  return items
}

/**
 * Parse any payload (bundled file contents or live index JSON) into a dataset.
 * @param {string | object} payload
 * @returns {{items: object[], generatedAt: string | null, declaredSource: string | null}}
 */
export function parseDataset(payload) {
  const data = typeof payload === 'string' ? JSON.parse(payload) : payload
  const items = mapItemList(extractRawItems(data))
  const obj = data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  return {
    items,
    generatedAt: firstString(obj.generatedAt, obj.generated_at, obj.fetchedAt, obj.fetched_at) || null,
    declaredSource: firstString(obj.source, obj.sourceUrl, obj.source_url) || null,
  }
}

/**
 * Map a live index payload to canonical items (exported for tests).
 * @param {unknown} payload
 * @returns {object[]}
 */
export function mapLivePayload(payload) {
  return parseDataset(payload).items
}

/* ------------------------------------------------------------------ */
/* Dataset selection / loading                                         */
/* ------------------------------------------------------------------ */

/**
 * Pick the dataset to serve.
 *
 * Cache (written by a previous successful refresh) wins only when it is both
 * valid and strictly newer than the bundled snapshot. If one of them is
 * missing/unreadable the other is used; if both are unusable the caller gets
 * an empty dataset and the plugin degrades gracefully.
 *
 * @param {{bundled?: object | null, cache?: object | null, bundledMtime?: number, cacheMtime?: number}} input
 * @returns {{dataset: {items: object[], generatedAt: string | null, declaredSource: string | null}, fromCache: boolean}}
 */
export function selectDataset(input = {}) {
  const bundled = input.bundled && Array.isArray(input.bundled.items) ? input.bundled : null
  const cache = input.cache && Array.isArray(input.cache.items) ? input.cache : null
  const bundledMtime = Number.isFinite(input.bundledMtime) ? input.bundledMtime : 0
  const cacheMtime = Number.isFinite(input.cacheMtime) ? input.cacheMtime : 0

  if (cache && (!bundled || cacheMtime > bundledMtime)) {
    return { dataset: cache, fromCache: true }
  }
  if (bundled) return { dataset: bundled, fromCache: false }
  if (cache) return { dataset: cache, fromCache: true }
  return { dataset: { items: [], generatedAt: null, declaredSource: null }, fromCache: false }
}

/** `$DSH_HOME/plugins/plugin-market/data.json`, or null when DSH_HOME is unset. */
export function getCachePath(env = process.env) {
  const home = env && typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  if (!home) return null
  return join(home, 'plugins', 'plugin-market', 'data.json')
}

/** User-editable sponsor config that overrides the one shipped in the package. */
export function getSponsorPath(env = process.env) {
  const cachePath = getCachePath(env)
  return cachePath ? join(dirname(cachePath), 'sponsor.json') : null
}

/* ------------------------------------------------------------------ */
/* Optional sponsor / donation area                                    */
/* ------------------------------------------------------------------ */

/** Shape served to the client when no sponsor config is present. */
export const DEFAULT_SPONSOR = Object.freeze({
  enabled: false,
  title: null,
  note: null,
  links: [],
  qrcodes: [],
})

/** Bilingual text: a plain string, or `{ zh, en }`, capped in length. */
function pickSponsorText(value, maxLength) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed.slice(0, maxLength) : null
  }
  if (!value || typeof value !== 'object') return null
  const out = {}
  for (const key of ['zh', 'en']) {
    if (typeof value[key] === 'string' && value[key].trim()) out[key] = value[key].trim().slice(0, maxLength)
  }
  return Object.keys(out).length ? out : null
}

function safeWebUrl(value) {
  try {
    const url = new URL(String(value))
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

/** Inline QR images only: PNG/JPEG/WebP data URLs, size-capped. */
const QR_DATA_URL = /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=\s]{256,}$/u
const MAX_QR_BYTES = 512 * 1024

function safeQrSource(value) {
  if (typeof value !== 'string') return null
  const source = value.trim()
  if (source.length > MAX_QR_BYTES) return null
  if (QR_DATA_URL.test(source)) return source
  return safeWebUrl(source)
}

/**
 * Sanitise a sponsor config. Anything malformed is dropped, and a config with
 * no usable entry is reported as disabled so the panel stays clean.
 */
export function normalizeSponsor(raw) {
  if (!raw || typeof raw !== 'object' || raw.enabled !== true) return { ...DEFAULT_SPONSOR }

  const links = []
  for (const entry of Array.isArray(raw.links) ? raw.links.slice(0, 6) : []) {
    if (!entry || typeof entry !== 'object') continue
    const url = safeWebUrl(entry.url)
    if (!url) continue
    const label = pickSponsorText(entry.label, 40)
    links.push({ label: label || url, url })
  }

  const qrcodes = []
  for (const entry of Array.isArray(raw.qrcodes) ? raw.qrcodes.slice(0, 4) : []) {
    if (!entry || typeof entry !== 'object') continue
    const src = safeQrSource(entry.src)
    if (!src) continue
    qrcodes.push({ label: pickSponsorText(entry.label, 40), src })
  }

  return {
    enabled: links.length > 0 || qrcodes.length > 0,
    title: pickSponsorText(raw.title, 40),
    note: pickSponsorText(raw.note, 160),
    links,
    qrcodes,
  }
}

/** Read one JSON file, preferring the newest of package copy and user override. */
async function loadSponsorFile(state) {
  const candidates = []
  for (const path of [state.bundledSponsorPath, state.sponsorPath]) {
    if (!path) continue
    try {
      const [raw, info] = await Promise.all([readFile(path, 'utf8'), stat(path)])
      candidates.push({ raw, mtime: info.mtimeMs || 0 })
    } catch {
      /* a missing sponsor file is the normal case */
    }
  }
  if (!candidates.length) return { ...DEFAULT_SPONSOR }
  candidates.sort((a, b) => b.mtime - a.mtime)
  try {
    return normalizeSponsor(JSON.parse(candidates[0].raw))
  } catch {
    return { ...DEFAULT_SPONSOR }
  }
}

/** Load the sponsor config once; a failure only disables the donation area. */
async function ensureSponsor(state) {
  if (state.sponsorLoaded) return state.sponsor
  try {
    state.sponsor = await loadSponsorFile(state)
  } catch {
    state.sponsor = { ...DEFAULT_SPONSOR }
  }
  state.sponsorLoaded = true
  return state.sponsor
}

/** Read + parse one data file; never throws (returns null when unusable). */
async function readDatasetFile(path) {
  if (!path) return null
  try {
    const [raw, info] = await Promise.all([readFile(path, 'utf8'), stat(path)])
    return {
      dataset: parseDataset(raw),
      mtime: info.mtimeMs || 0,
    }
  } catch {
    return null
  }
}

/** Create the mutable per-apply state (exported for tests). */
export function createMarketState(config = {}) {
  const env = config.env && typeof config.env === 'object' ? config.env : process.env
  return {
    config,
    env,
    items: [],
    generatedAt: null,
    source: 'bundled',
    fetchedAt: null,
    loaded: false,
    loading: null,
    index: null,
    bundledPath: config.bundledPath || BUNDLED_DATA_URL,
    bundledSponsorPath: config.bundledSponsorPath || BUNDLED_SPONSOR_URL,
    sponsorPath: config.sponsorPath !== undefined ? config.sponsorPath : getSponsorPath(env),
    sponsor: DEFAULT_SPONSOR,
    sponsorLoaded: false,
    cachePath: config.cachePath !== undefined ? config.cachePath : getCachePath(env),
    fetchImpl: config.fetchImpl || null,
    timeoutMs: Number.isFinite(config.fetchTimeoutMs) ? config.fetchTimeoutMs : FETCH_TIMEOUT_MS,
    liveUrls: Array.isArray(config.liveUrls) && config.liveUrls.length ? config.liveUrls : LIVE_URLS,
  }
}

/** Build the name/id lookup used by `detail`. */
function buildIndex(items) {
  const byKey = new Map()
  for (const item of items) {
    for (const key of [item.name, item.id]) {
      const norm = normalizeText(key)
      if (norm && !byKey.has(norm)) byKey.set(norm, item)
    }
  }
  return { byKey }
}

/** Apply a dataset to the state (also rebuilds the index). */
function setDataset(state, dataset, source) {
  state.items = Array.isArray(dataset.items) ? dataset.items : []
  state.generatedAt = dataset.generatedAt || null
  state.source = source
  state.index = buildIndex(state.items)
  state.loaded = true
}

/** Fallback dataset: empty but fully functional (search returns an empty page). */
function applyEmptyDataset(state) {
  state.items = []
  state.generatedAt = null
  state.source = 'bundled'
  state.index = buildIndex([])
  state.loaded = true
}

/** Resolve the dataset for one process/plugin instance. Never throws. */
async function loadState(state) {
  if (state.loaded) return state
  try {
    const [bundled, cache] = await Promise.all([
      readDatasetFile(state.bundledPath),
      readDatasetFile(state.cachePath),
    ])
    const selected = selectDataset({
      bundled: bundled ? bundled.dataset : null,
      cache: cache ? cache.dataset : null,
      bundledMtime: bundled ? bundled.mtime : 0,
      cacheMtime: cache ? cache.mtime : 0,
    })
    const source = selected.fromCache && isHttpUrl(selected.dataset.declaredSource) ? 'live' : 'bundled'
    setDataset(state, selected.dataset, source)
  } catch {
    applyEmptyDataset(state)
  }
  return state
}

/** Lazily load once; concurrent callers share the same promise. */
async function ensureLoaded(state) {
  await ensureSponsor(state)
  if (state.loaded) return state
  if (!state.loading) {
    state.loading = loadState(state).catch(() => {
      applyEmptyDataset(state)
      return state
    })
  }
  await state.loading
  return state
}

/* ------------------------------------------------------------------ */
/* API methods                                                         */
/* ------------------------------------------------------------------ */

/** `meta` → dataset summary. */
function buildMeta(state) {
  return {
    total: state.items.length,
    generatedAt: state.generatedAt,
    source: state.source,
    tags: buildTagFacets(state.items),
    sorts: SORT_KEYS.slice(),
    sponsor: state.sponsor || DEFAULT_SPONSOR,
  }
}

/** `detail` args → item or null. */
function findItem(state, args) {
  if (!state.index) state.index = buildIndex(state.items)
  const wanted = normalizeText(firstString(args && args.name, args && args.id))
  if (!wanted) return null
  const direct = state.index.byKey.get(wanted)
  if (direct) return direct
  for (const item of state.items) {
    if (normalizeText(item.name) === wanted || normalizeText(item.id) === wanted) return item
  }
  return null
}

/** Human-readable, short network failure message (never leaks stack traces). */
function describeFetchError(err, timeoutMs) {
  const message = err && typeof err === 'object' && typeof err.message === 'string' ? err.message : String(err)
  const name = err && typeof err === 'object' ? err.name : ''
  if (name === 'AbortError' || /abort|timed? ?out/iu.test(message)) {
    return { message: `request timeout after ${Math.round(timeoutMs / 1000)}s`, code: 'TIMEOUT' }
  }
  if (name === 'TypeError' || /fetch failed|network|ENOTFOUND|ECONN|EAI_AGAIN|socket/iu.test(message)) {
    return { message: 'network unreachable', code: 'NETWORK' }
  }
  return { message: message ? message.slice(0, 200) : 'network unreachable', code: 'FETCH_FAILED' }
}

/** Fetch + parse JSON with an AbortController timeout. */
async function fetchJson(fetchImpl, url, timeoutMs) {
  const controller = new AbortController()
  let timer = null
  try {
    timer = setTimeout(() => {
      try {
        controller.abort()
      } catch {
        /* ignore */
      }
    }, timeoutMs)
    if (timer && typeof timer.unref === 'function') timer.unref()

    const response = await fetchImpl(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
    if (!response || response.ok === false) {
      throw new Error(`HTTP ${response && response.status ? response.status : 'error'} from ${url}`)
    }
    if (typeof response.json === 'function') return await response.json()
    return JSON.parse(String(await response.text()))
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw errorWithCode(`request timeout after ${Math.round(timeoutMs / 1000)}s`, 'timeout')
    }
    throw err
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Best-effort cache write; all failures ignored. */
async function writeCache(state, dataset, sourceUrl) {
  if (!state.cachePath) return
  try {
    await mkdir(dirname(state.cachePath), { recursive: true })
    const payload = {
      schemaVersion: 1,
      generatedAt: dataset.generatedAt || new Date().toISOString(),
      fetchedAt: state.fetchedAt,
      source: sourceUrl,
      count: state.items.length,
      tags: buildTagFacets(state.items).map(({ id, count }) => ({ id, count })),
      items: state.items,
    }
    await writeFile(state.cachePath, JSON.stringify(payload), 'utf8')
  } catch {
    /* cache is best effort only */
  }
}

/** `refresh` → fetch live index, swap the in-memory dataset, write cache. */
async function refresh(state) {
  const currentTotal = state.items.length
  const currentSource = state.source
  const fetchImpl = state.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    return { ok: false, error: 'fetch unavailable', code: 'UNAVAILABLE', total: currentTotal, source: currentSource }
  }

  let lastError = null
  for (const url of state.liveUrls) {
    try {
      const payload = await fetchJson(fetchImpl, url, state.timeoutMs)
      const parsed = parseDataset(payload)
      const items = parsed.items
      if (items.length === 0) throw new Error('live index returned no items')

      state.fetchedAt = new Date().toISOString()
      setDataset(
        state,
        { items, generatedAt: parsed.generatedAt || state.fetchedAt, declaredSource: url },
        'live',
      )
      await writeCache(state, { generatedAt: state.generatedAt, items }, url)
      return { ok: true, total: state.items.length, source: 'live', fetchedAt: state.fetchedAt }
    } catch (err) {
      lastError = err
    }
  }

  const failure = describeFetchError(lastError, state.timeoutMs)
  return {
    ok: false,
    error: failure.message,
    code: failure.code,
    total: currentTotal,
    source: currentSource,
  }
}

/** Route one `{ method, args }` envelope to its implementation. */
async function dispatch(state, payload) {
  const envelope = payload && typeof payload === 'object' ? payload : {}
  const method = typeof envelope.method === 'string' ? envelope.method : ''
  const args = envelope.args && typeof envelope.args === 'object' ? envelope.args : {}

  switch (method) {
    case 'meta':
      await ensureLoaded(state)
      return buildMeta(state)
    case 'search':
      await ensureLoaded(state)
      return searchItems(state.items, args)
    case 'detail':
      await ensureLoaded(state)
      return findItem(state, args)
    case 'refresh':
      await ensureLoaded(state)
      return refresh(state)
    default:
      throw errorWithCode(`unknown method: ${method || '(missing)'}`, 'unknown_method')
  }
}

/* ------------------------------------------------------------------ */
/* HTTP plumbing                                                       */
/* ------------------------------------------------------------------ */

/** Read the request body as JSON, enforcing the 1 MiB cap. */
export async function readJsonBody(req, limit = MAX_BODY_BYTES) {
  const chunks = []
  let size = 0
  try {
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      size += buf.length
      if (size > limit) {
        // Drain the rest instead of destroying the socket, so the 413 reply
        // still reaches the client.
        if (req && typeof req.resume === 'function') {
          try {
            req.resume()
          } catch {
            /* ignore */
          }
        }
        throw errorWithCode('payload too large', 'BODY_TOO_LARGE')
      }
      chunks.push(buf)
    }
  } catch (err) {
    if (err && err.code === 'BODY_TOO_LARGE') throw err
    throw errorWithCode('failed to read request body', 'BODY_READ_ERROR')
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw errorWithCode('invalid JSON body', 'INVALID_JSON')
  }
}

/** Send a JSON reply; swallows socket errors (client may have gone away). */
function sendJson(res, status, body) {
  try {
    if (!res.headersSent) res.writeHead(status, JSON_HEADERS)
    res.end(JSON.stringify(body))
  } catch {
    /* response already gone; nothing useful to do */
  }
}

/**
 * Handle one HTTP request against the plugin API.
 * Exported so it can be exercised offline in unit tests.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {ReturnType<typeof createMarketState>} state
 */
export async function handleApiRequest(req, res, state) {
  try {
    if (!req || req.method !== 'POST') {
      return sendJson(res, 405, { ok: false, error: 'method not allowed', code: 'method_not_allowed' })
    }

    let payload
    try {
      payload = await readJsonBody(req)
    } catch (err) {
      const code = err && err.code ? err.code : 'BODY_READ_ERROR'
      if (code === 'BODY_TOO_LARGE') {
        return sendJson(res, 413, { ok: false, error: 'payload too large', code: 'payload_too_large' })
      }
      return sendJson(res, 200, { ok: false, error: err && err.message ? err.message : 'invalid request body', code })
    }

    try {
      const result = await dispatch(state, payload)
      return sendJson(res, 200, { ok: true, result })
    } catch (err) {
      const code = err && err.code ? err.code : 'internal_error'
      const message = err && err.message ? err.message : 'internal error'
      return sendJson(res, 200, { ok: false, error: message, code })
    }
  } catch (err) {
    return sendJson(res, 200, {
      ok: false,
      error: err && err.message ? err.message : 'internal error',
      code: 'internal_error',
    })
  }
}

/* ------------------------------------------------------------------ */
/* Cordis plugin entry                                                 */
/* ------------------------------------------------------------------ */

/**
 * Mount the API route. No data is read here: the dataset loads lazily on the
 * first request so plugin startup stays cheap.
 *
 * @param {object} ctx Cordis context
 * @param {object} [config]
 */
export function apply(ctx, config = {}) {
  const state = createMarketState(config && typeof config === 'object' ? config : {})

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/plugin-market/api',
        handler: (req, res) => {
          // Never let a rejection escape into the host.
          handleApiRequest(req, res, state).catch(() => {
            try {
              if (!res.headersSent) res.writeHead(200, JSON_HEADERS)
              if (!res.writableEnded) {
                res.end(JSON.stringify({ ok: false, error: 'internal error', code: 'internal_error' }))
              }
            } catch {
              /* ignore */
            }
          })
        },
      }),
    'plugin-market: /plugin-market/api',
  )
}

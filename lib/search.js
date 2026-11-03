/**
 * Plugin Market — pure search / ranking / faceting helpers.
 *
 * No IO, no side effects, no third-party dependencies. Everything here is a
 * deterministic function of its arguments so it can be unit tested offline
 * (see ../test/search.test.mjs).
 *
 * Matching contract (CONTRACT.md §5):
 *  - NFKC + lowercase normalization over name, id, author, tags,
 *    descriptionZh and descriptionEn.
 *  - Query is split on whitespace; EVERY token must be a substring of some
 *    field (plain `includes`, no word segmentation needed for Chinese).
 *  - Items whose name/id matched rank before items only matching other
 *    fields; within the same relevance tier the selected sort key decides.
 */

/** Supported sort keys, in the order exposed by `meta.sorts`. */
export const SORT_KEYS = ['usage', 'recent', 'name']

/** Default / maximum page sizes from the frozen API. */
export const DEFAULT_PAGE_SIZE = 24
export const MAX_PAGE_SIZE = 100

/** Separator used when flattening fields into one haystack. Can never occur in input. */
const SEP = '\u0000'

/**
 * Normalize a value for matching: NFKC (full-width → ASCII, compatibility
 * forms) then lowercase. Arrays are flattened with their entries normalized.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeText(value) {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeText(entry))
      .filter(Boolean)
      .join(SEP)
  }
  if (typeof value === 'string') {
    return value.normalize('NFKC').toLowerCase()
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value).normalize('NFKC').toLowerCase()
  }
  return ''
}

/** Coerce to a finite non-negative integer, or fall back. */
function toCount(value) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num) || num < 0) return 0
  return Math.trunc(num)
}

/** Timestamp in ms from an ISO-ish value; invalid/missing → 0 (sorts last). */
function toTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Plain code-unit string comparison (locale independent / deterministic). */
function compareStrings(a, b) {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/** Compare display names for a stable tie-break: normalized, then raw. */
function compareName(a, b) {
  const byNorm = compareStrings(normalizeText(a), normalizeText(b))
  return byNorm !== 0 ? byNorm : compareStrings(String(a), String(b))
}

/** Tags of an item as a clean string array (never throws on bad data). */
function itemTags(item) {
  if (!item || !Array.isArray(item.tags)) return []
  return item.tags.filter((tag) => typeof tag === 'string' && tag.trim() !== '')
}

/**
 * Normalized tags of one item (for facet counting and tag filtering).
 * @param {object} item
 * @returns {string[]}
 */
export function itemTagKeys(item) {
  const keys = []
  const seen = new Set()
  for (const tag of itemTags(item)) {
    const key = normalizeText(tag.trim())
    if (!key || seen.has(key)) continue
    seen.add(key)
    keys.push(key)
  }
  return keys
}

/** Precomputed search projection for one item. */
function buildDoc(item) {
  const name = normalizeText(item?.name)
  const id = normalizeText(item?.id)
  const tagKeys = itemTagKeys(item)
  const restParts = [
    normalizeText(item?.author),
    normalizeText(item?.descriptionZh),
    normalizeText(item?.descriptionEn),
  ]
  for (const tag of itemTags(item)) restParts.push(normalizeText(tag))
  return {
    name,
    id,
    // name/id are matched separately so they can win the relevance tier.
    nameHay: name + SEP + id,
    restHay: restParts.filter(Boolean).join(SEP),
    tagKeys,
  }
}

/**
 * Match one query token list against a search projection.
 * @param {ReturnType<typeof buildDoc>} doc
 * @param {string[]} tokens normalized non-empty tokens
 * @returns {number} number of tokens that hit name/id when the item matches,
 *                   or -1 when the item does not match.
 */
function matchTokens(doc, tokens) {
  if (tokens.length === 0) return 0
  let nameHits = 0
  for (const token of tokens) {
    if (doc.nameHay.includes(token)) {
      nameHits += 1
      continue
    }
    if (!doc.restHay.includes(token)) return -1
  }
  return nameHits
}

/** Split an already-normalized query string into tokens. */
function tokenize(text) {
  return normalizeText(text)
    .split(/\s+/u)
    .filter(Boolean)
}

/** Normalize sort + pagination inputs from the wire. */
function normalizeQuery(query) {
  const source = query && typeof query === 'object' ? query : {}
  const sort = SORT_KEYS.includes(source.sort) ? source.sort : 'usage'

  const rawLimit =
    source.limit === undefined || source.limit === null || source.limit === ''
      ? DEFAULT_PAGE_SIZE
      : Number(source.limit)
  const limit = Number.isFinite(rawLimit)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(rawLimit)))
    : DEFAULT_PAGE_SIZE

  const rawOffset = Number(source.offset)
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : 0

  const tag = typeof source.tag === 'string' ? normalizeText(source.tag.trim()) : ''
  return { sort, limit, offset, tag, tokens: tokenize(source.text) }
}

/** Decorate one item once, so comparators are O(1) per comparison. */
function decorateItem(item) {
  const doc = buildDoc(item)
  return {
    item,
    doc,
    name: typeof item?.name === 'string' ? item.name : '',
    id: typeof item?.id === 'string' ? item.id : '',
    stars: toCount(item?.stars),
    score: toCount(item?.score),
    time: toTimestamp(item?.updatedAt),
    relevance: 0,
  }
}

/** Sort key comparators (relevance is applied by the caller first). */
const SORT_COMPARATORS = {
  // "usage" = community heat: GitHub stars, tie-broken by community score.
  usage(a, b) {
    if (b.stars !== a.stars) return b.stars - a.stars
    if (b.score !== a.score) return b.score - a.score
    return compareName(a.name, b.name)
  },
  recent(a, b) {
    if (b.time !== a.time) return b.time - a.time
    return compareName(a.name, b.name)
  },
  name(a, b) {
    const byName = compareName(a.name, b.name)
    return byName !== 0 ? byName : compareStrings(a.id, b.id)
  },
}

/**
 * Filter + sort + paginate a list of MarketItems.
 *
 * @param {object[]} items
 * @param {{text?: string, tag?: string|null, sort?: string, offset?: number, limit?: number}} [query]
 * @returns {{items: object[], total: number, offset: number, limit: number, hasMore: boolean}}
 */
export function searchItems(items, query = {}) {
  const list = Array.isArray(items) ? items : []
  const { sort, limit, offset, tag, tokens } = normalizeQuery(query)

  const decorated = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const entry = decorateItem(item)
    const nameHits = matchTokens(entry.doc, tokens)
    if (nameHits < 0) continue
    if (tag && !entry.doc.tagKeys.includes(tag)) continue
    entry.relevance = nameHits
    decorated.push(entry)
  }

  const comparator = SORT_COMPARATORS[sort] || SORT_COMPARATORS.usage
  decorated.sort((a, b) => {
    // Text relevance first (name/id hits), then the selected sort key.
    if (b.relevance !== a.relevance) return b.relevance - a.relevance
    return comparator(a, b)
  })

  const total = decorated.length
  const page = decorated.slice(offset, offset + limit).map((entry) => entry.item)
  return {
    items: page,
    total,
    offset,
    limit,
    hasMore: offset + page.length < total,
  }
}

/**
 * Rebuild tag facets from an item list.
 * @param {object[]} items
 * @returns {{id: string, title: string, count: number}[]} count desc, then id asc
 */
export function buildTagFacets(items) {
  const counts = new Map()
  const titles = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    const seen = new Set()
    for (const raw of itemTags(item)) {
      const id = normalizeText(raw.trim())
      if (!id || seen.has(id)) continue
      seen.add(id)
      counts.set(id, (counts.get(id) || 0) + 1)
      // First spelling wins so chips read "AI 助手", not the normalized id.
      if (!titles.has(id)) titles.set(id, raw.trim())
    }
  }
  const facets = []
  for (const [id, count] of counts) {
    facets.push({ id: id, title: titles.get(id) || id, count })
  }
  facets.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return compareStrings(a.id, b.id)
  })
  return facets
}

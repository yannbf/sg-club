// Steam store user-tag fetcher.
//
// The Steam store app page embeds the complete user-tag list as JSON in an
// `InitAppTagModal( <appid>, [{"tagid":..,"name":..,"count":..}, ...], ...`
// call; the visible `a.app_tag` links only show the top handful. The age gate
// is skipped by sending the age-check cookies. Delisted or unknown apps are
// redirected to the store home page, which has no tag modal.
//
// Every lookup resolves to a tag list, or to `null` when the answer is
// unknown (request failed, non-OK status, rate limited). Callers must not
// read `null` as "has no tags". A page that loaded fine but is not an app page
// resolves to an empty list, which is cached so the app is not refetched.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'cheerio'
import { delay } from '../utils/common.js'
import { logError } from '../utils/log-error.js'

const STORE_URL = 'https://store.steampowered.com'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const AGE_GATE_COOKIE =
  'birthtime=0; mature_content=1; wants_mature_content=1; lastagecheckage=1-0-1990'

/** Delay observed between Steam store requests. */
export const STEAM_TAGS_DELAY_MS = 1500

/** Most apps of a package whose tags are merged into the package's tags. */
const MAX_PACKAGE_APPS = 3

const CACHE_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../data/steam-store-tags-cache.json',
)

/** Tags that mark a game as mystery or horror, besides any tag containing
 *  "horror". Matched against the whole lower-cased tag name. */
export const MYSTERY_TAG_NAMES = [
  'mystery',
  'detective',
  'lovecraftian',
  'thriller',
  'psychological thriller',
]

export function isHorrorOrMysteryTag(name: string): boolean {
  const tag = name.trim().toLowerCase()
  return tag.includes('horror') || MYSTERY_TAG_NAMES.includes(tag)
}

/**
 * Tag names from a Steam store app page, most-voted first, or null when the
 * page is not an app page. Prefers the embedded `InitAppTagModal` JSON and
 * falls back to the visible `a.app_tag` links.
 */
export function parseSteamStoreTags(html: string): string[] | null {
  const modal = html.match(/InitAppTagModal\(\s*\d+\s*,\s*(\[)/)
  if (modal && modal.index != null) {
    const start = modal.index + modal[0].length - 1
    const json = sliceJsonArray(html, start)
    if (json) {
      try {
        const parsed = JSON.parse(json) as { name?: unknown }[]
        return parsed
          .map((t) => (typeof t.name === 'string' ? t.name.trim() : ''))
          .filter(Boolean)
      } catch {
        // fall through to the visible links
      }
    }
  }

  const $ = load(html)
  const visible = $('a.app_tag')
    .map((_, el) => $(el).text().trim())
    .get()
    // The "+" link that opens the tag editor is an a.app_tag too.
    .filter((t) => t && t !== '+')
  return visible.length > 0 ? visible : null
}

/** The balanced JSON array starting at `start` (which must point at `[`). */
function sliceJsonArray(text: string, start: number): string | null {
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === '[') depth++
    else if (c === ']' && --depth === 0) return text.slice(start, i + 1)
  }
  return null
}

interface TagCacheEntry {
  tags: string[]
  checked_at: string
}

let cache: Record<string, TagCacheEntry> | null = null

function loadCache(): Record<string, TagCacheEntry> {
  if (cache) return cache
  try {
    cache = existsSync(CACHE_FILE)
      ? JSON.parse(readFileSync(CACHE_FILE, 'utf-8'))
      : {}
  } catch (error) {
    logError(error, 'Failed to read Steam store tags cache')
    cache = {}
  }
  return cache!
}

/** Cached tags for `app:<id>` / `sub:<id>`, or undefined when never fetched. */
export function getCachedSteamTags(key: string): string[] | undefined {
  return loadCache()[key]?.tags
}

export function saveSteamTagsCache(): void {
  if (!cache) return
  mkdirSync(dirname(CACHE_FILE), { recursive: true })
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2) + '\n')
}

export function steamTagsKey(ids: {
  app_id?: number | null
  package_id?: number | null
}): string | null {
  if (ids.app_id != null) return `app:${ids.app_id}`
  if (ids.package_id != null) return `sub:${ids.package_id}`
  return null
}

/** Tags of an app, `[]` when the store page has none, null when the request failed. */
async function fetchAppTags(appId: number): Promise<string[] | null> {
  try {
    const response = await fetch(`${STORE_URL}/app/${appId}/?l=english`, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: AGE_GATE_COOKIE,
      },
      redirect: 'follow',
    })
    if (!response.ok) return null
    return parseSteamStoreTags(await response.text()) ?? []
  } catch (error) {
    logError(error, `Failed to fetch Steam store tags for app ${appId}`)
    return null
  }
}

async function fetchPackageAppIds(packageId: number): Promise<number[] | null> {
  try {
    const response = await fetch(
      `${STORE_URL}/api/packagedetails?packageids=${packageId}`,
      { headers: { 'User-Agent': USER_AGENT } },
    )
    if (!response.ok) return null
    const body = (await response.json()) as Record<
      string,
      { success?: boolean; data?: { apps?: { id: number }[] } }
    >
    const apps = body[String(packageId)]?.data?.apps
    if (!apps || apps.length === 0) return null
    return apps.slice(0, MAX_PACKAGE_APPS).map((a) => a.id)
  } catch (error) {
    logError(error, `Failed to resolve Steam package ${packageId}`)
    return null
  }
}

/**
 * Tags for a game, from cache when present, otherwise from the store (and
 * cached). Returns null when the request failed; nothing is cached for those.
 * An app whose page loaded but carries no tag data yields (and caches) an
 * empty list. A package's tags are the union of its first few apps' tags.
 */
export async function fetchSteamTags(ids: {
  app_id?: number | null
  package_id?: number | null
}): Promise<string[] | null> {
  const key = steamTagsKey(ids)
  if (!key) return null
  const cached = getCachedSteamTags(key)
  if (cached) return cached

  let tags: string[] | null
  if (ids.app_id != null) {
    tags = await fetchAppTags(ids.app_id)
  } else {
    const appIds = await fetchPackageAppIds(ids.package_id!)
    tags = null
    if (appIds) {
      const union = new Set<string>()
      let failed = false
      for (const appId of appIds) {
        await delay(STEAM_TAGS_DELAY_MS)
        const appTags = await fetchAppTags(appId)
        if (appTags === null) failed = true
        else appTags.forEach((t) => union.add(t))
      }
      // A partial union could hide the matching tag, so any failure is unknown.
      tags = failed ? null : [...union]
    }
  }

  if (tags === null) return null
  loadCache()[key] = { tags, checked_at: new Date().toISOString() }
  return tags
}

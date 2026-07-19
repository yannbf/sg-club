// Loads a JSON data file from packages/website/public/data/. Three modes,
// tried in order:
//   1. DATA_BASE_URL env override (fetch `${DATA_BASE_URL}/data/<name>`)
//   2. a request host (fetch `https://<host>/data/<name>`) — used by the
//      interactions endpoint, which knows its own host at request time
//   3. filesystem read — used by scraper-side scripts, which have no host
//
// Module-level 5-minute cache so a burst of requests within a single warm
// serverless instance doesn't refetch the same file repeatedly.

import { getDataBaseUrl } from './constants'

const CACHE_TTL_MS = 5 * 60 * 1000

interface CacheEntry {
  data: unknown
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

export async function loadDataFile<T>(name: string, host?: string): Promise<T> {
  const cached = cache.get(name)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data as T
  }

  const data = await fetchOrRead<T>(name, host)
  cache.set(name, { data, expiresAt: Date.now() + CACHE_TTL_MS })
  return data
}

/** Clears the module-level cache. Exposed for tests only. */
export function clearDataFileCache(): void {
  cache.clear()
}

async function fetchOrRead<T>(name: string, host?: string): Promise<T> {
  const dataBaseUrl = getDataBaseUrl()
  if (dataBaseUrl) {
    return fetchJson<T>(`${dataBaseUrl.replace(/\/$/, '')}/data/${name}`)
  }
  if (host) {
    return fetchJson<T>(`https://${host}/data/${name}`)
  }

  const { readFileSync } = await import('node:fs')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')

  const currentDir = dirname(fileURLToPath(import.meta.url))
  // api/_lib -> api -> website root -> public/data
  const filePath = join(currentDir, '../../public/data', name)
  const raw = readFileSync(filePath, 'utf-8')
  return JSON.parse(raw) as T
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to load data file at ${url}: ${res.status}`)
  }
  return (await res.json()) as T
}

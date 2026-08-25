// Vercel serverless function — plain /api directory support (see
// api/discord/interactions.ts for why: the site is a static export, so this
// rides Vercel's generic Node.js Function support rather than Next.js
// routing). Marks a win as verified — or reverts a mistaken verification —
// in the group's Google Sheet from the /verification admin page's
// Verify/Unverify controls.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash, createSign } from 'node:crypto'
import { loadDataFile } from './_lib/data.js'
import { addReaction, removeReaction } from './_lib/discord-rest.js'

export const config = {
  maxDuration: 30,
}

const SHEET_ID = '1h20q3RPeYTDwL_hl3uWEq6SSRbSlsHJW3VhN538oP3A'
const IPB_SHEET_GID = 0
const PLAY_REQUIRED_SHEET_GID = 2065024481

const IPB_COLUMNS = ['ID', 'GAME', 'WINNER', 'COMPLETE PLAYING', 'EXTRA POINTS'] as const
const PLAY_REQUIRED_STATUS_COLUMN = 'PLAY REQUIREMENTS MET'

type VerifyType = 'ipb' | 'play_required'
type VerifyAction = 'verify' | 'unverify'

interface VerifyRequestBody {
  password?: string
  type?: VerifyType
  action?: VerifyAction
  giveawayId?: string
  discordThreadId?: string
}

interface GiveawaysData {
  giveaways: {
    id: string
    name: string
    points: number
    winners?: { name: string; winner_username?: string; status: string }[]
  }[]
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf-8')
  return raw ? JSON.parse(raw) : {}
}

function respondJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** Exchanges the GOOGLE_SA_* service-account credentials for a short-lived OAuth access token. */
async function getGoogleAccessToken(): Promise<string> {
  const email = process.env.GOOGLE_SA_EMAIL
  const rawKey = process.env.GOOGLE_SA_PRIVATE_KEY
  if (!email || !rawKey) {
    throw new Error('GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY are not set')
  }
  const privateKey = rawKey.replace(/\\n/g, '\n')

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey)
  const jwt = `${unsigned}.${base64url(signature)}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Google token exchange failed: ${res.status} ${body}`)
  }
  const json = (await res.json()) as { access_token: string }
  return json.access_token
}

async function sheetsFetch(
  accessToken: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    // Google answers 404 (not 403) for a spreadsheet the caller cannot see,
    // so a 404 here almost always means the sheet isn't shared with the
    // service account.
    const hint =
      res.status === 404
        ? ' (Google returns 404 when the spreadsheet is not shared with the service account — check the share settings)'
        : ''
    throw new Error(
      `Google Sheets API ${init.method ?? 'GET'} ${path} failed: ${res.status}${hint} ${body}`,
    )
  }
  return res
}

/** Resolves a tab's current title from its stable gid — titles get renamed, gids don't. */
async function resolveTabTitle(accessToken: string, gid: number): Promise<string> {
  const res = await sheetsFetch(accessToken, '?fields=sheets.properties')
  const json = (await res.json()) as {
    sheets: { properties: { sheetId: number; title: string } }[]
  }
  const sheet = json.sheets.find((s) => s.properties.sheetId === gid)
  if (!sheet) throw new Error(`No sheet tab found with gid ${gid}`)
  return sheet.properties.title
}

async function readTabValues(accessToken: string, title: string): Promise<string[][]> {
  const range = encodeURIComponent(`'${title}'!A:E`)
  const res = await sheetsFetch(accessToken, `/values/${range}`)
  const json = (await res.json()) as { values?: string[][] }
  return json.values ?? []
}

function columnIndex(headerRow: string[], name: string): number {
  return headerRow.findIndex((h) => h.trim() === name)
}

function columnLetter(index: number): string {
  return String.fromCharCode('A'.charCodeAt(0) + index)
}

async function updateCell(
  accessToken: string,
  title: string,
  rowNumber: number,
  colIndex: number,
  value: string
): Promise<void> {
  const range = encodeURIComponent(`'${title}'!${columnLetter(colIndex)}${rowNumber}`)
  await sheetsFetch(accessToken, `/values/${range}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ range: `'${title}'!${columnLetter(colIndex)}${rowNumber}`, values: [[value]] }),
  })
}

async function appendRow(accessToken: string, title: string, row: string[]): Promise<void> {
  const range = encodeURIComponent(`'${title}'!A:E`)
  await sheetsFetch(
    accessToken,
    `/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      body: JSON.stringify({ values: [row] }),
    }
  )
}

const VERIFIED_REACTION_EMOJI = '✅'

/**
 * Best-effort ✅ reaction on the submission thread's starter message — never
 * fails the request. In a forum thread the starter message id equals the
 * thread id.
 */
async function addVerifiedReaction(threadId: string): Promise<'reacted' | 'failed'> {
  try {
    await addReaction(threadId, threadId, VERIFIED_REACTION_EMOJI)
    return 'reacted'
  } catch (err) {
    console.error('verify: Discord reaction failed', err)
    return 'failed'
  }
}

/** Best-effort removal of the ✅ reaction after an unverify — never fails the request. */
async function removeVerifiedReaction(threadId: string): Promise<'unreacted' | 'failed'> {
  try {
    await removeReaction(threadId, threadId, VERIFIED_REACTION_EMOJI)
    return 'unreacted'
  } catch (err) {
    console.error('verify: Discord un-reaction failed', err)
    return 'failed'
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    respondJson(res, 405, { error: 'Method not allowed' })
    return
  }

  let body: VerifyRequestBody
  try {
    body = (await readJsonBody(req)) as VerifyRequestBody
  } catch {
    respondJson(res, 400, { error: 'Invalid JSON body' })
    return
  }

  const { password, type, giveawayId, discordThreadId } = body
  const action: VerifyAction = body.action === 'unverify' ? 'unverify' : 'verify'

  const expectedHash = process.env.ADMIN_PASSWORD_HASH
  if (!expectedHash || !password || sha256Hex(password) !== expectedHash) {
    respondJson(res, 401, { error: 'Unauthorized' })
    return
  }

  if (type !== 'ipb' && type !== 'play_required') {
    respondJson(res, 400, { error: 'type must be "ipb" or "play_required"' })
    return
  }
  if (!giveawayId) {
    respondJson(res, 400, { error: 'giveawayId is required' })
    return
  }

  try {
    const accessToken = await getGoogleAccessToken()
    const gid = type === 'ipb' ? IPB_SHEET_GID : PLAY_REQUIRED_SHEET_GID
    const title = await resolveTabTitle(accessToken, gid)

    if (action === 'unverify') {
      const values = await readTabValues(accessToken, title)
      const headerRow = values[0] ?? []
      const idCol = columnIndex(headerRow, 'ID')
      const rowIndex = values.findIndex((row, i) => i > 0 && (row[idCol] ?? '').trim() === giveawayId)

      if (type === 'ipb') {
        const completeCol = columnIndex(headerRow, IPB_COLUMNS[3])
        const pointsCol = columnIndex(headerRow, IPB_COLUMNS[4])

        if (rowIndex === -1) {
          respondJson(res, 404, { error: `No IPB row found for id ${giveawayId} — nothing to unverify` })
          return
        }
        const rowNumber = rowIndex + 1
        const currentStatus = (values[rowIndex]?.[completeCol] ?? '').trim().toUpperCase()
        if (currentStatus !== 'YES') {
          respondJson(res, 200, { ok: true, action: 'unverified', already: true, discord: 'skipped' })
          return
        }
        await updateCell(accessToken, title, rowNumber, completeCol, 'NO')
        await updateCell(accessToken, title, rowNumber, pointsCol, '')
        const discord = discordThreadId ? await removeVerifiedReaction(discordThreadId) : 'skipped'
        respondJson(res, 200, { ok: true, action: 'unverified', discord })
        return
      }

      // type === 'play_required'
      if (rowIndex === -1) {
        respondJson(res, 404, {
          error: `No Play Required row found for id ${giveawayId} — nothing to unverify`,
        })
        return
      }
      const statusCol = columnIndex(headerRow, PLAY_REQUIRED_STATUS_COLUMN)
      const rowNumber = rowIndex + 1
      const currentStatus = (values[rowIndex]?.[statusCol] ?? '').trim().toUpperCase()
      if (currentStatus !== 'YES') {
        respondJson(res, 200, { ok: true, action: 'unverified', already: true, discord: 'skipped' })
        return
      }
      await updateCell(accessToken, title, rowNumber, statusCol, 'NO')
      respondJson(res, 200, { ok: true, action: 'unverified', discord: 'skipped' })
      return
    }

    // action === 'verify'
    const giveawaysData = await loadDataFile<GiveawaysData>('giveaways.json', req.headers.host)
    const giveaway = giveawaysData.giveaways.find((g) => g.id === giveawayId)
    const winner = giveaway?.winners?.[0]
    if (!giveaway || !winner) {
      respondJson(res, 404, { error: `No giveaway with a winner found for id ${giveawayId}` })
      return
    }
    const winnerUsername = winner.winner_username ?? winner.name

    const values = await readTabValues(accessToken, title)
    const headerRow = values[0] ?? []
    const idCol = columnIndex(headerRow, 'ID')
    const rowIndex = values.findIndex((row, i) => i > 0 && (row[idCol] ?? '').trim() === giveawayId)

    if (type === 'ipb') {
      const completeCol = columnIndex(headerRow, IPB_COLUMNS[3])
      const pointsCol = columnIndex(headerRow, IPB_COLUMNS[4])

      if (rowIndex === -1) {
        await appendRow(accessToken, title, [
          giveawayId,
          giveaway.name,
          winnerUsername,
          'YES',
          String(giveaway.points),
        ])
        const discord = discordThreadId ? await addVerifiedReaction(discordThreadId) : 'skipped'
        respondJson(res, 200, { ok: true, action: 'appended', discord })
        return
      }

      const rowNumber = rowIndex + 1
      const currentStatus = (values[rowIndex]?.[completeCol] ?? '').trim().toUpperCase()
      if (currentStatus === 'YES') {
        respondJson(res, 200, { ok: true, action: 'updated', already: true, discord: 'skipped' })
        return
      }
      await updateCell(accessToken, title, rowNumber, completeCol, 'YES')
      await updateCell(accessToken, title, rowNumber, pointsCol, String(giveaway.points))
      const discord = discordThreadId ? await addVerifiedReaction(discordThreadId) : 'skipped'
      respondJson(res, 200, { ok: true, action: 'updated', discord })
      return
    }

    // type === 'play_required'
    if (rowIndex === -1) {
      respondJson(res, 404, {
        error: `No Play Required row found for id ${giveawayId} — PR rows are created by mods when the giveaway is made`,
      })
      return
    }
    const statusCol = columnIndex(headerRow, PLAY_REQUIRED_STATUS_COLUMN)
    const rowNumber = rowIndex + 1
    const currentStatus = (values[rowIndex]?.[statusCol] ?? '').trim().toUpperCase()
    if (currentStatus === 'YES') {
      respondJson(res, 200, { ok: true, action: 'updated', already: true, discord: 'skipped' })
      return
    }
    await updateCell(accessToken, title, rowNumber, statusCol, 'YES')
    respondJson(res, 200, { ok: true, action: 'updated', discord: 'skipped' })
  } catch (err) {
    console.error('verify: request failed', err)
    respondJson(res, 500, { error: err instanceof Error ? err.message : 'Internal error' })
  }
}

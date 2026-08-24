import {
  getAllUsersAsArray,
  getAllGiveaways,
  getExMembers,
  getGameData,
  getBeatenGames,
  getIpbDiscord,
  getLastUpdated,
} from '@/lib/data'
import { buildPlayRequiredRows, summarizeIpbRows, summarizeRows } from '@/lib/beaten'
import { AdminGate } from '@/components/AdminGate'
import PlayRequiredClient from './PlayRequiredClient'

export default async function PlayRequiredPage() {
  const [memberUsers, giveaways, exMembersData, gameData, beatenGames, ipbDiscord, lastUpdated] =
    await Promise.all([
      getAllUsersAsArray(),
      getAllGiveaways(),
      getExMembers(),
      getGameData(),
      getBeatenGames(),
      getIpbDiscord(),
      getLastUpdated(),
    ])

  const exMemberUsers = exMembersData ? Object.values(exMembersData.users) : []

  const rows = buildPlayRequiredRows({
    memberUsers,
    exMemberUsers,
    giveaways,
    gameData,
    beatenGames,
    ipbDiscord,
  })
  const summary = summarizeRows(rows.filter((row) => row.isPlayRequired))
  const ipbSummary = summarizeIpbRows(rows)

  return (
    <AdminGate>
      <PlayRequiredClient
        rows={rows}
        summary={summary}
        ipbSummary={ipbSummary}
        beatenDataAvailable={beatenGames != null}
        beatenLastUpdated={beatenGames?.last_updated ?? null}
        lastUpdated={lastUpdated}
        unmatchedDiscordThreads={ipbDiscord?.unmatched_threads ?? []}
      />
    </AdminGate>
  )
}

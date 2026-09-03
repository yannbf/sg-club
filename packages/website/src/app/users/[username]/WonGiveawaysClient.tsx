'use client'

import Image from 'next/image'

import { Giveaway, GameData, User, GameBreakdownEntry, SteamIdMap, noStatsReasonLabel } from '@/types'
import { getCVBadgeColor, getCVLabel, formatPlaytime, formatPlaytimeCompact } from '@/lib/data'
import { isConfirmedPlayed } from '@/lib/play-status'
import { useIsAdmin } from '@/lib/auth'
import { PlayTag } from '@/components/WinnerPlayProgress'
import { createCreatorResolver } from '@/lib/creator-resolver'
import GameImage from '@/components/GameImage'
import { useGameData, useDebounce } from '@/lib/hooks'
import FormattedDate, { getFullDate } from '@/components/FormattedDate'
import { useCallback, useState, useMemo } from 'react'
import Tooltip from '@/components/Tooltip'
import { DeadlineStatus, getDeadlineData } from '@/components/DeadlineStatus'
import { CvStatusIndicator } from '@/components/CvStatusIndicator'
import { UserLink } from '@/components/UserLink'
import UserAvatar from '@/components/UserAvatar'
import { Clock3, Trophy } from 'lucide-react'
import {
  LedgerRow,
  LedgerLine,
  LedgerChip,
  LedgerStats,
  LedgerSep,
  LedgerAttrs,
  LedgerWhen,
  type LedgerAttr,
} from '@/components/LedgerRow'
import { DEADLINE_WARNING_DAYS } from '../../../../api/_lib/required-play'
import { FilterSelect } from '@/components/ui/FilterSelect'

interface Props {
  giveaways: Giveaway[]
  wonGiveaways: NonNullable<User['giveaways_won']>
  gameData: GameData[]
  user: User
  /** Resolves giveaway creator fields (steam_id or stale username) to the
   *  current display name for the "by <author>" line on each card. */
  steamIdMap: SteamIdMap
  /** steam_id → avatar_url, for the author avatar on each card. */
  userAvatars: Map<string, string>
  /** Pre-enables the "Play required" filter (deep links from the Discord bot). */
  initialFilterPlayRequired?: boolean
}

type WonGiveaway = NonNullable<User['giveaways_won']>[number]

/**
 * A win's attributes, as the icon cluster the phone row collapses them into.
 * Anything without a number lives here; only deadlines, which carry days, are
 * spelled out as chips.
 */
function wonAttrs(game: WonGiveaway, giveaway: Partial<Giveaway> | undefined, isAdmin: boolean): LedgerAttr[] {
  return [
    giveaway?.region_restricted && { emoji: '🌍', label: 'Region restricted' },
    giveaway?.is_shared && { emoji: '👥', label: 'Shared giveaway' },
    giveaway?.whitelist && { emoji: '🩵', label: 'Whitelist' },
    isAdmin && game.steam_play_data?.is_potentially_idling && { emoji: '💤', label: 'Potentially idling' },
  ].filter(Boolean) as LedgerAttr[]
}

/**
 * A live deadline keeps its number — that's what makes it actionable — while an
 * expired one keeps only the fact, since "expired 258 days ago" and "expired"
 * call for the same thing. The exact count stays in the tooltip.
 */
function deadlineChip(label: string, daysRemaining: number, deadlineDate: Date) {
  const expired = daysRemaining < 0
  const on = getFullDate(deadlineDate.getTime() / 1000)
  return (
    <LedgerChip
      tone={expired ? 'bad' : daysRemaining <= DEADLINE_WARNING_DAYS ? 'warn' : 'neutral'}
      title={
        expired
          ? `Expired ${Math.abs(daysRemaining)} days ago, on ${on}`
          : `${daysRemaining} days left — due ${on}`
      }
    >
      {label} {expired ? 'expired' : `${daysRemaining}d`}
    </LedgerChip>
  )
}

function GamesBreakdown({ games, steamId }: { games: GameBreakdownEntry[]; steamId: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="mt-3 border-t border-card-border pt-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-xs font-medium text-accent hover:underline"
      >
        {expanded ? '▾' : '▸'} This package bundles {games.length} games — {expanded ? 'hide' : 'show'} breakdown
      </button>
      {expanded && (
        <div className="mt-2 space-y-1">
          {games.map((g) => (
            <div
              key={g.app_id}
              className="grid grid-cols-3 gap-2 text-xs py-1 border-b border-card-border/50 last:border-0"
            >
              <span className="truncate" title={g.name}>
                {g.owned ? '' : '🚫 '}
                {g.name}
              </span>
              <span className="text-muted-foreground">
                {g.owned ? formatPlaytime(g.playtime_minutes) : 'Not owned'}
              </span>
              <span className="text-muted-foreground">
                {g.achievements_total > 0 ? (
                  <a
                    href={`https://steamcommunity.com/profiles/${steamId}/stats/${g.app_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline"
                  >
                    {g.achievements_unlocked}/{g.achievements_total} ({g.achievements_percentage}%)
                  </a>
                ) : (
                  '—'
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function WonGiveawaysClient({ giveaways, wonGiveaways, gameData, user, steamIdMap, userAvatars, initialFilterPlayRequired }: Props) {
  const isAdmin = useIsAdmin()
  const { getGameData } = useGameData(gameData)
  const creatorResolver = useMemo(() => createCreatorResolver(steamIdMap), [steamIdMap])
  const [searchTerm, setSearchTerm] = useState('')
  const debouncedSearchTerm = useDebounce(searchTerm, 300)
  const [filterCV, setFilterCV] = useState<'all' | 'FULL_CV' | 'REDUCED_CV' | 'NO_CV'>('all')
  const [filterRegion, setFilterRegion] = useState<boolean>(false)
  const [filterPlayRequired, setFilterPlayRequired] = useState<boolean>(initialFilterPlayRequired ?? false)
  const [filterShared, setFilterShared] = useState<boolean>(false)
  const [playFilter, setPlayFilter] = useState<'all' | 'played' | 'never_played' | 'unplayed_required'>('all')
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [filterPotentiallyIdling, setFilterPotentiallyIdling] = useState<boolean>(false)
  const getGiveawayInfo = useCallback((giveaway: NonNullable<User['giveaways_won']>[0]) => {
    const giveawayInfo = giveaways.find(g => g.link === giveaway.link)
    const extraGiveawayInfo = wonGiveaways.find(g => g.link === giveaway.link)
    return { ...giveawayInfo, ...extraGiveawayInfo }
  }, [giveaways, wonGiveaways])

  const availableFilters = useMemo(() => {
    const hasRegionRestricted = wonGiveaways.some(game => {
      const giveawayInfo = getGiveawayInfo(game)
      return giveawayInfo?.region_restricted
    })

    const hasPlayRequired = wonGiveaways.some(game => {
      const giveawayInfo = getGiveawayInfo(game)
      return giveawayInfo?.required_play || giveawayInfo?.required_play_meta
    })

    const hasShared = wonGiveaways.some(game => {
      const giveawayInfo = getGiveawayInfo(game)
      return giveawayInfo?.is_shared
    })

    const hasPotentiallyIdling = wonGiveaways.some(game =>
      game.steam_play_data?.is_potentially_idling
    )

    return {
      hasRegionRestricted,
      hasPlayRequired,
      hasShared,
      hasPotentiallyIdling
    }
  }, [wonGiveaways, getGiveawayInfo])

  const filteredWonGiveaways = useMemo(() => {
    return wonGiveaways.filter(game => {
      const giveawayInfo = getGiveawayInfo(game)
      const searchTermLower = debouncedSearchTerm.toLowerCase()

      const matchesSearch = game.name.toLowerCase().includes(searchTermLower)
      const matchesCV = filterCV === 'all' || game.cv_status === filterCV

      const matchesLabels =
        (!filterRegion || giveawayInfo?.region_restricted) &&
        (!filterPlayRequired || giveawayInfo?.required_play || giveawayInfo?.required_play_meta) &&
        (!filterShared || giveawayInfo?.is_shared) &&
        (!filterPotentiallyIdling || game.steam_play_data?.is_potentially_idling)

      // "I played, bro" / proof-of-play attestations count as played
      // regardless of Steam data.
      const isAttested = isConfirmedPlayed(game)
      const matchesPlayFilter =
        playFilter === 'all' ||
        (playFilter === 'played' && (isAttested || (game.steam_play_data && !game.steam_play_data.never_played))) ||
        (playFilter === 'never_played' && game.steam_play_data?.never_played && !isAttested) ||
        (playFilter === 'unplayed_required' && (game.required_play || game.required_play_meta) && (!game.required_play_meta || game.required_play_meta?.requirements_met === false))

      return matchesSearch && matchesCV && matchesLabels && matchesPlayFilter
    })
  }, [wonGiveaways, debouncedSearchTerm, getGiveawayInfo, filterCV, filterRegion, filterPlayRequired, filterShared, playFilter, filterPotentiallyIdling])

  return (
    <div className="bg-card-background rounded-lg border-card-border border p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">
          🏆 Games Won <span className="text-xs text-muted-foreground">(Showing {filteredWonGiveaways.length} of {wonGiveaways.length})</span>
        </h2>
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="text-accent hover:text-accent-hover transition-colors text-sm font-medium"
        >
          {isCollapsed ? 'Show' : 'Hide'} {isCollapsed ? '↓' : '↑'}
        </button>
      </div>

      {!isCollapsed && (
        <>
          {/* Filter and Sort Controls */}
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4 p-4 bg-background/50 rounded-lg">
            <div className="flex flex-wrap items-center gap-4 flex-grow">
              {/* Search Input */}
              <div className="flex-grow md:flex-grow-0">
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full md:w-48 px-3 py-2 border border-card-border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-accent text-sm"
                />
              </div>

              {/* CV Filter */}
              <div className="flex items-center gap-2">
                <label htmlFor="cv-filter-won" className="text-sm font-medium">CV:</label>
                <FilterSelect
                  id="cv-filter-won"
                  value={filterCV}
                  onValueChange={setFilterCV}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'FULL_CV', label: 'Full' },
                    { value: 'REDUCED_CV', label: 'Reduced' },
                    { value: 'NO_CV', label: 'No CV' },
                  ]}
                />
              </div>
              {isAdmin && (
              <div className="flex items-center gap-2">
                <label htmlFor="play-filter-won" className="text-sm font-medium">Play:</label>
                <FilterSelect
                  id="play-filter-won"
                  value={playFilter}
                  onValueChange={setPlayFilter}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'played', label: 'Played' },
                    { value: 'never_played', label: 'Never Played' },
                    { value: 'unplayed_required', label: 'Unplayed Required' },
                  ]}
                />
              </div>
              )}
            </div>
            <div className="text-sm text-muted-foreground">
              Showing {filteredWonGiveaways.length} of {wonGiveaways.length}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {availableFilters.hasRegionRestricted && (
              <button
                onClick={() => setFilterRegion(!filterRegion)}
                className={`px-3 py-1 text-sm rounded-full border transition-colors ${filterRegion ? 'bg-info-light text-info-foreground border-info' : 'bg-transparent border-card-border'}`}
              >
                🌍 Restricted
              </button>
            )}
            {availableFilters.hasPlayRequired && (
              <button
                onClick={() => setFilterPlayRequired(!filterPlayRequired)}
                className={`px-3 py-1 text-sm rounded-full border transition-colors ${filterPlayRequired ? 'bg-warning-light text-warning-foreground border-warning' : 'bg-transparent border-card-border'}`}
              >
                🎮 Play Required
              </button>
            )}
            {availableFilters.hasShared && (
              <button
                onClick={() => setFilterShared(!filterShared)}
                className={`px-3 py-1 text-sm rounded-full border transition-colors ${filterShared ? 'bg-purple-light text-purple-foreground border-purple' : 'bg-transparent border-card-border'}`}
              >
                👥 Shared
              </button>
            )}
            {/* TODO: Maybe bring this back */}
            {/* {user.warnings?.includes('potentially_idling_games') && availableFilters.hasPotentiallyIdling && (
              <button
                onClick={() => setFilterPotentiallyIdling(!filterPotentiallyIdling)}
                className={`px-3 py-1 text-sm rounded-full border transition-colors ${filterPotentiallyIdling ? 'bg-error-light text-error-foreground border-error' : 'bg-transparent border-card-border'}`}
              >
                💤 Potentially Idling
              </button>
            )} */}
          </div>
          <div className="space-y-4">
            {filteredWonGiveaways.map((game, index) => {
              const matchingGiveaway = giveaways.find(g => g.link === game.link)
              const gameData = getGameData(matchingGiveaway?.app_id ?? matchingGiveaway?.package_id)
              const giveawayInfo = getGiveawayInfo(game)

              const hasUnavailableStats = !game.steam_play_data || game.steam_play_data?.has_no_available_stats || game.steam_play_data.is_playtime_private

              const hasHalfAchievements = game.steam_play_data?.achievements_percentage && game.steam_play_data?.achievements_percentage >= 50
              const hasPotentiallyCompletedMainStory = game.steam_play_data?.playtime_minutes && game.steam_play_data?.playtime_minutes >= (gameData?.hltb_main_story_hours || 0) * 0.9 * 60
              const hasOver15HoursPlaytime = game.steam_play_data?.playtime_minutes && game.steam_play_data?.playtime_minutes >= 15 * 60

              const needsReview = !!(game.required_play && !game.required_play_meta?.requirements_met && (hasHalfAchievements || hasPotentiallyCompletedMainStory || hasOver15HoursPlaytime))

              const resolvedAuthor = creatorResolver.displayName(
                matchingGiveaway?.creator ?? matchingGiveaway?.creator_username,
              )
              // displayName echoes unmapped values back; a raw steam_id is
              // useless on screen, so prefer the scraped username then.
              const authorName = /^\d{17}$/.test(resolvedAuthor)
                ? (matchingGiveaway?.creator_username ?? '')
                : resolvedAuthor
              const authorAvatar = userAvatars.get(
                creatorResolver.canonicalSteamId(matchingGiveaway?.creator),
              )

              const play = game.steam_play_data
              const confirmedPlayed = isConfirmedPlayed(game)
              const ipbroDeadline =
                !game.i_played_bro && game.cv_status === 'FULL_CV'
                  ? getDeadlineData(game.end_timestamp)
                  : null
              const preqDeadline =
                game.required_play && game.required_play_meta && !game.required_play_meta.requirements_met
                  ? getDeadlineData(
                      game.end_timestamp,
                      game.required_play_meta.deadline_in_months,
                      game.required_play_meta.deadline,
                    )
                  : null

              return (
                <div key={index}>
                <LedgerRow
                  className="md:hidden"
                  name={game.name}
                  link={game.link}
                  points={matchingGiveaway?.points}
                  appId={matchingGiveaway?.app_id}
                  packageId={matchingGiveaway?.package_id}
                  fallbackUrl={gameData?.header_image_url}
                  titleSuffix={matchingGiveaway ? <CvStatusIndicator giveaway={matchingGiveaway} /> : undefined}
                  muted={game.deleted}
                >
                  <LedgerLine>
                    {!play || play.has_no_available_stats || !play.owned ? (
                      <LedgerChip
                        tone="neutral"
                        title={
                          !play
                            ? "This game hasn't been checked against Steam yet."
                            : noStatsReasonLabel(play.no_stats_reason)
                        }
                      >
                        No stats
                      </LedgerChip>
                    ) : isAdmin ? (
                      <LedgerChip tone={play.never_played ? 'bad' : 'ok'}>
                        {play.never_played ? 'Never played' : 'Played'}
                      </LedgerChip>
                    ) : null}
                    {play?.owned && !play.has_no_available_stats && (
                      <LedgerStats>
                        <span
                          className="inline-flex items-center gap-1"
                          title={play.is_playtime_private ? undefined : `${formatPlaytime(play.playtime_minutes)} played`}
                        >
                          <Clock3 className="h-3 w-3" aria-hidden />
                          {play.is_playtime_private ? 'private' : formatPlaytimeCompact(play.playtime_minutes)}
                          {gameData?.hltb_main_story_hours != null && (
                            <span className="text-subtle">/{gameData.hltb_main_story_hours}h</span>
                          )}
                        </span>
                        {play.achievements_total > 0 && (
                          <>
                            <LedgerSep />
                            <span
                              className={`inline-flex items-center gap-1 ${play.achievements_percentage === 100 ? 'font-semibold text-[var(--accent-yellow)]' : ''}`}
                            >
                              <Trophy className="h-3 w-3" aria-hidden />
                              {play.achievements_unlocked}/{play.achievements_total}
                            </span>
                          </>
                        )}
                      </LedgerStats>
                    )}
                  </LedgerLine>
                  <LedgerLine>
                    {game.unreleased && (
                      <LedgerChip tone="neutral" title={game.release_date || 'Not released yet'}>
                        Unreleased
                      </LedgerChip>
                    )}
                    {game.i_played_bro && (
                      <PlayTag label="IpBro" verified title='Marked "I played, bro!"' />
                    )}
                    {game.required_play_meta?.requirements_met && (
                      <PlayTag label="PReq" verified title="Proof of play accepted" />
                    )}
                    {!game.unreleased &&
                      ipbroDeadline &&
                      deadlineChip('IpBro', ipbroDeadline.daysRemaining, ipbroDeadline.deadlineDate)}
                    {!game.unreleased &&
                      preqDeadline &&
                      deadlineChip('PReq', preqDeadline.daysRemaining, preqDeadline.deadlineDate)}
                    {(game.required_play || game.required_play_meta) &&
                      !game.required_play_meta?.requirements_met &&
                      !preqDeadline && (
                        <PlayTag
                          label="PReq"
                          verified={false}
                          title={game.required_play_meta?.additional_notes || 'Play required'}
                        />
                      )}
                    {isAdmin && needsReview && (
                      <LedgerChip tone="warn" title="Playtime or achievements suggest this play requirement is met — needs review">
                        🔍 Review
                      </LedgerChip>
                    )}
                    <LedgerAttrs attrs={wonAttrs(game, giveawayInfo, isAdmin)} />
                    {authorName && (
                      <UserLink
                        username={authorName}
                        className="inline-flex min-w-0 max-w-[120px] items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        {authorAvatar && (
                          <Image
                            src={authorAvatar}
                            alt=""
                            width={16}
                            height={16}
                            className="h-4 w-4 flex-none rounded-full"
                          />
                        )}
                        <span className="truncate">{authorName}</span>
                      </UserLink>
                    )}
                    <LedgerWhen timestamp={game.end_timestamp} />
                  </LedgerLine>
                  {play?.games_breakdown && play.games_breakdown.length > 1 && (
                    <LedgerLine>
                      <LedgerChip
                        tone="neutral"
                        title={play.games_breakdown
                          .map(
                            (entry) =>
                              `${entry.name} — ${entry.playtime_formatted}, ${entry.achievements_unlocked}/${entry.achievements_total}`,
                          )
                          .join('\n')}
                      >
                        Bundles {play.games_breakdown.length} games
                      </LedgerChip>
                    </LedgerLine>
                  )}
                </LedgerRow>
                <div className="hidden md:block border border-card-border rounded-lg overflow-hidden">
                  <div className="flex">
                    {/* Game Image */}
                    <GameImage
                      appId={matchingGiveaway?.app_id?.toString()}
                      packageId={matchingGiveaway?.package_id?.toString()}
                      fallbackUrl={gameData?.header_image_url}
                      name={game.name}
                    />

                    <div className="p-4 flex-1">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="font-semibold flex items-center gap-2">
                            <a
                              href={`https://www.steamgifts.com/giveaway/${game.link}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-accent hover:underline text-sm"
                            >{game.name} ({matchingGiveaway?.points}P) {matchingGiveaway && <CvStatusIndicator giveaway={matchingGiveaway} />}</a>

                            {game.i_played_bro && (
                              <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                                ⭐️ I played, bro!
                              </span>
                            )}
                            {game.required_play_meta?.requirements_met && (
                              <span className="px-2 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800">
                                ✅ Proof of Play
                              </span>
                            )}
                          </h3>
                          <div className="flex items-center mt-1 space-x-4">
                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getCVBadgeColor(game.cv_status, false)}`}>
                              {getCVLabel(game.cv_status, false)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Won <FormattedDate timestamp={game.end_timestamp} />
                              {!game.i_played_bro && game.cv_status === 'FULL_CV' && (
                                <DeadlineStatus
                                  endTimestamp={game.end_timestamp}
                                  tagLabel="IpBro"
                                />
                              )}
                              {game.required_play && game.required_play_meta && !game.required_play_meta.requirements_met && (
                                <DeadlineStatus
                                  endTimestamp={game.end_timestamp}
                                  deadlineInMonths={game.required_play_meta.deadline_in_months}
                                  deadline={game.required_play_meta.deadline}
                                  unreleased={game.unreleased}
                                  releaseDate={game.release_date}
                                  tagLabel="PReq"
                                />
                              )}
                            </span>
                          </div>
                          {giveawayInfo && <>
                            <div className="flex items-center">
                              <div className="flex items-center gap-2 mt-2">
                                {giveawayInfo.region_restricted && (
                                  <span className="text-xs font-medium px-2 py-1 bg-info-light text-info-foreground rounded-full">
                                    🌍 Restricted
                                  </span>
                                )}
                                {isAdmin && game.steam_play_data?.is_potentially_idling && (
                                  <span className="text-xs font-medium px-2 py-1 bg-error-light text-error-foreground rounded-full">
                                    💤 Potentially Idling
                                  </span>
                                )}
                                {(giveawayInfo.required_play || giveawayInfo.required_play_meta) && (
                                  <Tooltip content={giveawayInfo.required_play_meta?.additional_notes || 'No additional notes'}>
                                    <span className="text-xs font-medium px-2 py-1 bg-warning-light text-warning-foreground rounded-full">
                                      🎮 Play Required {giveawayInfo.required_play_meta?.additional_notes && `*`}
                                    </span>
                                  </Tooltip>
                                )}
                                {isAdmin && needsReview && (
                                  <span className="text-xs font-medium px-2 py-1 bg-orange-500 text-white rounded-full">
                                    🔍 Needs Play Required Review
                                  </span>
                                )}
                                {giveawayInfo.is_shared && (
                                  <span className="text-xs font-medium px-2 py-1 bg-info-light text-info-foreground rounded-full">
                                    👥 Shared
                                  </span>
                                )}
                                {giveawayInfo.whitelist && (
                                  <span className="text-xs font-medium px-2 py-1 bg-info-light text-info-foreground rounded-full">
                                    🩵 Whitelist
                                  </span>
                                )}
                              </div>
                            </div>
                          </>}
                        </div>
                      </div>
                    </div>
                  </div>

                  {authorName && (
                    <div className="px-4 pb-4">
                      <div className="pt-3 border-t border-card-border">
                        <div className="text-sm">
                          <span className="text-muted-foreground">Created by:</span>
                          <div className="mt-1">
                            <UserLink
                              username={authorName}
                              className="text-accent hover:underline mr-2 inline-flex items-center"
                            >
                              {authorAvatar && (
                                <UserAvatar
                                  src={authorAvatar}
                                  username={authorName}
                                />
                              )}
                              {authorName}
                            </UserLink>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {hasUnavailableStats && (
                    <div className="bg-background/50 p-4 border-t border-card-border">
                      <div className="text-sm text-muted-foreground font-medium">
                        ⚠️ No stats available
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {!game.steam_play_data
                          ? "This game hasn't been checked against Steam yet."
                          : game.steam_play_data.is_playtime_private &&
                              !game.steam_play_data.has_no_available_stats
                            ? "This user's Steam playtime is set to private."
                            : noStatsReasonLabel(game.steam_play_data.no_stats_reason)}
                      </div>
                    </div>
                  )}

                  {game.steam_play_data && game.steam_play_data.owned && (
                    <div className="bg-background/50 p-4 border-t border-card-border">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                        {isAdmin && (
                        <div>
                          <span className="text-muted-foreground">Status:</span>
                          <span
                            className={`ml-1 font-medium ${game.steam_play_data.never_played && !confirmedPlayed ? 'text-error-foreground' : 'text-success-foreground'}`}
                            title={
                              game.steam_play_data.never_played && confirmedPlayed
                                ? 'Mod-confirmed play (I played, bro / proof of play) — Steam shows no playtime, likely played elsewhere or on a private profile.'
                                : undefined
                            }
                          >
                            {game.steam_play_data.never_played
                              ? confirmedPlayed
                                ? 'Confirmed Played'
                                : 'Never Played'
                              : 'Played'}
                          </span>
                        </div>
                        )}
                        <div>
                          <span className="text-muted-foreground">Playtime:</span>
                          <span className="ml-1 font-medium">
                            {game.steam_play_data.is_playtime_private
                              ? 'Unavailable'
                              : formatPlaytime(game.steam_play_data.playtime_minutes)}
                          </span>
                        </div>
                        {gameData && 'hltb_main_story_hours' in gameData && (<div>
                          <span className="text-muted-foreground">⏱️ HLTB:</span>
                          <span className="ml-1 font-medium">
                            <span className="text-sm text-muted-foreground">
                              {gameData?.hltb_main_story_hours === null ? 'N/A' : `${gameData?.hltb_main_story_hours} hours`}
                            </span>
                          </span>
                        </div>)}
                        <div>
                          <span className="text-muted-foreground">Achievements:</span>
                          {game.steam_play_data.has_no_available_stats ? <span className="ml-1 font-medium text-error-foreground">
                            Unavailable
                          </span> : <a href={`https://steamcommunity.com/profiles/${user.steam_id}/stats/${gameData?.app_id}`} target="_blank" rel="noopener noreferrer" className="ml-1 font-medium text-accent hover:underline">
                            {game.steam_play_data.achievements_unlocked}/{game.steam_play_data.achievements_total} ({game.steam_play_data.achievements_percentage}%)
                          </a>}
                        </div>
                      </div>
                      {game.steam_play_data.games_breakdown &&
                        game.steam_play_data.games_breakdown.length > 1 && (
                          <GamesBreakdown
                            games={game.steam_play_data.games_breakdown}
                            steamId={user.steam_id}
                          />
                        )}
                    </div>
                  )}
                </div>
                </div>
              )

            })}
          </div>
        </>
      )}
    </div>
  )
}
'use client'

import { Giveaway, GameData, User } from '@/types'
import { getCVBadgeColor, getCVLabel, formatPlaytime } from '@/lib/data'
import GameImage from '@/components/GameImage'
import { useGameData, useDebounce } from '@/lib/hooks'
import FormattedDate from '@/components/FormattedDate'
import { useCallback, useState, useMemo } from 'react'
import Tooltip from '@/components/Tooltip'
import { DeadlineStatus } from '@/components/DeadlineStatus'
import { CvStatusIndicator } from '@/components/CvStatusIndicator'

interface Props {
  giveaways: Giveaway[]
  wonGiveaways: NonNullable<User['giveaways_won']>
  gameData: GameData[]
  user: User
}

export default function WonGiveawaysClient({ giveaways, wonGiveaways, gameData, user }: Props) {
  const { getGameData } = useGameData(gameData)
  const [searchTerm, setSearchTerm] = useState('')
  const debouncedSearchTerm = useDebounce(searchTerm, 300)
  const [filterCV, setFilterCV] = useState<'all' | 'FULL_CV' | 'REDUCED_CV' | 'NO_CV'>('all')
  const [filterRegion, setFilterRegion] = useState<boolean>(false)
  const [filterPlayRequired, setFilterPlayRequired] = useState<boolean>(false)
  const [filterShared, setFilterShared] = useState<boolean>(false)
  const [filterUnplayedRequired, setFilterUnplayedRequired] = useState<boolean>(false)
  const [isCollapsed, setIsCollapsed] = useState(false)

  const getGiveawayInfo = useCallback((giveaway: NonNullable<User['giveaways_won']>[0]) => {
    const giveawayInfo = giveaways.find(g => g.link === giveaway.link)
    const extraGiveawayInfo = wonGiveaways.find(g => g.link === giveaway.link)
    return { ...giveawayInfo, ...extraGiveawayInfo }
  }, [giveaways, wonGiveaways])

  const filteredWonGiveaways = useMemo(() => {
    return wonGiveaways.filter(game => {
      const giveawayInfo = getGiveawayInfo(game)
      const searchTermLower = debouncedSearchTerm.toLowerCase()

      const matchesSearch = game.name.toLowerCase().includes(searchTermLower)
      const matchesCV = filterCV === 'all' || game.cv_status === filterCV

      const matchesLabels =
        (!filterRegion || giveawayInfo?.region_restricted) &&
        (!filterPlayRequired || giveawayInfo?.required_play || giveawayInfo?.required_play_meta) &&
        (!filterShared || giveawayInfo?.is_shared)

      const matchesUnplayedRequired =
        !filterUnplayedRequired ||
        ((giveawayInfo?.required_play || giveawayInfo?.required_play_meta) && game.steam_play_data?.never_played)

      return matchesSearch && matchesCV && matchesLabels && matchesUnplayedRequired
    })
  }, [wonGiveaways, debouncedSearchTerm, getGiveawayInfo, filterCV, filterRegion, filterPlayRequired, filterShared, filterUnplayedRequired])

  return (
    <div className="bg-card-background rounded-lg border-card-border border p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">
          🏆 Games Won ({filteredWonGiveaways.length})
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
                <select
                  id="cv-filter-won"
                  value={filterCV}
                  onChange={(e) => setFilterCV(e.target.value as 'all' | 'FULL_CV' | 'REDUCED_CV' | 'NO_CV')}
                  className="px-3 py-2 border border-card-border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-accent text-sm"
                >
                  <option value="all">All</option>
                  <option value="FULL_CV">Full</option>
                  <option value="REDUCED_CV">Reduced</option>
                  <option value="NO_CV">No CV</option>
                </select>
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              Showing {filteredWonGiveaways.length} of {wonGiveaways.length}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <button
              onClick={() => setFilterRegion(!filterRegion)}
              className={`px-3 py-1 text-sm rounded-full border transition-colors ${filterRegion ? 'bg-info-light text-info-foreground border-info' : 'bg-transparent border-card-border'}`}
            >
              🌍 Restricted
            </button>
            <button
              onClick={() => setFilterPlayRequired(!filterPlayRequired)}
              className={`px-3 py-1 text-sm rounded-full border transition-colors ${filterPlayRequired ? 'bg-warning-light text-warning-foreground border-warning' : 'bg-transparent border-card-border'}`}
            >
              🎮 Play Required
            </button>
            <button
              onClick={() => setFilterShared(!filterShared)}
              className={`px-3 py-1 text-sm rounded-full border transition-colors ${filterShared ? 'bg-purple-light text-purple-foreground border-purple' : 'bg-transparent border-card-border'}`}
            >
              👥 Shared
            </button>
            <button
              onClick={() => setFilterUnplayedRequired(!filterUnplayedRequired)}
              className={`px-3 py-1 text-sm rounded-full border transition-colors ${filterUnplayedRequired ? 'bg-error-light text-error-foreground border-error' : 'bg-transparent border-card-border'}`}
            >
              Unplayed Required
            </button>
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

              return (
                <div key={index} className="border border-card-border rounded-lg overflow-hidden">
                  <div className="flex">
                    {/* Game Image */}
                    <GameImage
                      appId={matchingGiveaway?.app_id?.toString()}
                      packageId={matchingGiveaway?.package_id?.toString()}
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
                            >{game.name} ({matchingGiveaway?.points}P) <CvStatusIndicator giveaway={matchingGiveaway} /></a>

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
                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getCVBadgeColor(game.cv_status)}`}>
                              {getCVLabel(game.cv_status)}
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
                                {(giveawayInfo.required_play || giveawayInfo.required_play_meta) && (
                                  <Tooltip content={giveawayInfo.required_play_meta?.additional_notes || 'No additional notes'}>
                                    <span className="text-xs font-medium px-2 py-1 bg-warning-light text-warning-foreground rounded-full">
                                      🎮 Play Required {giveawayInfo.required_play_meta?.additional_notes && `*`}
                                    </span>
                                  </Tooltip>
                                )}
                                {needsReview && (
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

                  {hasUnavailableStats && (
                    <div className="bg-background/50 p-4 border-t border-card-border">
                      <div className="text-sm text-muted-foreground font-medium">
                        ⚠️ No stats available
                      </div>
                    </div>
                  )}

                  {game.steam_play_data && game.steam_play_data.owned && (
                    <div className="bg-background/50 p-4 border-t border-card-border">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Status:</span>
                          <span className={`ml-1 font-medium ${game.steam_play_data.never_played ? 'text-error-foreground' : 'text-success-foreground'}`}>
                            {game.steam_play_data.never_played ? 'Never Played' : 'Played'}
                          </span>
                        </div>
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
                    </div>
                  )}
                </div>
              )

            })}
          </div>
        </>
      )}
    </div>
  )
}
'use client'

import { Giveaway, GameData, User } from '@/types'
import { getCVBadgeColor, getCVLabel, formatPlaytime } from '@/lib/data'
import GameImage from './GameImage'
import { useGameData } from '@/lib/hooks'
import FormattedDate from '@/components/FormattedDate'

interface Props {
  giveaways: Giveaway[]
  wonGiveaways: NonNullable<User['giveaways_won']>
  gameData: GameData[]
}

export default function WonGiveawaysClient({ giveaways, wonGiveaways, gameData }: Props) {
  const { getGameData } = useGameData(gameData)

  return (
    <div className="bg-card-background rounded-lg border-card-border border p-6 mb-6">
      <h2 className="text-xl font-semibold mb-4">
        🏆 Games Won ({wonGiveaways.length})
      </h2>
      <div className="space-y-4">
        {wonGiveaways.map((game, index) => {
          const matchingGiveaway = giveaways.find(g => g.link === game.link)
          const gameData = getGameData(matchingGiveaway?.app_id)

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
                      <h3 className="font-semibold">
                        <a
                          href={`https://www.steamgifts.com/giveaway/${game.link}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:underline text-sm"
                        >{game.name} ({matchingGiveaway?.points}P)</a>
                      </h3>
                      <div className="flex items-center mt-1 space-x-4">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getCVBadgeColor(game.cv_status)}`}>
                          {getCVLabel(game.cv_status)}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          Won <FormattedDate timestamp={game.end_timestamp} />
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {game.steam_play_data && (
                <div className="bg-background/50 p-4">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                    {game.steam_play_data.owned && (
                      <>
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
                          <span className="ml-1 font-medium">
                            {game.steam_play_data.achievements_unlocked}/{game.steam_play_data.achievements_total}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
} 
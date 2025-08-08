import { User } from "@/types"
import Tooltip from "./Tooltip"

export const getUnplayedGamesStats = (user: User) => {
  if (!user.giveaways_won) return { played: 0, total: 0, percentage: 0 }
  const total = user.giveaways_won.length
  const unplayed = user.giveaways_won.filter(game =>
    !game.steam_play_data || game.steam_play_data.never_played || game.steam_play_data.has_no_available_stats
  ).length
  const played = total - unplayed
  return {
    played,
    total,
    percentage: total > 0 ? (played / total) * 100 : 0
  }
}

const getPlayedRateColor = (percentage: number) => {
  if (percentage >= 66) return 'text-success-foreground'
  if (percentage >= 33) return 'text-accent-yellow'
  return 'text-error-foreground'
}

export function UnplayedGamesStats({ user, size = 'medium' }: { user: User, size?: 'medium' | 'large' }) {
  if (!user.giveaways_won || user.giveaways_won.length === 0) {
    return null;
  }

  const stats = getUnplayedGamesStats(user);
  const missingData = user.giveaways_won.some(game => !game.steam_play_data || game.steam_play_data.has_no_available_stats);
  const rateText = stats.total === 0
    ? '0/0 (0%)'
    : `${stats.played}/${stats.total} (${stats.percentage.toFixed(0)}%)`;

  return (
    <div className="text-center">
      <div className={`${size === 'medium' ? 'text-sm font-medium' : 'text-2xl font-bold'} ${getPlayedRateColor(stats.percentage)}`}>
        {rateText}
        {missingData && (
          <Tooltip content="Some or all games have no available stats so this might be innacurate">
            <span>⚠️</span>
          </Tooltip>
        )}
      </div>
      <div className={`${size === 'medium' ? 'text-xs' : 'text-sm'} text-muted-foreground`}>Play Rate</div>
    </div>
  );
}
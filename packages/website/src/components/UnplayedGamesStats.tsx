import { User } from "@/types"
import Tooltip from "./Tooltip"

export const getUnplayedGamesStats = (user: User) => {
  // Wins from deleted giveaways don't count toward the play rate.
  const wins = (user.giveaways_won ?? []).filter(game => !game.deleted)
  if (wins.length === 0) return { played: 0, total: 0, percentage: 0 }
  const total = wins.length
  const unplayed = wins.filter(game =>
    // "I played, bro" / proof-of-play attestations always count as played,
    // regardless of what Steam data says (played elsewhere, private, etc.).
    !game.i_played_bro &&
    !game.required_play_meta?.requirements_met &&
    (!game.steam_play_data || game.steam_play_data.never_played || game.steam_play_data.has_no_available_stats)
  ).length
  const played = total - unplayed
  return {
    played,
    total,
    percentage: Math.round(total > 0 ? (played / total) * 100 : 0)
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
  const missingData = user.giveaways_won.some(game => !game.deleted && (!game.steam_play_data || game.steam_play_data.has_no_available_stats));
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
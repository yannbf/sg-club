import FormattedDate from '@/components/FormattedDate'
import { useCallback, useState, useMemo } from 'react'
import Tooltip from '@/components/Tooltip'

interface Props {
  giveaways: Giveaway[];
  wonGiveaways: NonNullable<User['giveaways_won']>[0][];
  gameData: GameData;
}

export default function WonGiveawaysClient({ giveaways, wonGiveaways, gameData }: Props) {
  const { getGameData } = useGameData(gameData)
  const [searchTerm, setSearchTerm] = useState('')
  const debouncedSearchTerm = useDebounce(searchTerm, 300)
  const [filterCV, setFilterCV] = useState<'all' | 'FULL_CV' | 'REDUCED_CV' | 'NO_CV'>('all')
  const [filterRegion, setFilterRegion] = useState<boolean>(false)
  const [filterPlayRequired, setFilterPlayRequired] = useState<boolean>(false)
  const [filterShared, setFilterShared] = useState<boolean>(false)
  const [filterUnplayedRequired, setFilterUnplayedRequired] = useState<boolean>(false)

  const getGiveawayInfo = useCallback((giveaway: NonNullable<User['giveaways_won']>[0]) => {
    const giveawayInfo = giveaways.find(g => g.link === giveaway.link)
    const extraGiveawayInfo = wonGiveaways.find(g => g.link === giveaway.link)
    const timeSinceWon = extraGiveawayInfo?.time_won ? Date.now() - extraGiveawayInfo.time_won : 0;
    const TWO_MONTHS_IN_SECONDS = 60 * 60 * 24 * 60; // 60 days in seconds
    const daysRemaining = Math.ceil((TWO_MONTHS_IN_SECONDS - timeSinceWon) / (60 * 60 * 24));
    return <span className={textColorClass}> ({daysRemaining} days remaining for <code>I play, bro</code> proof)</span>;
  };

  const filteredWonGiveaways = useMemo(() => {
    return wonGiveaways.filter(game => {
      const giveawayInfo = getGiveawayInfo(game)
      const searchTermLower = debouncedSearchTerm.toLowerCase()
      const matchesSearch = game.name.toLowerCase().includes(searchTermLower)
      const matchesCV = filterCV === 'all' || (giveawayInfo?.cv_status || 'FULL_CV') === filterCV

      const matchesLabels = (
        (!filterRegion || giveawayInfo?.region_restricted) &&
        (!filterPlayRequired || (giveawayInfo?.required_play || giveawayInfo?.required_play_meta)) &&
        (!filterShared || giveawayInfo?.is_shared)
      )

      const matchesUnplayedRequired = (
        !filterUnplayedRequired ||
        ((giveawayInfo?.required_play || giveawayInfo?.required_play_meta) && game.steam_play_data?.never_played)
      )

      return matchesSearch && matchesCV && matchesLabels && matchesUnplayedRequired
    })
  }, [wonGiveaways, debouncedSearchTerm, getGiveawayInfo, filterCV, filterRegion, filterPlayRequired, filterShared, filterUnplayedRequired])

  return (
    <div className="bg-card-background rounded-lg border-card-border border p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">
          🏆 Games Won ({wonGiveaways.length})
        </h2>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-4 p-4 bg-background/50 rounded-lg">
        <div className="flex-grow">
          <input
            type="text"
            placeholder="Search won games..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-2 border border-card-border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="cv-filter-won" className="text-sm font-medium">CV:</label>
          <select
            id="cv-filter-won"
            value={filterCV}
            onChange={(e) => setFilterCV(e.target.value as 'all' | 'FULL_CV' | 'REDUCED_CV' | 'NO_CV')}
            className="px-3 py-2 border border-card-border rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="all">All</option>
            <option value="FULL_CV">Full</option>
            <option value="REDUCED_CV">Reduced</option>
            <option value="NO_CV">No CV</option>
          </select>
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
          const extraGiveawayInfo = wonGiveaways.find(g => g.link === game.link)
          const giveawayInfo = getGiveawayInfo(game)
          const timeSinceWon = extraGiveawayInfo?.time_won ? Date.now() - extraGiveawayInfo.time_won : 0;
          const TWO_MONTHS_IN_SECONDS = 60 * 60 * 24 * 60; // 60 days in seconds
          const daysRemaining = Math.ceil((TWO_MONTHS_IN_SECONDS - timeSinceWon) / (60 * 60 * 24));
          const textColorClass = daysRemaining <= 0 ? 'text-error' : 'text-success';

          return (
            <div key={game.link} className="flex items-center justify-between bg-background/20 p-4 rounded-lg">
              <div className="flex items-center gap-4">
                <img src={matchingGiveaway?.image_url || '/placeholder.png'} alt={game.name} className="w-12 h-12 object-cover rounded-md" />
                <div>
                  <h3 className="text-lg font-semibold">{game.name}</h3>
                  <p className="text-sm text-gray-500">
                    Won on: <FormattedDate date={extraGiveawayInfo?.time_won || 0} />
                  </p>
                  <p className="text-sm text-gray-500">
                    Days remaining: <span className={textColorClass}>{daysRemaining} days</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Tooltip text="View Giveaway">
                  <a href={game.link} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-external-link"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg>
                  </a>
                </Tooltip>
                <Tooltip text="View Game">
                  <a href={`/games/${matchingGiveaway?.id}`} className="text-primary hover:underline">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-gamepad"><path d="M16 2H8a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/><path d="M12 15H8"/><path d="M12 12H8"/><path d="M12 9H8"/></svg>
                  </a>
                </Tooltip>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
} 
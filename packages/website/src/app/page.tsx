import { getAllGiveaways, getAllUsers } from '@/lib/data'
import Link from 'next/link'
import { LastUpdated } from '@/components/LastUpdated'

export default async function Home() {
  const giveaways = await getAllGiveaways()
  const userData = await getAllUsers()
  
  if (!userData) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Unable to load data</p>
      </div>
    )
  }

  const users = userData.users
  const activeMembers = users.length
  const totalGiveaways = giveaways.length

  // Calculate statistics
  const totalGiveawaysCreated = users.reduce((sum, user) => {
    return sum + (user.giveaways_created?.length || 0)
  }, 0)

  const totalGiveawaysWon = users.reduce((sum, user) => {
    return sum + (user.giveaways_won?.length || 0)
  }, 0)

  const totalValueSent = users.reduce((sum, user) => sum + user.stats.total_sent_value, 0)
  const totalValueReceived = users.reduce((sum, user) => sum + user.stats.total_received_value, 0)

  const netContributors = users.filter(user => user.stats.total_gift_difference > 0).length
  const neutralUsers = users.filter(user => user.stats.total_gift_difference === 0).length
  const netReceivers = users.filter(user => user.stats.total_gift_difference < 0).length

  return (
    <div className="space-y-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Group Analytics Overview</h1>
        {userData.lastUpdated ? <LastUpdated lastUpdatedDate={new Date(userData.lastUpdated).toISOString()} /> : <p className="mt-2 text-sm text-muted-foreground">Last updated: Unknown</p>}
      </div>

      {/* Key Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-card-background rounded-lg border-card-border border p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-accent-blue rounded-full flex items-center justify-center">
                <span className="text-white font-semibold">👥</span>
              </div>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted-foreground">Active Members</p>
              <p className="text-2xl font-semibold">{activeMembers}</p>
            </div>
          </div>
        </div>

        <div className="bg-card-background rounded-lg border-card-border border p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-accent-green rounded-full flex items-center justify-center">
                <span className="text-white font-semibold">🎁</span>
              </div>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted-foreground">Total Giveaways</p>
              <p className="text-2xl font-semibold">{totalGiveaways}</p>
            </div>
          </div>
        </div>

        <div className="bg-card-background rounded-lg border-card-border border p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-accent-purple rounded-full flex items-center justify-center">
                <span className="text-white font-semibold">💰</span>
              </div>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted-foreground">Total Value Sent</p>
              <p className="text-2xl font-semibold">${totalValueSent.toFixed(0)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Community Health */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-card-background rounded-lg border-card-border border p-6">
          <h3 className="text-lg font-semibold mb-4">Community Health</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Net Contributors</span>
              <span className="text-sm font-semibold text-success-foreground">
                {netContributors} ({((netContributors / activeMembers) * 100).toFixed(1)}%)
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Net Receivers</span>
              <span className="text-sm font-semibold text-error-foreground">
                {netReceivers} ({((netReceivers / activeMembers) * 100).toFixed(1)}%)
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Neutral Users</span>
              <span className="text-sm font-semibold text-muted-foreground">
                {neutralUsers} ({((neutralUsers / activeMembers) * 100).toFixed(1)}%)
              </span>
            </div>
          </div>
        </div>

        <div className="bg-card-background rounded-lg border-card-border border p-6">
          <h3 className="text-lg font-semibold mb-4">Activity Summary</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Giveaways Created</span>
              <span className="text-sm font-semibold text-info-foreground">{totalGiveawaysCreated}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Giveaways Won</span>
              <span className="text-sm font-semibold text-success-foreground">{totalGiveawaysWon}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Total Value Received</span>
              <span className="text-sm font-semibold text-accent-purple">${totalValueReceived.toFixed(0)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-card-background rounded-lg border-card-border border p-6">
        <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            href="/giveaways"
            className="flex items-center justify-center px-4 py-3 border border-transparent text-sm font-medium rounded-md text-accent-foreground bg-accent hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent"
          >
            View All Giveaways
          </Link>
          <Link
            href="/users"
            className="flex items-center justify-center px-4 py-3 border border-transparent text-sm font-medium rounded-md text-accent-foreground bg-accent hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent"
          >
            View All Users
          </Link>
        </div>
      </div>
    </div>
  )
}

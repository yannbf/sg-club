import { getAllGiveaways, getAllUsers, formatDateTime } from '@/lib/data'
import Link from 'next/link'

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
  const lastUpdated = formatDateTime(userData.lastUpdated / 1000)

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

  const usersWithSteam = users.filter(user => user.steam_id).length

  return (
    <div className="px-4 sm:px-0">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Group Analytics Overview</h1>
        <p className="mt-2 text-sm text-gray-600">
          Last updated: {lastUpdated}
        </p>
      </div>

      {/* Key Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                <span className="text-white font-semibold">👥</span>
              </div>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Active Members</p>
              <p className="text-2xl font-semibold text-gray-900">{activeMembers}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                <span className="text-white font-semibold">🎁</span>
              </div>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Total Giveaways</p>
              <p className="text-2xl font-semibold text-gray-900">{totalGiveaways}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center">
                <span className="text-white font-semibold">💰</span>
              </div>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Total Value Sent</p>
              <p className="text-2xl font-semibold text-gray-900">${totalValueSent.toFixed(0)}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center">
                <span className="text-white font-semibold">🎮</span>
              </div>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Steam Integration</p>
              <p className="text-2xl font-semibold text-gray-900">{usersWithSteam}</p>
              <p className="text-xs text-gray-500">of {activeMembers} users</p>
            </div>
          </div>
        </div>
      </div>

      {/* Community Health */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Community Health</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Net Contributors</span>
              <span className="text-sm font-semibold text-green-600">
                {netContributors} ({((netContributors / activeMembers) * 100).toFixed(1)}%)
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Net Receivers</span>
              <span className="text-sm font-semibold text-red-600">
                {netReceivers} ({((netReceivers / activeMembers) * 100).toFixed(1)}%)
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Neutral Users</span>
              <span className="text-sm font-semibold text-gray-600">
                {neutralUsers} ({((neutralUsers / activeMembers) * 100).toFixed(1)}%)
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Activity Summary</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Giveaways Created</span>
              <span className="text-sm font-semibold text-blue-600">{totalGiveawaysCreated}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Giveaways Won</span>
              <span className="text-sm font-semibold text-green-600">{totalGiveawaysWon}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Total Value Received</span>
              <span className="text-sm font-semibold text-purple-600">${totalValueReceived.toFixed(0)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            href="/giveaways"
            className="flex items-center justify-center px-4 py-3 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            View All Giveaways
          </Link>
          <Link
            href="/users"
            className="flex items-center justify-center px-4 py-3 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
          >
            View All Users
          </Link>
        </div>
      </div>
    </div>
  )
}

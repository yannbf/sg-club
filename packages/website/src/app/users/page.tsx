import { getAllUsers } from '@/lib/data'
import UsersClient from './client'

export default async function UsersPage() {
  const userData = await getAllUsers()
  const lastUpdated = userData?.lastUpdated

  if (!userData) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Unable to load user data</p>
      </div>
    )
  }

  return <UsersClient users={Object.values(userData.users)} lastUpdated={lastUpdated} />
} 
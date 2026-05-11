import { getAllUsers, getExMembers } from '@/lib/data'
import UsersClient from './client'
import { AdminGate } from '@/components/AdminGate'

export default async function UsersPage() {
  const userData = await getAllUsers()
  const exData = await getExMembers()
  const lastUpdated = userData?.lastUpdated

  if (!userData) {
    return (
      <AdminGate>
        <div className="flex items-center justify-center h-64">
          <p className="text-gray-500">Unable to load user data</p>
        </div>
      </AdminGate>
    )
  }

  const exMembers = exData ? Object.values(exData.users) : []

  return (
    <AdminGate>
      <UsersClient
        users={Object.values(userData.users)}
        exMembers={exMembers}
        lastUpdated={lastUpdated}
      />
    </AdminGate>
  )
}

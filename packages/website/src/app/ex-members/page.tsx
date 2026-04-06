import { getExMembers } from '@/lib/data'
import UsersClient from '../users/client'

export default async function ExMembersPage() {
  const exData = await getExMembers()

  if (!exData || Object.keys(exData.users).length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold">Ex Members</h1>
        <div className="flex items-center justify-center h-64">
          <p className="text-gray-500">No ex-members data available</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Ex Members</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Members who have left the group. Their profiles and history are preserved.
        </p>
      </div>
      <UsersClient users={Object.values(exData.users)} />
    </div>
  )
}

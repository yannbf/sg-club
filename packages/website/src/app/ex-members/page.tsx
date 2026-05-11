import { getExMembers } from '@/lib/data'
import UsersClient from '../users/client'
import { Card } from '@/components/ui/Card'
import { AdminGate } from '@/components/AdminGate'

export default async function ExMembersPage() {
  const exData = await getExMembers()

  if (!exData || Object.keys(exData.users).length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">
            Ex members
          </h1>
        </div>
        <AdminGate>
          <Card className="flex h-64 items-center justify-center">
            <p className="text-muted-foreground">
              No ex-members data available.
            </p>
          </Card>
        </AdminGate>
      </div>
    )
  }

  return (
    <AdminGate>
      <UsersClient
        users={Object.values(exData.users)}
        heading="Ex members"
        description="Members who have left the group. Their profiles and history are preserved."
      />
    </AdminGate>
  )
}

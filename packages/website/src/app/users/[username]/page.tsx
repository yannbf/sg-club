// page.tsx
import { getUser, getAllGiveaways, getAllUsers, getExMembers, getGameData, getUserEntries, getSteamIdMap } from '@/lib/data'
import { notFound } from 'next/navigation'
import UserDetailPageClient from './UserDetailPageClient'
import leaversData from '@/../investigation/giveaway_leavers.json';
import { GiveawayLeaver } from '@/types/stats';
import { Giveaway } from '@/types';
// import { Metadata } from 'next'

export async function generateStaticParams() {
  const [userData, exData, steamIdMap] = await Promise.all([
    getAllUsers(),
    getExMembers(),
    getSteamIdMap(),
  ])
  const usernames = new Set<string>()

  if (userData) {
    for (const user of Object.values(userData.users)) {
      usernames.add(user.username)
    }
  }
  if (exData) {
    for (const user of Object.values(exData.users)) {
      usernames.add(user.username)
    }
  }
  // Also generate pages for previous usernames so old links still work
  for (const entry of Object.values(steamIdMap)) {
    for (const prev of entry.previous) {
      usernames.add(prev.username)
    }
  }

  return Array.from(usernames).map((username) => ({ username }))
}

// export async function generateMetadata({ params }: { params: { username: string } }): Promise<Metadata> {
//   const paramsData = await params
//   const username = decodeURIComponent(paramsData.username)
//   const user = await getUser(username)

//   if (!user) {
//     return {
//       title: 'User not found',
//       description: 'This user does not exist.',
//     }
//   }

//   const description = `Ratio ${user.stats.giveaway_ratio} | Created ${user.giveaways_created?.length ?? 0} GAs | Received ${user.stats.real_total_received_count} | Sent ${user.stats.total_sent_count} | Received ${user.stats.total_received_count}`

//   return {
//     title: `TGC - ${user.username}`,
//     description,
//     openGraph: {
//       title: `TGC - ${user.username}`,
//       description,
//     },
//   }
// }

type Leaver = {
  joined_at_timestamp: string;
  ga_link: string;
  leave_detected_at: number;
  time_difference_hours: number;
};

const leavers: Record<string, Leaver[]> = leaversData;

export default async function UserDetailPage(
  props: {
    params: Promise<{ username: string }>
  }
) {
  const params = await props.params;
  const { username } = params
  const [userResult, allUsers, giveaways, userEntries, gameDataObj, steamIdMap] = await Promise.all([
    getUser(decodeURIComponent(username)),
    getAllUsers(),
    getAllGiveaways(),
    getUserEntries(),
    getGameData(),
    getSteamIdMap(),
  ])
  const lastUpdated = allUsers?.lastUpdated ?? null

  if (!userResult) {
    notFound()
  }

  const { user, isExMember } = userResult

  // Leavers are keyed by steam_id
  const userLeavers = leavers[user.steam_id] || [];
  const userLeaversWithGaData: GiveawayLeaver[] = userLeavers.map((leaver) => {
    const gaId = leaver.ga_link.split('/')[0];
    const giveaway = giveaways.find((ga) => ga.id === gaId);
    return {
      ...leaver,
      giveaway: giveaway
        ? {
          ...(giveaway as unknown as Giveaway),
          game: {
            image_url: `https://cdn.akamai.steamstatic.com/steam/apps/${giveaway.app_id}/header.jpg`,
            name: giveaway.name,
            app_id: giveaway.app_id,
          },
        }
        : undefined,
    };
  }).filter(id => !!id.giveaway);

  // Convert gameData from object to array
  const gameData = Object.entries(gameDataObj).map(([, data]) => data)

  return (
    <UserDetailPageClient
      user={user}
      allUsers={allUsers}
      giveaways={giveaways}
      gameData={gameData}
      userEntries={userEntries}
      lastUpdated={lastUpdated}
      leavers={userLeaversWithGaData}
      steamIdMap={steamIdMap}
      isExMember={isExMember}
    />
  )
} 
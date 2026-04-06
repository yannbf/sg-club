import Client from './client';
import leaversData from '@/../investigation/giveaway_leavers.json';
import giveawaysData from '@/../public/data/giveaways.json';
import usersData from '@/../public/data/group_users.json';
import { GiveawayLeaver } from '@/types/stats';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

type UserInfo = { username: string; avatar_url: string; steam_id: string };

const leavers: Record<string, Omit<GiveawayLeaver, 'giveaway'>[]> = leaversData;

const activeUsers: Record<string, UserInfo> = usersData.users as any;
const activeSteamIds = new Set(Object.keys(activeUsers));

// Build a combined users lookup: active + ex-members
function getAllUsersMap(): Record<string, UserInfo> {
  const allUsers = { ...activeUsers };

  try {
    const exPath = join(process.cwd(), 'public', 'data', 'ex_members.json');
    if (existsSync(exPath)) {
      const exData = JSON.parse(readFileSync(exPath, 'utf-8'));
      const exUsers: Record<string, UserInfo> = exData.users || {};
      for (const [steamId, user] of Object.entries(exUsers)) {
        if (!allUsers[steamId]) {
          allUsers[steamId] = user;
        }
      }
    }
  } catch {}

  return allUsers;
}

const users = getAllUsersMap();

export default function Page() {
  const giveawaysWithLeavers = giveawaysData.giveaways
    .map((ga) => {
      const leaversForGa: {
        user: { username: string; avatar_url: string; isExMember: boolean };
        leaver: Omit<GiveawayLeaver, 'giveaway'>;
      }[] = [];
      Object.entries(leavers).forEach(([steamId, leaverArr]) => {
        leaverArr.forEach((leaver) => {
          if (leaver.ga_link.startsWith(ga.id)) {
            const user = users[steamId];
            if (user) {
              leaversForGa.push({
                user: {
                  username: user.username,
                  avatar_url: user.avatar_url,
                  isExMember: !activeSteamIds.has(steamId),
                },
                leaver,
              });
            }
          }
        });
      });
      return {
        ...ga,
        game: {
          image_url: `https://cdn.akamai.steamstatic.com/steam/apps/${ga.app_id}/header.jpg`,
          name: ga.name,
          app_id: ga.app_id,
        },
        leavers: leaversForGa,
      };
    })
    .filter((ga) => ga.leavers.length > 0);

  const lastUpdated = giveawaysData.last_updated

  return <Client giveaways={giveawaysWithLeavers as any} lastUpdated={lastUpdated} />;
} 
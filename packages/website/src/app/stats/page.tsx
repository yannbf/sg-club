import Client from './client';
import leaversData from '@/../investigation/giveaway_leavers.json';
import giveawaysData from '@/../public/data/giveaways.json';
import usersData from '@/../public/data/group_users.json';
import { GiveawayLeaver } from '@/types/stats';

const leavers: Record<string, Omit<GiveawayLeaver, 'giveaway'>[]> = leaversData;

const users = usersData.users;

export default function Page() {
  const giveawaysWithLeavers = giveawaysData.giveaways
    .map((ga) => {
      const leaversForGa: {
        user: { username: string; avatar_url: string };
        leaver: Omit<GiveawayLeaver, 'giveaway'>;
      }[] = [];
      Object.entries(leavers).forEach(([username, leaverArr]) => {
        leaverArr.forEach((leaver) => {
          if (leaver.ga_link.startsWith(ga.id)) {
            const user = Object.values(users).find(
              (u) => u.username === username
            );
            if (user) {
              leaversForGa.push({
                user: {
                  username: user.username,
                  avatar_url: user.avatar_url,
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
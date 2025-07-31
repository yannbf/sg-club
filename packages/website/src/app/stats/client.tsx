'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Giveaway } from '@/types';
import { GiveawayLeaver } from '@/types/stats';
import GameImage from '@/components/GameImage';
import UserAvatar from '@/components/UserAvatar';
import Tooltip from '@/components/Tooltip';
import FormattedDate, { getFullDate } from '@/components/FormattedDate';

type GiveawayWithLeavers = Giveaway & {
  leavers: {
    user: { username: string; avatar_url: string };
    leaver: Omit<GiveawayLeaver, 'giveaway'>;
  }[];
};

type Props = {
  giveaways: GiveawayWithLeavers[];
};

export default function Client({ giveaways }: Props) {
  const [search, setSearch] = useState('');

  const filteredGiveaways = giveaways.filter((ga) => {
    const searchTerm = search.toLowerCase();
    const hasLeaver = ga.leavers.some((l) =>
      l.user.username.toLowerCase().includes(searchTerm)
    );
    return (
      ga.name.toLowerCase().includes(searchTerm) ||
      ga.id === search ||
      hasLeaver
    );
  });

  // sort giveaways by end date (ending soon first, then ended by end date)
  const sortedGiveaways = filteredGiveaways.sort((a, b) => {
    const aEnd = new Date(a.end_timestamp * 1000);
    const bEnd = new Date(b.end_timestamp * 1000);
    return bEnd.getTime() - aEnd.getTime();
  });

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Giveaway Leavers</h1>
      <input
        type="text"
        placeholder="Search for a giveaway name, id or username"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 p-2 border rounded w-full"
      />
      <div>
        {sortedGiveaways.map((ga) => (
          <div key={ga.id} className="mb-4 p-4 border rounded">
            <div className="flex items-center gap-4">
              <GameImage
                appId={String(ga.app_id)}
                name={ga.name}
              />
              <div>
                <h2 className="text-xl font-bold">
                  <Link
                    href={`https://steamgifts.com/giveaway/${ga.link}`}
                    className="text-blue-500 hover:underline"
                  >
                    {ga.name}
                  </Link>
                  <div className="flex items-center justify-between text-sm">
                    {ga.end_timestamp > Date.now() / 1000 ? (
                      <span className="text-muted-500">Ends  <FormattedDate timestamp={ga.end_timestamp} className="font-medium" /></span>
                    ) : (
                      <span className="text-muted-500">Ended <FormattedDate timestamp={ga.end_timestamp} className="font-medium" /></span>
                    )}
                    
                  </div>
                </h2>
                <div className="flex flex-wrap gap-4 mt-2">
                  {ga.leavers.map(({ user, leaver }) => (
                    <div key={user.username} className="flex items-center gap-2">
                      <UserAvatar
                        src={user.avatar_url}
                        username={user.username}
                      />
                      <div className="text-sm">
                        <Link
                          href={`/users/${user.username}`}
                          className="text-blue-500 hover:underline"
                        >
                          {user.username}
                        </Link>
                        <Tooltip
                          content={`Detected at: ${getFullDate(
                            leaver.leave_detected_at
                          )}`}
                        >
                          <p
                            className={
                              leaver.time_difference_hours < 24
                                ? 'text-red-500 font-bold'
                                : leaver.time_difference_hours < 48
                                ? 'text-yellow-500 font-bold'
                                : 'text-green-500 font-bold'
                            }>
                            {leaver.time_difference_hours}h
                          </p>
                        </Tooltip>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
} 
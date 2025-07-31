'use client';

import { GiveawayLeaver } from '@/types/stats';
import Link from 'next/link';
import GameImage from '@/components/GameImage';
import Tooltip from '@/components/Tooltip';
import { getFullDate } from '@/components/FormattedDate';

type Props = {
  leavers: GiveawayLeaver[];
};

export default function GiveawayLeaversClient({ leavers }: Props) {
  if (!leavers || leavers.length === 0) {
    return null;
  }
  return (
    <div className="mt-8">
      <h2 className="text-2xl font-bold mb-4">Giveaways Leaving Pattern</h2>
      <i className="text-sm text-muted-foreground">
        The leaving time is not precise. It is based on when it was detected.
      </i>
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mt-4">
        {leavers.map((leaver) => (
          <div key={leaver.ga_link} className="border rounded">
            {leaver.giveaway && (
              <div className="flex flex-col h-full">
                <GameImage
                  appId={String(leaver.giveaway.app_id)}
                  name={leaver.giveaway.name}
                />
                <div className="p-4 flex flex-col flex-grow">
                  <h2 className="text-lg font-bold flex-grow">
                    <Link
                      href={`https://steamgifts.com/giveaway/${leaver.ga_link}`}
                      className="text-blue-500 hover:underline"
                    >
                      {leaver.giveaway.name}
                    </Link>
                  </h2>
                  <Tooltip
                    content={`Detected at: ${getFullDate(
                      leaver.leave_detected_at
                    )}`}
                  >
                    <p
                      className={
                        leaver.time_difference_hours < 24
                          ? 'text-red-500'
                          : ''
                      }
                    >
                      {leaver.time_difference_hours} hours before end date
                    </p>
                  </Tooltip>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
} 
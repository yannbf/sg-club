import React from "react";
import Tooltip from "./Tooltip";
import { getFullDate } from "./FormattedDate";
import { differenceInDays } from "date-fns";
import {
  DEADLINE_WARNING_DAYS,
  requiredPlayDeadline,
} from "../../api/_lib/required-play";

type DeadlineStatusProps = {
  endTimestamp: number;           // Unix timestamp in seconds
  deadlineInMonths?: number;     // Defaults to 2 months if not provided
  tagLabel: string;              // e.g., 'PReq' or 'IpBro'
  deadline?: string;             // hand-entered, day-first (e.g. '31.12.2025')
  unreleased?: boolean;          // game isn't out yet — no deadline runs
  releaseDate?: string | null;   // Steam's announced release date, as displayed
};

export const DeadlineStatus: React.FC<DeadlineStatusProps> = ({
  endTimestamp,
  deadlineInMonths = 2,
  tagLabel,
  deadline,
  unreleased,
  releaseDate,
}) => {
  // A countdown on a game nobody can play yet is misinformation — the clock
  // only starts once it's out, so say that instead.
  if (unreleased) {
    return (
      <span className="text-xs text-muted-foreground">
        <code>{` | ${tagLabel}: unreleased${releaseDate ? ` (${releaseDate})` : ''}`}</code>
      </span>
    );
  }

  const { daysRemaining, deadlineDate } = getDeadlineData(endTimestamp, deadlineInMonths, deadline);

  const isExpired = daysRemaining < 0;
  const isCloseToExpiring = daysRemaining <= DEADLINE_WARNING_DAYS;

  const commonClass = 'text-xs';
  const textColorClass = isExpired
    ? 'text-error-foreground font-medium'
    : isCloseToExpiring
      ? 'text-accent-yellow font-medium'
      : 'text-muted-foreground';

  const content = isExpired
    ? ` | ${tagLabel}: expired ${Math.abs(daysRemaining)} day(s) ago`
    : ` | ${tagLabel}: ${daysRemaining} day(s) remaining`;

  return (
    <Tooltip content={getFullDate(deadlineDate.getTime() / 1000)}>
      <span className={`${commonClass} ${textColorClass}`}>
        <code>{content}</code>
      </span>
    </Tooltip>
  );
};

/**
 * Days left to fulfil a play requirement, plus the deadline itself. Deadline
 * maths lives in api/_lib/required-play.ts, shared with the scraper's warning
 * rules and the Discord handlers so all three agree on what a spreadsheet
 * deadline means.
 */
export const getDeadlineData = (endTimestamp: number, deadlineInMonths = 2, deadline?: string) => {
  const deadlineDate = requiredPlayDeadline({
    end_timestamp: endTimestamp,
    required_play_meta: { deadline, deadline_in_months: deadlineInMonths },
  });
  return { daysRemaining: differenceInDays(deadlineDate, new Date()), deadlineDate };
}

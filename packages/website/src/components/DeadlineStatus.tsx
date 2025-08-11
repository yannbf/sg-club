import React from "react";
import Tooltip from "./Tooltip";
import { getFullDate } from "./FormattedDate";

type DeadlineStatusProps = {
  endTimestamp: number;           // Unix timestamp in seconds
  deadlineInMonths?: number;     // Defaults to 2 months if not provided
  tagLabel: string;              // e.g., 'PReq' or 'IpBro'
};

export const DeadlineStatus: React.FC<DeadlineStatusProps> = ({
  endTimestamp,
  deadlineInMonths = 2,
  tagLabel,
}) => {
  const { daysRemaining, deadlineDate } = getDeadlineData(endTimestamp, deadlineInMonths);

  const isExpired = daysRemaining < 0;
  const isCloseToExpiring = daysRemaining <= 15;

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

export const getDeadlineData = (endTimestamp: number, deadlineInMonths = 2) => {
  const deadlineDate = new Date(endTimestamp * 1000);
  deadlineDate.setMonth(deadlineDate.getMonth() + (deadlineInMonths === 0 ? 2 : deadlineInMonths));

  const now = Date.now();
  const msRemaining = deadlineDate.getTime() - now;
  const daysRemaining = Math.floor(msRemaining / (1000 * 60 * 60 * 24));
  return { daysRemaining, deadlineDate };
}

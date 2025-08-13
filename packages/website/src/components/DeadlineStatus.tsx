import React from "react";
import Tooltip from "./Tooltip";
import { getFullDate } from "./FormattedDate";
import { addMonths, differenceInDays, fromUnixTime, parse } from "date-fns";

type DeadlineStatusProps = {
  endTimestamp: number;           // Unix timestamp in seconds
  deadlineInMonths?: number;     // Defaults to 2 months if not provided
  tagLabel: string;              // e.g., 'PReq' or 'IpBro'
  deadline?: string;             // e.g., '31.12.2025'
};

export const DeadlineStatus: React.FC<DeadlineStatusProps> = ({
  endTimestamp,
  deadlineInMonths = 2,
  tagLabel,
  deadline,
}) => {
  const { daysRemaining, deadlineDate } = getDeadlineData(endTimestamp, deadlineInMonths, deadline);

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

export const getDeadlineData = (endTimestamp: number, deadlineInMonths = 2, deadline?: string) => {
  if (deadline) {
    const deadlineDate = parse(deadline, 'dd.MM.yyyy', new Date());
    const now = new Date();
    const daysRemaining = differenceInDays(deadlineDate, now);
    return { daysRemaining, deadlineDate };
  }

  const deadlineDate = addMonths(fromUnixTime(endTimestamp), deadlineInMonths === 0 ? 2 : deadlineInMonths);
  const now = new Date();
  const daysRemaining = differenceInDays(deadlineDate, now);
  return { daysRemaining, deadlineDate };
}

import { Giveaway } from "@/types";
import Tooltip from "./Tooltip";

export const CvStatusIndicator = ({ giveaway }: { giveaway: Giveaway }) => {
  // Check for decreased ratio giveaways (highest priority)
  if (giveaway.decreased_ratio_info) {
    const tooltipContent = giveaway.decreased_ratio_info.notes
      ? giveaway.decreased_ratio_info.notes
      : "Decreased ratio giveaway";

    return (
      <Tooltip content={tooltipContent}>
        <span className="text-sm text-red-500 font-medium">***</span>
      </Tooltip>
    );
  }

  // Check for shared/whitelist/non-full CV giveaways
  if (giveaway.is_shared || giveaway.whitelist || giveaway.cv_status !== 'FULL_CV') {
    const tooltipContent = giveaway.cv_status !== 'FULL_CV'
      ? "Reduced CV giveaway"
      : "No CV/shared giveaway";

    return (
      <Tooltip content={tooltipContent}>
        <span className="text-sm text-red-500 font-medium">**</span>
      </Tooltip>
    );
  }

  return null;
}
import { Giveaway } from "@/types";

export const CvStatusIndicator = ({ giveaway }: { giveaway: any }) => {
  if (giveaway.is_shared || giveaway.whitelist || giveaway.cv_status !== 'FULL_CV') {
    return <span className="text-sm text-red-500 font-medium">**</span>
  }
  return null
}
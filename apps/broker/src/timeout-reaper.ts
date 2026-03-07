import { requeueTimedOutAssignedJobs } from "./dispatcher.js";

export const startTimeoutReaper = (
  timeoutSec: number,
  intervalMs: number,
  onRequeued?: (jobId: string) => void
) => {
  return setInterval(async () => {
    try {
      const requeued = await requeueTimedOutAssignedJobs(timeoutSec);
      requeued.forEach((id) => onRequeued?.(id));
    } catch (error) {
      console.error("[timeout-reaper] failed", error);
    }
  }, intervalMs);
};

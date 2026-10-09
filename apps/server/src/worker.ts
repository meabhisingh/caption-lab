import { env } from "@caption-generator/env/server";
import type { CaptionJob } from "@caption-generator/types";
import type { ProjectStore } from "./project-store";

export type CaptionJobs = {
  enqueue: (job: CaptionJob, options?: { jobId?: string }) => Promise<void>;
  close: () => Promise<void>;
};

export const startCaptionWorker = async (
  store: ProjectStore,
): Promise<CaptionJobs> => {
  if (env.CAPTIONLAB_RUNTIME === "desktop") {
    const { startLocalCaptionQueue } = await import("./local-queue");
    return startLocalCaptionQueue(store);
  }
  const { startRedisCaptionQueue } = await import("./redis-worker");
  return startRedisCaptionQueue(store, env.REDIS_URL, env.WORKER_CONCURRENCY);
};

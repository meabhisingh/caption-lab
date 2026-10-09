import {
  CAPTION_QUEUE_NAME,
  createCaptionQueue,
  enqueueCaptionJob,
} from "@caption-generator/queue";
import type { CaptionJob } from "@caption-generator/types";
import { Worker } from "bullmq";
import type { ProjectStore } from "./project-store";
import { runCaptionJob } from "./processor";

export const startRedisCaptionQueue = (
  store: ProjectStore,
  redisUrl: string,
  concurrency: number,
) => {
  const queue = createCaptionQueue(redisUrl);
  const worker = new Worker<CaptionJob>(
    CAPTION_QUEUE_NAME,
    async (job) => {
      await runCaptionJob(store, job.data);
    },
    {
      connection: { url: redisUrl, maxRetriesPerRequest: null },
      concurrency,
    },
  );

  worker.on("failed", (job, error) => {
    const projectId = job?.data.projectId;
    if (!projectId || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    void store
      .update(projectId, {
        status: "FAILED",
        error: error.message.slice(0, 1_000),
      })
      .catch(() => undefined);
  });

  return {
    enqueue: (job: CaptionJob, options?: { jobId?: string }) =>
      enqueueCaptionJob(queue, job, options).then(() => undefined),
    close: async () => {
      await Promise.all([worker.close(), queue.close()]);
    },
  };
};

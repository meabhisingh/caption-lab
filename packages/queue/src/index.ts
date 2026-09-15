import type { CaptionJob } from "@caption-generator/types";
import { Queue, type JobsOptions } from "bullmq";

export const CAPTION_QUEUE_NAME = "caption-processing";

export const createCaptionQueue = (redisUrl: string) =>
  new Queue<CaptionJob>(CAPTION_QUEUE_NAME, {
    connection: { url: redisUrl, maxRetriesPerRequest: null },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: 100,
      removeOnFail: 250,
    },
  });

export const enqueueCaptionJob = (
  queue: Queue<CaptionJob>,
  job: CaptionJob,
  options?: JobsOptions,
) => queue.add(job.kind, job, options);

export type { CaptionJob } from "@caption-generator/types";

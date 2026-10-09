import { randomUUID } from "node:crypto";
import { env } from "@caption-generator/env/server";
import type { CaptionJob } from "@caption-generator/types";
import type { SQLOutputValue } from "node:sqlite";
import type { ProjectStore } from "./project-store";
import { runCaptionJob } from "./processor";
import { getLocalDatabase } from "./sqlite";

type LocalJob = {
  id: string;
  kind: CaptionJob["kind"];
  projectId: string;
  attempts: number;
  maxAttempts: number;
};

const text = (value: SQLOutputValue | undefined) =>
  typeof value === "string" ? value : null;

const integer = (value: SQLOutputValue | undefined) => {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return 0;
};

const claimJob = (): LocalJob | null => {
  const database = getLocalDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    const row = database
      .prepare(
        `SELECT id, kind, project_id, attempts, max_attempts
         FROM caption_job
         WHERE status = 'queued' AND available_at <= ?
         ORDER BY created_at
         LIMIT 1`,
      )
      .get(Date.now());
    if (!row) {
      database.exec("COMMIT");
      return null;
    }
    const id = text(row.id);
    const kind = text(row.kind);
    const projectId = text(row.project_id);
    if (!id || (kind !== "transcribe" && kind !== "export") || !projectId) {
      throw new Error("Queued caption job is invalid.");
    }
    const attempts = integer(row.attempts) + 1;
    database
      .prepare(
        "UPDATE caption_job SET status = 'active', attempts = ? WHERE id = ?",
      )
      .run(attempts, id);
    database.exec("COMMIT");
    return {
      id,
      kind,
      projectId,
      attempts,
      maxAttempts: integer(row.max_attempts) || 3,
    };
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // The transaction was already closed or never opened.
    }
    throw error;
  }
};

export const startLocalCaptionQueue = (store: ProjectStore) => {
  const database = getLocalDatabase();
  database
    .prepare(
      "UPDATE caption_job SET status = 'queued', available_at = ? WHERE status = 'active'",
    )
    .run(Date.now());

  let active = 0;
  let stopped = false;
  const concurrency = env.WORKER_CONCURRENCY;

  const failJob = async (job: LocalJob, error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Processing failed";
    const detail = message.slice(0, 1_000);
    if (job.attempts >= job.maxAttempts) {
      database
        .prepare(
          "UPDATE caption_job SET status = 'failed', last_error = ? WHERE id = ?",
        )
        .run(detail, job.id);
      await store
        .update(job.projectId, { status: "FAILED", error: detail })
        .catch(() => undefined);
      return;
    }
    const delay = 2_000 * 2 ** Math.max(0, job.attempts - 1);
    database
      .prepare(
        `UPDATE caption_job
         SET status = 'queued', available_at = ?, last_error = ?
         WHERE id = ?`,
      )
      .run(Date.now() + delay, detail, job.id);
  };

  const tick = () => {
    if (stopped) return;
    while (active < concurrency) {
      const job = claimJob();
      if (!job) return;
      active += 1;
      void runCaptionJob(store, { kind: job.kind, projectId: job.projectId })
        .then(() => {
          database
            .prepare(
              "UPDATE caption_job SET status = 'completed', last_error = NULL WHERE id = ?",
            )
            .run(job.id);
        })
        .catch((error: unknown) => failJob(job, error))
        .finally(() => {
          active -= 1;
          tick();
        });
    }
  };

  const timer = setInterval(tick, 400);
  tick();

  return {
    enqueue: async (job: CaptionJob, options?: { jobId?: string }) => {
      const id = options?.jobId ?? randomUUID();
      const existing = database
        .prepare("SELECT status FROM caption_job WHERE id = ?")
        .get(id);
      const status = text(existing?.status);
      if (
        status === "queued" ||
        status === "active" ||
        status === "completed"
      ) {
        return;
      }
      const now = Date.now();
      if (status === "failed") {
        database
          .prepare(
            `UPDATE caption_job
             SET kind = ?, project_id = ?, attempts = 0, status = 'queued',
                 available_at = ?, last_error = NULL
             WHERE id = ?`,
          )
          .run(job.kind, job.projectId, now, id);
      } else {
        database
          .prepare(
            `INSERT INTO caption_job (
              id, kind, project_id, attempts, max_attempts, status, available_at, created_at
            ) VALUES (?, ?, ?, 0, 3, 'queued', ?, ?)`,
          )
          .run(id, job.kind, job.projectId, now, now);
      }
      tick();
    },
    close: async () => {
      stopped = true;
      clearInterval(timer);
      while (active > 0) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
  };
};

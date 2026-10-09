import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const shared = {
  GROQ_API_KEY: z.string().min(1),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8),
  REMOTION_GL: z.enum(["angle"]).optional(),
  REMOTION_ENTRY_POINT: z.string().min(1).optional(),
  REMOTION_BROWSER_EXECUTABLE: z.string().min(1).optional(),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.url().default("http://localhost:3000"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
};

const serverEnv = () =>
  createEnv({
    server: {
      ...shared,
      CAPTIONLAB_RUNTIME: z.literal("server").default("server"),
      WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
      DATABASE_URL: z.string().min(1),
      REDIS_URL: z.url(),
      AWS_ACCESS_KEY: z.string().min(1),
      AWS_SECRET_KEY: z.string().min(1),
      STORAGE_REGION: z.string().min(1),
      STORAGE_BUCKET: z.string().min(1),
    },
    runtimeEnv: process.env,
    skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
    emptyStringAsUndefined: true,
  });

const desktopEnv = () =>
  createEnv({
    server: {
      ...shared,
      CAPTIONLAB_RUNTIME: z.literal("desktop"),
      WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
      CAPTIONLAB_DATA_DIR: z.string().min(1),
    },
    runtimeEnv: process.env,
    skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
    emptyStringAsUndefined: true,
  });

export const env =
  process.env.CAPTIONLAB_RUNTIME === "desktop" ? desktopEnv() : serverEnv();

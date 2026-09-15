import { env } from "@caption-generator/env/server";
import { Redis } from "ioredis";

const redis = new Redis(env.REDIS_URL, {
	maxRetriesPerRequest: null,
});

export { redis };
export type IORedis = typeof redis;

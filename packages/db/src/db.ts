import { env } from "@caption-generator/env/server";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";

/**
 * node-pg (pg-connection-string ≥2.14) treats bare `sslmode=require` as
 * verify-certs unless `uselibpqcompat=true`. Prisma Postgres URLs ship with
 * `sslmode=require` and expect encrypt-without-verify, so align with libpq.
 */
function toPgConnectionString(connectionString: string) {
	const url = new URL(connectionString);
	if (
		url.searchParams.get("sslmode") === "require" &&
		!url.searchParams.has("uselibpqcompat")
	) {
		url.searchParams.set("uselibpqcompat", "true");
	}
	return url.toString();
}

const adapter = new PrismaPg({
	connectionString: toPgConnectionString(env.DATABASE_URL),
});
const prisma = new PrismaClient({ adapter });

export { prisma };

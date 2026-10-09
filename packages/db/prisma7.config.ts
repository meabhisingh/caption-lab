import { env } from "@caption-generator/env/server";
import { defineConfig } from "prisma/config";

if (env.CAPTIONLAB_RUNTIME !== "server") {
  throw new Error("DATABASE_URL is required to run Prisma.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env.DATABASE_URL,
  },
});

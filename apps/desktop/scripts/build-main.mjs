import { build } from "esbuild";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const desktopDirectory = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(desktopDirectory, "dist");

await rm(outputDirectory, { recursive: true, force: true });

await Promise.all([
  build({
    entryPoints: [resolve(desktopDirectory, "src/main.ts")],
    outfile: resolve(outputDirectory, "main.js"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external: ["electron"],
    sourcemap: true,
  }),
  build({
    entryPoints: [resolve(desktopDirectory, "src/preload.ts")],
    outfile: resolve(outputDirectory, "preload.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    external: ["electron"],
    sourcemap: true,
  }),
]);

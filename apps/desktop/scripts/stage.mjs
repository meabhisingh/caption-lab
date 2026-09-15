import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const desktopDirectory = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(desktopDirectory, "../..");
const stageDirectory = resolve(desktopDirectory, "stage");
const webStage = resolve(stageDirectory, "web");
const backendStage = resolve(stageDirectory, "backend");
const pnpmCli = process.env.npm_execpath;

if (!pnpmCli) {
  throw new Error("Run this script through pnpm so npm_execpath is available.");
}

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
};

const runPnpm = (args, options = {}) =>
  run(process.execPath, [pnpmCli, ...args], options);

const findBrowserExecutable = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findBrowserExecutable(path);
      if (nested) return nested;
    } else if (/^chrome-headless-shell(?:\.exe)?$/i.test(entry.name)) {
      return path;
    }
  }
  return null;
};

await rm(stageDirectory, { recursive: true, force: true });
await mkdir(stageDirectory, { recursive: true });

runPnpm(["--filter", "web", "build"], {
  env: {
    ...process.env,
    NEXT_PUBLIC_SERVER_URL: "http://127.0.0.1:43111",
  },
});

runPnpm([
  "--config.node-linker=hoisted",
  "--filter",
  "web",
  "deploy",
  "--prod",
  webStage,
  "--legacy",
]);

const standaloneWeb = resolve(
  repositoryRoot,
  "apps/web/.next/standalone/apps/web",
);
await cp(resolve(standaloneWeb, "server.js"), resolve(webStage, "server.js"));
await cp(resolve(standaloneWeb, ".next"), resolve(webStage, ".next"), {
  recursive: true,
  dereference: true,
});
await mkdir(resolve(webStage, ".next"), { recursive: true });
await cp(
  resolve(repositoryRoot, "apps/web/.next/static"),
  resolve(webStage, ".next/static"),
  { recursive: true },
);
await cp(
  resolve(repositoryRoot, "apps/web/public"),
  resolve(webStage, "public"),
  { recursive: true },
);

runPnpm([
  "--config.node-linker=hoisted",
  "--filter",
  "server",
  "deploy",
  "--prod",
  backendStage,
  "--legacy",
]);

const remotionCli = resolve(
  backendStage,
  "node_modules/@remotion/cli/remotion-cli.js",
);
run(process.execPath, [remotionCli, "browser", "ensure"], {
  cwd: backendStage,
});

const browserRoot = resolve(backendStage, "node_modules/.remotion");
const browserExecutable = await findBrowserExecutable(browserRoot);
if (!browserExecutable) {
  throw new Error(`Could not find Remotion browser below ${browserRoot}`);
}

await writeFile(
  resolve(backendStage, "captionlab-runtime.json"),
  `${JSON.stringify(
    {
      browserExecutable: relative(backendStage, browserExecutable),
      platform: process.platform,
      architecture: process.arch,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);

console.log(
  `Desktop resources staged in ${basename(stageDirectory)} for ${process.platform}-${process.arch}`,
);

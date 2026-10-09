import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const child = spawn(
  pnpm,
  ["--filter", "web", "dev", "--hostname", "127.0.0.1", "--port", "43110"],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      NEXT_PUBLIC_SERVER_URL: "http://127.0.0.1:43111",
    },
    stdio: "inherit",
    shell: process.platform === "win32",
    windowsHide: true,
  },
);

const stop = () => {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], {
      stdio: "ignore",
    });
    return;
  }
  child.kill("SIGTERM");
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("exit", stop);
child.on("exit", (code) => {
  process.exit(code ?? 0);
});

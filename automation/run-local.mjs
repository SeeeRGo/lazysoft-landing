import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(resolve(root, ".local/request-worker"), { recursive: true, mode: 0o700 });
// OS-owned lock is released after crashes; overlapping timers cannot refresh the same session.
const child = spawn("flock", ["--nonblock", "--conflict-exit-code", "75", resolve(root, ".local/request-worker/run.lock"), process.execPath,
  `--env-file-if-exists=${process.env.REQUEST_WORKER_ENV_FILE || ".env.automation"}`, "automation/worker.mjs", ...process.argv.slice(2)], { cwd: root, stdio: "inherit", env: { ...process.env, PATH: `${resolve(root, ".local/aws-cli/bin")}:${process.env.PATH || "/usr/bin:/bin"}` } });
child.on("error", () => { console.error("Cannot start local worker; Linux flock is required."); process.exitCode = 1; });
child.on("exit", code => {
  if (code === 75) console.log("Local worker is already running; skipped.");
  process.exitCode = code === 75 ? 0 : (code ?? 1);
});

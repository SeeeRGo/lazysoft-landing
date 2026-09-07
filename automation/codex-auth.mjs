import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";

export async function codexAuth(env = process.env) {
  const mode = env.CODEX_AUTH_MODE || "api-key";
  if (mode === "api-key") {
    if (!env.CODEX_API_KEY) throw new Error("Missing CODEX_API_KEY");
    return { mode, dockerArgs: ["--tmpfs", `/home/node/.codex:uid=${process.getuid?.() ?? 1000},gid=${process.getgid?.() ?? 1000}`, "-e", "CODEX_API_KEY"], env: { CODEX_API_KEY: env.CODEX_API_KEY } };
  }
  if (mode !== "chatgpt") throw new Error("Invalid CODEX_AUTH_MODE");
  const directory = env.CODEX_AUTH_DIR;
  if (!directory || !isAbsolute(directory) || directory.includes(",")) throw new Error("CODEX_AUTH_DIR must be an absolute dedicated directory");
  const info = await lstat(directory);
  const file = await lstat(join(directory, "auth.json"));
  if (!info.isDirectory() || info.isSymbolicLink() || !file.isFile() || file.isSymbolicLink() || (info.mode & 0o077) || (file.mode & 0o077)) throw new Error("Codex auth requires a private directory (700) and auth.json (600), without symlinks");
  let auth;
  try { auth = JSON.parse(await readFile(join(directory, "auth.json"), "utf8")); }
  catch { throw new Error("Cannot read Codex authorization"); }
  if (auth.auth_mode !== "chatgpt" || !auth.tokens?.access_token || !auth.tokens?.refresh_token) throw new Error("Saved ChatGPT authorization not found; sign in with Codex first");
  return { mode, directory: resolve(directory), dockerArgs: ["--mount", `type=bind,src=${directory},dst=/home/node/.codex`], env: {} };
}

export function assertAuthOutsideWorkspace(auth, project, output) {
  if (!auth.directory) return;
  for (const path of [project, output]) {
    const root = resolve(path);
    if (auth.directory === root || auth.directory.startsWith(root + sep) || root.startsWith(auth.directory + sep)) throw new Error("Codex authorization must be separate from generated artifacts");
  }
}

import { chmod, copyFile, mkdir, readFile, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";

const source = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "auth.json");
const directory = resolve(".local/request-worker/auth");
const destination = join(directory, "auth.json");
try {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).isSymbolicLink()) throw new Error("Unsafe auth directory");
  await chmod(directory, 0o700);
  let auth;
  try { auth = JSON.parse(await readFile(source, "utf8")); }
  catch { throw new Error("Saved file authorization unavailable. Run codex login first."); }
  if (auth.auth_mode !== "chatgpt" || !auth.tokens?.access_token || !auth.tokens?.refresh_token) throw new Error("ChatGPT login required");
  // Never overwrite refreshed worker credentials with an older desktop session.
  await copyFile(source, destination, constants.COPYFILE_EXCL);
  await chmod(destination, 0o600);
  console.log("Saved ChatGPT authorization prepared in private local worker directory. No credentials printed.");
} catch (error) {
  console.error(error.code === "EEXIST" ? "Worker authorization already exists; preserved without changes." : error.message);
  process.exitCode = error.code === "EEXIST" ? 0 : 1;
}

import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexAuth, assertAuthOutsideWorkspace } from "../automation/codex-auth.mjs";

describe("local Codex authentication", () => {
  it("requires an API key only in API mode", async () => {
    await expect(codexAuth({})).rejects.toThrow("Missing CODEX_API_KEY");
    expect((await codexAuth({ CODEX_API_KEY: "fake-test-key" })).mode).toBe("api-key");
    await expect(codexAuth({ CODEX_AUTH_MODE: "unknown" })).rejects.toThrow("Invalid");
  });
  it("mounts persistent chatgpt authorization without exposing inherited API keys", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-auth-test-"));
    const directory = join(root, "auth");
    await mkdir(directory, { mode: 0o700 });
    await writeFile(join(directory, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "fake-access", refresh_token: "fake-refresh" } }), { mode: 0o600 });
    const auth = await codexAuth({ CODEX_AUTH_MODE: "chatgpt", CODEX_AUTH_DIR: directory, CODEX_API_KEY: "must-not-forward" });
    expect(auth.env).toEqual({});
    expect(auth.dockerArgs).toEqual(["--mount", `type=bind,src=${directory},dst=/home/node/.codex`]);
    expect(JSON.stringify(auth)).not.toContain("fake-access");
    expect(() => assertAuthOutsideWorkspace(auth, root, "/tmp/output")).toThrow("separate");
    expect(() => assertAuthOutsideWorkspace(auth, "/tmp/demo-test", "/tmp/output")).not.toThrow();
    await chmod(join(directory, "auth.json"), 0o644);
    await expect(codexAuth({ CODEX_AUTH_MODE: "chatgpt", CODEX_AUTH_DIR: directory })).rejects.toThrow("private");
  });
});

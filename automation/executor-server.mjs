import { createServer } from "node:http";
import { runOnce } from "./worker.mjs";

const port = Number(process.env.PORT || 8080);
const secret = process.env.AUTOMATION_WORKER_SECRET || "";
const maxBody = 4096;

function json(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

async function body(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBody) throw new Error("Payload too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") return json(response, 200, { ok: true });
  if (request.method !== "POST" || request.url !== "/generate") return json(response, 404, { error: "Not found" });
  if (!secret || request.headers["x-lazysoft-executor-token"] !== secret) return json(response, 401, { error: "Unauthorized" });
  try {
    const payload = await body(request);
    const requestId = typeof payload.requestId === "string" && /^#[a-f0-9]{8}$/i.test(payload.requestId) ? payload.requestId : "";
    const jobId = typeof payload.jobId === "string" && /^[A-Za-z0-9_-]{10,80}$/.test(payload.jobId) ? payload.jobId : "";
    if (!requestId || !jobId) return json(response, 400, { error: "Invalid job scope" });
    const worked = await runOnce({ requestId, jobId });
    return json(response, 200, { ok: true, worked });
  } catch (error) {
    console.error("Executor request failed", error instanceof Error ? error.message : "Unknown error");
    return json(response, 500, { error: "Generation failed" });
  }
}).listen(port, "0.0.0.0", () => console.log(`Generation executor listening on ${port}`));

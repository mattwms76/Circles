import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import http from "node:http";

const port = Number(process.env.SYNTHETIC_PORT);
const mode = process.env.SYNTHETIC_MODE ?? "healthy";
const stateFile = process.env.SYNTHETIC_STATE_FILE ?? "";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  process.exitCode = 64;
} else if (mode === "immediateCrash") {
  process.exit(1);
} else {
  if (process.env.SYNTHETIC_WRITE_SECRET) {
    // The supervisor must ignore raw child stderr, even when it contains a synthetic secret.
    process.stderr.write(`${process.env.SYNTHETIC_WRITE_SECRET}\n`);
  }

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (mode === "hang" && pathname === "/api/health") return;
    if (pathname === "/api/health") {
      const healthStatus = mode === "health500" ? 500 : 200;
      response.writeHead(healthStatus, { "content-type": "application/json" });
      response.end(healthStatus === 500 ? '{"ok":false}' : '{"ok":true}');
      return;
    }
    if (pathname === "/api/ready") {
      response.writeHead(mode === "ready503" ? 503 : 200, {
        "content-type": "application/json",
      });
      response.end(mode === "ready503" ? '{"ok":false}' : '{"ok":true}');
      return;
    }
    response.writeHead(404).end();
  });

  server.listen(port, "127.0.0.1", async () => {
    if (mode === "flaky" && stateFile && !existsSync(stateFile)) {
      await writeFile(stateFile, "first-generation-crashed\n", { mode: 0o600 });
      setTimeout(() => process.exit(17), 100);
    }
    if (mode === "crash") setTimeout(() => process.exit(17), 50);
  });

  const close = () => server.close(() => process.exit(0));
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
}

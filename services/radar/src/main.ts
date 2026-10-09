import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { WorkerPool, startEngine } from "./workers.ts";
import { createServer } from "./server.ts";
const sites = JSON.parse(
  readFileSync(
    new URL("../../../engine/data/sites.json", import.meta.url),
    "utf8",
  ),
).sites;
const origins = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const binary = process.env.OMASTORM_ENGINE ?? "/usr/local/bin/omastorm-engine";
const state = resolve(process.env.RADAR_STATE_DIR ?? "./state");
const pool = new WorkerPool({
  sites: sites.map((s: { id: string }) => s.id),
  start: startEngine(binary, state),
});
const server = createServer({ pool, sites, origins });
const reaper = setInterval(() => pool.reap(), 60000);
reaper.unref();
server.listen(Number(process.env.PORT ?? 8080), "0.0.0.0", () =>
  console.log("Omastorm radar service listening"),
);
function shutdown() {
  clearInterval(reaper);
  pool.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000).unref();
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

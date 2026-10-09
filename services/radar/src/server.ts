import { createServer as httpServer } from "node:http";
import { readAsset, readCatalog, readFrame, ServiceError } from "./catalog.ts";
import type { WorkerPool } from "./workers.ts";
import type { Station } from "../../../web/src/radar/model.ts";
export function createServer({
  pool,
  sites,
  origins,
}: {
  pool: WorkerPool;
  sites: Station[];
  origins: string[];
}) {
  const rates = new Map<string, { start: number; count: number }>();
  const allowed = new Set(sites.map((s) => s.id));
  return httpServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Vary", "Origin");
    const origin = req.headers.origin;
    try {
      if (origin && !origins.includes(origin))
        throw new ServiceError("Origin is not allowed", 403);
      if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.writeHead(204).end();
        return;
      }
      if (req.method !== "GET")
        throw new ServiceError("Read-only radar service", 405);
      const key = req.socket.remoteAddress ?? "unknown",
        now = Date.now();
      for (const [id, entry] of rates)
        if (now - entry.start >= 60000) rates.delete(id);
      let rate = rates.get(key);
      if (!rate) {
        if (rates.size >= 10000) throw new ServiceError("Service busy", 503);
        rate = { start: now, count: 0 };
        rates.set(key, rate);
      }
      if (++rate.count > 120) {
        res.setHeader("Retry-After", "60");
        throw new ServiceError("Too many requests. Retry in a minute.", 429);
      }
      const url = new URL(req.url ?? "/", "http://local"),
        p = url.pathname;
      if (p === "/health") {
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      if (p === "/v1/stations") {
        res.end(JSON.stringify({ sites, attribution: "NOAA NEXRAD" }));
        return;
      }
      if (p === "/v1/places") {
        const q = url.searchParams.get("q")?.trim() ?? "";
        if (!q || q.length > 120)
          throw new ServiceError("Search needs 1–120 characters", 400);
        const worker = await pool.get("KTLX");
        const results = await worker.search?.(q);
        res.end(
          JSON.stringify({ results: results ?? [], attribution: "GeoNames" }),
        );
        return;
      }
      const match = p.match(
        /^\/v1\/stations\/([^/]+)\/frames(?:\/([^/]+)(?:\/assets\/(sweep|azimuth-lut))?)?$/,
      );
      if (!match) throw new ServiceError("Resource not found", 404);
      const station = match[1];
      if (!allowed.has(station)) throw new ServiceError("Unknown station", 400);
      let id: string | undefined;
      try {
        id = match[2] ? decodeURIComponent(match[2]) : undefined;
      } catch {
        throw new ServiceError("Invalid frame id", 400);
      }
      if (id && !/^[A-Za-z0-9._-]{1,160}$/.test(id))
        throw new ServiceError("Invalid frame id", 400);
      const worker = await pool.get(station);
      if (!id) {
        res.end(
          JSON.stringify({
            station,
            health: worker.health,
            frames: readCatalog(worker.cacheDir, station),
          }),
        );
        return;
      }
      if (match[3]) {
        const bytes = readAsset(worker.cacheDir, station, id, match[3]);
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "public, max-age=60");
        res.setHeader("Content-Length", bytes.length);
        res.end(bytes);
        return;
      }
      res.end(JSON.stringify(readFrame(worker.cacheDir, station, id)));
    } catch (e) {
      const err = e as ServiceError;
      res
        .writeHead(err.status ?? 503)
        .end(
          JSON.stringify({
            message: err.status
              ? err.message
              : "Radar service is unavailable. Try again shortly.",
          }),
        );
    }
  });
}

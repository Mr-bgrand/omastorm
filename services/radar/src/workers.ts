import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, openSync, closeSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { ServiceError } from "./catalog.ts";
import type { Health } from "../../../web/src/radar/model.ts";
export type Worker = {
  station: string;
  cacheDir: string;
  health: Health;
  closed?: boolean;
  search?: (q: string) => Promise<unknown[]>;
  close: () => void;
};
type Options = {
  sites: string[];
  limit?: number;
  idleMs?: number;
  startupMs?: number;
  now?: () => number;
  start: (station: string, signal: AbortSignal) => Promise<Worker>;
};
export class WorkerPool {
  private options: Options;
  private workers = new Map<string, { value: Worker; used: number }>();
  private pending = new Map<string, Promise<Worker>>();
  private controllers = new Set<AbortController>();
  private stopped = false;
  constructor(options: Options) {
    this.options = options;
  }
  get size() {
    return this.workers.size + this.pending.size;
  }
  async get(station: string): Promise<Worker> {
    if (this.stopped) throw new ServiceError("Service is shutting down", 503);
    if (!this.options.sites.includes(station))
      throw new ServiceError("Unknown station", 400);
    const existing = this.workers.get(station);
    if (existing && !existing.value.closed) {
      existing.used = this.now();
      return existing.value;
    }
    if (existing) {
      existing.value.close();
      this.workers.delete(station);
    }
    const pending = this.pending.get(station);
    if (pending) return pending;
    const limit = this.options.limit ?? 4;
    if (this.size >= limit) {
      const oldest = [...this.workers.entries()].sort(
        (a, b) => a[1].used - b[1].used,
      )[0];
      if (!oldest)
        throw new ServiceError(
          "Radar service is busy. Try again shortly.",
          503,
        );
      oldest[1].value.close();
      this.workers.delete(oldest[0]);
    }
    const controller = new AbortController();
    this.controllers.add(controller);
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ServiceError("Radar worker startup timeout", 503));
      }, this.options.startupMs ?? 10000);
    });
    const start = this.options
      .start(station, controller.signal)
      .then((value) => {
        if (controller.signal.aborted || this.stopped) {
          value.close();
          throw new ServiceError("Radar worker startup cancelled", 503);
        }
        return value;
      });
    const task = Promise.race([start, timeout])
      .then((value) => {
        this.workers.set(station, { value, used: this.now() });
        return value;
      })
      .finally(() => {
        clearTimeout(timer);
        this.pending.delete(station);
        this.controllers.delete(controller);
      });
    this.pending.set(station, task);
    return task;
  }
  private now() {
    return this.options.now?.() ?? Date.now();
  }
  reap() {
    for (const [id, w] of this.workers)
      if (
        w.value.closed ||
        this.now() - w.used >= (this.options.idleMs ?? 600000)
      ) {
        w.value.close();
        this.workers.delete(id);
      }
  }
  close() {
    this.stopped = true;
    for (const c of this.controllers) c.abort();
    for (const w of this.workers.values()) w.value.close();
    this.workers.clear();
  }
}
export function startEngine(
  binary: string,
  stateRoot: string,
  archive?: string,
) {
  return async (station: string, signal: AbortSignal): Promise<Worker> => {
    const base = resolve(stateRoot, station),
      runtime = mkdtempSync(join(tmpdir(), "oma-")),
      cache = join(base, "cache");
    mkdirSync(runtime, { recursive: true, mode: 0o700 });
    mkdirSync(cache, { recursive: true, mode: 0o700 });
    const env: Record<string, string | undefined> = {
      ...process.env,
      XDG_RUNTIME_DIR: runtime,
      XDG_CACHE_HOME: cache,
    };
    delete env.OMASTORM_ARCHIVE;
    if (archive) env.OMASTORM_ARCHIVE = archive;
    const log = openSync(join(base, "engine.log"), "a", 0o600),
      child = spawn(binary, ["serve"], { env, stdio: ["ignore", log, log] });
    closeSync(log);
    let socket: ReturnType<typeof createConnection> | null = null;
    let retry: NodeJS.Timeout | undefined;
    let done = false;
    let rejectStart: (e: Error) => void;
    const searches = new Map<
      string,
      {
        resolve: (a: unknown[]) => void;
        reject: (e: Error) => void;
        timer: NodeJS.Timeout;
      }
    >();
    const worker: Worker = {
      station,
      cacheDir: join(cache, "omastorm", "frames"),
      health: "loading",
      close() {
        if (worker.closed) return;
        worker.closed = true;
        clearTimeout(retry);
        socket?.destroy();
        child.kill("SIGTERM");
        const timer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null)
            child.kill("SIGKILL");
        }, 2000);
        timer.unref();
        for (const q of searches.values()) {
          clearTimeout(q.timer);
          q.reject(new ServiceError("Radar worker closed", 503));
        }
        searches.clear();
      },
      search(q) {
        if (!socket || worker.closed)
          return Promise.reject(
            new ServiceError("Radar search unavailable", 503),
          );
        const previous = searches.get(q);
        if (previous)
          return Promise.reject(
            new ServiceError("Search already pending. Retry.", 503),
          );
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            searches.delete(q);
            reject(new ServiceError("Place search timeout", 503));
          }, 3000);
          searches.set(q, { resolve, reject, timer });
          socket!.write(
            JSON.stringify({ type: "search_places", query: q }) + "\n",
          );
        });
      },
    };
    function fail(e: Error) {
      worker.health = "offline";
      worker.close();
      if (!done) {
        done = true;
        rejectStart(e);
      }
    }
    child.on("error", fail);
    child.on("exit", () => {
      rmSync(runtime, { recursive: true, force: true });
      fail(new ServiceError("Radar engine stopped", 503));
    });
    signal.addEventListener(
      "abort",
      () => fail(new ServiceError("Radar startup cancelled", 503)),
      { once: true },
    );
    return new Promise<Worker>((resolveStart, reject) => {
      rejectStart = reject;
      function connect() {
        if (signal.aborted || worker.closed) return;
        socket = createConnection(join(runtime, "omastorm", "engine.sock"));
        const current = socket;
        current.once("error", () => {
          current.destroy();
          if (!done) retry = setTimeout(connect, 100);
          else fail(new ServiceError("Radar connection lost", 503));
        });
        const lines = createInterface({ input: current, crlfDelay: Infinity });
        lines.on("error", () => {});
        lines.on("line", (line) => {
          if (line.length > 512 * 1024) {
            fail(new ServiceError("Radar message exceeds limit", 503));
            return;
          }
          try {
            const m = JSON.parse(line);
            if (m.v !== 2) {
              fail(new ServiceError("Incompatible radar protocol", 503));
              return;
            }
            if (m.type === "hello" && !done) {
              done = true;
              current.write(
                JSON.stringify({ type: "select_site", id: station }) + "\n",
              );
              resolveStart(worker);
            }
            if (m.type === "state")
              worker.health = m.connection?.status ?? "loading";
            if (m.type === "places") {
              const item = searches.get(m.query);
              if (item) {
                clearTimeout(item.timer);
                searches.delete(m.query);
                item.resolve(m.results);
              }
            }
          } catch {
            fail(new ServiceError("Malformed radar message", 503));
          }
        });
        current.once("close", () => {
          lines.close();
          if (done && !worker.closed)
            fail(new ServiceError("Radar connection lost", 503));
        });
      }
      connect();
    });
  };
}

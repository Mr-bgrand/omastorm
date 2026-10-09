import { createServer as unixServer } from "node:net";
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const golden = JSON.parse(
  readFileSync("../../web/public/fixtures/ktlx-20130520/frame.json", "utf8"),
);
test("catalog retains completed scans and returnsGoneForEvictedFrame", async () => {
  const { readCatalog, readAsset } = await import("../src/catalog.ts");
  const dir = mkdtempSync(join(tmpdir(), "radar-test-"));
  try {
    mkdirSync(join(dir, "KTLX"));
    const db = new DatabaseSync(join(dir, "catalog.sqlite"));
    db.exec(
      "CREATE TABLE frames(id TEXT,site TEXT,start_ms INTEGER,frame TEXT,texture TEXT,azimuth_lut TEXT)",
    );
    const id = golden.id;
    db.prepare("INSERT INTO frames VALUES(?,?,?,?,?,?)").run(
      id,
      "KTLX",
      Date.now(),
      JSON.stringify({ ...golden, kind: "polar", texture: "", azimuthLut: "" }),
      "KTLX/a.png",
      "KTLX/l.png",
    );
    writeFileSync(
      join(dir, "KTLX/a.png"),
      readFileSync("../../web/public/fixtures/ktlx-20130520/sweep.png"),
    );
    writeFileSync(
      join(dir, "KTLX/l.png"),
      readFileSync("../../web/public/fixtures/ktlx-20130520/lut.png"),
    );
    assert.equal(readCatalog(dir, "KTLX").length, 1);
    assert.ok(readAsset(dir, "KTLX", id, "sweep").length > 0);
    rmSync(join(dir, "KTLX/a.png"));
    assert.throws(() => readAsset(dir, "KTLX", id, "sweep"), /expired/);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("rejectsTraversal and cross-station assets", async () => {
  const { safeAssetPath } = await import("../src/catalog.ts");
  assert.throws(
    () => safeAssetPath("/tmp/root", "KTLX", "../secrets"),
    /Invalid/,
  );
  assert.throws(
    () => safeAssetPath("/tmp/root", "KTLX", "KIWA/a.png"),
    /Invalid/,
  );
  assert.throws(
    () => safeAssetPath("/tmp/root", "KTLX", "KTLX/../../x"),
    /Invalid/,
  );
});
test("separatesStationWorkers, boundsWorkerCount, reapsIdleWorkers", async () => {
  const { WorkerPool } = await import("../src/workers.ts");
  let time = 0;
  const closed: string[] = [];
  const pool = new WorkerPool({
    sites: ["KTLX", "KIWA", "KAMX"],
    limit: 2,
    idleMs: 100,
    now: () => time,
    start: async (station: string) => ({
      station,
      cacheDir: "/tmp/" + station,
      health: "ok",
      close() {
        closed.push(station);
      },
    }),
  });
  assert.notEqual(await pool.get("KTLX"), await pool.get("KIWA"));
  time = 10;
  await pool.get("KTLX");
  await pool.get("KAMX");
  assert.deepEqual(closed, ["KIWA"]);
  assert.equal(pool.size, 2);
  time = 200;
  pool.reap();
  assert.equal(pool.size, 0);
  await assert.rejects(() => pool.get("../x"), /Unknown station/);
  pool.close();
});
test("coalesces concurrent startup and handlesStartupTimeout", async () => {
  const { WorkerPool } = await import("../src/workers.ts");
  let starts = 0;
  const pool = new WorkerPool({
    sites: ["KTLX"],
    startupMs: 20,
    start: async () => {
      starts++;
      await new Promise(() => {});
      return {} as never;
    },
  });
  const results = await Promise.allSettled([
    pool.get("KTLX"),
    pool.get("KTLX"),
  ]);
  assert.equal(starts, 1);
  assert.ok(results.every((r) => r.status === "rejected"));
  assert.equal(pool.size, 0);
  pool.close();
});
test("HTTP rejects bad identifiers, query limits, and disallowed origins", async () => {
  const { createServer } = await import("../src/server.ts");
  const pool = {
    async get() {
      throw Error("must not start");
    },
  };
  const server = createServer({
    pool: pool as never,
    sites: [
      { id: "KTLX", name: "OKC", state: "OK", lat: 35, lon: -97, altM: 1 },
    ],
    origins: ["https://web.test"],
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as { port: number };
  const base = "http://127.0.0.1:" + addr.port;
  try {
    assert.equal((await fetch(base + "/v1/stations/BAD/frames")).status, 400);
    assert.equal(
      (await fetch(base + "/v1/places?q=" + "a".repeat(121))).status,
      400,
    );
    assert.equal(
      (
        await fetch(base + "/v1/stations", {
          headers: { Origin: "https://evil.test" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/v1/stations", {
          headers: { Origin: "https://web.test" },
        })
      ).headers.get("access-control-allow-origin"),
      "https://web.test",
    );
    assert.equal(
      (await fetch(base + "/v1/stations/KTLX/frames/f/assets/%2e%2e%2fx"))
        .status,
      404,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test("engine startup tolerates a long state directory and a not-yet-created socket", async (t) => {
  const probe = unixServer();
  try {
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(
        join(tmpdir(), "omastorm-probe-" + process.pid + ".sock"),
        resolve,
      );
    });
    await new Promise<void>((resolve) => probe.close(() => resolve()));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EPERM") {
      t.skip(
        "Sandbox blocks Unix socket listeners; requires Linux host verification",
      );
      return;
    }
    throw e;
  }
  const { startEngine, WorkerPool } = await import("../src/workers.ts");
  const root = mkdtempSync(join(tmpdir(), "radar-long-"));
  const script = join(root, "fake-engine.mjs");
  writeFileSync(
    script,
    `#!/usr/bin/env node\nimport {mkdirSync} from 'node:fs';import {createServer} from 'node:net';import {join} from 'node:path';const dir=join(process.env.XDG_RUNTIME_DIR,'omastorm');mkdirSync(dir,{recursive:true});const server=createServer(s=>{s.write(JSON.stringify({type:'hello',v:2})+'\\n');s.on('data',()=>s.write(JSON.stringify({type:'state',v:2,connection:{status:'ok'}})+'\\n'));});server.listen(join(dir,'engine.sock'));process.on('SIGTERM',()=>process.exit(0));`,
    { mode: 0o755 },
  );
  chmodSync(script, 0o755);
  const pool = new WorkerPool({
    sites: ["KTLX"],
    start: startEngine(script, join(root, "x".repeat(120))),
    startupMs: 2000,
  });
  try {
    const w = await pool.get("KTLX");
    assert.equal(w.station, "KTLX");
  } catch (e) {
    console.error(
      readFileSync(join(root, "x".repeat(120), "KTLX", "engine.log"), "utf8"),
    );
    throw e;
  } finally {
    pool.close();
    rmSync(root, { recursive: true, force: true });
  }
});

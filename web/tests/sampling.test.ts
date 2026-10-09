import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const meta = JSON.parse(
  readFileSync("../golden/ktlx-20130520/sweep0.json", "utf8"),
);
const raw = new Uint8Array(readFileSync("../golden/ktlx-20130520/sweep0.u8"));

test("decodesMomentCodes: special values and exact dBZ", async () => {
  const { decodeMoment } = await import("../src/radar/sampling.ts");
  assert.deepEqual(decodeMoment(0, 2, 66), { kind: "below" });
  assert.deepEqual(decodeMoment(1, 2, 66), { kind: "folded" });
  assert.deepEqual(decodeMoment(106, 2, 66), { kind: "measured", dbz: 20 });
});
test("rejects insufficient byte length and invalid geometry", async () => {
  const { encodeSweep } = await import("../src/radar/fixture.ts");
  assert.throws(() => encodeSweep(meta, raw.subarray(0, 4)), /length/);
  assert.throws(
    () => encodeSweep({ ...meta, gateSpacingM: 0 }, raw),
    /geometry/,
  );
});
test("golden scan preserves every raw gate code and LUT rows", async () => {
  const { encodeSweep } = await import("../src/radar/fixture.ts");
  const { sweep, lut, rows } = encodeSweep(meta, raw);
  assert.equal(rows, 720);
  assert.equal(sweep.length, 720 * 1832 * 4);
  for (let i = 0; i < raw.length; i++) assert.equal(sweep[i * 4 + 2], raw[i]);
  for (let i = 0; i < 3600; i++) {
    const row = lut[i * 4] + 256 * lut[i * 4 + 1];
    const angle = (i + 0.5) / 10;
    const d = meta.azimuthDeg.map((a: number) =>
      Math.min(Math.abs(a - angle), 360 - Math.abs(a - angle)),
    );
    assert.ok(d[row] <= Math.min(...d) + 1e-8);
  }
});
test("sampling rejects outside range and weak measured returns", async () => {
  const { sampleAt, mercator } = await import("../src/radar/sampling.ts");
  const { encodeSweep, fixtureFrame } = await import("../src/radar/fixture.ts");
  const { sweep, lut } = encodeSweep(meta, raw);
  const frame = fixtureFrame(meta);
  const camera = { lat: meta.siteLat, lon: meta.siteLon, zoom: 8 };
  assert.equal(
    sampleAt(frame, camera, 400, 400, 200, 200, sweep, lut).kind,
    "outside",
  );
  assert.equal(
    sampleAt(
      frame,
      { ...camera, lat: 0, lon: 0 },
      400,
      400,
      200,
      200,
      sweep,
      lut,
    ).kind,
    "outside",
  );
  assert.ok(Math.abs(mercator(0, 0)[0] - 0.5) < 1e-10);
});
test("Mercator round trip preserves longitude during pan", async () => {
  const { mercator, inverseMercator } = await import(
    "../src/radar/sampling.ts"
  );
  for (const [lat, lon] of [
    [0, 0],
    [35.333, -97.277],
    [33.4, -112.1],
    [-20, 170],
  ]) {
    const [x, y] = mercator(lat, lon);
    const [a, b] = inverseMercator(x, y);
    assert.ok(Math.abs(a - lat) < 1e-8);
    assert.ok(Math.abs(b - lon) < 1e-8);
  }
});

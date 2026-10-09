import { PALETTE, BOUNDS, validateFrame } from "./model.ts";
import type { RadarFrame } from "./model.ts";
export type FixtureMeta = {
  station: string;
  rays: number;
  gates: number;
  scale: number;
  offset: number;
  firstGateM: number;
  gateSpacingM: number;
  azimuthDeg: number[];
  elevationDeg: number[];
  siteLat: number;
  siteLon: number;
  siteAltM: number;
  rayTimeBase: string;
  sourceSha256: string;
};
export function fixtureFrame(m: FixtureMeta): RadarFrame {
  return validateFrame({
    id: "KTLX-20130520T201643Z-e0",
    station: m.station,
    scanTime: m.rayTimeBase,
    sweepEnd: "2013-05-20T20:17:00Z",
    status: "complete",
    mode: "archived",
    rays: m.rays,
    gates: m.gates,
    textureRows: m.rays,
    firstGateM: m.firstGateM,
    gateSpacingM: m.gateSpacingM,
    elevationDeg: m.elevationDeg.reduce((a, b) => a + b, 0) / m.rays,
    site: { lat: m.siteLat, lon: m.siteLon, altM: m.siteAltM },
    palette: PALETTE,
    bounds: BOUNDS,
    scale: m.scale,
    offset: m.offset,
    textureUrl: "/fixtures/ktlx-20130520/sweep.png",
    azimuthLutUrl: "/fixtures/ktlx-20130520/lut.png",
    sourceSha256: m.sourceSha256,
  });
}
export function encodeSweep(m: FixtureMeta, raw: Uint8Array) {
  fixtureFrame(m);
  if (raw.length !== m.rays * m.gates) throw Error("Invalid sweep byte length");
  if (
    m.azimuthDeg.length !== m.rays ||
    m.azimuthDeg.some(
      (a, i) =>
        !Number.isFinite(a) ||
        a < 0 ||
        a >= 360 ||
        (i > 0 && a < m.azimuthDeg[i - 1]),
    )
  )
    throw Error("Invalid ray geometry");
  const lut = new Uint8Array(3600 * 4);
  let blank = false;
  for (let i = 0; i < 3600; i++) {
    const c = Math.fround((i + 0.5) / 10);
    let after = m.azimuthDeg.findIndex((a) => Math.fround(a) > c);
    if (after < 0) after = 0;
    const before = (after + m.rays - 1) % m.rays;
    const distance = (r: number) => {
      const d = Math.abs(Math.fround(m.azimuthDeg[r]) - c);
      return Math.min(d, 360 - d);
    };
    let row = distance(before) <= distance(after) ? before : after;
    if (distance(row) > 0.75) {
      row = m.rays;
      blank = true;
    }
    lut.set([row & 255, row >> 8, 0, 255], i * 4);
  }
  const rows = m.rays + (blank ? 1 : 0);
  const sweep = new Uint8Array(rows * m.gates * 4);
  for (let i = 0; i < rows * m.gates; i++) {
    const code = i < raw.length ? raw[i] : 0;
    let cls = 0;
    const status = i >= raw.length ? 0 : code === 0 ? 2 : code === 1 ? 1 : 0;
    if (code >= 2) {
      const dbz = (code - m.offset) / m.scale;
      cls =
        Math.max(
          0,
          Math.min(
            PALETTE.length - 1,
            BOUNDS.filter((b) => b <= dbz).length - 1,
          ),
        ) + 1;
    }
    sweep.set([cls, status, code, 255], i * 4);
  }
  return { sweep, lut, rows };
}
export async function loadFixture(): Promise<RadarFrame> {
  const r = await fetch("/fixtures/ktlx-20130520/frame.json");
  if (!r.ok) throw Error("Archived scan unavailable");
  return validateFrame(await r.json());
}

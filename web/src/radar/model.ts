export type Treatment = "modern" | "pixels" | "glyphs" | "stipple";
export type Camera = { lat: number; lon: number; zoom: number };
export type Station = {
  id: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
  altM: number;
};
export type Health =
  | "ok"
  | "stale"
  | "unavailable"
  | "offline"
  | "loading"
  | "idle";
export type RadarFrame = {
  id: string;
  station: string;
  scanTime: string;
  sweepEnd: string;
  status: "complete";
  mode: "live" | "archived";
  rays: number;
  gates: number;
  textureRows: number;
  firstGateM: number;
  gateSpacingM: number;
  elevationDeg: number;
  site: { lat: number; lon: number; altM: number };
  palette: string[];
  bounds: number[];
  scale: number;
  offset: number;
  textureUrl: string;
  azimuthLutUrl: string;
  sourceSha256?: string;
};
export type Catalog = { station: string; health: Health; frames: RadarFrame[] };
export const EARTH = 6371000;
export const EFFECTIVE_EARTH = (EARTH * 4) / 3;
export const PALETTE = [
  "#34465f",
  "#426b88",
  "#4098a5",
  "#51b897",
  "#85c76b",
  "#cadb6b",
  "#f0cd61",
  "#eda24c",
  "#e67349",
  "#d84c64",
  "#b55096",
  "#e2b4df",
];
export const BOUNDS = [-32, 0, 10, 20, 30, 40, 45, 50, 55, 60, 65, 70, 96];
export function validateFrame(f: RadarFrame): RadarFrame {
  if (
    !f ||
    f.status !== "complete" ||
    !["live", "archived"].includes(f.mode) ||
    !f.id ||
    !Number.isFinite(Date.parse(f.scanTime))
  )
    throw Error("Invalid radar frame");
  if (
    !Number.isInteger(f.rays) ||
    f.rays < 1 ||
    f.rays > 65534 ||
    !Number.isInteger(f.gates) ||
    f.gates < 1 ||
    f.gates > 8192 ||
    f.textureRows < f.rays ||
    f.textureRows > f.rays + 1 ||
    !Number.isFinite(f.gateSpacingM) ||
    f.gateSpacingM <= 0 ||
    !Number.isFinite(f.firstGateM) ||
    !Number.isFinite(f.elevationDeg) ||
    f.elevationDeg < 0 ||
    f.elevationDeg > 90 ||
    !Number.isFinite(f.scale) ||
    f.scale <= 0 ||
    !Number.isFinite(f.offset)
  )
    throw Error("Invalid radar geometry");
  if (
    !f.site ||
    !Number.isFinite(f.site.lat) ||
    Math.abs(f.site.lat) > 90 ||
    !Number.isFinite(f.site.lon) ||
    Math.abs(f.site.lon) > 180 ||
    !f.palette?.length ||
    f.palette.length > 254 ||
    f.bounds?.length !== f.palette.length + 1 ||
    f.palette.some((c) => !/^#[\da-f]{6}$/i.test(c)) ||
    f.bounds.some(
      (b, i) => !Number.isFinite(b) || (i > 0 && b <= f.bounds[i - 1]),
    )
  )
    throw Error("Invalid radar palette or site");
  if (typeof f.textureUrl !== "string" || typeof f.azimuthLutUrl !== "string")
    throw Error("Missing radar assets");
  return f;
}

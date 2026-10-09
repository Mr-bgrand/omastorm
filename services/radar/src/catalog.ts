import { DatabaseSync } from "node:sqlite";
import { readFileSync, realpathSync, statSync, existsSync } from "node:fs";
import { resolve, join, sep } from "node:path";
import { validateFrame } from "../../../web/src/radar/model.ts";
import type { RadarFrame } from "../../../web/src/radar/model.ts";
export class ServiceError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}
export function safeAssetPath(root: string, station: string, path: string) {
  if (
    !/^[A-Z0-9]{4}$/.test(station) ||
    !new RegExp("^" + station + "/[A-Za-z0-9._-]+\\.png$").test(path)
  )
    throw new ServiceError("Invalid radar asset path", 400);
  const base = realpathSync(root),
    candidate = resolve(root, path);
  if (!candidate.startsWith(base + sep))
    throw new ServiceError("Invalid radar asset path", 400);
  return candidate;
}
function open(root: string) {
  const path = join(root, "catalog.sqlite");
  return existsSync(path)
    ? new DatabaseSync(path, { readOnly: true, timeout: 2000 })
    : null;
}
type Row = {
  frame: string;
  texture: string;
  azimuth_lut: string;
  id: string;
  start_ms: number;
};
function assetBytes(root: string, station: string, path: string) {
  const candidate = safeAssetPath(root, station, path);
  try {
    const resolved = realpathSync(candidate);
    if (!resolved.startsWith(realpathSync(root) + sep))
      throw new ServiceError("Invalid radar asset path", 400);
    const info = statSync(resolved);
    if (!info.isFile() || info.size > 32 * 1024 * 1024)
      throw new ServiceError("Invalid radar asset size", 500);
    const b = readFileSync(resolved);
    if (
      b.length < 33 ||
      b.readUInt32BE(0) !== 0x89504e47 ||
      b[24] !== 8 ||
      b[25] !== 6
    )
      throw new ServiceError("Invalid radar PNG", 500);
    return b;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      throw new ServiceError("This scan expired. Refresh the timeline.", 410);
    throw e;
  }
}
function normalize(root: string, station: string, row: Row) {
  const f = JSON.parse(row.frame);
  if (f.kind && f.kind !== "polar")
    throw new ServiceError("Unsupported radar product", 500);
  const png = assetBytes(root, station, row.texture);
  const base =
    "/v1/stations/" + station + "/frames/" + encodeURIComponent(row.id);
  return validateFrame({
    ...f,
    id: row.id,
    station,
    mode: "live",
    status: "complete",
    textureRows: png.readUInt32BE(20),
    textureUrl: base + "/assets/sweep",
    azimuthLutUrl: base + "/assets/azimuth-lut",
  }) as RadarFrame;
}
export function readCatalog(root: string, station: string, now = Date.now()) {
  const db = open(root);
  if (!db) return [];
  try {
    const rows = db
      .prepare(
        "SELECT id,frame,texture,azimuth_lut,start_ms FROM frames WHERE site=? AND start_ms>=? ORDER BY start_ms DESC,id DESC LIMIT 60",
      )
      .all(station, now - 7200000) as unknown as Row[];
    return rows.reverse().flatMap((row) => {
      try {
        return [normalize(root, station, row)];
      } catch (e) {
        if ((e as ServiceError).status === 410) return [];
        throw e;
      }
    });
  } finally {
    db.close();
  }
}
export function readFrame(root: string, station: string, id: string) {
  const db = open(root);
  if (!db)
    throw new ServiceError("This scan expired. Refresh the timeline.", 410);
  try {
    const row = db
      .prepare(
        "SELECT id,frame,texture,azimuth_lut,start_ms FROM frames WHERE site=? AND id=? AND start_ms>=?",
      )
      .get(station, id, Date.now() - 7200000) as Row | undefined;
    if (!row)
      throw new ServiceError("This scan expired. Refresh the timeline.", 410);
    return normalize(root, station, row);
  } finally {
    db.close();
  }
}
export function readAsset(
  root: string,
  station: string,
  id: string,
  kind: string,
) {
  if (!["sweep", "azimuth-lut"].includes(kind))
    throw new ServiceError("Invalid asset kind", 400);
  const db = open(root);
  if (!db)
    throw new ServiceError("This scan expired. Refresh the timeline.", 410);
  try {
    const row = db
      .prepare(
        "SELECT texture,azimuth_lut FROM frames WHERE site=? AND id=? AND start_ms>=?",
      )
      .get(station, id, Date.now() - 7200000) as Row | undefined;
    if (!row)
      throw new ServiceError("This scan expired. Refresh the timeline.", 410);
    return assetBytes(
      root,
      station,
      kind === "sweep" ? row.texture : row.azimuth_lut,
    );
  } finally {
    db.close();
  }
}

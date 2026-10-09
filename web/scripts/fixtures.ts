import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { encode } from "fast-png";
import { encodeSweep, fixtureFrame } from "../src/radar/fixture.ts";
const root = "../";
const m = JSON.parse(
  readFileSync(root + "golden/ktlx-20130520/sweep0.json", "utf8"),
);
const raw = new Uint8Array(
  readFileSync(root + "golden/ktlx-20130520/sweep0.u8"),
);
const { sweep, lut, rows } = encodeSweep(m, raw);
const dir = "public/fixtures/ktlx-20130520";
mkdirSync(dir, { recursive: true });
writeFileSync(
  dir + "/sweep.png",
  encode({ width: m.gates, height: rows, data: sweep, channels: 4, depth: 8 }),
);
writeFileSync(
  dir + "/lut.png",
  encode({ width: 3600, height: 1, data: lut, channels: 4, depth: 8 }),
);
writeFileSync(
  dir + "/frame.json",
  JSON.stringify({ ...fixtureFrame(m), textureRows: rows }),
);
writeFileSync(dir + "/provenance.json", JSON.stringify(m));
mkdirSync("public/data", { recursive: true });
writeFileSync(
  "public/data/stations.json",
  readFileSync(root + "engine/data/sites.json"),
);
const lines: number[][][] = [];
for (const name of [
  "ne_50m_coastline",
  "ne_50m_admin_0_boundary_lines_land",
  "ne_50m_admin_1_states_provinces_lines",
]) {
  const g = JSON.parse(
    gunzipSync(
      readFileSync(root + "data/fixtures/" + name + ".geojson.gz"),
    ).toString(),
  );
  for (const f of g.features) {
    const c = f.geometry.coordinates;
    for (const line of f.geometry.type === "LineString" ? [c] : c) {
      lines.push(
        line.map((p: number[]) => [+p[0].toFixed(4), +p[1].toFixed(4)]),
      );
    }
  }
}
writeFileSync("public/data/geography.json", JSON.stringify(lines));
console.log(
  "Generated archived radar PNGs, station list and Natural Earth geography.",
);

const places = gunzipSync(
  readFileSync(root + "data/fixtures/cities5000.txt.gz"),
)
  .toString()
  .split("\n")
  .map((l) => l.split("\t"))
  .filter((c) => c[8] === "US" && Number(c[14]) >= 10000)
  .map((c) => ({
    name: c[1],
    lat: Number(c[4]),
    lon: Number(c[5]),
    region: c[10],
    country: c[8],
    population: Number(c[14]),
  }));
writeFileSync("public/data/places.json", JSON.stringify(places));

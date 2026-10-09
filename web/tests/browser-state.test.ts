import test from "node:test";
import assert from "node:assert/strict";
import type { RadarFrame } from "../src/radar/model.ts";
const f = (id: string, status = "complete") =>
  ({ id, status, scanTime: "2026-10-09T01:00:00Z" }) as RadarFrame;
test("keepsTwoViewersIndependent and skipsPartialFrames", async () => {
  const { reconcilePlayback, nextFrame } = await import(
    "../src/radar/playback.ts"
  );
  const a = reconcilePlayback({ selected: "a", playing: true }, [
    f("a"),
    f("b"),
    f("c", "partial"),
  ]);
  const b = reconcilePlayback({ selected: "b", playing: false }, [
    f("a"),
    f("b"),
  ]);
  assert.equal(nextFrame(a, [f("a"), f("b"), f("c", "partial")]).selected, "b");
  assert.equal(b.selected, "b");
  assert.equal(b.playing, false);
});
test("restartsAfterFrameExpiry and staleFeedKeepsTimestamp", async () => {
  const { reconcilePlayback } = await import("../src/radar/playback.ts");
  const frames = [f("b"), f("c")];
  assert.equal(
    reconcilePlayback({ selected: "a", playing: true }, frames).selected,
    "b",
  );
  assert.equal(frames[0].scanTime, "2026-10-09T01:00:00Z");
});
test("ignoresLateStationResponse", async () => {
  const { LatestRequest } = await import("../src/radar/client.ts");
  const latest = new LatestRequest();
  const a = latest.begin(),
    b = latest.begin();
  assert.equal(latest.current(a), false);
  assert.equal(latest.current(b), true);
});
test("rejectsInvalidSharedCoordinates and restoresSharedAppearance", async () => {
  const { parseViewUrl, serializeViewUrl } = await import(
    "../src/radar/view-url.ts"
  );
  const bad = parseViewUrl(
    new URL("https://test/?lat=999&lon=no&zoom=Infinity&style=foo"),
  );
  assert.equal(bad.camera.lat, 35.333);
  assert.equal(bad.treatment, "modern");
  const value = {
    camera: { lat: 33.4, lon: -112.1, zoom: 8 },
    station: "KIWA",
    treatment: "glyphs" as const,
  };
  const url = serializeViewUrl(value, new URL("https://test/"));
  assert.deepEqual(parseViewUrl(url), value);
});
test("animation loops from the chosen completed scan", async () => {
  const { nextFrame } = await import("../src/radar/playback.ts");
  const state = { selected: "c", playing: true, start: "b" };
  assert.equal(nextFrame(state, [f("a"), f("b"), f("c")]).selected, "b");
});

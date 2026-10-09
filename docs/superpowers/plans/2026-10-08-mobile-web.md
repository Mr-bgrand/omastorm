# Omastorm Mobile Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Native execution in this session is recommended; the user has not yet selected an execution method.

**Goal:** Deliver a phone-friendly browser radar with modern and retro views, independent visitor controls, and a shareable hosted preview.

**Architecture:** Add a separate Next.js client in `web/` and a persistent Node HTTP adapter in `services/radar/`. Reuse existing Rust engine station workers for ingestion; keep camera and playback entirely in browsers. First verify rendering against the committed golden scan, then add live data and hosting.

**Tech Stack:** Next.js, React, TypeScript, WebGL2, Node.js 24 LTS, existing Rust engine, Node test runner and Playwright.

**Spec:** `docs/mobile-web-design.md`, approved October 8, 2026.

## Global Constraints

- Offer both the original retro treatments and a modern view.
- No accounts are needed for the first version.
- Visitors never send raw engine commands.
- Playback, chosen frame, camera, and presentation settings stay in each browser.
- Fixture mode is never labeled live.
- Preserve raw PNG channel values without browser color transforms and use nearest-neighbor sampling for radar codes and azimuth lookup.
- Modern styling can change map/chrome treatment but must not invent or smooth radar values.
- Europe/OPERA and aviation overlays follow after the US flow works.
- Choose the persistent Linux host before deployment or incurring costs.
- Preserve MIT notices and all applicable weather/map/place attribution.

## Review Focus

1. Corrupt or incomplete frame assets must leave a readable error, never a fabricated radar picture (Task 1).
2. Lost WebGL context or unsupported devices must report failure and allow recovery (Task 2).
3. Rapid station changes must discard late responses and preserve each browser's selection (Task 3).
4. Engine eviction during an asset read must return a recoverable expired-frame response, never another frame (Task 4).
5. Malformed share URLs and denied GPS must leave a usable viewer with validated defaults (Task 5).

## File Boundaries

- `web/src/radar/model.ts`: normalized completed-frame, source-health and camera types.
- `web/src/radar/fixture.ts`: archived golden scan adapter and encoding.
- `web/src/radar/sampling.ts`: CPU reference for radar geometry and values.
- `web/src/radar/renderer.ts`, `shaders.ts`: WebGL resources and shader port.
- `web/src/radar/client.ts`, `playback.ts`: read-only API and per-browser timeline state.
- `web/src/components/RadarCanvas.tsx`, `RadarViewer.tsx`, `RadarControls.tsx`: map lifecycle, layout and controls.
- `web/src/radar/view-url.ts`: validated shared-view serialization.
- `services/radar/src/workers.ts`, `catalog.ts`, `server.ts`: engine lifecycle, completed-frame reads and public HTTP boundary.
- `services/radar/Dockerfile`, `web/README.md`: reproducible deployment and verification instructions.

### Task 1: Real archived scan and data contract

**Files:** Create `web/package.json`, lockfile, TypeScript/Next configuration, `web/src/radar/{model,fixture,sampling}.ts`, `web/tests/sampling.test.ts`, and a fixture generation script. Copy only the committed golden data into `web/public/fixtures/ktlx-20130520/`, retaining provenance.

**Interfaces:** `RadarFrame` supplies id, station, scanTime, geometry, palette/bounds, textureUrl and azimuthLutUrl. `samplePolar(frame, camera, pixel): Sample` distinguishes outside, below-threshold, folded and measured results. `loadFixture(): Promise<RadarFrame>` returns one archived frame.

- [ ] Write `decodesMomentCodes`, asserting code 0 below-threshold, 1 folded, and code 106 equals 20 dBZ using scale 2 and offset 66; test insufficient byte length and invalid geometry rejection.
- [ ] Run `cd web && npm test`; verify the missing implementation causes the expected failure.
- [ ] Generate RGBA sweep bytes matching the engine's R palette-class+1, G flags and B raw-code contract. Generate the 3600-entry LUT using the nearest ray to each bin center and the existing 0.75-degree gap rule. Preserve geometry/time/source hash from `sweep0.json`.
- [ ] Implement the CPU reference from `ui/shaders/radar.frag`, including Mercator projection, spherical bearing, effective-earth slant distance, nearest gate and the weak-return floor.
- [ ] Run tests and `npm run build`; verify tests pass and the fixture is explicitly archived with the correct 2013 observation date. Commit the deliverable.

### Task 2: Browser renderer and both appearances

**Files:** Create renderer/shaders, canvas/viewer/controls components, app layout/page/styles, and `web/tests/renderer.spec.ts`.

**Interfaces:** `createRenderer(canvas): Renderer` exposes `setFrame(frame)`, `setCamera(camera)`, `setTreatment(modern|pixels|glyphs|stipple)`, `resize()` and `dispose()`. Renderer consumes Task 1 types and textures; the viewer owns settings.

- [ ] Write Playwright `matchesReferenceSamples` to compare representative pixels to Task 1 CPU output, including outside range, special codes, weak returns, zoom and all retro treatments. Add `reportsContextFailure` for initialization failure and context loss.
- [ ] Run the renderer tests and confirm failure before implementation.
- [ ] Port the shader to GLSL ES 3.00; retain original 3-pixel sampling cells, treatment masks, palette and status handling. Decode PNGs to channel-preserving RGBA bytes before upload. Disable interpolation, mipmaps and color conversion; account for device pixel ratio without changing logical cell size.
- [ ] Implement map pan, pinch zoom, wheel zoom, resize and resource cleanup. Compose a radar-first phone layout with safe-area spacing, observation stamp, legend, mode switch, retro selector and archived label. Use the same observed cells in modern mode with cleaner map/chrome styling.
- [ ] Run reference comparisons and build; inspect screenshots at 390x844, 844x390 and 1440x900. Commit only after the picture and controls are usable.

### Task 3: Independent browser data and playback

**Files:** Create `web/src/radar/{client,playback}.ts`, client/playback tests, and wire the viewer to fixture/live providers.

**Interfaces:** `getStations()`, `searchPlaces(query)`, `getFrames(station, signal)` and `getFrame(station, id, signal)` return normalized API resources. `PlaybackState` holds selected id and playing locally, never on the engine. Production API base comes from configured deployment settings, not a query parameter.

- [ ] Write `keepsTwoViewersIndependent`, `ignoresLateStationResponse`, `skipsPartialFrames`, `restartsAfterFrameExpiry`, and `staleFeedKeepsTimestamp`. Assert no playback or seek commands reach the backend.
- [ ] Run tests and confirm failure before implementation.
- [ ] Implement abortable reads, frame validation, completed-only timeline and local loop pacing of 250 ms to 1 s. Refresh active catalogs every 30 seconds with backoff; pause background fetching when hidden and refresh on return. Do not overwrite a deliberately selected older frame with a new live frame.
- [ ] Render loading, stale, unavailable, offline and expired-frame states with original observation times. Keep fixture mode selectable and unmistakably archived.
- [ ] Run tests, build and a two-browser mocked live test; commit.

### Task 4: Persistent live-radar adapter

**Files:** Create `services/radar/package.json`, lockfile, `src/{workers,catalog,server}.ts`, tests and Dockerfile; document the internal catalog dependency.

**Interfaces:** Read-only `/v1/stations`, `/v1/places?q=...`, `/v1/stations/:id/frames`, `/v1/stations/:id/frames/:frameId` and `/v1/stations/:id/frames/:frameId/assets/:kind`, where kind is sweep or azimuth-lut. Worker control is internal. Station resources return status and normalized completed-frame metadata for Task 3.

- [ ] Write `separatesStationWorkers`, `rejectsUnknownStation`, `rejectsTraversal`, `boundsWorkerCount`, `handlesStartupTimeout`, `returnsGoneForEvictedFrame`, and `reapsIdleWorkers`. Add integration tests against an archived engine worker and live tests only when network access permits.
- [ ] Run tests and confirm failure before implementation.
- [ ] Manage at most four engine workers, ten-minute idle expiry, isolated XDG runtime/cache paths and ten-second startup deadline. Spawn the configured executable directly with fixed arguments; select exactly one allowlisted NEXRAD station through a private protocol-v2 connection. Stop workers gracefully on eviction and shutdown.
- [ ] Read each worker's SQLite catalog read-only through Node's SQLite API. This is a backend-only dependency on `engine/src/catalog.rs`, not public protocol. Filter by station and completed frame id; validate PNG paths and copy requested bytes before response. Never list arbitrary directories or expose filesystem paths. Handle catalog/file eviction races as HTTP 410 with client refresh guidance. Preserve source provenance and frame geometry.
- [ ] Limit responses to 60 frames within two hours, search queries to 120 characters, assets to 32 MiB and requests to 120/minute/client. Allow CORS only for configured frontend origins. Read health from the engine independently of archived catalog records; keep empty and failed feeds distinct. Validate bounds with tests.
- [ ] Build a Linux container using the repository's supported Rust toolchain and locked dependencies. Run adapter tests and repository engine checks when existing engine files change; confirm live data and cache reuse between two visitors. Commit.

### Task 5: Search, sharing, installation and preview

**Files:** Create `web/src/radar/view-url.ts`, view-url tests, manifest/icons, `web/README.md`; extend controls and end-to-end tests.

**Interfaces:** `parseViewUrl(url): ViewSettings` and `serializeViewUrl(settings): URL` encode validated camera, zoom, station and treatment. GPS is one-shot and called only by the locate button. API/provider selection cannot be changed by shared links.

- [ ] Write `rejectsInvalidSharedCoordinates`, `restoresSharedAppearance`, `gpsDeniedStillAllowsSearch`, and `neverLabelsFixtureLive`. Test two viewers with distinct live stations and playback positions end to end.
- [ ] Run tests and verify failure before implementation.
- [ ] Wire city/station search with debouncing and cancellation; use bundled place search via an internal worker request. Keep a chosen source separate from camera center. Persist local preferences. Add native share with clipboard fallback only on explicit click, and validate latitude, longitude, zoom, station and treatment on restore.
- [ ] Add manifest and icons, plus HTTPS installation guidance. Do not cache live API responses or advertise offline radar without a verified offline flow. Show licenses, source attribution and actual scan times.
- [ ] Run test suite, type checks, production build and browser checks for all specified viewports, URL restore, GPS denial and reconnects. Document exact passing commands and any blocked live/device checks.
- [ ] Configure Vercel root directory `web/` and persistent backend deployment once host/account is selected. Do not provision paid infrastructure without authorization. Verify deployed API, CORS, both styles and independent viewers before presenting a shareable preview. Commit.

## Execution Handoff

Recommended method: native execution, implementing these tasks in this session. The renderer, normalized frame contract and adapter are closely connected, making one implementer the straightforward choice. Await the user's plan review and execution-method selection before product implementation.

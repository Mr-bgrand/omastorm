# Mobile web implementation status

The first web client and live-service adapter are implemented on the mobile-web feature branch. The original Rust/Quickshell application was not modified.

Implemented: original shader sampling in WebGL2; Modern and Retro styles (Pixels/Glyphs/Stipple); real archived golden scan; touch/wheel navigation; US station and city search; location on request; validated sharing URLs; independent browser timeline/playback; install manifest, icons and a network-only service worker; bounded station workers; read-only frame/asset API; CORS and request/path validation; Docker deployment recipe.

Verification is recorded in the final handoff. Live hosting is not complete: this executor forbids native Unix socket listeners, so a real engine/service integration run cannot start here. The connected Vercel credentials return HTTP 403 for the owner's default project scope, and CLI credentials are absent. No deployment or paid infrastructure was created.

Before sharing live radar: rerun native integration checks on a Linux host, deploy the persistent container, set its HTTPS URL in the frontend build environment, and verify actual NOAA observations through the hosted frontend. This is separate from the archived demonstration and mocked live browser tests.

## Verified on October 9, 2026 UTC

- `npm test --prefix web`: 10 passed.
- `npm test --prefix services/radar`: 5 passed, 1 native-worker check explicitly skipped after a Unix socket EPERM probe.
- Both TypeScript checks and `git diff --check`: passed.
- `npm run test:e2e --prefix web`: 7 passed against a fresh production test server. Includes phone/desktop/landscape views, source-switch canvas clearing, URL/GPS fallback, independent mocked live viewers, context loss and actual GPU pixels against the CPU golden scan.
- Normal frontend production build: passed; no live API is embedded unless configured at build time.
- Fresh code review: one important finding fixed. Source/frame changes now clear the previous scan and abort obsolete texture requests. The regression failed before the fix and passed after it. No remaining review findings.

## Implementation decisions and remaining checks

Tests use pinned Playwright 1.56.1 because newer browser downloads were unavailable, and a production server because development HMR was blocked. Local fonts avoid external runtime requests. The traversal test uses encoded separators to prevent Fetch normalizing away the attack. Runtime socket directories are private, short temporary paths; observation caches stay persistent. Existing desktop files remain unchanged because their toolchain is unavailable here. Cloud-only skill scripts were replaced by a local execution ledger. A golden-pixel test also exposed and corrected inverse Mercator longitude handling.

Deferred verification: real native worker/NOAA ingestion, Docker build, hosted API/CORS/frontend integration, and physical iPhone/Android installation. These remain prerequisites for calling this a verified live service. The archived browser demonstration and mocked API tests are verified separately.

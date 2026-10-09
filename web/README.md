# Omastorm Web

A separate mobile-first browser client for Omastorm. The desktop application is unchanged.

## Run locally

Node.js 24 is required. From the repository root:

```sh
npm ci --prefix web
npm run dev --prefix web
```

Open http://localhost:3000. Without a radar API configured, the app displays the committed **archived KTLX scan from May 20, 2013**, labeled ARCHIVED SCAN. It never substitutes a demo for live observations.

The browser offers Modern and Retro appearances; Retro includes Pixels, Glyphs and Stipple. Both use the same original shader sampling, radar palette, and weak-return threshold. Drag/pinch/wheel navigation, US city and station search, one-shot location, shared links, and local preferences work in both appearances. Live playback is independent in each browser and loops completed scans.

## Live service

The Rust engine needs a persistent Linux host. A Vercel frontend does not keep that daemon running. Build the adapter container from the repository root:

```sh
docker build -f services/radar/Dockerfile -t omastorm-radar .
docker run --rm -p 8080:8080 -v omastorm-radar:/data \
  -e ALLOWED_ORIGINS=http://localhost:3000 \
  omastorm-radar
```

For a hosted frontend, publish the container through HTTPS and set ALLOWED_ORIGINS to its exact frontend origin. This first implementation is for a small private/friends deployment: station workers are bounded to four, expire after ten idle minutes, and reuse observations between visitors. Serving more simultaneous stations requires tuning and host capacity measurement. The initial engine load and backfill may take time before a completed scan appears.

Set `NEXT_PUBLIC_RADAR_API_URL=https://your-radar-service.example.com` in the **frontend build environment**, then rebuild. The service exposes read-only station, place, completed-frame and image resources. Browser requests never change engine playback. No API keys or account credentials are needed for NOAA radar.

The backend reads the engine's internal SQLite catalog in read-only mode; its schema is a version coupling, not a public Omastorm API. Pin/verify the engine version and rerun adapter integration tests before upgrading. The Dockerfile builds this checkout using Cargo.lock. The worker protocol requires v2.

## Vercel

Create/link a project to this fork with Root Directory `web`, framework Next.js, Node.js 24.x, Install Command `npm ci`, and Build Command `npm run build`. Select the feature branch for a preview. Deploying without NEXT_PUBLIC_RADAR_API_URL creates the archived demonstration; connecting that variable requires a redeploy. Use exact preview/production origins in the backend's CORS allowlist.

This build does not provision a backend or incur recurring hosting costs automatically.

## Install on a phone

Open the HTTPS site on iPhone and use Share → Add to Home Screen. On Android use the browser's install/add-to-home-screen action. The manifest includes app icons and standalone display. The service worker is network-only; radar is not claimed to work offline.

## Verify

```sh
npm test --prefix web
npm run typecheck --prefix web
npm test --prefix services/radar
npm run typecheck --prefix services/radar
npm run build --prefix web
cd web
npx playwright install chromium
npm run test:e2e
```

The browser suite builds against a intercepted test radar origin and verifies independent live station/playback state, archived labels, appearance switching, sharing URL restore, denied location, WebGL context loss and CPU/GPU sample agreement. The test API is configured only for that test build; run a fresh normal production build before deployment.

The native-worker integration test skips only when the executor forbids Unix socket listeners; rerun it on the Linux deployment host. A mocked API browser test does not prove that NOAA ingestion works on the deployed service. Full engine/desktop checks use the original repository tooling and require its documented environment.

Generated static radar PNGs preserve R palette index, G status, B raw moment code and A exactly. `npm run fixtures --prefix web` regenerates them and the bundled geography/search resources from the original committed fixtures.

## Credits

Original Omastorm by Wesley Grimes and contributors, MIT license (see repository LICENSE and `/LICENSE.txt`). Radar observations: NOAA NEXRAD. Geography: Natural Earth public domain. US place search: GeoNames, CC BY 4.0, https://www.geonames.org/. Fonts: DM Sans and Space Grotesk, SIL Open Font License, distributed locally through their fontsource packages. No map tiles or paid map credentials are used.

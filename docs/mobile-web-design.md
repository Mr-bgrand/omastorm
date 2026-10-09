# Omastorm mobile web port: proposed design

## Goal

Let Brent and friends open a shared web link on iPhone, Android, or desktop and explore live radar. Offer both the original retro treatments and a modern view. No accounts are needed for the first version.

## Findings from the fork

Reviewed commit c5e4d533cff1f10e02418c3f7fd26977ddb8d4a3.

- `site/` is a static promotional website, not a radar client.
- `engine/` decodes NOAA NEXRAD and OPERA radar, maintains frame catalogs, and publishes PNG textures and metadata.
- Protocol v2 uses a Unix socket and runtime-relative texture paths. A browser cannot consume it directly.
- Connected clients share selection and playback state. A transparent public socket bridge would let visitors interfere with each other.
- The original UI uses QML and shaders; the renderer needs a browser implementation.
- The checkout has no AGENTS.md. Existing design, protocol, contribution, and license documents remain relevant.

## Recommended architecture

Keep the desktop application and add a separate `web/` Next.js application. Host the web frontend on Vercel. Run the Rust engine and a narrow HTTP adapter together on a persistent Linux service; choose that host before deployment or incurring costs.

For the initial backend, a manager owns a bounded pool of per-station engine workers, each with its own runtime directory and cache namespace. It selects a station internally and exposes completed frame catalogs, metadata, texture assets, and place/site search. Visitors never send raw engine commands. Playback, chosen frame, camera, and presentation settings stay in each browser. Reuse worker output between visitors viewing the same station, cap active workers, and evict idle workers.

An alternative is extracting shared ingestion into a new Rust library with independent HTTP resources. That is cleaner for broader scale but changes more existing engine code. A third option is a processed third-party radar tile feed; it would be faster to ship but would not preserve Omastorm's raw sweep rendering. Prefer the adapter for the first version, subject to confirming worker startup and catalog access behavior.

## First release

- US NEXRAD reflectivity with explicit observation time and feed health.
- Toggle Modern / Retro. Retro offers Pixels, Glyphs, and Stipple; both modes use the same observations, palette, and legend.
- City and station search, touch pan and pinch zoom, optional one-shot browser GPS on a button press.
- Per-browser animation and timeline seeking through available completed scans.
- Share URL containing camera, selected station, and appearance. Do not put precise GPS coordinates in a share link without an explicit share action.
- Remember local preferences and provide a PWA manifest and app icons.
- Responsive layouts that respect phone safe areas, with readable controls in portrait and landscape.

Europe/OPERA and aviation overlays follow after the US flow works. They remain available in the desktop application.

## Rendering and data integrity

Port the polar sampling rules from the existing shaders to WebGL. Preserve raw PNG channel values without browser color transforms and use nearest-neighbor sampling for radar codes and azimuth lookup. Match special missing, range-folded, and below-threshold values before mapping measured values to colors. Modern styling can change map/chrome treatment but must not invent or smooth radar values.

Use the supplied golden scan for a clearly labeled archived development view. Fixture mode is never labeled live. Show loading, unavailable, stale, and offline states; keep cached observations accessible with their original times. Keep NOAA, GeoNames, map-data, and MIT attribution where applicable.

## Backend boundary

Expose versioned, read-only resources for stations, searches, frame catalogs, and allowlisted image assets. Validate station identifiers and coordinates; never accept arbitrary filesystem paths, URLs, shell arguments, or runtime commands. Bound request rates, worker count, startup waits, response sizes, and cache usage. Define CORS for the deployed frontend. Keep public file serving limited to known published assets.

## Delivery order

1. Build a browser vertical slice against the archived golden scan: accurate renderer, both styles, responsive map and local playback controls.
2. Add and verify the persistent station-worker adapter and live data resources.
3. Connect search, location, independent viewer state, sharing, and installation support.
4. Validate live operation and deploy a shareable preview once hosting is configured.

## Acceptance and validation

- Build and type checks pass for the web application.
- Renderer samples and special-value handling agree with the supplied golden data and existing engine rules.
- Two browsers can choose different stations and playback positions without interference.
- Test worker startup failure, outage/staleness, reconnects, invalid identifiers, path traversal attempts, and idle-worker cleanup.
- Verify touch navigation, search, GPS denial, shared-link restoration, and portrait/landscape layouts on representative phone and desktop viewports.
- Run the repository's required verification tasks when existing engine behavior changes. A full desktop UI check requires an Omarchy/Quickshell environment.

## Design review

Brent approved this design on October 8, 2026. The implementation plan will detail the adapter's access to completed frame catalogs and texture retention before implementation.

## Current status

Fork cloned and inspected; design approved. No application code, public deployment, paid infrastructure, or upstream pull request has been created.

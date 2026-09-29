# Contributing

Report bugs and propose work in [GitHub issues](https://github.com/wesleygrimes/omastorm/issues).
Every pull request requires an issue approved by a maintainer before the PR is
opened. This applies to bug fixes and feature requests, including draft PRs
and automated PRs.

## Issues

For a bug, use the
[bug report template](https://github.com/wesleygrimes/omastorm/issues/new?template=bug-report.md).
Say what happened, what you expected, and your Omarchy version, plugin commit,
engine, and GPU as the template asks.

`$XDG_RUNTIME_DIR/omastorm/engine.log` is the daemon's stderr: startup,
`Live {site}: …` feed lines, decode and tile errors. Attach the last screenful
covering the failure, not a single line. If the engine never installed, attach
`bootstrap.log` from the same directory too. Paths are in the
[README](README.md#troubleshooting).

For a feature, use the
[feature request template](https://github.com/wesleygrimes/omastorm/issues/new?template=feature-request.md): what should change on screen, why it belongs
in this app, and how it fits [DESIGN.md](DESIGN.md). Keep the feature set small.

## Issue approval

1. Open an issue using the bug report or feature request template.
2. Agree on the scope and acceptance criteria with a maintainer. Wait for them
   to apply the `approved` label before opening a PR.
3. Link the approved issue in the PR body and keep the change within its agreed
   scope. Use `Closes #123` if merging should close the issue.

Issues have exactly one class: `bug` for a bug fix or `enhancement` for a feature
request. Other labels can help triage, but do not grant approval. Changes to
docs, tests, tooling, and dependencies still need an issue describing the bug
they fix or the improvement they propose.

Maintainers apply `approved` once the scope is settled. Approval means the work
is welcome for review; it does not guarantee the PR will be merged. Discuss
scope changes on the issue before expanding the PR.

Maintainers enforce this policy during review and may close PRs opened without
prior issue approval or outside the approved scope. PRs must also pass the
required `CI` check and receive maintainer review before merging.

## Labels

Use the same labels on issues and PRs. Every issue has exactly one of `bug`
or `enhancement`; apply the corresponding type to its PR for release notes.
Add other labels only when they help someone decide what to do next.

| Label | Use |
| --- | --- |
| `bug` | Existing behavior is broken. |
| `enhancement` | New capability or improvement. |
| `documentation` | Docs work; supplement the issue or PR type. |
| `approved` | A maintainer agreed to the issue scope before implementation. |
| `needs-author` | Waiting for information or changes from the author. |
| `blocked` | Waiting on another issue or an external dependency. |
| `help wanted` | Approved work available for a contributor to pick up. |
| `good first issue` | Approved, small, scoped work suitable for a newcomer. |
| `duplicate` | Already tracked elsewhere; link the original when closing. |
| `wontfix` | Outside scope or declined; explain the decision when closing. |

`approved` applies to issues and does not replace PR review. Remove
`needs-author` or `blocked` when the wait ends. Use GitHub review requests
to indicate that a PR needs review. Priority, component, and release labels
are not part of this set.

## Develop

Read [README.md](README.md) for the user guide and [DESIGN.md](DESIGN.md) for product
rules. [docs/README.md](docs/README.md) indexes internal docs.
[docs/protocol.md](docs/protocol.md) defines the engine/client contract;
[engine/README.md](engine/README.md) maps the backend.

Use an Omarchy desktop with Quickshell and OpenGL, `qt6-shadertools`, and
`socat`. `unzip` is only needed to refresh vendored fixtures. Install [mise](https://mise.jdx.dev), then from a checkout:

```sh
mise install
mise setup
mise start
```

The tree: `engine/` the Rust daemon, `ui/` the Quickshell client, `scripts/`
bootstrap and checks, `docs/` internal docs ([docs/README.md](docs/README.md)),
`data/` fixture provenance, `golden/` the decoder answer key, `site/`
omastorm.com.

Setup checks desktop dependencies, extracts verified fixtures, and builds the
engine. Rust comes from mise; use `mise exec -- cargo …` for Cargo commands.
[mise.toml](mise.toml) is the task and toolchain reference (`mise tasks` lists
jobs). For an offline archived scan:

```sh
OMASTORM_ARCHIVE=data/raw/KTLX20130520_201643_V06.gz mise start
```

The daemon is shared and outlives windows. Launch replaces a stale build and
open clients reconnect. Use `mise stop` to end it, never `kill`. Close only
Quickshell instances you launched; a windowless process left after closing is
a leak to investigate.

`mise start` loads this checkout's `ui/` in a window. The bar still uses the
installed plugin under `~/.config/omarchy/plugins/com.omastorm.radar` unless
you point it here:

```sh
mise plugin-link
```

That replaces the install directory with a symlink to this checkout (the
previous clone is kept beside it), restarts the Omarchy shell, and
enables the bar widget.
After that, `mise start`, `mise restart`, and `mise onboard` also restart the
shell so the popover matches this tree (a symlink skips the plugin file
watcher, and `rescanPlugins` keeps the old QML). `mise onboard`'s empty weather
and state files apply only to the window; the popover keeps its usual place
files. `mise plugin-unlink` restores the clone. A tty launch prints the qml path,
live vs archive, whether the bar is linked, and which config/state/place
files apply. `mise restart` stops the daemon first so a check or capture
leftover is not reused. `mise onboard` starts the window with no weather file
and no remembered view, so the location picker shows.

## What not to change

Do not bump [engine/release.pin](engine/release.pin) until the named GitHub
Release exists and its asset is verified. [docs/RELEASING.md](docs/RELEASING.md)
is the sequence.

[golden/](golden/) is the decoder's answer key. Regenerating it is a
decoder-contract change: keep the provenance and dates in the JSON, and do not
rewrite it to match a new decode by accident. Capture scripts write images
under `review/` for visual review; those stay out of git. README stills are
`docs/media/readme/` (`bash scripts/capture-readme.sh`). Include review
captures with a rendering change.

Capture scripts remove their temporary inputs, caches, and raw demo frames on
exit, including failures and handled signals. Final images and videos remain in
`review/` and `docs/media/`. Register cleanup immediately after `mktemp`, keep
helper directories inside the same scratch tree, and stop only processes owned
by that capture. Build outputs, fixtures, and the shared daemon are preserved.

Honor [DESIGN.md](DESIGN.md): actual scan times, no forecasts, chrome from the
Omarchy theme, radar color only from `frame.palette`.

## Verify and submit

Branch from `main`. One change per pull request. During iteration, run the
focused checks that cover the change:

| Change | Command |
| --- | --- |
| Engine logic, decoding, storage | `mise check-engine` |
| Wire output, commands, daemon lifecycle | `mise check-protocol` |
| QML, launcher, installer, UI integration | `mise check-ui` |
| Shader sampling, camera, rendering | `mise check-rendering` |

Focused checks support iteration and commits; they do not establish PR readiness.
Run `mise check` before marking a PR ready, plus the rendering checks and captures
below when applicable. The complete applicable suite gates readiness.

Checks use scratch daemons and leave the shared daemon alone. Cargo builds first;
Rust tests can overlap with UI work, but UI groups run sequentially to avoid
competing Quickshell/OpenGL harnesses. Concurrent check runners in the same
checkout are refused before touching scratch files. Scratch and logs live under
`target/check/`; runtime files are removed on exit, logs remain until the next
run. `target/check/logs/timings.tsv` records step durations and total wall time.
Step times overlap and should not be summed to infer wall time. The checks read
`target/debug/`, so leave `CARGO_TARGET_DIR` unset. CI runs on pull requests and pushes to `main` (avoiding duplicate branch/PR
runs), plus engine tags and manual runs. It selects jobs from the complete change
diff. Engine changes run native tests
and release builds on both Linux architectures, with formatting and Clippy once,
plus UI integration. UI-only changes skip Rust builds and tests and run against
the verified published engine pin. When engine and UI protocol versions match,
engine changes run UI checks against the source-built candidate; differing
versions keep UI checks on the pin and validate the candidate separately.
Version equality declares compatibility; UI integration checks test behavior.
Playback UI tests replay supplied frames and record emitted controls; they do
not assert frame order or loop policy. Those regressions live in the engine's
Rust tests, so an older compatible pin does not need unreleased engine behavior.

Installer-only changes run ShellCheck and focused installer/launcher checks.
Pin changes verify published checksums for both architectures and run UI checks.
Release-tool changes exercise tooling regressions, native builds, binary smoke
tests, and packaging without Rust lint/unit tests. Docs, branding, and
site-only changes get whitespace and changed-JSON validation. Mixed changes run
the union of their groups. CI/toolchain changes and unknown paths run everything,
as do engine tags and manual workflow runs. Shell changes also run ShellCheck.
The selected groups appear in the workflow summary.

UI CI runs in an Arch container with Qt Quick's OpenGL RHI and Mesa rendering;
it reuses verified or source-built binaries without compiling Rust. This covers
headless integration; desktop GPU rendering tests and review captures remain
required locally for shader, sampling, or camera changes. The final `CI` job
requires every selected job to pass, including jobs that fail to start. Configure
branch protection to require that single check. Report required checks that could
not run explicitly.

For shader, sampling, or camera changes, also run `mise check --gpu` and
`bash scripts/capture-review.sh`, inspect the images in `review/`, and include
captures with the review. The rendering test replays the shader's sampling
rule in Rust; update both when changing that rule. Rebuild changed radar,
tile, or grid shaders with `bash scripts/build-shader.sh` and commit their `.qsb` files.
The GPU checks need a desktop OpenGL context; software Qt Quick is unsupported.
If the environment cannot run a required check, report that explicitly.

Open a pull request linking the previously approved issue as described above.
Keep commits small. Commit messages and
pull request titles use
[Angular conventional commits](https://www.conventionalcommits.org/en/v1.0.0/#summary):

```text
<type>(optional-scope): <description>
```

Use a lowercase type (`feat`, `fix`, `docs`, `refactor`, `test`, `ci`,
`chore`, `perf`, `build`, `revert`), an imperative description, and no
trailing period. Scope is optional; common ones are `engine`, `ui`, `docs`,
and `scripts`. Examples:

```text
feat(ui): remember camera and station after reconnect
fix(engine): restart a quiet live poller instead of UNAVAILABLE
docs: document the first-time contributor path
ci: bump jdx/mise-action to v4.3.0
```

The pull request body says why the behavior changed and how you verified it.
Omit co-author and tool trailers. Update the relevant docs when behavior
changes. Document current behavior, not implementation history.

## Releases

Maintainers: [docs/RELEASING.md](docs/RELEASING.md).

## Contributors

Merged help is credited in the README with
[all-contributors](https://allcontributors.org). On a pull request or issue,
comment:

```text
@all-contributors please add @username for code
```

Use the right
[emoji key](https://allcontributors.org/docs/en/emoji-key) type
(`code`, `doc`, `bug`, `infra`, and so on). The bot opens a small follow-up
pull request that updates the contributor table.

## Conduct

Be kind and treat people well.

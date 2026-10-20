# Sceneplan decisions

Recorded 2026-10-20.

## Local trust boundary

The server binds to `127.0.0.1` by default. That is not authentication. Anyone who can open the port can change the database. Host must be `localhost` or `127.0.0.1`. State-changing requests need the `sp_csrf` cookie and a matching form field or `x-sceneplan-csrf` header. An `Origin` that parses as a URL must match the Host header. The literal Origin value `null`, which Chromium sent from the automation browser, is allowed only when `Sec-Fetch-Site` is `same-origin`, `none`, or absent. The CSRF token still has to match. SameSite=Strict is not treated as sufficient by itself.

## Plain JavaScript

The app is ESM JavaScript rather than TypeScript so it runs on Node 22 without a compile step or type-stripping flags. `node:sqlite` is experimental. The npm scripts pass `--disable-warning=ExperimentalWarning`.

## Script subset

Recognized headings, case-insensitive, optional period: `INT`, `EXT`, `INT/EXT`, `EXT/INT`, `I/E`, `EST`. An optional scene number may lead the line (`12` or `12A`, not `1.`) or sit in a trailing `#12#`. If both differ, the hash wins and the preview warns. Location and story time split on the last ` - `. Text before the first heading is preamble. A heading-like line that does not match stays in the scene body with a warning. This is not full Fountain. PDF and DOCX are rejected.

The original text is stored on `script_versions` and is not updated when a scene is edited. Review edits live on the preview, then become planning rows. Commit is one transaction. Limits: 512 KiB, 8,000 lines, 2,000 characters per line, 120 detected scenes.

## Ordering and conflicts

`sort_order` is rewritten in two phases inside `BEGIN IMMEDIATE`. Collection revisions live on the production, scene, or shoot day. A stale revision returns HTTP 409 and does not write. Duplicate display labels are allowed. Reorder is Move up and Move down. Alt+Arrow is an extra on a focused shot card. Drag-and-drop is not implemented.

## Durations and schedules

Minutes are nonnegative integers. Null means missing. Zero means a zero-minute estimate. A scene override wins. Otherwise the duration is the sum of shot shooting durations, and any missing shot makes the scene unknown. A partial sum is shown and is not used as the schedule duration. A scene with no shots and no override is unknown, not zero minutes.

Schedule times are computed from current committed data when the page or print view is rendered. They are not snapshotted. An unknown duration keeps earlier exact times, marks that item incomplete, and does not calculate later times. A maximum planned duration is a warning, not a validity failure.

Local start times are interpreted by sampling offsets around the wall time. Zero matches means the local time does not exist. More than one match means it is ambiguous. Both are rejected. A schedule that would change offset or reach the next local midnight is invalid, and clock labels are withheld. Adding an item that would make the day invalid is rejected. Reorder and delete stay available so the day can be repaired. Changing the production timezone keeps the local date and start strings and warns that the instants changed. `UTC` is not in this Node build's IANA list. The forms default to `America/New_York` when that zone exists. The control is a text field, not a select of every zone, because the full list made the page unusable.

## Images

JPEG and PNG only, checked by magic bytes, dimensions, and a real decode, then re-encoded to PNG. Storage keys are UUIDs. User filenames are display metadata only. SVG and executables are rejected. Files live under `data/uploads`, outside the application source. They are served from `/media/:id` as `image/png` with `nosniff`. Duplicated shots share the image row. The file is deleted only when the last shot reference is gone. `npm run cleanup-orphans` lists files with no row. `--apply` deletes those files. It does not delete rows whose files are already missing.

## Deletion

Removing a scene removes its shots and its schedule assignment after a confirm page. Removing a character or location that is still referenced is blocked. Removing a shoot day removes schedule items and leaves scenes and shots. Nothing here is reversible. There is no trash.

## JSON

Schema name `sceneplan.production`, version 1. Import creates a new production and new ids. `includesImageFiles` must be false. Storyboard references are dropped and counted in the preview.

## Print

Print routes are HTML without forms or navigation. The browser print dialog is the PDF path. The app does not write a PDF file. Print CSS forces black text on white because the screen palette is light-on-dark, and a more specific screen color was winning inside warnings.

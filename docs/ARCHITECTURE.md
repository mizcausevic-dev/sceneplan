# Sceneplan architecture

## Request path

`src/server.js` opens SQLite, purges import previews older than 24 hours, and listens. Before Hono reads a body, the HTTP server rejects a missing `Content-Length` with 411 and an oversize length with 413. Caps are about 1 MB for ordinary forms, 1.2 MB for script import, 1.7 MB for JSON, and 5.5 MB for a storyboard post. The image itself is capped at 5 MB after that.

`securityMiddleware` checks the Host, sets the CSRF cookie, and blocks a mismatched Origin. `assertCsrf` compares the cookie to the form field or header with `timingSafeEqual`. Responses send `nosniff`, a CSP with no inline scripts, and `no-store`.

HTML is built with a tagged template that escapes interpolated strings. User script text, notes, labels, captions, and filenames go through that path. There is no template execution.

## Data

One SQLite file. Foreign keys are on. Cross-production links are also rejected by triggers. A scene can appear in at most one `schedule_items` row, enforced by a partial unique index. Scene-work items store no duration. Other item kinds require a duration and have a null scene id.

Production delete removes children in a fixed order and then the upload directory. SQLite cascade from the production row is not relied on, because a location `RESTRICT` foreign key blocked a naive delete in a probe.

Display numbers and shot labels are editable and may repeat. The id does not change when the label or the sort position changes.

## Import

`parse-script.js` returns preamble, scenes, and warnings. The preview row stores the original text and the parsed JSON separately from the form the user edits. Commit writes a `script_versions` row, locations, scenes, and the edited preamble in one transaction, then deletes the preview. Unchecking a detected scene appends its submitted text to that preamble. If the form drops text the parser had found, commit refuses. An empty commit is refused.

Manual scene edits update `scenes`. They do not update `script_versions`. The scene page says so, and the Script page shows the snapshot.

## Ordering and concurrency

Moves are up or down only. The ordered ids are written to negative sort values, then to 1..n, in one immediate transaction, and the parent collection revision increments. A second tab still holding the old revision gets 409. Creating a scene appends and bumps the scene-order revision inside the transaction, so it does not depend on a hidden order field from the form.

## Scheduling

`interpretLocal` does not use Luxon's default gap and fold behavior. Luxon shifts a spring-forward time forward and picks one fall-back offset. Sceneplan counts distinct instants that round-trip to the requested local parts. The schedule walk then uses Luxon only to add minutes to a resolved instant and to detect an offset change or the next local midnight.

`sceneDuration` applies the override, else the shot sum, else unknown. `calculateSchedule` stops the clock at the first unknown duration.

## Uploads

`transcodeStoryboard` checks the filename extension, magic bytes, and pixel bounds before decode, then writes a PNG with a new uuid name using the exclusive-create flag. The database insert happens after the file write. If the insert fails, the new file is removed. Replacing an image drops the previous row only when no shot still points at it.

## What is intentionally absent

No accounts. No remote image URLs. No image generation. No PDF parser. No claim that the printed times are a call sheet.

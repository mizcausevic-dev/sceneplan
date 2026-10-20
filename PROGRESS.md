# Sceneplan progress

Wall clock recorded from `2026-10-20T18:32:05Z` to `2026-10-20T19:28:17Z`. That is 56 minutes 12 seconds. It is not five hours of active work, and it is not a measure of uninterrupted coding time.

## Done

- SQLite schema, domain services, Fountain-style subset parser, live schedule math, and PNG storyboard storage.
- Server-rendered workspace: productions, scenes, shots, people, places, schedule, import review, script snapshots, JSON transfer, and three print views.
- Fictional seed: Paper Boats on Mercer Street, through the same functions the app uses.
- HTTP tests for CSRF, host checks, escaped text, import, conflicts, images, print HTML, body-size limits, process restart, and JSON transfer.
- Browser pass on `http://127.0.0.1:4173`: create production, add scene and shot, open the seed, read warnings, switch to the shot table, reorder a schedule row and restore it at a 390px width, and open print views. Print media was emulated. A generated PDF was not produced.

## Verification still open

- Moving a shot to another scene has an implementation and no automated or browser execution.
- A storyboard card taller than one printed page was not inspected. `break-inside: avoid` is set, and the seeded print views fit the viewport that was captured.
- Clean setup was run: the tree was copied to `/tmp/sceneplan-clean` without `node_modules`, `npm ci` installed 5 packages, and `npm test` reported 25 pass, 0 fail.
- GitHub push and GitHub Pages were not completed. `gh auth status` reported no login, and `GH_TOKEN` is unset. `git push -u origin HEAD` failed because origin does not exist. `gh repo create` stopped at the login prompt. Pages cannot run this Node server, so no static stand-in was published. Local commit: `70b6d39` on `cursor/sceneplan-local-preproduction-bf6f`. The commit author is `mizcausevic-dev@users.noreply.github.com` because this environment had no git identity configured.

## Next

Run the shot-move case through HTTP, then inspect one over-long print card in an actual print-to-PDF capture.

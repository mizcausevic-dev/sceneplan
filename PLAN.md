# Sceneplan plan

Sceneplan is a local preproduction workspace for one filmmaker on one computer. The working path is create a production, add or import scenes, plan shots, attach storyboard images, schedule a shoot day, and print the shot list and schedule.

## Stack

Node.js 22 ESM, no build step. Hono on the loopback interface. SQLite through `node:sqlite`, with the schema applied from `src/schema.sql` on first open. Images are re-encoded to PNG and stored under `data/uploads`. Luxon supplies timezone-aware instants. The app does not call a paid API.

## Milestones

1. Schema, validation, script parsing, duration rules, and image checks. Done. Covered by unit tests.
2. Production, scene, shot, schedule, and import services with optimistic revisions. Done. Covered by domain tests.
3. Server-rendered workspace, print HTML, seed, and HTTP tests. Done.
4. Browser pass of the seeded production, print-media inspection, and contrast repair. Done.
5. Not in this version: PDF or DOCX import, full Fountain, drag-and-drop as the only reorder, splitting one scene across days, matching shots from an older script version, accounts, or a public deploy.

## Scope choices

- Import fills an empty production or creates a new one. It does not merge into a production that already has scenes.
- Schedule durations are live. They are recalculated from the current scene override or shot estimates.
- Duplicate display numbers and shot labels are allowed. Identity is a UUID.
- JSON transfer is metadata only. It is not a backup of storyboard files.
- Print output is HTML for the browser print dialog. It is not a generated PDF file.

## Priorities if work continues

1. Exercise shot move-between-scenes in the browser and add that case to the HTTP suite.
2. Add a page-break fixture whose text is longer than one printed page and inspect the PDF, not only print CSS.
3. Only after that, consider PDF import. Do not start it while the two gaps above are open.

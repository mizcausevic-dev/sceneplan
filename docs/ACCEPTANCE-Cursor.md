# Sceneplan acceptance

Date of the runs: 2026-10-20.

Automated tests and these scenarios are different counts. The scenario lines below are the mission list. A line is PASS only for the portion that was executed. The rest of a mixed line stays NOT RUN.

## Automated tests

`npm test` on 2026-10-20 ran `tests/*.test.js` and reported 25 tests, 25 pass, 0 fail. That command includes the restart test, the seed test, and the HTTP reorder, character-delete, and JSON test. Do not add the scenario count below to 25.

Parser, schedule math, image rejection, domain integrity, seed, and HTTP workflow are separate files. They use disposable SQLite directories except the seed test, which uses its own temp `DATA_DIR`.

## Browser and print inspection

Playwright drove `http://127.0.0.1:4173` after `npm run seed` and `npm start`.

Observed:

- Created production Browser Cut, scene EXT. ALLEY - NIGHT, shot 9A. That production was then deleted through `deleteProduction` so the data directory again holds only Paper Boats on Mercer Street.
- Seed overview listed the unscheduled-scene warning, the unknown-duration warning, the missing shot estimate, the zero-minute estimate, and the location-change reminder.
- Laundromat scene showed two images, both alt text "Placeholder drawing of a folded paper boat on a dark dryer.", natural size 320 by 180. Table view rendered a table.
- Schedule rows ran from 16:00 to 19:39. Moving the first row down changed its start to 16:18. Moving it back restored 16:00. At 390 by 844 CSS pixels, `scrollWidth` did not exceed the viewport by more than 8 pixels.
- Print schedule and print shot list had zero `form` elements. The scene print had zero buttons. The location warning remained. Under emulated print media, warning and note text computed to `rgb(17, 17, 17)` on white after the contrast fix.
- Shots without an image showed the text "No storyboard".

Not observed: a PDF from the system print dialog, or a card forced to be taller than one page.

Screenshots from that pass: `docs/print-schedule-media-Cursor.png`, `docs/print-scene-shots-Cursor.png`, `docs/schedule-mobile-Cursor.png`. `docs/print-schedule-screen-Cursor.png` is an earlier screen-media capture of the same route, taken before the print-contrast change.

## Scenarios

1. Create a production and persist it across a server restart. PASS. `tests/http.test.js` starts `src/server.js`, POSTs a production, kills the process, starts again, and reads the name. The browser also created a production and loaded it after navigation.

2. Create and edit a scene manually. PASS. The HTTP workflow POSTs a scene and then POSTs a heading change that returns 303. The browser created EXT. ALLEY - NIGHT.

3. Import supported text, review boundaries, and commit atomically. PASS. The HTTP test posts a two-scene paste, sees both headings on the review page, commits, and lands on the new production.

4. Preserve original source and unrecognized text. PASS for preamble and scene text: the script snapshot page still contains "Keep this preamble." and "Ada waits." PASS for a non-matching heading staying in the body: `tests/parser.test.js`. An HTTP upload of a malformed heading was not a separate run.

5. Reject invalid imports without damaging existing work. PASS. Parser tests reject empty input, UTF-16, bad UTF-8, DOCX bytes, and oversize text. The domain test rolls back a failed commit and leaves no production. The HTTP test's bad import into a production that already has scenes returns 400.

6. Prevent an import from silently replacing existing planning data. PASS. HTTP and domain both refuse a second import into a production that has scenes.

7. Add, edit, duplicate, reorder, and move shots.
   - Add: PASS. HTTP and browser.
   - Edit: PASS. Domain test updates a shot duration and the schedule follows after the override is cleared.
   - Duplicate: PASS. HTTP duplicate keeps the image URL on both shots.
   - Reorder: PASS for the domain move and for an HTTP stale-revision move returning 409. A successful shot reorder through HTTP was not asserted.
   - Move to another scene: NOT RUN. `moveShot` is implemented and was not executed by a test or the browser.

8. Refresh and verify ordering and relationships. PASS for read-back inside the same process: domain tests and the HTTP pages after create, duplicate, and schedule. A browser reload of shot order was not a separate step. NOT RUN for that reload.

9. Detect conflicting record edits and conflicting reorders. PASS. HTTP scene save with revision 1 after a successful save returns 409. HTTP shot move with order revision 1 after two creates returns 409. Domain tests cover the same conflicts.

10. Enforce deletion and reference rules. PASS. Domain: character delete blocked while linked, scene delete removes shots and the schedule item, then the character can be deleted, shared image file remains after one shot delete and is removed after the last. HTTP: deleting Nia while she is on a scene returns 400, and posting that character id to another production returns 404.

11. Upload a valid image and display it on the correct shot. PASS. HTTP upload returns the scene page with the alt text and `/media/` responds `image/png`. The seeded boat image rendered in the browser at 320 by 180.

12. Reject oversized, malformed, unsupported, and path-manipulation uploads. PASS. `tests/images.test.js` covers SVG name, non-image bytes, broken JPEG magic, 5 MB plus one byte, a 5000 px edge, and path traversal. HTTP rejects an SVG upload. The domain image test stores `../../<img>.png` only as a display name. The storage key does not contain `..`.

13. Delete a duplicated shot without breaking a shared image. PASS. Domain test and the HTTP test, which still finds the media URL after the copy is deleted.

14. Verify untrusted text and filenames cannot execute markup or scripts. PASS. A production name containing `<script>alert(1)</script>` is stored and rendered escaped. The HTTP image upload filename `../../<img src=x onerror=alert(1)>.png` does not appear as a raw tag. CSP has no inline script.

15. Assign scenes and reject duplicate assignments. PASS. HTTP second assignment returns 400 and says the scene is already assigned. Domain test throws the same rule.

16. Reorder items and verify calculated times. PASS. Browser: first row moved down, start changed from 16:00 to 16:18, then restored to 16:00. Seed schedule ends at 19:39 in both the seed test and the print page.

17. Verify override precedence and incomplete-duration behavior. PASS. `tests/schedule.test.js` and the domain schedule test. The seed's river scene is a 40 minute override while its shots sum to less, and scene 5 is unknown rather than zero. The overview showed that warning in the browser.

18. Verify estimate changes propagate to live schedules. PASS. Domain test: override end stays 16:25 after a shot edit, then clearing the override moves the end to 17:30 from the shot sum.

19. Reject unsupported midnight and timezone-transition cases. PASS. Schedule tests reject the spring-forward gap, the fall-back fold, a midnight crossing, and an offset change inside the day. HTTP create of a shoot day at 2026-03-08 02:30 America/New_York returns 400 and says the time does not exist.

20. Verify planning warnings and timezone-change behavior. PASS for warnings, in the browser text quoted above and in the seed test. PASS for timezone: the domain test changes the zone and the stored local date and start time stay 2026-04-18 16:00. The timezone warning copy is on the production form. That form was not submitted in the browser.

21. Verify printed shot lists and schedules use committed data. PASS. HTTP print of the test day contains the production name, America/New_York, and 16:08, which is 16:00 plus the 8 minute shot. The seeded print page lists the same 16:00 through 19:39 sequence as `dayView`.

22. Verify editing controls are excluded and warnings remain visible. PASS. Browser print pages: no forms, no nav, scene print had no buttons, warning text present and, after the CSS fix, dark on white.

23. Inspect long-content and missing-image print layouts.
   - Missing image: PASS. Scene print shows "No storyboard" for shots without a file, observed in the print-media screenshot.
   - Long content: NOT RUN as a page-break test. Seeded cards fit the captured page. CSS sets `break-inside: avoid` and does not set a clipping `max-height` on the card. That is not a measurement of a multi-page card.

24. Verify JSON export/import round-trip. PASS. HTTP downloads export JSON with `includesImageFiles: false`, the preview says image files are not included, commit creates a different production id, and the scene heading is on the new production. The domain test checks new ids and a null image reference.

## Not implemented

- PDF or DOCX import.
- Full Fountain.
- Drag-and-drop reorder.
- Splitting one scene across more than one shoot day.
- Automatic matching of scenes between script versions.
- Reversible deletion.
- Accounts, and any public deployment.
- Downloadable PDF generation. Print means printable HTML.
- Remote image URLs and image generation.

## Clean setup

Verified. The source tree was copied to `/tmp/sceneplan-clean` without `node_modules`. `npm ci` added 5 packages. `npm test` then reported 25 pass, 0 fail on Node v22.23.3.

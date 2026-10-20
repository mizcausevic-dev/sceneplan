# Sceneplan

Local preproduction workspace for an independent filmmaker. Create a production, add or import scenes, plan shots, attach storyboard images, schedule a shoot day, and print a shot list or daily schedule.

It runs on this computer. It does not sign anyone in. Binding to loopback is not authentication. Do not expose the port.

Durations are planning estimates you type. Story time of day, such as NIGHT, is not the call time. A location-change warning is a reminder, not a travel-time calculation. The schedule does not check labor rules, union rules, safety, performer availability, or equipment conflicts. Deletion is permanent.

## Prerequisites

- Node.js 22.13 or newer (`node:sqlite` is built in)
- npm

No database server, no API key, and no network call at runtime.

## Setup

```bash
npm ci
npm test
npm run seed
npm start
```

Open `http://127.0.0.1:4173`.

`npm run seed` inserts the fictional short film Paper Boats on Mercer Street when that name is not already present. It does not download images. Running it twice does not duplicate the film.

Optional environment, see `.env.example`:

```bash
HOST=127.0.0.1
PORT=4173
DATA_DIR=./data
```

`PORT=0` asks the operating system for a free port. The process prints the actual URL. A non-loopback `HOST` starts, and the log says there is no login.

The database file is `data/sceneplan.sqlite`. Uploads are `data/uploads/<production id>/<uuid>.png`. Both are gitignored.

## Other commands

```bash
npm run cleanup-orphans
npm run cleanup-orphans -- --apply
```

The first command lists image files that have no storyboard row. `--apply` deletes those files. It does not remove database rows. A shot whose file is missing shows that on the scene page.

## What the script import accepts

UTF-8 `.txt` or pasted text. Headings, any case, optional period: `INT`, `EXT`, `INT/EXT`, `EXT/INT`, `I/E`, `EST`. Optional scene number `12` or `12A` at the start, or `#12#` at the end. Location and story time split on the last ` - `. Text before the first heading is kept and shown before you save. This is not full Fountain. PDF and DOCX are refused.

If the current production already has scenes, the import form creates a new production instead of merging or replacing.

## Print

Shot list for a scene, shot list for a shoot day, and the shoot-day schedule are HTML pages. Use the browser print command. Sceneplan does not generate a PDF file.

## JSON

Export from the Script page. The file's `includesImageFiles` field is false. Import previews the payload and creates a new production with new ids. It is not a complete backup.

## Layout of the code

- `src/server.js` listens.
- `src/schema.sql` is migration `001_init`.
- `src/domain.js` is the write path.
- `src/parse-script.js`, `src/duration.js`, `src/time.js`, `src/images.js`, `src/transfer.js` are the pure pieces with tests beside them.
- `docs/ARCHITECTURE.md` records import, ordering, concurrency, scheduling, uploads, and the trust boundary.
- `docs/ACCEPTANCE-Cursor.md` scores the requested scenarios from the runs that actually happened.

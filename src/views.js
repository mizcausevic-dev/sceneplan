import { html, render } from "./html.js"
import { durationLabel } from "./duration.js"
import { CAMERA_ANGLES, CAMERA_MOVES, INT_EXT, ITEM_KINDS, PLANNING_STATUSES, SHOT_SIZES, STORY_TIMES } from "./limits.js"
import { intExtLabel, scalar, statusLabel } from "./forms.js"
import { scheduleWarnings } from "./domain.js"
import { timezoneNames } from "./time.js"

const ZONES = timezoneNames()

function options(list, selected) {
  return list.map((item) => {
    const value = typeof item === "string" ? item : item.value
    const label = typeof item === "string" ? item : item.label
    return html`<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`
  })
}

function zoneValue(selected) {
  if (ZONES.includes(selected)) return selected
  if (ZONES.includes("America/New_York")) return "America/New_York"
  return ZONES[0] || ""
}

function hidden(csrf) {
  return html`<input type="hidden" name="_csrf" value="${csrf}">`
}

function shortId(id) {
  return String(id).slice(0, 8)
}

function shotName(shot) {
  return shot.display_label || "Untitled shot"
}

export function page(value) {
  return render(value)
}

export function shell({ title, body, notice = "", production = null, current = "" }) {
  const nav = production ? html`<nav class="subnav wrap" aria-label="Production">
    ${[
      ["Overview", `/productions/${production.id}`, "overview"],
      ["Schedule", `/productions/${production.id}/schedule`, "schedule"],
      ["People", `/productions/${production.id}/people`, "people"],
      ["Places", `/productions/${production.id}/places`, "places"],
      ["Script", `/productions/${production.id}/script`, "script"],
    ].map(([label, href, key]) => html`<a href="${href}" ${key === current ? html`aria-current="page"` : ""}>${label}</a>`)}
  </nav>` : ""
  return html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${title}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/app.css">
</head>
<body>
  <a class="skip" href="#content">Skip to content</a>
  <header class="topbar wrap">
    <a class="brand" href="/"><strong>Sceneplan</strong><small>Local preproduction workspace</small></a>
    <p class="lede">Scenes, shots, storyboards, and shoot days for one production at a time.</p>
  </header>
  ${nav}
  <main id="content" class="wrap stack">
    ${notice ? html`<p class="notice" role="status">${notice}</p>` : ""}
    ${body}
  </main>
  <footer class="footer wrap">Sceneplan binds to this computer by default. Reaching the port is enough to change data. There is no login. Deletion is permanent.</footer>
  <script src="/assets/app.js" defer></script>
</body>
</html>`
}

export function printShell({ title, body }) {
  return html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="stylesheet" href="/assets/app.css">
</head>
<body>
  <main id="content" class="wrap stack">
    <p class="no-print">Use the browser print command. This page is HTML for printing, not a downloaded PDF.</p>
    ${body}
  </main>
</body>
</html>`
}

function warnList(items) {
  if (!items?.length) return ""
  return html`<ul class="warnings">${items.map((item) => html`<li><strong>Warning.</strong> ${item.text || item.message || ""}</li>`)}</ul>`
}

export function messagePage(title, message) {
  return shell({ title, body: html`<article class="panel stack"><h1>${title}</h1><p>${message}</p><p><a href="/">Back to productions</a></p></article>` })
}

export function homePage({ productions, csrf, error = "", draft = null }) {
  const name = draft ? scalar(draft, "name") : ""
  const zone = draft ? scalar(draft, "timezone") : "America/New_York"
  return shell({
    title: "Sceneplan",
    body: html`<section class="stack">
      <p class="kicker">Independent film preproduction</p>
      <h1>Plan the shoot before the day eats the plan.</h1>
      <p>Create a production, break it into scenes and shots, attach storyboard frames, then build a shoot day. Durations are estimates you enter. Story time of day is not the call time.</p>
      ${error ? html`<p class="form-error" role="alert">${error}</p>` : ""}
      <div class="grid-2">
        <form class="panel fields" method="post" action="/productions">
          ${hidden(csrf)}
          <h2>New production</h2>
          <label><span>Name</span><input name="name" required maxlength="160" value="${name}"></label>
          <label><span>Timezone</span><input name="timezone" required maxlength="80" value="${zoneValue(zone)}" autocomplete="off"></label>
          <p class="meta">IANA name, such as America/New_York. The server rejects a name this runtime does not know.</p>
          <label><span>Logline</span><input name="logline" maxlength="500" value="${draft ? scalar(draft, "logline") : ""}"></label>
          <label><span>Notes</span><textarea name="notes">${draft ? scalar(draft, "notes") : ""}</textarea></label>
          <button type="submit">Create production</button>
        </form>
        <form class="panel fields" method="post" action="/import" enctype="multipart/form-data">
          ${hidden(csrf)}
          <h2>New production from a script</h2>
          <p>UTF-8 .txt only. A supported Fountain-style heading subset. You review scenes before anything is saved.</p>
          <label><span>Name</span><input name="name" required maxlength="160"></label>
          <label><span>Timezone</span><input name="timezone" required maxlength="80" value="${zoneValue("America/New_York")}" autocomplete="off"></label>
          <label><span>Paste script</span><textarea name="script_text"></textarea></label>
          <label><span>Or upload .txt</span><input type="file" name="script" accept=".txt,text/plain"></label>
          <button type="submit">Review import</button>
        </form>
      </div>
      <section class="stack">
        <h2>Productions</h2>
        ${productions.length ? html`<ul class="stripboard">${productions.map((item) => html`<li>
          <a href="/productions/${item.id}"><strong>${item.name}</strong><br><span class="meta">${item.timezone}</span></a>
          <span class="id">${shortId(item.id)}</span>
        </li>`)}</ul>` : html`<p class="panel">No productions yet. The fictional demo is separate: run <code>npm run seed</code> if you want sample data.</p>`}
      </section>
    </section>`,
  })
}

export function productionPage({ production, scenes, warnings, days, query, csrf, error = "" }) {
  return shell({
    title: production.name,
    production,
    current: "overview",
    body: html`<article class="stack">
      <p class="kicker">${production.timezone}</p>
      <h1>${production.name}</h1>
      ${production.logline ? html`<p>${production.logline}</p>` : ""}
      ${error ? html`<p class="form-error" role="alert">${error}</p>` : ""}
      ${warnList(warnings)}
      <div class="workspace">
        <section class="stack">
          <form method="get" class="inline" action="/productions/${production.id}">
            <label><span class="field-label">Find scenes</span><input name="q" value="${query}" placeholder="Heading, character, place"></label>
            <button class="secondary" type="submit">Filter</button>
          </form>
          <p class="inline"><a class="button" href="/productions/${production.id}/scenes/new">New scene</a>
            <a class="button secondary" href="/productions/${production.id}/import">Import script</a></p>
          ${scenes.length ? html`<ol class="stripboard">${scenes.map((scene) => html`<li>
            <a href="/productions/${production.id}/scenes/${scene.id}">
              <span class="num">${scene.display_number || "#"}</span>
              ${scene.heading}
              <br><span class="meta">${intExtLabel(scene.int_ext)} · ${scene.story_time_of_day || "No story time"} · ${scene.locationName || "No location"} · ${durationLabel(scene.duration)}</span>
            </a>
            <span class="actions">
              <form method="post" action="/productions/${production.id}/scenes/${scene.id}/move" data-move="up">
                ${hidden(csrf)}
                <input type="hidden" name="direction" value="up">
                <input type="hidden" name="order_revision" value="${production.scene_order_revision}">
                <button class="secondary" type="submit">Move up</button>
              </form>
              <form method="post" action="/productions/${production.id}/scenes/${scene.id}/move">
                ${hidden(csrf)}
                <input type="hidden" name="direction" value="down">
                <input type="hidden" name="order_revision" value="${production.scene_order_revision}">
                <button class="secondary" type="submit">Move down</button>
              </form>
            </span>
          </li>`)}</ol>` : html`<p class="panel">No scenes match. Add one manually or import a text script.</p>`}
        </section>
        <aside class="stack">
          <section class="panel">
            <h2>Shoot days</h2>
            ${days.length ? html`<ul>${days.map((view) => html`<li><a href="/productions/${production.id}/days/${view.day.id}">${view.day.local_date} ${view.day.label}</a> <span class="meta">${view.calc.status}</span></li>`)}</ul>` : html`<p>No shoot days yet.</p>`}
            <p><a href="/productions/${production.id}/schedule">Open the schedule</a></p>
          </section>
          <form class="panel fields" method="post" action="/productions/${production.id}">
            ${hidden(csrf)}
            <input type="hidden" name="revision" value="${production.revision}">
            <h2>Production details</h2>
            <label><span>Name</span><input name="name" required value="${production.name}"></label>
            <label><span>Timezone</span><input name="timezone" required maxlength="80" value="${zoneValue(production.timezone)}" autocomplete="off"></label>
            <p class="meta">Changing timezone keeps the local dates and start times already entered. Their real-world instants can change. Review every shoot day after saving.</p>
            <label><span>Logline</span><input name="logline" value="${production.logline}"></label>
            <label><span>Notes</span><textarea name="notes">${production.notes}</textarea></label>
            <button type="submit">Save production</button>
          </form>
          <p><a class="danger" href="/productions/${production.id}/delete">Delete this production</a></p>
        </aside>
      </div>
    </article>`,
  })
}

function sceneFields({ production, scene = null, locations, characters, selected, csrf, draft = null, orderRevision = null }) {
  const pick = (name, fallback = "") => draft ? scalar(draft, name) : fallback
  const selectedIds = draft ? new Set([].concat(draft.character_ids || []).flat()) : selected
  return html`<form class="panel fields" method="post" action="${scene ? `/productions/${production.id}/scenes/${scene.id}` : `/productions/${production.id}/scenes`}">
    ${hidden(csrf)}
    ${scene ? html`<input type="hidden" name="revision" value="${scene.revision}">` : html`<input type="hidden" name="order_revision" value="${orderRevision}">`}
    <label><span>Scene number</span><input name="display_number" maxlength="12" value="${pick("display_number", scene?.display_number || "")}"></label>
    <label><span>Heading</span><input name="heading" required maxlength="240" value="${pick("heading", scene?.heading || "")}"></label>
    <label><span>Interior / exterior</span><select name="int_ext">${options(INT_EXT, pick("int_ext", scene?.int_ext || "INT"))}</select></label>
    <label><span>Location</span><select name="location_id"><option value="">No location</option>${options(locations.map((row) => ({ value: row.id, label: row.name })), pick("location_id", scene?.location_id || ""))}</select></label>
    <label><span>Or new location</span><input name="new_location_name" value="${pick("new_location_name", "")}"></label>
    <label><span>Story time of day</span><input name="story_time_of_day" list="story-times" value="${pick("story_time_of_day", scene?.story_time_of_day || "")}"><datalist id="story-times">${STORY_TIMES.map((time) => html`<option value="${time}"></option>`)}</datalist></label>
    <p class="meta">Story time is a script label such as NIGHT. It is not the scheduled clock time.</p>
    <label><span>Script text</span><textarea name="script_text">${pick("script_text", scene?.script_text || "")}</textarea></label>
    <label><span>Synopsis</span><textarea name="synopsis">${pick("synopsis", scene?.synopsis || "")}</textarea></label>
    <label><span>Production notes</span><textarea name="production_notes">${pick("production_notes", scene?.production_notes || "")}</textarea></label>
    <label><span>Shooting duration override, minutes</span><input name="shooting_duration_override_minutes" inputmode="numeric" value="${pick("shooting_duration_override_minutes", scene?.shooting_duration_override_minutes ?? "")}"></label>
    <p class="meta">Leave the override blank to add up shot shooting durations. Blank shots make the scene duration unknown. Zero is a real estimate of zero minutes, not a missing value.</p>
    <fieldset class="checks"><legend>Characters</legend>
      ${characters.length ? characters.map((row) => html`<label><input type="checkbox" name="character_ids" value="${row.id}" ${selectedIds.has(row.id) ? "checked" : ""}> ${row.name}</label>`) : html`<p>No characters yet.</p>`}
    </fieldset>
    <label><span>Add a character</span><input name="new_character_name" value="${pick("new_character_name", "")}"></label>
    <button type="submit">${scene ? "Save scene" : "Create scene"}</button>
  </form>`
}

function shotForm(action, csrf, orderRevision, shot = null) {
  return html`<form class="fields" method="post" action="${action}">
    ${hidden(csrf)}
    ${shot ? html`<input type="hidden" name="revision" value="${shot.revision}">` : html`<input type="hidden" name="order_revision" value="${orderRevision}">`}
    <label><span>Label</span><input name="display_label" maxlength="40" value="${shot?.display_label || ""}"></label>
    <label><span>Description</span><textarea name="description">${shot?.description || ""}</textarea></label>
    <label><span>Shot size</span><select name="shot_size"><option value="">Unset</option>${options(SHOT_SIZES, shot?.shot_size || "")}</select></label>
    <label><span>Camera angle</span><select name="camera_angle"><option value="">Unset</option>${options(CAMERA_ANGLES, shot?.camera_angle || "")}</select></label>
    <label><span>Camera movement</span><select name="camera_movement"><option value="">Unset</option>${options(CAMERA_MOVES, shot?.camera_movement || "")}</select></label>
    <label><span>Lens note</span><input name="lens_note" value="${shot?.lens_note || ""}"></label>
    <label><span>Shooting duration, minutes</span><input name="shooting_duration_minutes" inputmode="numeric" value="${shot?.shooting_duration_minutes ?? ""}"></label>
    <p class="meta">This is estimated shooting time, not expected on-screen time. Leave it blank when you do not know. Do not enter zero unless you mean zero minutes.</p>
    <label><span>Equipment notes</span><textarea name="equipment_notes">${shot?.equipment_notes || ""}</textarea></label>
    <label><span>Planning status</span><select name="planning_status">${options(PLANNING_STATUSES, shot?.planning_status || "planned")}</select></label>
    <label><span>Storyboard description</span><input name="image_alt" value="${shot?.image_alt || ""}"></label>
    <button type="submit">${shot ? "Save shot" : "Add shot"}</button>
  </form>`
}

function shotActions(production, scene, shot, csrf) {
  return html`<div class="actions">
    <form method="post" action="/productions/${production.id}/shots/${shot.id}/move" data-move="up">
      ${hidden(csrf)}
      <input type="hidden" name="direction" value="up">
      <input type="hidden" name="order_revision" value="${scene.shot_order_revision}">
      <button class="secondary" type="submit">Move up</button>
    </form>
    <form method="post" action="/productions/${production.id}/shots/${shot.id}/move" data-move="down">
      ${hidden(csrf)}
      <input type="hidden" name="direction" value="down">
      <input type="hidden" name="order_revision" value="${scene.shot_order_revision}">
      <button class="secondary" type="submit">Move down</button>
    </form>
    <form method="post" action="/productions/${production.id}/shots/${shot.id}/duplicate">
      ${hidden(csrf)}
      <input type="hidden" name="order_revision" value="${scene.shot_order_revision}">
      <button class="secondary" type="submit">Duplicate shot</button>
    </form>
    <a href="/productions/${production.id}/shots/${shot.id}/delete">Remove shot</a>
  </div>
  <form class="fields" method="post" action="/productions/${production.id}/shots/${shot.id}/transfer">
    ${hidden(csrf)}
    <input type="hidden" name="revision" value="${shot.revision}">
    <input type="hidden" name="source_order_revision" value="${scene.shot_order_revision}">
    <label><span>Move to scene</span>
      <select name="target_scene_id">${production.sceneChoices.map((choice) => html`<option value="${choice.id}" ${choice.id === scene.id ? "disabled" : ""}>${choice.display_number || "unnumbered"} ${choice.heading}</option>`)}</select>
    </label>
    ${(production.sceneChoices || []).map((choice) => html`<input type="hidden" name="target_rev_${choice.id}" value="${choice.shot_order_revision}">`)}
    <button class="secondary" type="submit">Move to scene</button>
  </form>`
}

function frameFor(shot) {
  if (!shot.image) return html`<div class="frame"><p>No storyboard</p></div>`
  if (shot.imageMissing) return html`<div class="frame"><p>Storyboard file missing. ${shot.image_alt || "No description"}</p></div>`
  return html`<div class="frame"><img src="/media/${shot.image.id}" alt="${shot.image_alt || "Storyboard image"}"></div>
    <p class="meta">${shot.image_alt}</p>`
}

export function scenePage({ bundle, view, status, csrf, error = "" }) {
  const { production, scene, shots, duration, characters, selected, locations, scriptVersion } = bundle
  const visible = status ? shots.filter((shot) => shot.planning_status === status) : shots
  const banner = scriptVersion
    ? html`<p class="callout">Editing this scene changes planning content. It does not change the imported script snapshot from ${scriptVersion.created_at}. <a href="/productions/${production.id}/script/${scriptVersion.id}">Read the snapshot</a>.</p>`
    : html`<p class="callout">This scene is planning content. It is not tied to an imported script snapshot.</p>`
  return shell({
    title: scene.heading,
    production,
    current: "overview",
    body: html`<article class="stack">
      <p class="kicker"><a href="/productions/${production.id}">${production.name}</a></p>
      <h1><span class="num">${scene.display_number || "Unnumbered"}</span> ${scene.heading}</h1>
      <p class="meta">${intExtLabel(scene.int_ext)} · Story time ${scene.story_time_of_day || "unset"} · ${durationLabel(duration)} · Internal id ${shortId(scene.id)}</p>
      ${banner}
      ${error ? html`<p class="form-error" role="alert">${error}</p>` : ""}
      <div class="grid-2">
        ${sceneFields({ production, scene, locations, characters, selected, csrf })}
        <section class="stack">
          <div class="inline">
            <a href="?view=cards">Card view</a>
            <a href="?view=table">Table view</a>
            <a href="/productions/${production.id}/scenes/${scene.id}/print">Print shot list</a>
            <a class="danger" href="/productions/${production.id}/scenes/${scene.id}/delete">Remove scene</a>
          </div>
          <form method="get" class="inline">
            <label><span class="field-label">Status</span><select name="status"><option value="">All</option>${options(PLANNING_STATUSES, status)}</select></label>
            <input type="hidden" name="view" value="${view}">
            <button class="secondary" type="submit">Filter</button>
          </form>
          ${view === "table" ? html`<div class="table-wrap"><table>
            <caption>Shots in ${scene.heading}</caption>
            <thead><tr><th>Label</th><th>Description</th><th>Size</th><th>Angle</th><th>Move</th><th>Shooting min</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>${visible.map((shot) => html`<tr data-shot="${shot.id}">
              <td>${shotName(shot)}</td>
              <td>${shot.description}</td>
              <td>${shot.shot_size}</td>
              <td>${shot.camera_angle}</td>
              <td>${shot.camera_movement}</td>
              <td>${shot.shooting_duration_minutes ?? "Missing"}</td>
              <td class="status status-${shot.planning_status}">${statusLabel(shot.planning_status)}</td>
              <td>${shotActions({ ...production, sceneChoices: bundle.scenes }, scene, shot, csrf)}
                <details><summary>Edit shot</summary>${shotForm(`/productions/${production.id}/shots/${shot.id}`, csrf, scene.shot_order_revision, shot)}</details>
              </td>
            </tr>`)}</tbody>
          </table></div>` : html`<div class="shot-grid">${visible.map((shot) => html`<article class="shot-card" data-shot="${shot.id}" tabindex="0">
            <p class="status status-${shot.planning_status}">${statusLabel(shot.planning_status)} · ${shotName(shot)}</p>
            ${frameFor(shot)}
            <p>${shot.description || "No description yet."}</p>
            <p class="meta">${[shot.shot_size, shot.camera_angle, shot.camera_movement].filter(Boolean).join(" · ") || "Camera unset"} · ${shot.shooting_duration_minutes == null ? "Shooting duration missing" : `${shot.shooting_duration_minutes} shooting min`}</p>
            ${shot.lens_note ? html`<p class="meta">Lens: ${shot.lens_note}</p>` : ""}
            ${shotActions({ ...production, sceneChoices: bundle.scenes }, scene, shot, csrf)}
            <details><summary>Edit shot</summary>${shotForm(`/productions/${production.id}/shots/${shot.id}`, csrf, scene.shot_order_revision, shot)}</details>
            <form class="fields" method="post" action="/productions/${production.id}/shots/${shot.id}/image" enctype="multipart/form-data">
              ${hidden(csrf)}
              <input type="hidden" name="revision" value="${shot.revision}">
              <label><span>Storyboard JPEG or PNG</span><input type="file" name="image" accept="image/jpeg,image/png,.jpg,.jpeg,.png"></label>
              <label><span>Description of the image</span><input name="image_alt" value="${shot.image_alt || shot.description || ""}"></label>
              <button class="secondary" type="submit">Upload storyboard</button>
            </form>
            ${shot.image ? html`<form method="post" action="/productions/${production.id}/shots/${shot.id}/image/remove">
              ${hidden(csrf)}
              <input type="hidden" name="revision" value="${shot.revision}">
              <button class="secondary" type="submit">Remove image from this shot</button>
            </form>` : ""}
            <p class="id">Internal id ${shortId(shot.id)}. Alt plus Up or Down moves the focused shot.</p>
          </article>`)}</div>`}
          ${visible.length ? "" : html`<p class="panel">No shots in this view. A scene with no shots and no override has an unknown duration.</p>`}
          <section class="panel stack"><h2>Add a shot</h2>${shotForm(`/productions/${production.id}/scenes/${scene.id}/shots`, csrf, scene.shot_order_revision)}</section>
        </section>
      </div>
    </article>`,
  })
}

export function newScenePage({ production, locations, characters, csrf, error = "", draft = null }) {
  return shell({
    title: "New scene",
    production,
    current: "overview",
    body: html`<article class="stack"><h1>New scene</h1>${error ? html`<p class="form-error" role="alert">${error}</p>` : ""}${sceneFields({ production, locations, characters, selected: new Set(), csrf, draft, orderRevision: production.scene_order_revision })}</article>`,
  })
}

export function confirmPage({ title, production, text, action, csrf, fields }) {
  return shell({
    title,
    production,
    body: html`<article class="panel stack"><h1>${title}</h1><p>${text}</p><p><strong>This cannot be undone.</strong> Sceneplan has no restore.</p>
      <form method="post" action="${action}">${hidden(csrf)}${fields}<button class="danger" type="submit">Delete permanently</button></form></article>`,
  })
}

export function peoplePage({ production, characters, csrf, error = "" }) {
  return shell({
    title: "People",
    production,
    current: "people",
    body: html`<section class="stack"><h1>Characters</h1><p>Duplicate display names are not allowed. Removing a character who is still in a scene is blocked.</p>
      ${error ? html`<p class="form-error" role="alert">${error}</p>` : ""}
      ${characters.map((row) => html`<form class="panel fields" method="post" action="/productions/${production.id}/people/${row.id}">
        ${hidden(csrf)}
        <input type="hidden" name="revision" value="${row.revision}">
        <label><span>Name</span><input name="name" required value="${row.name}"></label>
        <label><span>Notes</span><textarea name="notes">${row.notes}</textarea></label>
        <div class="inline"><button type="submit">Save character</button><a href="/productions/${production.id}/people/${row.id}/delete">Remove</a></div>
      </form>`)}
      <form class="panel fields" method="post" action="/productions/${production.id}/people">
        ${hidden(csrf)}
        <h2>Add character</h2>
        <label><span>Name</span><input name="name" required></label>
        <label><span>Notes</span><textarea name="notes"></textarea></label>
        <button type="submit">Add character</button>
      </form></section>`,
  })
}

export function placesPage({ production, locations, csrf, error = "" }) {
  return shell({
    title: "Places",
    production,
    current: "places",
    body: html`<section class="stack"><h1>Locations</h1><p>A location that is still linked to a scene cannot be removed until those scenes are reassigned.</p>
      ${error ? html`<p class="form-error" role="alert">${error}</p>` : ""}
      ${locations.map((row) => html`<form class="panel fields" method="post" action="/productions/${production.id}/places/${row.id}">
        ${hidden(csrf)}
        <input type="hidden" name="revision" value="${row.revision}">
        <label><span>Name</span><input name="name" required value="${row.name}"></label>
        <label><span>Notes</span><textarea name="notes">${row.notes}</textarea></label>
        <div class="inline"><button type="submit">Save location</button><a href="/productions/${production.id}/places/${row.id}/delete">Remove</a></div>
      </form>`)}
      <form class="panel fields" method="post" action="/productions/${production.id}/places">
        ${hidden(csrf)}
        <h2>Add location</h2>
        <label><span>Name</span><input name="name" required></label>
        <label><span>Notes</span><textarea name="notes"></textarea></label>
        <button type="submit">Add location</button>
      </form></section>`,
  })
}

function dayStatus(calc) {
  if (calc.status === "valid") return "Timing valid"
  if (calc.status === "incomplete") return "Timing incomplete"
  return "Not valid"
}

export function schedulePage({ production, days, unscheduled, csrf }) {
  return shell({
    title: "Schedule",
    production,
    current: "schedule",
    body: html`<section class="stack">
      <h1>Shoot days</h1>
      <p>Each scene can be on one shoot day. Scene durations on a day are live: they follow the current override, or the current sum of shot shooting durations. These are planning estimates, not predictions.</p>
      ${days.map((view) => html`<article class="panel">
        <h2><a href="/productions/${production.id}/days/${view.day.id}">${view.day.local_date} ${view.day.local_start_time} ${view.day.label}</a></h2>
        <p>${dayStatus(view.calc)}. ${view.calc.totalKnown ? `${view.calc.knownMinutes} planned minutes.` : "Some later times are not calculated."}</p>
      </article>`)}
      <form class="panel fields" method="post" action="/productions/${production.id}/days">
        ${hidden(csrf)}
        <h2>Add a shoot day</h2>
        <label><span>Local date</span><input name="local_date" required placeholder="2026-04-18"></label>
        <label><span>Local start time</span><input name="local_start_time" required placeholder="08:00"></label>
        <label><span>Label</span><input name="label" placeholder="Main unit"></label>
        <label><span>Maximum planned minutes</span><input name="max_planned_duration_minutes" inputmode="numeric"></label>
        <label><span>Notes</span><textarea name="notes"></textarea></label>
        <button type="submit">Add shoot day</button>
      </form>
      <section class="panel"><h2>Not scheduled</h2>${unscheduled.length ? html`<ul>${unscheduled.map((scene) => html`<li>${scene.display_number || "unnumbered"} ${scene.heading}</li>`)}</ul>` : html`<p>Every scene is on a shoot day.</p>`}</section>
    </section>`,
  })
}

export function dayPage({ production, view, csrf, error = "" }) {
  const { day, calc, unscheduled } = view
  const warnings = scheduleWarnings(calc)
  return shell({
    title: day.local_date,
    production,
    current: "schedule",
    body: html`<article class="stack">
      <p class="kicker">${production.timezone}</p>
      <h1>${day.local_date} ${day.label || "Shoot day"}</h1>
      <p>Clock times use the production timezone and the current committed estimates. Story time on a scene is separate. ${dayStatus(calc)}.</p>
      ${error ? html`<p class="form-error" role="alert">${error}</p>` : ""}
      ${calc.status === "invalid" ? html`<p class="callout bad"><strong>Not valid.</strong> ${calc.reason}</p>` : ""}
      ${warnList(warnings)}
      <p class="inline no-print">
        <a href="/productions/${production.id}/days/${day.id}/print/shots">Print shot list</a>
        <a href="/productions/${production.id}/days/${day.id}/print/schedule">Print schedule</a>
        <a class="danger" href="/productions/${production.id}/days/${day.id}/delete">Remove shoot day</a>
      </p>
      <div class="table-wrap"><table>
        <caption>Schedule for ${day.local_date}</caption>
        <thead><tr><th>Order</th><th>Activity</th><th>Duration</th><th>Start</th><th>End</th><th></th></tr></thead>
        <tbody>${calc.items.map((item, index) => html`<tr class="schedule-block">
          <td>${index + 1}</td>
          <td>${item.kind === "scene_work" ? html`<a href="/productions/${production.id}/scenes/${item.sceneId}">${item.displayNumber || "unnumbered"} ${item.sceneHeading}</a><br><span class="meta">Story time ${item.storyTime || "unset"} · ${item.locationName || "No location"}</span>` : item.label}</td>
          <td>${item.durationMinutes == null ? "Unknown" : `${item.durationMinutes} min`}${item.durationSource === "override" ? " override" : ""}</td>
          <td>${item.startLabel || (item.timing === "incomplete" ? "Known start, end unknown" : "Not calculated")}</td>
          <td>${item.endLabel || (item.timing === "incomplete" ? "Incomplete" : "Not calculated")}</td>
          <td class="actions">
            <form method="post" action="/productions/${production.id}/items/${item.id}/move">${hidden(csrf)}<input type="hidden" name="direction" value="up"><input type="hidden" name="order_revision" value="${day.schedule_order_revision}"><button class="secondary" type="submit">Move up</button></form>
            <form method="post" action="/productions/${production.id}/items/${item.id}/move">${hidden(csrf)}<input type="hidden" name="direction" value="down"><input type="hidden" name="order_revision" value="${day.schedule_order_revision}"><button class="secondary" type="submit">Move down</button></form>
            <a href="/productions/${production.id}/items/${item.id}/delete">Remove</a>
            ${item.kind === "scene_work" ? "" : html`<details><summary>Edit activity</summary>
              <form method="post" action="/productions/${production.id}/items/${item.id}" class="fields">${hidden(csrf)}
                <input type="hidden" name="revision" value="${item.revision}">
                <label><span>Label</span><input name="label" value="${item.label}"></label>
                <label><span>Minutes</span><input name="duration_minutes" value="${item.duration_minutes}"></label>
                <button type="submit">Save activity</button>
              </form></details>`}
          </td>
        </tr>`)}</tbody>
      </table></div>
      <div class="grid-2">
        <form class="panel fields" method="post" action="/productions/${production.id}/days/${day.id}/scenes">
          ${hidden(csrf)}
          <input type="hidden" name="order_revision" value="${day.schedule_order_revision}">
          <h2>Add scene work</h2>
          <label><span>Unscheduled scene</span><select name="scene_id">${unscheduled.map((scene) => html`<option value="${scene.id}">${scene.display_number || "unnumbered"} ${scene.heading}</option>`)}</select></label>
          <button type="submit" ${unscheduled.length ? "" : "disabled"}>Add scene</button>
        </form>
        <form class="panel fields" method="post" action="/productions/${production.id}/days/${day.id}/activities">
          ${hidden(csrf)}
          <input type="hidden" name="order_revision" value="${day.schedule_order_revision}">
          <h2>Add break, move, or other</h2>
          <label><span>Kind</span><select name="kind">${options(ITEM_KINDS.filter((item) => item.value !== "scene_work"), "break")}</select></label>
          <label><span>Label</span><input name="label" required></label>
          <label><span>Minutes</span><input name="duration_minutes" required inputmode="numeric"></label>
          <button type="submit">Add activity</button>
        </form>
      </div>
      <form class="panel fields" method="post" action="/productions/${production.id}/days/${day.id}">
        ${hidden(csrf)}
        <input type="hidden" name="revision" value="${day.revision}">
        <h2>Day setup</h2>
        <label><span>Local date</span><input name="local_date" value="${day.local_date}"></label>
        <label><span>Local start</span><input name="local_start_time" value="${day.local_start_time}"></label>
        <label><span>Label</span><input name="label" value="${day.label}"></label>
        <label><span>Maximum planned minutes</span><input name="max_planned_duration_minutes" value="${day.max_planned_duration_minutes ?? ""}"></label>
        <label><span>Notes</span><textarea name="notes">${day.notes}</textarea></label>
        <button type="submit">Save shoot day</button>
      </form>
    </article>`,
  })
}

export function importPage({ production, blocked, csrf, error = "" }) {
  return shell({
    title: "Import script",
    production,
    current: "script",
    body: html`<article class="stack"><h1>Import a script</h1>
      <p>Supported headings, case-insensitive, optional period: INT, EXT, INT/EXT, EXT/INT, I/E, EST. Optional scene number before the heading (<code>12</code> or <code>12A</code>) or a Fountain-style <code>#12#</code> at the end. Location and story time split on the last <code> - </code>. Text before the first heading is kept as unassigned text. This is not full Fountain, and PDF or DOCX is not accepted.</p>
      ${error ? html`<p class="form-error" role="alert">${error}</p>` : ""}
      ${blocked ? html`<p class="callout bad">This production already has scenes. Sceneplan will not merge or replace them. Create another production from the script instead.</p>
        <form class="panel fields" method="post" action="/import" enctype="multipart/form-data">${hidden(csrf)}
          <label><span>New production name</span><input name="name" required></label>
          <label><span>Timezone</span><input name="timezone" required maxlength="80" value="${zoneValue(production.timezone)}" autocomplete="off"></label>
          <label><span>Paste</span><textarea name="script_text"></textarea></label>
          <label><span>.txt upload</span><input type="file" name="script" accept=".txt,text/plain"></label>
          <button type="submit">Review as a new production</button>
        </form>` : html`<form class="panel fields" method="post" action="/productions/${production.id}/import" enctype="multipart/form-data">${hidden(csrf)}
          <label><span>Paste</span><textarea name="script_text"></textarea></label>
          <label><span>.txt upload</span><input type="file" name="script" accept=".txt,text/plain"></label>
          <button type="submit">Review scenes</button>
        </form>`}
    </article>`,
  })
}

function sceneEditor(prefix, scene, index) {
  return html`<fieldset class="panel fields">
    <legend>Detected scene ${index + 1}${scene.sourceLine ? ` from line ${scene.sourceLine}` : ""}</legend>
    <label><input type="checkbox" name="${prefix}_include" value="yes" checked> Save as a scene. Uncheck to keep its text in unassigned planning text instead of dropping it.</label>
    <label><span>Number</span><input name="${prefix}_number" value="${scene.displayNumber || ""}"></label>
    <label><span>Interior / exterior</span><select name="${prefix}_int_ext">${options(INT_EXT, scene.intExt || "INT")}</select></label>
    <label><span>Location name</span><input name="${prefix}_location" value="${scene.locationName || ""}"></label>
    <label><span>Story time</span><input name="${prefix}_time" value="${scene.storyTime || ""}"></label>
    <label><span>Heading</span><input name="${prefix}_heading" value="${scene.heading || ""}"></label>
    <label><span>Text</span><textarea name="${prefix}_text">${scene.scriptText || ""}</textarea></label>
  </fieldset>`
}

export function reviewPage({ preview, csrf, error = "" }) {
  const payload = preview.payload
  return shell({
    title: "Review import",
    body: html`<article class="stack"><h1>Review detected scenes</h1>
      <p>Nothing is saved until you commit. The original text stays on an immutable script version. Edits here become planning content. ${preview.mode === "new" ? `This will create ${preview.new_name}.` : "This will fill the empty production."}</p>
      ${error ? html`<p class="form-error" role="alert">${error}</p>` : ""}
      ${warnList(payload.warnings)}
      <form method="post" action="/import/${preview.id}/commit" class="stack">${hidden(csrf)}
        <label><span>Unassigned text</span><textarea name="preamble">${payload.preamble || ""}</textarea></label>
        ${payload.scenes.map((scene, index) => sceneEditor(`scene_${index}`, scene, index))}
        <details class="panel"><summary>Add up to three scenes that the parser missed</summary>
          ${[0, 1, 2].map((index) => html`<fieldset class="fields"><legend>Extra scene ${index + 1}</legend>
            <label><span>Number</span><input name="extra_${index}_number"></label>
            <label><span>Interior / exterior</span><select name="extra_${index}_int_ext">${options(INT_EXT, "INT")}</select></label>
            <label><span>Location</span><input name="extra_${index}_location"></label>
            <label><span>Story time</span><input name="extra_${index}_time"></label>
            <label><span>Heading</span><input name="extra_${index}_heading"></label>
            <label><span>Text</span><textarea name="extra_${index}_text"></textarea></label>
          </fieldset>`)}
        </details>
        <button type="submit">Commit import</button>
      </form></article>`,
  })
}

export function scriptPage({ production, versions, csrf, error = "" }) {
  return shell({
    title: "Script",
    production,
    current: "script",
    body: html`<section class="stack"><h1>Script versions</h1>
      <p>Snapshots are read-only. Scene edits do not rewrite them. Comparison does not migrate shots or schedules.</p>
      ${error ? html`<p class="form-error" role="alert">${error}</p>` : ""}
      ${versions.length ? html`<ul>${versions.map((version) => html`<li><a href="/productions/${production.id}/script/${version.id}">${version.created_at}</a> ${version.source_kind} ${version.original_filename}</li>`)}</ul>` : html`<p>No imported script yet.</p>`}
      ${versions.length >= 2 ? html`<form method="get" action="/productions/${production.id}/script/compare" class="panel fields">
        <h2>Compare original text</h2>
        <label><span>Older</span><select name="a">${versions.map((version) => html`<option value="${version.id}">${version.created_at}</option>`)}</select></label>
        <label><span>Newer</span><select name="b">${versions.map((version) => html`<option value="${version.id}">${version.created_at}</option>`)}</select></label>
        <button type="submit">Compare</button>
      </form>` : ""}
      <section class="panel stack">
        <h2>Metadata transfer</h2>
        <p>JSON export does not include storyboard files. It is not a complete backup. Import creates a new production and new internal ids.</p>
        <p><a href="/productions/${production.id}/export.json">Download JSON</a></p>
        <form method="post" action="/transfer" enctype="multipart/form-data" class="fields">${hidden(csrf)}
          <label><span>JSON file</span><input type="file" name="json" accept="application/json,.json"></label>
          <button type="submit">Review JSON import</button>
        </form>
      </section>
      <p><a href="/productions/${production.id}/import">Import a text script</a></p>
    </section>`,
  })
}

export function scriptTextPage({ production, version }) {
  return shell({
    title: "Script snapshot",
    production,
    current: "script",
    body: html`<article class="stack"><h1>Script snapshot</h1><p class="meta">${version.created_at} · ${version.source_kind} · ${version.original_filename || "pasted text"}</p><h2>Original text</h2><pre>${version.original_text}</pre><h2>Unassigned text saved with the import</h2><pre>${version.committed_preamble || ""}</pre></article>`,
  })
}

export function comparePage({ production, left, right }) {
  return shell({
    title: "Compare scripts",
    production,
    current: "script",
    body: html`<article class="stack"><h1>Read-only comparison</h1><div class="split"><section><h2>${left.created_at}</h2><pre>${left.original_text}</pre></section><section><h2>${right.created_at}</h2><pre>${right.original_text}</pre></section></div></article>`,
  })
}

export function jsonPreviewPage({ summary, csrf }) {
  return shell({
    title: "Review JSON import",
    body: html`<article class="panel stack"><h1>Import into a new production</h1>
      <p>${summary.name}: ${summary.scenes} scenes, ${summary.shots} shots, ${summary.days} shoot days.</p>
      <p><strong>Image files are not included.</strong> ${summary.omittedImageRefs} storyboard references will be dropped. This is not a full restore.</p>
      <form method="post" action="/transfer/${summary.id}/commit">${hidden(csrf)}<button type="submit">Create production</button></form></article>`,
  })
}

export function printScene({ production, bundle }) {
  const { scene, shots, duration } = bundle
  return printShell({
    title: `Shot list ${scene.heading}`,
    body: html`<header><p class="kicker">${production.name} · ${production.timezone}</p><h1>Shot list</h1><p>${scene.display_number || "Unnumbered"} ${scene.heading}</p><p>${durationLabel(duration)}. Estimates are planning figures.</p></header>
      ${duration.known ? "" : html`<p class="callout bad"><strong>Warning.</strong> This scene duration is unknown. Missing shot estimates are not treated as zero.</p>`}
      <h2>Script text</h2><pre class="script">${scene.script_text}</pre>
      ${shots.map((shot) => html`<article class="shot-card"><h2>${shotName(shot)} · ${statusLabel(shot.planning_status)}</h2>${frameFor(shot)}<p>${shot.description}</p><p>${shot.shot_size} ${shot.camera_angle} ${shot.camera_movement}</p><p>${shot.shooting_duration_minutes == null ? "Shooting duration missing" : `${shot.shooting_duration_minutes} shooting minutes`}</p></article>`)}`,
  })
}

export function printDayShots({ production, view }) {
  const warnings = scheduleWarnings(view.calc)
  return printShell({
    title: `Shot list ${view.day.local_date}`,
    body: html`<header><p class="kicker">${production.name} · ${view.day.local_date} · ${production.timezone}</p><h1>Shoot day shot list</h1><p>${view.day.label} starts ${view.day.local_start_time}. Scene durations are live estimates from current committed data.</p></header>
      ${warnList(warnings)}
      ${view.calc.status === "invalid" ? html`<p class="callout bad"><strong>Not valid.</strong> ${view.calc.reason}</p>` : ""}
      ${view.calc.items.filter((item) => item.kind === "scene_work").map((item) => html`<section class="schedule-block"><h2>${item.displayNumber || "Unnumbered"} ${item.sceneHeading}</h2><p>${item.durationMinutes == null ? "Duration unknown" : `${item.durationMinutes} min`} ${item.durationSource === "override" ? "override" : ""}</p>
        ${(item.shots || []).map((shot) => html`<article class="shot-card"><h3>${shot.display_label || "Untitled shot"}</h3><p>${shot.description}</p><p>${shot.shooting_duration_minutes == null ? "Shooting duration missing" : `${shot.shooting_duration_minutes} shooting minutes`}</p></article>`)}
      </section>`)}`,
  })
}

export function printSchedule({ production, view }) {
  const warnings = scheduleWarnings(view.calc)
  return printShell({
    title: `Schedule ${view.day.local_date}`,
    body: html`<header><p class="kicker">${production.name} · ${production.timezone}</p><h1>${view.day.local_date} ${view.day.label}</h1><p>Start ${view.day.local_start_time}. ${dayStatus(view.calc)}. Times use current committed estimates.</p></header>
      ${view.calc.status === "invalid" ? html`<p class="callout bad"><strong>Not valid.</strong> ${view.calc.reason} Clock times are withheld.</p>` : ""}
      ${warnList(warnings)}
      <table><thead><tr><th>Activity</th><th>Duration</th><th>Start</th><th>End</th></tr></thead><tbody>
        ${view.calc.items.map((item) => html`<tr class="schedule-block"><td>${item.kind === "scene_work" ? `${item.displayNumber || ""} ${item.sceneHeading}` : item.label}</td><td>${item.durationMinutes == null ? "Unknown" : item.durationMinutes}</td><td>${item.startLabel || "Not calculated"}</td><td>${item.endLabel || (item.timing === "incomplete" ? "Incomplete" : "Not calculated")}</td></tr>`)}
      </tbody></table>
      ${view.day.notes ? html`<h2>Notes</h2><pre class="script">${view.day.notes}</pre>` : ""}`,
  })
}

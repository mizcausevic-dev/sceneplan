import { getCookie, setCookie } from "hono/cookie"
import { existsSync } from "node:fs"
import { resolveUploadPath } from "./images.js"
import { HttpError, NotFoundError, ValidationError } from "./errors.js"
import { assertCsrf } from "./security.js"
import { readActivityInput, readDuration, readProductionInput, readRevision, readSceneInput, readShootDayInput, readShotInput, readText, readTimezone, scalar } from "./forms.js"
import { page, homePage, productionPage, scenePage, newScenePage, confirmPage, peoplePage, placesPage, schedulePage, dayPage, importPage, reviewPage, scriptPage, scriptTextPage, comparePage, jsonPreviewPage, printScene, printDayShots, printSchedule, messagePage } from "./views.js"
import { html, escapeHtml } from "./html.js"
import { get } from "./db.js"
import {
  addActivityToDay,
  addSceneToDay,
  clearShotImage,
  commitScriptPreview,
  createCharacter,
  createLocation,
  createProduction,
  createScene,
  createShootDay,
  createShot,
  dayView,
  deleteCharacter,
  deleteLocation,
  deleteProduction,
  deleteScene,
  deleteScheduleItem,
  deleteShootDay,
  deleteShot,
  duplicateShot,
  getPreview,
  getScriptVersion,
  imageForRequest,
  listCharacters,
  listDays,
  listLocations,
  listProductions,
  listScriptVersions,
  moveOrdered,
  moveShot,
  mustProduction,
  mustScene,
  previewFromUpload,
  productionWarnings,
  purgeExpiredPreviews,
  saveShotImage,
  sceneBundle,
  shotContext,
  unscheduledScenes,
  updateActivity,
  updateCharacter,
  updateLocation,
  updateProduction,
  updateScene,
  updateShootDay,
  updateShot,
  workspaceScenes,
} from "./domain.js"
import { commitJsonPreview, exportProduction, storeJsonPreview } from "./transfer.js"

const NOTICES = {
  saved: "Saved.",
  created: "Created.",
  deleted: "Deleted. This cannot be undone.",
  imported: "Import saved. The original script text is unchanged. Later scene edits change planning content only.",
  "tz-changed": "Timezone updated. Local shoot dates and start times were kept. Their corresponding instants may have changed. Review each shoot day.",
  "image-saved": "Storyboard stored. It was re-encoded to PNG. The original upload was not kept as a file.",
  copied: "Shot copied. The copy has a new id. A storyboard image, if there was one, is shared rather than cloned.",
  edge: "That item is already at the end of the list.",
}

function notice(c) {
  return NOTICES[c.req.query("notice")] || ""
}

function fail(c, error) {
  if (error instanceof HttpError) {
    const title = error.status === 409 ? "Edit conflict" : error.status === 404 ? "Not found" : error.status === 403 ? "Blocked" : "Cannot complete that action"
    return send(c, messagePage(title, error.message), error.status)
  }
  console.error(error)
  return send(c, messagePage("Something went wrong", "The last action failed. The previous save was not confirmed."), 500)
}

function guard(c, fn) {
  return Promise.resolve().then(fn).catch((error) => fail(c, error))
}

function go(c, path) {
  if (!path.startsWith("/")) throw new Error("Refusing an external redirect.")
  return c.redirect(path, 303)
}

function send(c, view, status = 200) {
  let body = page(view)
  const text = notice(c)
  if (text && body.includes("class=\"topbar wrap\"")) {
    body = body.replace(
      "<main id=\"content\" class=\"wrap stack\">",
      `<main id="content" class="wrap stack"><p class="notice no-print" role="status">${escapeHtml(text)}</p>`,
    )
  }
  return c.html(body, status)
}

function sameProduction(row, productionId, message) {
  if (!row || row.production_id !== productionId) throw new NotFoundError(message)
  return row
}

function ownedCharacter(db, productionId, id) {
  return sameProduction(get(db, "SELECT * FROM characters WHERE id = ?", id), productionId, "Character not found.")
}

function ownedLocation(db, productionId, id) {
  return sameProduction(get(db, "SELECT * FROM locations WHERE id = ?", id), productionId, "Location not found.")
}

function ownedDay(db, productionId, dayId) {
  const row = get(db, "SELECT * FROM shoot_days WHERE id = ?", dayId)
  return sameProduction(row, productionId, "Shoot day not found.")
}

function ownedItem(db, productionId, itemId) {
  const row = get(db, `SELECT schedule_items.*, shoot_days.production_id AS production_id
    FROM schedule_items
    JOIN shoot_days ON shoot_days.id = schedule_items.shoot_day_id
    WHERE schedule_items.id = ?`, itemId)
  return sameProduction(row, productionId, "Schedule item not found.")
}

async function posted(c) {
  const body = await c.req.parseBody({ all: true })
  assertCsrf(c, body)
  return body
}

function uploaded(body, name) {
  const value = body?.[name]
  const file = Array.isArray(value) ? value.find((item) => item && typeof item.arrayBuffer === "function") : value
  if (!file || typeof file.arrayBuffer !== "function" || file.size === 0) return null
  return file
}

function annotate(bundle, uploadDir) {
  for (const shot of bundle.shots) {
    if (!shot.image) continue
    try {
      shot.imageMissing = !existsSync(resolveUploadPath(uploadDir, shot.image.production_id, shot.image.storage_key))
    } catch {
      shot.imageMissing = true
    }
  }
  return bundle
}

function preferredView(c) {
  const query = c.req.query("view")
  if (query === "table" || query === "cards") {
    setCookie(c, "sp_view", query, { path: "/", sameSite: "Strict", httpOnly: false })
    return query
  }
  return getCookie(c, "sp_view") === "table" ? "table" : "cards"
}

async function scriptPreview(db, body, extra) {
  const file = uploaded(body, "script")
  if (file) {
    const buffer = Buffer.from(await file.arrayBuffer())
    return previewFromUpload(db, { ...extra, buffer, filename: file.name || "script.txt", sourceKind: "upload" })
  }
  const text = String(scalar(body, "script_text") || "")
  if (!text.trim()) throw new ValidationError("Paste a script or choose a UTF-8 .txt file.")
  return previewFromUpload(db, { ...extra, text, sourceKind: "paste" })
}

export function register(app, { db, uploadDir }) {
  app.get("/health", (c) => c.text("ok"))
  app.get("/", (c) => guard(c, () => {
    purgeExpiredPreviews(db)
    return send(c, homePage({ productions: listProductions(db), csrf: c.get("csrf") }))
  }))
  app.post("/productions", (c) => guard(c, async () => {
    const body = await posted(c)
    try {
      const id = createProduction(db, readProductionInput(body))
      return go(c, `/productions/${id}?notice=created`)
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error
      return send(c, homePage({ productions: listProductions(db), csrf: c.get("csrf"), error: error.message, draft: body }), 400)
    }
  }))
  app.post("/import", (c) => guard(c, async () => {
    const body = await posted(c)
    const name = readText(scalar(body, "name"), { max: 160, label: "Production name", required: true })
    const timezone = readTimezone(scalar(body, "timezone"))
    const preview = await scriptPreview(db, body, { name, timezone, logline: "" })
    return go(c, `/import/${preview.id}`)
  }))
  app.get("/import/:previewId", (c) => guard(c, () => {
    const preview = getPreview(db, c.req.param("previewId"))
    if (preview.mode === "json") throw new NotFoundError()
    return send(c, reviewPage({ preview, csrf: c.get("csrf") }))
  }))
  app.post("/import/:previewId/commit", (c) => guard(c, async () => {
    const body = await posted(c)
    try {
      const productionId = commitScriptPreview(db, c.req.param("previewId"), body)
      return go(c, `/productions/${productionId}?notice=imported`)
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error
      const preview = getPreview(db, c.req.param("previewId"))
      return send(c, reviewPage({ preview, csrf: c.get("csrf"), error: error.message }), 400)
    }
  }))
  app.post("/transfer", (c) => guard(c, async () => {
    const body = await posted(c)
    const file = uploaded(body, "json")
    if (!file) throw new ValidationError("Choose a JSON file.")
    const summary = storeJsonPreview(db, Buffer.from(await file.arrayBuffer()).toString("utf8"))
    return go(c, `/transfer/${summary.id}`)
  }))
  app.get("/transfer/:previewId", (c) => guard(c, () => {
    const preview = getPreview(db, c.req.param("previewId"))
    if (preview.mode !== "json") throw new NotFoundError()
    const payload = JSON.parse(preview.payload_json)
    const shots = Array.isArray(payload.shots) ? payload.shots : []
    return send(c, jsonPreviewPage({
      csrf: c.get("csrf"),
      summary: {
        id: preview.id,
        name: preview.new_name,
        scenes: payload.scenes?.length || 0,
        shots: shots.length,
        days: payload.shootDays?.length || 0,
        omittedImageRefs: shots.filter((shot) => shot.storyboardImageId).length,
      },
    }))
  }))
  app.post("/transfer/:previewId/commit", (c) => guard(c, async () => {
    await posted(c)
    const result = commitJsonPreview(db, c.req.param("previewId"))
    return go(c, `/productions/${result.productionId}?notice=imported`)
  }))
  app.get("/productions/:pid", (c) => guard(c, () => {
    const production = mustProduction(db, c.req.param("pid"))
    const query = String(c.req.query("q") || "").slice(0, 100)
    return send(c, productionPage({
      production,
      scenes: workspaceScenes(db, production.id, query),
      warnings: productionWarnings(db, production.id),
      days: listDays(db, production.id),
      query,
      csrf: c.get("csrf"),
    }))
  }))
  app.post("/productions/:pid", (c) => guard(c, async () => {
    const body = await posted(c)
    const result = updateProduction(db, c.req.param("pid"), readProductionInput(body, { revision: true }))
    return go(c, `/productions/${c.req.param("pid")}?notice=${result.timezoneChanged ? "tz-changed" : "saved"}`)
  }))
  app.get("/productions/:pid/delete", (c) => guard(c, () => {
    const production = mustProduction(db, c.req.param("pid"))
    return send(c, confirmPage({
      title: `Delete ${production.name}`,
      production,
      text: "Deleting the production removes its scenes, shots, schedule, script snapshots, and storyboard files.",
      action: `/productions/${production.id}/delete`,
      csrf: c.get("csrf"),
      fields: html`<input type="hidden" name="revision" value="${production.revision}">`,
    }))
  }))
  app.post("/productions/:pid/delete", (c) => guard(c, async () => {
    const body = await posted(c)
    deleteProduction(db, uploadDir, c.req.param("pid"), readRevision(body))
    return go(c, "/?notice=deleted")
  }))
  app.get("/productions/:pid/scenes/new", (c) => guard(c, () => {
    const production = mustProduction(db, c.req.param("pid"))
    return send(c, newScenePage({
      production,
      locations: listLocations(db, production.id),
      characters: listCharacters(db, production.id),
      csrf: c.get("csrf"),
    }))
  }))
  app.post("/productions/:pid/scenes", (c) => guard(c, async () => {
    const production = mustProduction(db, c.req.param("pid"))
    const body = await posted(c)
    try {
      const id = createScene(db, production.id, readSceneInput(body))
      return go(c, `/productions/${production.id}/scenes/${id}?notice=created`)
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error
      return send(c, newScenePage({
        production,
        locations: listLocations(db, production.id),
        characters: listCharacters(db, production.id),
        csrf: c.get("csrf"),
        error: error.message,
        draft: body,
      }), 400)
    }
  }))
  app.get("/productions/:pid/scenes/:sid", (c) => guard(c, () => renderScene(c, db, uploadDir)))
  app.post("/productions/:pid/scenes/:sid", (c) => guard(c, async () => {
    const body = await posted(c)
    const scene = mustScene(db, c.req.param("sid"))
    if (scene.production_id !== c.req.param("pid")) throw new NotFoundError()
    try {
      updateScene(db, scene.id, readSceneInput(body, { revision: true }))
      return go(c, `/productions/${scene.production_id}/scenes/${scene.id}?notice=saved`)
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error
      return send(c, scenePage({
        bundle: annotate(sceneBundle(db, scene.id), uploadDir),
        view: preferredView(c),
        status: "",
        csrf: c.get("csrf"),
        error: error.message,
      }), 400)
    }
  }))
  app.post("/productions/:pid/scenes/:sid/move", (c) => guard(c, async () => {
    const body = await posted(c)
    const scene = mustScene(db, c.req.param("sid"))
    if (scene.production_id !== c.req.param("pid")) throw new NotFoundError()
    const moved = moveOrdered(db, "scenes", scene.production_id, scene.id, scalar(body, "direction"), readRevision(body, "order_revision"))
    return go(c, `/productions/${scene.production_id}?notice=${moved.moved ? "saved" : "edge"}`)
  }))
  app.get("/productions/:pid/scenes/:sid/delete", (c) => guard(c, () => {
    const production = mustProduction(db, c.req.param("pid"))
    const scene = mustScene(db, c.req.param("sid"))
    if (scene.production_id !== production.id) throw new NotFoundError()
    return send(c, confirmPage({
      title: "Remove scene",
      production,
      text: `Removing ${scene.heading} also removes its shots and its shoot-day assignment.`,
      action: `/productions/${production.id}/scenes/${scene.id}/delete`,
      csrf: c.get("csrf"),
      fields: html`<input type="hidden" name="order_revision" value="${production.scene_order_revision}">`,
    }))
  }))
  app.post("/productions/:pid/scenes/:sid/delete", (c) => guard(c, async () => {
    const body = await posted(c)
    const scene = mustScene(db, c.req.param("sid"))
    if (scene.production_id !== c.req.param("pid")) throw new NotFoundError()
    deleteScene(db, uploadDir, scene.id, readRevision(body, "order_revision"))
    return go(c, `/productions/${scene.production_id}?notice=deleted`)
  }))
  app.post("/productions/:pid/scenes/:sid/shots", (c) => guard(c, async () => {
    const body = await posted(c)
    const scene = mustScene(db, c.req.param("sid"))
    if (scene.production_id !== c.req.param("pid")) throw new NotFoundError()
    createShot(db, scene.id, readShotInput(body, { orderRevision: true }))
    return go(c, `/productions/${scene.production_id}/scenes/${scene.id}?notice=created`)
  }))
  app.post("/productions/:pid/shots/:shotId", (c) => guard(c, async () => {
    const body = await posted(c)
    const { shot, scene } = shotContext(db, c.req.param("pid"), c.req.param("shotId"))
    updateShot(db, shot.id, readShotInput(body, { revision: true }))
    return go(c, `/productions/${scene.production_id}/scenes/${scene.id}?notice=saved`)
  }))
  app.post("/productions/:pid/shots/:shotId/move", (c) => guard(c, async () => {
    const body = await posted(c)
    const { shot, scene } = shotContext(db, c.req.param("pid"), c.req.param("shotId"))
    const moved = moveOrdered(db, "shots", scene.id, shot.id, scalar(body, "direction"), readRevision(body, "order_revision"))
    return go(c, `/productions/${scene.production_id}/scenes/${scene.id}?notice=${moved.moved ? "saved" : "edge"}`)
  }))
  app.post("/productions/:pid/shots/:shotId/duplicate", (c) => guard(c, async () => {
    const body = await posted(c)
    const { shot, scene } = shotContext(db, c.req.param("pid"), c.req.param("shotId"))
    duplicateShot(db, shot.id, readRevision(body, "order_revision"))
    return go(c, `/productions/${scene.production_id}/scenes/${scene.id}?notice=copied`)
  }))
  app.post("/productions/:pid/shots/:shotId/transfer", (c) => guard(c, async () => {
    const body = await posted(c)
    const { shot } = shotContext(db, c.req.param("pid"), c.req.param("shotId"))
    const targetId = String(scalar(body, "target_scene_id"))
    moveShot(db, shot.id, targetId, {
      revision: readRevision(body),
      sourceOrderRevision: readRevision(body, "source_order_revision"),
      targetOrderRevision: readRevision(body, `target_rev_${targetId}`),
    })
    return go(c, `/productions/${c.req.param("pid")}/scenes/${targetId}?notice=saved`)
  }))
  app.get("/productions/:pid/shots/:shotId/delete", (c) => guard(c, () => {
    const { shot, scene, production } = shotContext(db, c.req.param("pid"), c.req.param("shotId"))
    return send(c, confirmPage({
      title: "Remove shot",
      production,
      text: `Removing ${shot.display_label || "this shot"} does not remove a storyboard that another shot still uses.`,
      action: `/productions/${production.id}/shots/${shot.id}/delete`,
      csrf: c.get("csrf"),
      fields: html`<input type="hidden" name="order_revision" value="${scene.shot_order_revision}">`,
    }))
  }))
  app.post("/productions/:pid/shots/:shotId/delete", (c) => guard(c, async () => {
    const body = await posted(c)
    const { shot, scene } = shotContext(db, c.req.param("pid"), c.req.param("shotId"))
    deleteShot(db, uploadDir, shot.id, readRevision(body, "order_revision"))
    return go(c, `/productions/${scene.production_id}/scenes/${scene.id}?notice=deleted`)
  }))
  app.post("/productions/:pid/shots/:shotId/image", (c) => guard(c, async () => {
    const body = await posted(c)
    const { shot, scene } = shotContext(db, c.req.param("pid"), c.req.param("shotId"))
    const file = uploaded(body, "image")
    if (!file) throw new ValidationError("Choose a JPEG or PNG storyboard.")
    await saveShotImage(db, uploadDir, shot.id, {
      bytes: Buffer.from(await file.arrayBuffer()),
      filename: file.name || "",
      alt: scalar(body, "image_alt"),
      revision: readRevision(body),
    })
    return go(c, `/productions/${scene.production_id}/scenes/${scene.id}?notice=image-saved`)
  }))
  app.post("/productions/:pid/shots/:shotId/image/remove", (c) => guard(c, async () => {
    const body = await posted(c)
    const { shot, scene } = shotContext(db, c.req.param("pid"), c.req.param("shotId"))
    clearShotImage(db, uploadDir, shot.id, readRevision(body))
    return go(c, `/productions/${scene.production_id}/scenes/${scene.id}?notice=saved`)
  }))
  app.get("/media/:imageId", (c) => guard(c, () => {
    const found = imageForRequest(db, uploadDir, c.req.param("imageId"))
    if (!found?.bytes) return c.text("Storyboard file not found.", 404)
    return c.body(new Uint8Array(found.bytes), 200, {
      "content-type": "image/png",
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
      "cache-control": "private, no-store",
    })
  }))
  app.get("/productions/:pid/people", (c) => guard(c, () => {
    const production = mustProduction(db, c.req.param("pid"))
    return send(c, peoplePage({ production, characters: listCharacters(db, production.id), csrf: c.get("csrf"), notice: notice(c) }))
  }))
  app.post("/productions/:pid/people", (c) => guard(c, async () => {
    const body = await posted(c)
    createCharacter(db, c.req.param("pid"), {
      name: readText(scalar(body, "name"), { max: 200, label: "Name", required: true }),
      notes: readText(scalar(body, "notes"), { max: 20000, label: "Notes", trim: false }),
    })
    return go(c, `/productions/${c.req.param("pid")}/people?notice=created`)
  }))
  app.post("/productions/:pid/people/:id", (c) => guard(c, async () => {
    const body = await posted(c)
    ownedCharacter(db, c.req.param("pid"), c.req.param("id"))
    updateCharacter(db, c.req.param("id"), {
      name: readText(scalar(body, "name"), { max: 200, label: "Name", required: true }),
      notes: readText(scalar(body, "notes"), { max: 20000, label: "Notes", trim: false }),
      revision: readRevision(body),
    })
    return go(c, `/productions/${c.req.param("pid")}/people?notice=saved`)
  }))
  app.get("/productions/:pid/people/:id/delete", (c) => guard(c, () => {
    const production = mustProduction(db, c.req.param("pid"))
    const character = listCharacters(db, production.id).find((row) => row.id === c.req.param("id"))
    if (!character) throw new NotFoundError("Character not found.")
    return send(c, confirmPage({
      title: `Remove ${character.name}`,
      production,
      text: "The character is removed only when no scene still links to them.",
      action: `/productions/${production.id}/people/${character.id}/delete`,
      csrf: c.get("csrf"),
      fields: html`<input type="hidden" name="revision" value="${character.revision}">`,
    }))
  }))
  app.post("/productions/:pid/people/:id/delete", (c) => guard(c, async () => {
    const body = await posted(c)
    ownedCharacter(db, c.req.param("pid"), c.req.param("id"))
    deleteCharacter(db, c.req.param("id"), readRevision(body))
    return go(c, `/productions/${c.req.param("pid")}/people?notice=deleted`)
  }))
  app.get("/productions/:pid/places", (c) => guard(c, () => {
    const production = mustProduction(db, c.req.param("pid"))
    return send(c, placesPage({ production, locations: listLocations(db, production.id), csrf: c.get("csrf") }))
  }))
  app.post("/productions/:pid/places", (c) => guard(c, async () => {
    const body = await posted(c)
    createLocation(db, c.req.param("pid"), {
      name: readText(scalar(body, "name"), { max: 200, label: "Name", required: true }),
      notes: readText(scalar(body, "notes"), { max: 20000, label: "Notes", trim: false }),
    })
    return go(c, `/productions/${c.req.param("pid")}/places?notice=created`)
  }))
  app.post("/productions/:pid/places/:id", (c) => guard(c, async () => {
    const body = await posted(c)
    ownedLocation(db, c.req.param("pid"), c.req.param("id"))
    updateLocation(db, c.req.param("id"), {
      name: readText(scalar(body, "name"), { max: 200, label: "Name", required: true }),
      notes: readText(scalar(body, "notes"), { max: 20000, label: "Notes", trim: false }),
      revision: readRevision(body),
    })
    return go(c, `/productions/${c.req.param("pid")}/places?notice=saved`)
  }))
  app.get("/productions/:pid/places/:id/delete", (c) => guard(c, () => {
    const production = mustProduction(db, c.req.param("pid"))
    const location = listLocations(db, production.id).find((row) => row.id === c.req.param("id"))
    if (!location) throw new NotFoundError("Location not found.")
    return send(c, confirmPage({
      title: `Remove ${location.name}`,
      production,
      text: "The location is removed only when no scene still uses it.",
      action: `/productions/${production.id}/places/${location.id}/delete`,
      csrf: c.get("csrf"),
      fields: html`<input type="hidden" name="revision" value="${location.revision}">`,
    }))
  }))
  app.post("/productions/:pid/places/:id/delete", (c) => guard(c, async () => {
    const body = await posted(c)
    ownedLocation(db, c.req.param("pid"), c.req.param("id"))
    deleteLocation(db, c.req.param("id"), readRevision(body))
    return go(c, `/productions/${c.req.param("pid")}/places?notice=deleted`)
  }))
  app.get("/productions/:pid/schedule", (c) => guard(c, () => {
    const production = mustProduction(db, c.req.param("pid"))
    return send(c, schedulePage({
      production,
      days: listDays(db, production.id),
      unscheduled: unscheduledScenes(db, production.id),
      csrf: c.get("csrf"),
    }))
  }))
  app.post("/productions/:pid/days", (c) => guard(c, async () => {
    const body = await posted(c)
    const id = createShootDay(db, c.req.param("pid"), readShootDayInput(body))
    return go(c, `/productions/${c.req.param("pid")}/days/${id}?notice=created`)
  }))
  app.get("/productions/:pid/days/:did", (c) => guard(c, () => renderDay(c, db)))
  app.post("/productions/:pid/days/:did", (c) => guard(c, async () => {
    const body = await posted(c)
    ownedDay(db, c.req.param("pid"), c.req.param("did"))
    updateShootDay(db, c.req.param("did"), readShootDayInput(body, { revision: true }))
    return go(c, `/productions/${c.req.param("pid")}/days/${c.req.param("did")}?notice=saved`)
  }))
  app.post("/productions/:pid/days/:did/scenes", (c) => guard(c, async () => {
    const body = await posted(c)
    ownedDay(db, c.req.param("pid"), c.req.param("did"))
    addSceneToDay(db, c.req.param("did"), String(scalar(body, "scene_id")), readRevision(body, "order_revision"))
    return go(c, `/productions/${c.req.param("pid")}/days/${c.req.param("did")}?notice=saved`)
  }))
  app.post("/productions/:pid/days/:did/activities", (c) => guard(c, async () => {
    const body = await posted(c)
    ownedDay(db, c.req.param("pid"), c.req.param("did"))
    addActivityToDay(db, c.req.param("did"), readActivityInput(body))
    return go(c, `/productions/${c.req.param("pid")}/days/${c.req.param("did")}?notice=saved`)
  }))
  app.get("/productions/:pid/days/:did/delete", (c) => guard(c, () => {
    const production = mustProduction(db, c.req.param("pid"))
    const view = dayView(db, c.req.param("did"))
    if (view.day.production_id !== production.id) throw new NotFoundError()
    return send(c, confirmPage({
      title: "Remove shoot day",
      production,
      text: "Removing the shoot day removes its schedule items. Scenes and shots stay.",
      action: `/productions/${production.id}/days/${view.day.id}/delete`,
      csrf: c.get("csrf"),
      fields: html`<input type="hidden" name="revision" value="${view.day.revision}">`,
    }))
  }))
  app.post("/productions/:pid/days/:did/delete", (c) => guard(c, async () => {
    const body = await posted(c)
    ownedDay(db, c.req.param("pid"), c.req.param("did"))
    deleteShootDay(db, c.req.param("did"), readRevision(body))
    return go(c, `/productions/${c.req.param("pid")}/schedule?notice=deleted`)
  }))
  app.post("/productions/:pid/items/:itemId", (c) => guard(c, async () => {
    const body = await posted(c)
    const item = ownedItem(db, c.req.param("pid"), c.req.param("itemId"))
    updateActivity(db, item.id, {
      label: readText(scalar(body, "label"), { max: 200, label: "Label", required: true }),
      durationMinutes: readDuration(scalar(body, "duration_minutes"), { allowBlank: false, label: "Duration" }),
      revision: readRevision(body),
    })
    return go(c, `/productions/${c.req.param("pid")}/days/${item.shoot_day_id}?notice=saved`)
  }))
  app.post("/productions/:pid/items/:itemId/move", (c) => guard(c, async () => {
    const body = await posted(c)
    const item = ownedItem(db, c.req.param("pid"), c.req.param("itemId"))
    const dayId = item.shoot_day_id
    const moved = moveOrdered(db, "items", dayId, item.id, scalar(body, "direction"), readRevision(body, "order_revision"))
    return go(c, `/productions/${c.req.param("pid")}/days/${dayId}?notice=${moved.moved ? "saved" : "edge"}`)
  }))
  app.get("/productions/:pid/items/:itemId/delete", (c) => guard(c, () => {
    const production = mustProduction(db, c.req.param("pid"))
    const item = ownedItem(db, production.id, c.req.param("itemId"))
    const view = dayView(db, item.shoot_day_id)
    return send(c, confirmPage({
      title: "Remove schedule item",
      production,
      text: "Removing scene work from the day unschedules that scene. The scene and its shots stay.",
      action: `/productions/${production.id}/items/${c.req.param("itemId")}/delete`,
      csrf: c.get("csrf"),
      fields: html`<input type="hidden" name="order_revision" value="${view.day.schedule_order_revision}">`,
    }))
  }))
  app.post("/productions/:pid/items/:itemId/delete", (c) => guard(c, async () => {
    const body = await posted(c)
    const item = ownedItem(db, c.req.param("pid"), c.req.param("itemId"))
    const dayId = item.shoot_day_id
    deleteScheduleItem(db, item.id, readRevision(body, "order_revision"))
    return go(c, `/productions/${c.req.param("pid")}/days/${dayId}?notice=deleted`)
  }))
  app.get("/productions/:pid/import", (c) => guard(c, () => {
    const production = mustProduction(db, c.req.param("pid"))
    const blocked = workspaceScenes(db, production.id).length > 0
    return send(c, importPage({ production, blocked, csrf: c.get("csrf") }))
  }))
  app.post("/productions/:pid/import", (c) => guard(c, async () => {
    const body = await posted(c)
    const production = mustProduction(db, c.req.param("pid"))
    try {
      const preview = await scriptPreview(db, body, { productionId: production.id })
      return go(c, `/import/${preview.id}`)
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error
      return send(c, importPage({ production, blocked: workspaceScenes(db, production.id).length > 0, csrf: c.get("csrf"), error: error.message }), 400)
    }
  }))
  app.get("/productions/:pid/script", (c) => guard(c, () => {
    const production = mustProduction(db, c.req.param("pid"))
    return send(c, scriptPage({ production, versions: listScriptVersions(db, production.id), csrf: c.get("csrf") }))
  }))
  app.get("/productions/:pid/script/compare", (c) => guard(c, () => {
    const production = mustProduction(db, c.req.param("pid"))
    const left = getScriptVersion(db, production.id, c.req.query("a"))
    const right = getScriptVersion(db, production.id, c.req.query("b"))
    return send(c, comparePage({ production, left, right }))
  }))
  app.get("/productions/:pid/script/:vid", (c) => guard(c, () => {
    const production = mustProduction(db, c.req.param("pid"))
    if (c.req.param("vid") === "compare") return c.notFound()
    return send(c, scriptTextPage({ production, version: getScriptVersion(db, production.id, c.req.param("vid")) }))
  }))
  app.get("/productions/:pid/export.json", (c) => guard(c, () => {
    const production = mustProduction(db, c.req.param("pid"))
    const payload = exportProduction(db, production.id)
    const name = production.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "production"
    return c.body(JSON.stringify(payload, null, 2), 200, {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="sceneplan-${name}.json"`,
    })
  }))
  app.get("/productions/:pid/scenes/:sid/print", (c) => guard(c, () => {
    const production = mustProduction(db, c.req.param("pid"))
    const scene = mustScene(db, c.req.param("sid"))
    if (scene.production_id !== production.id) throw new NotFoundError()
    return send(c, printScene({ production, bundle: annotate(sceneBundle(db, scene.id), uploadDir) }))
  }))
  app.get("/productions/:pid/days/:did/print/shots", (c) => guard(c, () => {
    const production = mustProduction(db, c.req.param("pid"))
    const view = dayView(db, c.req.param("did"))
    if (view.production.id !== production.id) throw new NotFoundError()
    return send(c, printDayShots({ production, view }))
  }))
  app.get("/productions/:pid/days/:did/print/schedule", (c) => guard(c, () => {
    const production = mustProduction(db, c.req.param("pid"))
    const view = dayView(db, c.req.param("did"))
    if (view.production.id !== production.id) throw new NotFoundError()
    return send(c, printSchedule({ production, view }))
  }))
}

function renderScene(c, db, uploadDir) {
  const production = mustProduction(db, c.req.param("pid"))
  const scene = mustScene(db, c.req.param("sid"))
  if (scene.production_id !== production.id) throw new NotFoundError()
  const status = ["idea", "planned", "ready", "cut"].includes(c.req.query("status")) ? c.req.query("status") : ""
  return send(c, scenePage({
    bundle: annotate(sceneBundle(db, scene.id), uploadDir),
    view: preferredView(c),
    status,
    csrf: c.get("csrf"),
  }))
}

function renderDay(c, db) {
  const production = mustProduction(db, c.req.param("pid"))
  const view = dayView(db, c.req.param("did"))
  if (view.production.id !== production.id) throw new NotFoundError()
  return send(c, dayPage({ production, view, csrf: c.get("csrf") }))
}

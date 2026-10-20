import { randomUUID } from "node:crypto"
import { all, get, run, transaction } from "./db.js"
import { NotFoundError, ValidationError } from "./errors.js"
import { LIMITS } from "./limits.js"
import { calculateSchedule, sceneDuration } from "./duration.js"
import { isTimezone } from "./time.js"
import {
  listCharacters,
  listLocations,
  listScenes,
  listScriptVersions,
  mustProduction,
  sceneCharacters,
  shotsForScene,
  listDays,
} from "./domain.js"

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/
const TOP_KEYS = ["schema", "schemaVersion", "exportedAt", "includesImageFiles", "note", "production", "locations", "characters", "scriptVersions", "scenes", "shots", "shootDays", "scheduleItems"]

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function rejectExtra(obj, allowed, label) {
  const extra = Object.keys(obj).filter((key) => !allowed.includes(key))
  if (extra.length) throw new ValidationError(`${label} contains unsupported fields: ${extra.join(", ")}.`)
}

function readId(value, label) {
  if (typeof value !== "string" || !ID_RE.test(value)) throw new ValidationError(`${label} has an invalid id.`)
  return value
}

function readString(value, max, label, { required = false } = {}) {
  if (typeof value !== "string") throw new ValidationError(`${label} must be text.`)
  if (value.includes("\u0000")) throw new ValidationError(`${label} contains an invalid character.`)
  if (required && value.trim() === "") throw new ValidationError(`${label} is required.`)
  if (value.length > max) throw new ValidationError(`${label} is too long.`)
  return value
}

function readNullableInt(value, label) {
  if (value === null) return null
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > LIMITS.durationMax) {
    throw new ValidationError(`${label} must be a whole number of minutes from 0 through ${LIMITS.durationMax}, or null.`)
  }
  return value
}

function uniqueIds(rows, label) {
  const seen = new Set()
  for (const row of rows) {
    if (seen.has(row.id)) throw new ValidationError(`${label} repeats id ${row.id}.`)
    seen.add(row.id)
  }
}

export function exportProduction(db, productionId) {
  const production = mustProduction(db, productionId)
  const scenes = listScenes(db, productionId)
  const shots = scenes.flatMap((scene) => shotsForScene(db, scene.id))
  const days = listDays(db, productionId).map((view) => view.day)
  const items = days.flatMap((day) => all(db, "SELECT * FROM schedule_items WHERE shoot_day_id = ? ORDER BY sort_order ASC, id ASC", day.id))
  return {
    schema: "sceneplan.production",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    includesImageFiles: false,
    note: "Image files are not included. This JSON is not a complete backup.",
    production: {
      name: production.name,
      timezone: production.timezone,
      logline: production.logline,
      notes: production.notes,
    },
    locations: listLocations(db, productionId).map((row) => ({ id: row.id, name: row.name, notes: row.notes })),
    characters: listCharacters(db, productionId).map((row) => ({ id: row.id, name: row.name, notes: row.notes })),
    scriptVersions: listScriptVersions(db, productionId).map((row) => ({
      id: row.id,
      originalText: row.original_text,
      sourceKind: row.source_kind,
      originalFilename: row.original_filename,
      committedPreamble: row.committed_preamble,
      createdAt: row.created_at,
    })),
    scenes: scenes.map((scene) => ({
      id: scene.id,
      scriptVersionId: scene.script_version_id,
      displayNumber: scene.display_number,
      heading: scene.heading,
      intExt: scene.int_ext,
      locationId: scene.location_id,
      storyTimeOfDay: scene.story_time_of_day,
      scriptText: scene.script_text,
      synopsis: scene.synopsis,
      productionNotes: scene.production_notes,
      shootingDurationOverrideMinutes: scene.shooting_duration_override_minutes,
      sortOrder: scene.sort_order,
      characterIds: sceneCharacters(db, scene.id).map((row) => row.id),
    })),
    shots: shots.map((shot) => ({
      id: shot.id,
      sceneId: shot.scene_id,
      displayLabel: shot.display_label,
      description: shot.description,
      shotSize: shot.shot_size,
      cameraAngle: shot.camera_angle,
      cameraMovement: shot.camera_movement,
      lensNote: shot.lens_note,
      shootingDurationMinutes: shot.shooting_duration_minutes,
      equipmentNotes: shot.equipment_notes,
      imageAlt: shot.image_alt,
      planningStatus: shot.planning_status,
      sortOrder: shot.sort_order,
      storyboardImageId: shot.storyboard_image_id,
    })),
    shootDays: days.map((day) => ({
      id: day.id,
      localDate: day.local_date,
      localStartTime: day.local_start_time,
      label: day.label,
      maxPlannedDurationMinutes: day.max_planned_duration_minutes,
      notes: day.notes,
    })),
    scheduleItems: items.map((item) => ({
      id: item.id,
      shootDayId: item.shoot_day_id,
      kind: item.kind,
      sceneId: item.scene_id,
      label: item.label,
      durationMinutes: item.duration_minutes,
      sortOrder: item.sort_order,
    })),
  }
}

export function validateTransfer(payload) {
  if (!isObject(payload)) throw new ValidationError("The JSON root must be an object.")
  rejectExtra(payload, TOP_KEYS, "The transfer file")
  if (payload.schema !== "sceneplan.production") throw new ValidationError("Unsupported schema. Expected sceneplan.production.")
  if (payload.schemaVersion !== 1) throw new ValidationError("Unsupported schemaVersion. This build imports version 1 only.")
  if (payload.includesImageFiles !== false) {
    throw new ValidationError("This importer accepts metadata only. includesImageFiles must be false. Image files were not imported.")
  }
  if ("note" in payload) readString(payload.note, 400, "Note")
  if ("exportedAt" in payload && typeof payload.exportedAt !== "string") throw new ValidationError("exportedAt must be text.")
  if (!isObject(payload.production)) throw new ValidationError("Missing production.")
  rejectExtra(payload.production, ["name", "timezone", "logline", "notes"], "Production")
  const production = {
    name: readString(payload.production.name, LIMITS.name, "Production name", { required: true }).trim(),
    timezone: readString(payload.production.timezone, 80, "Timezone", { required: true }).trim(),
    logline: readString(payload.production.logline || "", LIMITS.logline, "Logline").trim(),
    notes: readString(payload.production.notes || "", LIMITS.notes, "Notes"),
  }
  if (!production.name) throw new ValidationError("Production name is required.")
  if (!isTimezone(production.timezone)) throw new ValidationError("The production timezone is not a valid IANA name.")

  const locations = readRows(payload.locations, "Locations", ["id", "name", "notes"], (row) => ({
    id: readId(row.id, "Location"),
    name: readString(row.name, LIMITS.short, "Location name", { required: true }).trim(),
    notes: readString(row.notes || "", LIMITS.notes, "Location notes"),
  }))
  const characters = readRows(payload.characters, "Characters", ["id", "name", "notes"], (row) => ({
    id: readId(row.id, "Character"),
    name: readString(row.name, LIMITS.short, "Character name", { required: true }).trim(),
    notes: readString(row.notes || "", LIMITS.notes, "Character notes"),
  }))
  const scriptVersions = readRows(payload.scriptVersions, "Script versions", ["id", "originalText", "sourceKind", "originalFilename", "committedPreamble", "createdAt"], (row) => ({
    id: readId(row.id, "Script version"),
    originalText: readString(row.originalText, LIMITS.scriptBytes, "Original script"),
    sourceKind: row.sourceKind === "paste" || row.sourceKind === "upload" ? row.sourceKind : fail("Script sourceKind must be paste or upload."),
    originalFilename: readString(row.originalFilename || "", 240, "Script filename"),
    committedPreamble: readString(row.committedPreamble || "", LIMITS.scriptBytes, "Committed preamble"),
    createdAt: readString(row.createdAt, 40, "Script createdAt", { required: true }),
  }))
  const scenes = readRows(payload.scenes, "Scenes", ["id", "scriptVersionId", "displayNumber", "heading", "intExt", "locationId", "storyTimeOfDay", "scriptText", "synopsis", "productionNotes", "shootingDurationOverrideMinutes", "sortOrder", "characterIds"], (row) => ({
    id: readId(row.id, "Scene"),
    scriptVersionId: row.scriptVersionId == null ? null : readId(row.scriptVersionId, "Scene script version"),
    displayNumber: readString(row.displayNumber || "", 12, "Scene number"),
    heading: readString(row.heading, 240, "Scene heading", { required: true }).trim(),
    intExt: ["INT", "EXT", "INT_EXT", "EST", "OTHER"].includes(row.intExt) ? row.intExt : fail("Scene intExt is not supported."),
    locationId: row.locationId == null ? null : readId(row.locationId, "Scene location"),
    storyTimeOfDay: readString(row.storyTimeOfDay || "", 80, "Story time of day"),
    scriptText: readString(row.scriptText || "", LIMITS.scriptField, "Scene text"),
    synopsis: readString(row.synopsis || "", 5000, "Synopsis"),
    productionNotes: readString(row.productionNotes || "", LIMITS.notes, "Production notes"),
    shootingDurationOverrideMinutes: readNullableInt(row.shootingDurationOverrideMinutes, "Scene duration override"),
    sortOrder: readSort(row.sortOrder),
    characterIds: Array.isArray(row.characterIds) ? row.characterIds.map((id) => readId(id, "Scene character")) : fail("Scene characterIds must be a list."),
  }))
  const shots = readRows(payload.shots, "Shots", ["id", "sceneId", "displayLabel", "description", "shotSize", "cameraAngle", "cameraMovement", "lensNote", "shootingDurationMinutes", "equipmentNotes", "imageAlt", "planningStatus", "sortOrder", "storyboardImageId"], (row) => ({
    id: readId(row.id, "Shot"),
    sceneId: readId(row.sceneId, "Shot scene"),
    displayLabel: readString(row.displayLabel || "", 40, "Shot label"),
    description: readString(row.description || "", LIMITS.description, "Shot description"),
    shotSize: readString(row.shotSize || "", 40, "Shot size"),
    cameraAngle: readString(row.cameraAngle || "", 40, "Camera angle"),
    cameraMovement: readString(row.cameraMovement || "", 40, "Camera movement"),
    lensNote: readString(row.lensNote || "", 120, "Lens note"),
    shootingDurationMinutes: readNullableInt(row.shootingDurationMinutes, "Shot duration"),
    equipmentNotes: readString(row.equipmentNotes || "", 2000, "Equipment notes"),
    imageAlt: readString(row.imageAlt || "", 300, "Image description"),
    planningStatus: ["idea", "planned", "ready", "cut"].includes(row.planningStatus) ? row.planningStatus : fail("Shot planningStatus is not supported."),
    sortOrder: readSort(row.sortOrder),
    storyboardImageId: row.storyboardImageId == null || row.storyboardImageId === "" ? null : readId(String(row.storyboardImageId), "Storyboard image"),
  }))
  const shootDays = readRows(payload.shootDays, "Shoot days", ["id", "localDate", "localStartTime", "label", "maxPlannedDurationMinutes", "notes"], (row) => ({
    id: readId(row.id, "Shoot day"),
    localDate: readString(row.localDate, 10, "Shoot date", { required: true }),
    localStartTime: readString(row.localStartTime, 5, "Start time", { required: true }),
    label: readString(row.label || "", 120, "Shoot day label"),
    maxPlannedDurationMinutes: row.maxPlannedDurationMinutes == null ? null : readNullableInt(row.maxPlannedDurationMinutes, "Maximum duration"),
    notes: readString(row.notes || "", LIMITS.notes, "Shoot day notes"),
  }))
  const scheduleItems = readRows(payload.scheduleItems, "Schedule items", ["id", "shootDayId", "kind", "sceneId", "label", "durationMinutes", "sortOrder"], (row) => ({
    id: readId(row.id, "Schedule item"),
    shootDayId: readId(row.shootDayId, "Schedule day"),
    kind: ["scene_work", "break", "setup_move", "other"].includes(row.kind) ? row.kind : fail("Schedule kind is not supported."),
    sceneId: row.sceneId == null ? null : readId(row.sceneId, "Schedule scene"),
    label: readString(row.label || "", LIMITS.short, "Schedule label"),
    durationMinutes: readNullableInt(row.durationMinutes, "Schedule duration"),
    sortOrder: readSort(row.sortOrder),
  }))

  if (locations.length > LIMITS.locationsPerProduction) throw new ValidationError("Too many locations.")
  if (characters.length > LIMITS.charactersPerProduction) throw new ValidationError("Too many characters.")
  if (scenes.length > LIMITS.scenesPerProduction) throw new ValidationError("Too many scenes.")
  if (shootDays.length > LIMITS.daysPerProduction) throw new ValidationError("Too many shoot days.")
  uniqueIds(locations, "Locations")
  uniqueIds(characters, "Characters")
  const locationNames = new Set()
  for (const location of locations) {
    if (locationNames.has(location.name)) throw new ValidationError(`Location name repeats: ${location.name}.`)
    locationNames.add(location.name)
  }
  const characterNames = new Set()
  for (const character of characters) {
    if (characterNames.has(character.name)) throw new ValidationError(`Character name repeats: ${character.name}.`)
    characterNames.add(character.name)
  }
  uniqueIds(scriptVersions, "Script versions")
  uniqueIds(scenes, "Scenes")
  uniqueIds(shots, "Shots")
  uniqueIds(shootDays, "Shoot days")
  uniqueIds(scheduleItems, "Schedule items")

  const locationIds = new Set(locations.map((row) => row.id))
  const characterIds = new Set(characters.map((row) => row.id))
  const versionIds = new Set(scriptVersions.map((row) => row.id))
  const sceneIds = new Set(scenes.map((row) => row.id))
  const dayIds = new Set(shootDays.map((row) => row.id))
  for (const scene of scenes) {
    if (scene.locationId && !locationIds.has(scene.locationId)) throw new ValidationError(`Scene ${scene.heading} references a missing location.`)
    if (scene.scriptVersionId && !versionIds.has(scene.scriptVersionId)) throw new ValidationError(`Scene ${scene.heading} references a missing script version.`)
    for (const characterId of scene.characterIds) {
      if (!characterIds.has(characterId)) throw new ValidationError(`Scene ${scene.heading} references a missing character.`)
    }
  }
  const shotsByScene = new Map()
  for (const shot of shots) {
    if (!sceneIds.has(shot.sceneId)) throw new ValidationError("A shot references a missing scene.")
    const list = shotsByScene.get(shot.sceneId) || []
    list.push(shot)
    shotsByScene.set(shot.sceneId, list)
    if (list.length > LIMITS.shotsPerScene) throw new ValidationError("A scene has too many shots.")
  }
  const scheduled = new Set()
  const itemsByDay = new Map()
  for (const item of scheduleItems) {
    if (!dayIds.has(item.shootDayId)) throw new ValidationError("A schedule item references a missing shoot day.")
    if (item.kind === "scene_work") {
      if (!item.sceneId || !sceneIds.has(item.sceneId)) throw new ValidationError("Scene work needs a scene from this file.")
      if (item.durationMinutes !== null) throw new ValidationError("Scene-work items cannot store their own duration. Duration stays on the scene and shots.")
      if (scheduled.has(item.sceneId)) throw new ValidationError("A scene is scheduled more than once.")
      scheduled.add(item.sceneId)
    } else if (item.sceneId || item.durationMinutes === null) {
      throw new ValidationError("Breaks, moves, and other activities need an explicit duration and no scene.")
    }
    const list = itemsByDay.get(item.shootDayId) || []
    list.push(item)
    itemsByDay.set(item.shootDayId, list)
    if (list.length > LIMITS.itemsPerDay) throw new ValidationError("A shoot day has too many items.")
  }
  for (const day of shootDays) {
    if (day.maxPlannedDurationMinutes === 0) throw new ValidationError("A shoot-day maximum cannot be zero.")
    const sceneById = new Map(scenes.map((scene) => [scene.id, scene]))
    const items = (itemsByDay.get(day.id) || []).slice().sort((a, b) => a.sortOrder - b.sortOrder)
    const calc = calculateSchedule({
      zone: production.timezone,
      localDate: day.localDate,
      localStartTime: day.localStartTime,
      maxMinutes: day.maxPlannedDurationMinutes,
      items: items.map((item) => {
        if (item.kind !== "scene_work") {
          return { ...item, durationMinutes: item.durationMinutes, locationId: null }
        }
        const scene = sceneById.get(item.sceneId)
        const duration = sceneDuration({
          shooting_duration_override_minutes: scene.shootingDurationOverrideMinutes,
        }, (shotsByScene.get(scene.id) || []).map((shot) => ({ shooting_duration_minutes: shot.shootingDurationMinutes })))
        return {
          ...item,
          durationMinutes: duration.known ? duration.minutes : null,
          locationId: scene.locationId,
          locationName: locations.find((location) => location.id === scene.locationId)?.name || "",
          sceneHeading: scene.heading,
          displayNumber: scene.displayNumber,
        }
      }),
    })
    if (calc.status === "invalid") throw new ValidationError(calc.reason)
  }

  const omittedImageRefs = shots.filter((shot) => shot.storyboardImageId).length
  return { production, locations, characters, scriptVersions, scenes, shots, shootDays, scheduleItems, omittedImageRefs }
}

function fail(message) {
  throw new ValidationError(message)
}

function readSort(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100000) {
    throw new ValidationError("sortOrder must be a whole number.")
  }
  return value
}

function readRows(value, label, keys, mapRow) {
  if (!Array.isArray(value)) throw new ValidationError(`${label} must be a list.`)
  return value.map((row, index) => {
    if (!isObject(row)) throw new ValidationError(`${label} item ${index + 1} must be an object.`)
    rejectExtra(row, keys, `${label} item ${index + 1}`)
    return mapRow(row)
  })
}

export function importTransfer(db, payload) {
  const data = validateTransfer(payload)
  return transaction(db, () => insertTransfer(db, data))
}

function insertTransfer(db, data) {
  const productionId = randomUUID()
  const stamp = new Date().toISOString()
  const ids = new Map()
  const take = (type, id) => {
    const key = `${type}:${id}`
    if (!ids.has(key)) ids.set(key, randomUUID())
    return ids.get(key)
  }
  run(db, `INSERT INTO productions
    (id, name, timezone, logline, notes, revision, scene_order_revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)`,
    productionId, data.production.name, data.production.timezone, data.production.logline, data.production.notes, stamp, stamp)
  for (const location of data.locations) {
    run(db, "INSERT INTO locations (id, production_id, name, notes, revision) VALUES (?, ?, ?, ?, 1)",
      take("location", location.id), productionId, location.name, location.notes)
  }
  for (const character of data.characters) {
    run(db, "INSERT INTO characters (id, production_id, name, notes, revision) VALUES (?, ?, ?, ?, 1)",
      take("character", character.id), productionId, character.name, character.notes)
  }
  for (const version of data.scriptVersions) {
    run(db, `INSERT INTO script_versions
      (id, production_id, original_text, source_kind, original_filename, committed_preamble, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      take("version", version.id), productionId, version.originalText, version.sourceKind, version.originalFilename, version.committedPreamble, version.createdAt)
  }
  data.scenes.slice().sort((a, b) => a.sortOrder - b.sortOrder).forEach((scene, index) => {
    run(db, `INSERT INTO scenes (
      id, production_id, script_version_id, display_number, heading, int_ext, location_id, story_time_of_day,
      script_text, synopsis, production_notes, shooting_duration_override_minutes, sort_order, revision,
      shot_order_revision, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
      take("scene", scene.id), productionId, scene.scriptVersionId ? take("version", scene.scriptVersionId) : null,
      scene.displayNumber, scene.heading, scene.intExt, scene.locationId ? take("location", scene.locationId) : null,
      scene.storyTimeOfDay, scene.scriptText, scene.synopsis, scene.productionNotes, scene.shootingDurationOverrideMinutes,
      index + 1, stamp, stamp)
    for (const characterId of scene.characterIds) {
      run(db, "INSERT INTO scene_characters (scene_id, character_id) VALUES (?, ?)", take("scene", scene.id), take("character", characterId))
    }
  })
  const grouped = new Map()
  for (const shot of data.shots) {
    const list = grouped.get(shot.sceneId) || []
    list.push(shot)
    grouped.set(shot.sceneId, list)
  }
  for (const [sceneId, list] of grouped) {
    list.sort((a, b) => a.sortOrder - b.sortOrder).forEach((shot, index) => {
      run(db, `INSERT INTO shots (
        id, scene_id, display_label, description, shot_size, camera_angle, camera_movement, lens_note,
        shooting_duration_minutes, equipment_notes, storyboard_image_id, image_alt, planning_status,
        sort_order, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 1, ?, ?)`,
        take("shot", shot.id), take("scene", sceneId), shot.displayLabel, shot.description, shot.shotSize,
        shot.cameraAngle, shot.cameraMovement, shot.lensNote, shot.shootingDurationMinutes, shot.equipmentNotes,
        shot.imageAlt, shot.planningStatus, index + 1, stamp, stamp)
    })
  }
  data.shootDays.forEach((day) => {
    run(db, `INSERT INTO shoot_days (
      id, production_id, local_date, local_start_time, label, max_planned_duration_minutes, notes,
      schedule_order_revision, revision, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
      take("day", day.id), productionId, day.localDate, day.localStartTime, day.label, day.maxPlannedDurationMinutes, day.notes, stamp, stamp)
  })
  const dayItems = new Map()
  for (const item of data.scheduleItems) {
    const list = dayItems.get(item.shootDayId) || []
    list.push(item)
    dayItems.set(item.shootDayId, list)
  }
  for (const [dayId, list] of dayItems) {
    list.sort((a, b) => a.sortOrder - b.sortOrder).forEach((item, index) => {
      run(db, `INSERT INTO schedule_items (id, shoot_day_id, kind, scene_id, label, duration_minutes, sort_order, revision)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        take("item", item.id), take("day", dayId), item.kind, item.sceneId ? take("scene", item.sceneId) : null,
        item.label, item.durationMinutes, index + 1)
    })
  }
  return { productionId, omittedImageRefs: data.omittedImageRefs }
}

export function storeJsonPreview(db, rawText) {
  if (typeof rawText !== "string" || rawText.trim() === "") throw new ValidationError("The JSON file is empty.")
  if (Buffer.byteLength(rawText) > LIMITS.jsonBytes) throw new ValidationError("The JSON file is too large.")
  let payload
  try {
    payload = JSON.parse(rawText)
  } catch {
    throw new ValidationError("The JSON could not be parsed. Nothing was imported.")
  }
  const data = validateTransfer(payload)
  const id = randomUUID()
  run(db, `INSERT INTO import_previews (
    id, production_id, mode, new_name, new_timezone, new_logline, source_kind, original_filename, original_text, payload_json, created_at
  ) VALUES (?, NULL, 'json', ?, ?, '', 'json', '', '', ?, ?)`,
    id, data.production.name, data.production.timezone, JSON.stringify(payload), new Date().toISOString())
  return {
    id,
    name: data.production.name,
    scenes: data.scenes.length,
    shots: data.shots.length,
    days: data.shootDays.length,
    omittedImageRefs: data.omittedImageRefs,
  }
}

export function commitJsonPreview(db, previewId) {
  const preview = get(db, "SELECT * FROM import_previews WHERE id = ?", previewId)
  if (!preview || preview.mode !== "json") throw new NotFoundError("Import preview not found.")
  const data = validateTransfer(JSON.parse(preview.payload_json))
  return transaction(db, () => {
    const result = insertTransfer(db, data)
    run(db, "DELETE FROM import_previews WHERE id = ?", previewId)
    return result
  })
}

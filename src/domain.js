import { randomUUID } from "node:crypto"
import path from "node:path"
import { all, get, run, transaction } from "./db.js"
import { ConflictError, NotFoundError, ValidationError } from "./errors.js"
import { sceneDuration, calculateSchedule } from "./duration.js"
import { LIMITS } from "./limits.js"
import { decodeScriptBuffer, parseScript } from "./parse-script.js"
import { interpretLocal } from "./time.js"
import {
  readImageFile,
  removeImageFile,
  removeProductionUploads,
  transcodeStoryboard,
  writeImageFile,
} from "./images.js"
import { readText, scalar } from "./forms.js"

const ORDERING = {
  shots: { parent: "scenes", parentColumn: "shot_order_revision", child: "shots", childColumn: "scene_id" },
  scenes: { parent: "productions", parentColumn: "scene_order_revision", child: "scenes", childColumn: "production_id" },
  items: { parent: "shoot_days", parentColumn: "schedule_order_revision", child: "schedule_items", childColumn: "shoot_day_id" },
}

function now() {
  return new Date().toISOString()
}

function uid() {
  return randomUUID()
}

function failConstraint(error) {
  if (error instanceof ValidationError || error instanceof ConflictError || error instanceof NotFoundError) throw error
  const message = String(error?.message || "")
  if (message.includes("cross-production")) throw new ValidationError("That link belongs to a different production.")
  if (message.includes("schedule_items.scene_id")) {
    throw new ValidationError("That scene is already assigned to a shoot day. Each scene can be scheduled once.")
  }
  if (message.includes("locations.production_id") || message.includes("locations.name")) {
    throw new ValidationError("A location with that name already exists in this production.")
  }
  if (message.includes("characters.production_id") || message.includes("characters.name")) {
    throw new ValidationError("A character with that name already exists in this production.")
  }
  if (message.includes("FOREIGN KEY")) {
    throw new ValidationError("That record is still referenced. Reassign or remove the references first. Deletion was not completed.")
  }
  if (message.includes("CHECK constraint")) throw new ValidationError("A value is outside the allowed range.")
  throw error
}

function must(row, message) {
  if (!row) throw new NotFoundError(message)
  return row
}

function changed(info) {
  if (!info || info.changes !== 1) throw new ConflictError()
}

export function mustProduction(db, id) {
  return must(get(db, "SELECT * FROM productions WHERE id = ?", id), "Production not found.")
}

export function mustScene(db, id) {
  return must(get(db, "SELECT * FROM scenes WHERE id = ?", id), "Scene not found.")
}

function mustShot(db, id) {
  return must(get(db, "SELECT * FROM shots WHERE id = ?", id), "Shot not found.")
}

export function shotContext(db, productionId, shotId) {
  const shot = mustShot(db, shotId)
  const scene = mustScene(db, shot.scene_id)
  if (scene.production_id !== productionId) throw new NotFoundError("Shot not found.")
  return { shot, scene, production: mustProduction(db, productionId) }
}

function mustDay(db, id) {
  return must(get(db, "SELECT * FROM shoot_days WHERE id = ?", id), "Shoot day not found.")
}

function sceneCount(db, productionId) {
  return get(db, "SELECT COUNT(*) AS c FROM scenes WHERE production_id = ?", productionId).c
}

function nextSort(db, table, column, parentId) {
  const row = get(db, `SELECT COALESCE(MAX(sort_order), 0) AS m FROM ${table} WHERE ${column} = ?`, parentId)
  return row.m + 1
}

function ensureLocation(db, productionId, name, notes = "") {
  if (!name) return null
  const existing = get(db, "SELECT id FROM locations WHERE production_id = ? AND name = ?", productionId, name)
  if (existing) return existing.id
  const count = get(db, "SELECT COUNT(*) AS c FROM locations WHERE production_id = ?", productionId).c
  if (count >= LIMITS.locationsPerProduction) throw new ValidationError("This production has reached the location limit.")
  const id = uid()
  try {
    run(db, "INSERT INTO locations (id, production_id, name, notes, revision) VALUES (?, ?, ?, ?, 1)", id, productionId, name, notes)
  } catch (error) {
    failConstraint(error)
  }
  return id
}

function ensureCharacter(db, productionId, name, notes = "") {
  if (!name) return null
  const existing = get(db, "SELECT id FROM characters WHERE production_id = ? AND name = ?", productionId, name)
  if (existing) return existing.id
  const count = get(db, "SELECT COUNT(*) AS c FROM characters WHERE production_id = ?", productionId).c
  if (count >= LIMITS.charactersPerProduction) throw new ValidationError("This production has reached the character limit.")
  const id = uid()
  try {
    run(db, "INSERT INTO characters (id, production_id, name, notes, revision) VALUES (?, ?, ?, ?, 1)", id, productionId, name, notes)
  } catch (error) {
    failConstraint(error)
  }
  return id
}

function replaceCharacters(db, sceneId, productionId, characterIds) {
  const unique = [...new Set(characterIds)]
  for (const characterId of unique) {
    const character = get(db, "SELECT * FROM characters WHERE id = ?", characterId)
    if (!character || character.production_id !== productionId) {
      throw new ValidationError("Choose characters from this production.")
    }
  }
  run(db, "DELETE FROM scene_characters WHERE scene_id = ?", sceneId)
  for (const characterId of unique) {
    try {
      run(db, "INSERT INTO scene_characters (scene_id, character_id) VALUES (?, ?)", sceneId, characterId)
    } catch (error) {
      failConstraint(error)
    }
  }
}

function resolveLocation(db, productionId, locationId, newName) {
  if (locationId && newName) throw new ValidationError("Choose a saved location or type a new one, not both.")
  if (newName) return ensureLocation(db, productionId, newName)
  if (!locationId) return null
  const location = get(db, "SELECT * FROM locations WHERE id = ?", locationId)
  if (!location || location.production_id !== productionId) throw new ValidationError("Choose a location from this production.")
  return location.id
}

export function listProductions(db) {
  return all(db, "SELECT * FROM productions ORDER BY updated_at DESC, name ASC")
}

export function createProduction(db, input) {
  const id = uid()
  const stamp = now()
  try {
    run(db, `INSERT INTO productions
      (id, name, timezone, logline, notes, revision, scene_order_revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)`,
      id, input.name, input.timezone, input.logline, input.notes.trim(), stamp, stamp)
  } catch (error) {
    failConstraint(error)
  }
  return id
}

export function updateProduction(db, productionId, input) {
  const current = mustProduction(db, productionId)
  try {
    transaction(db, () => {
      changed(run(db, `UPDATE productions
        SET name = ?, timezone = ?, logline = ?, notes = ?, revision = revision + 1, updated_at = ?
        WHERE id = ? AND revision = ?`,
        input.name, input.timezone, input.logline, input.notes.trim(), now(), productionId, input.revision))
    })
  } catch (error) {
    failConstraint(error)
  }
  return { timezoneChanged: current.timezone !== input.timezone }
}

export function deleteProduction(db, uploadDir, productionId, revision) {
  mustProduction(db, productionId)
  try {
    transaction(db, () => {
      changed(run(db, "UPDATE productions SET revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?", now(), productionId, revision))
      run(db, "DELETE FROM schedule_items WHERE shoot_day_id IN (SELECT id FROM shoot_days WHERE production_id = ?)", productionId)
      run(db, "DELETE FROM shoot_days WHERE production_id = ?", productionId)
      run(db, "DELETE FROM shots WHERE scene_id IN (SELECT id FROM scenes WHERE production_id = ?)", productionId)
      run(db, "DELETE FROM scene_characters WHERE scene_id IN (SELECT id FROM scenes WHERE production_id = ?)", productionId)
      run(db, "DELETE FROM scenes WHERE production_id = ?", productionId)
      run(db, "DELETE FROM storyboard_images WHERE production_id = ?", productionId)
      run(db, "DELETE FROM characters WHERE production_id = ?", productionId)
      run(db, "DELETE FROM locations WHERE production_id = ?", productionId)
      run(db, "DELETE FROM script_versions WHERE production_id = ?", productionId)
      run(db, "DELETE FROM import_previews WHERE production_id = ?", productionId)
      changed(run(db, "DELETE FROM productions WHERE id = ?", productionId))
    })
  } catch (error) {
    failConstraint(error)
  }
  removeProductionUploads(uploadDir, productionId)
}

export function listScenes(db, productionId) {
  return all(db, "SELECT * FROM scenes WHERE production_id = ? ORDER BY sort_order ASC, id ASC", productionId)
}

export function shotsForScene(db, sceneId) {
  return all(db, "SELECT * FROM shots WHERE scene_id = ? ORDER BY sort_order ASC, id ASC", sceneId)
}

export function createScene(db, productionId, input) {
  const id = uid()
  try {
    transaction(db, () => {
      const production = mustProduction(db, productionId)
      if (sceneCount(db, productionId) >= LIMITS.scenesPerProduction) {
        throw new ValidationError("This production has reached the scene limit.")
      }
      const locationId = resolveLocation(db, productionId, input.locationId, input.newLocationName)
      const stamp = now()
      run(db, `INSERT INTO scenes (
        id, production_id, script_version_id, display_number, heading, int_ext, location_id,
        story_time_of_day, script_text, synopsis, production_notes, shooting_duration_override_minutes,
        sort_order, revision, shot_order_revision, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
        id, productionId, input.displayNumber, input.heading, input.intExt, locationId,
        input.storyTime, input.scriptText, input.synopsis, input.productionNotes, input.durationOverride,
        nextSort(db, "scenes", "production_id", productionId), stamp, stamp)
      const characterIds = [...input.characterIds]
      if (input.newCharacterName) characterIds.push(ensureCharacter(db, productionId, input.newCharacterName))
      replaceCharacters(db, id, productionId, characterIds)
      changed(run(db, "UPDATE productions SET scene_order_revision = scene_order_revision + 1, updated_at = ? WHERE id = ? AND scene_order_revision = ?",
        stamp, productionId, production.scene_order_revision))
    })
  } catch (error) {
    failConstraint(error)
  }
  return id
}

export function updateScene(db, sceneId, input) {
  try {
    transaction(db, () => {
      const scene = mustScene(db, sceneId)
      const locationId = resolveLocation(db, scene.production_id, input.locationId, input.newLocationName)
      const stamp = now()
      changed(run(db, `UPDATE scenes SET
        display_number = ?, heading = ?, int_ext = ?, location_id = ?, story_time_of_day = ?,
        script_text = ?, synopsis = ?, production_notes = ?, shooting_duration_override_minutes = ?,
        revision = revision + 1, updated_at = ?
        WHERE id = ? AND revision = ?`,
        input.displayNumber, input.heading, input.intExt, locationId, input.storyTime,
        input.scriptText, input.synopsis, input.productionNotes, input.durationOverride,
        stamp, sceneId, input.revision))
      const characterIds = [...input.characterIds]
      if (input.newCharacterName) characterIds.push(ensureCharacter(db, scene.production_id, input.newCharacterName))
      replaceCharacters(db, sceneId, scene.production_id, characterIds)
      run(db, "UPDATE productions SET updated_at = ? WHERE id = ?", stamp, scene.production_id)
    })
  } catch (error) {
    failConstraint(error)
  }
}

export function deleteScene(db, uploadDir, sceneId, orderRevision) {
  const scene = mustScene(db, sceneId)
  const imageIds = all(db, "SELECT DISTINCT storyboard_image_id AS id FROM shots WHERE scene_id = ? AND storyboard_image_id IS NOT NULL", sceneId)
  try {
    transaction(db, () => {
      changed(run(db, "UPDATE productions SET scene_order_revision = scene_order_revision + 1, updated_at = ? WHERE id = ? AND scene_order_revision = ?",
        now(), scene.production_id, orderRevision))
      run(db, "DELETE FROM shots WHERE scene_id = ?", sceneId)
      run(db, "DELETE FROM scenes WHERE id = ?", sceneId)
    })
  } catch (error) {
    failConstraint(error)
  }
  releaseUnreferenced(db, uploadDir, imageIds.map((row) => row.id))
}

export function moveOrdered(db, kind, parentId, childId, direction, orderRevision) {
  const spec = ORDERING[kind]
  if (!spec) throw new ValidationError("Unknown list.")
  if (direction !== "up" && direction !== "down") throw new ValidationError("Choose up or down.")
  try {
    return transaction(db, () => {
      const parent = get(db, `SELECT ${spec.parentColumn} AS rev FROM ${spec.parent} WHERE id = ?`, parentId)
      if (!parent) throw new NotFoundError()
      if (parent.rev !== orderRevision) throw new ConflictError()
      const rows = all(db, `SELECT id FROM ${spec.child} WHERE ${spec.childColumn} = ? ORDER BY sort_order ASC, id ASC`, parentId)
      const index = rows.findIndex((row) => row.id === childId)
      if (index < 0) throw new NotFoundError()
      const target = direction === "up" ? index - 1 : index + 1
      if (target < 0 || target >= rows.length) return { moved: false }
      const next = rows.slice()
      const [row] = next.splice(index, 1)
      next.splice(target, 0, row)
      writeOrder(db, spec.child, next.map((item) => item.id))
      changed(run(db, `UPDATE ${spec.parent} SET ${spec.parentColumn} = ${spec.parentColumn} + 1 WHERE id = ? AND ${spec.parentColumn} = ?`, parentId, orderRevision))
      return { moved: true }
    })
  } catch (error) {
    failConstraint(error)
  }
}

function writeOrder(db, table, ids) {
  ids.forEach((id, index) => run(db, `UPDATE ${table} SET sort_order = ? WHERE id = ?`, -(index + 1), id))
  ids.forEach((id, index) => run(db, `UPDATE ${table} SET sort_order = ? WHERE id = ?`, index + 1, id))
}

export function createShot(db, sceneId, input) {
  const id = uid()
  try {
    transaction(db, () => {
      const scene = mustScene(db, sceneId)
      const count = get(db, "SELECT COUNT(*) AS c FROM shots WHERE scene_id = ?", sceneId).c
      if (count >= LIMITS.shotsPerScene) throw new ValidationError("This scene has reached the shot limit.")
      const stamp = now()
      run(db, `INSERT INTO shots (
        id, scene_id, display_label, description, shot_size, camera_angle, camera_movement, lens_note,
        shooting_duration_minutes, equipment_notes, storyboard_image_id, image_alt, planning_status,
        sort_order, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '', ?, ?, 1, ?, ?)`,
        id, sceneId, input.displayLabel, input.description, input.shotSize, input.cameraAngle, input.cameraMovement,
        input.lensNote, input.shootingDuration, input.equipmentNotes, input.planningStatus,
        nextSort(db, "shots", "scene_id", sceneId), stamp, stamp)
      changed(run(db, "UPDATE scenes SET shot_order_revision = shot_order_revision + 1, updated_at = ? WHERE id = ? AND shot_order_revision = ?",
        stamp, sceneId, input.orderRevision))
    })
  } catch (error) {
    failConstraint(error)
  }
  return id
}

export function updateShot(db, shotId, input) {
  try {
    transaction(db, () => {
      const shot = mustShot(db, shotId)
      const imageAlt = String(input.imageAlt || "")
      if (shot.storyboard_image_id && !imageAlt.trim()) {
        throw new ValidationError("Describe the storyboard image, or remove the image first.")
      }
      changed(run(db, `UPDATE shots SET
        display_label = ?, description = ?, shot_size = ?, camera_angle = ?, camera_movement = ?, lens_note = ?,
        shooting_duration_minutes = ?, equipment_notes = ?, planning_status = ?, image_alt = ?,
        revision = revision + 1, updated_at = ?
        WHERE id = ? AND revision = ?`,
        input.displayLabel, input.description, input.shotSize, input.cameraAngle, input.cameraMovement, input.lensNote,
        input.shootingDuration, input.equipmentNotes, input.planningStatus, imageAlt,
        now(), shotId, input.revision))
    })
  } catch (error) {
    failConstraint(error)
  }
}

export function duplicateShot(db, shotId, orderRevision) {
  const newId = uid()
  try {
    transaction(db, () => {
      const shot = mustShot(db, shotId)
      const scene = mustScene(db, shot.scene_id)
      if (scene.shot_order_revision !== orderRevision) throw new ConflictError()
      const count = get(db, "SELECT COUNT(*) AS c FROM shots WHERE scene_id = ?", scene.id).c
      if (count >= LIMITS.shotsPerScene) throw new ValidationError("This scene has reached the shot limit.")
      const label = (shot.display_label ? `${shot.display_label} copy` : "copy").slice(0, 40)
      const stamp = now()
      run(db, `INSERT INTO shots (
        id, scene_id, display_label, description, shot_size, camera_angle, camera_movement, lens_note,
        shooting_duration_minutes, equipment_notes, storyboard_image_id, image_alt, planning_status,
        sort_order, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, -1, 1, ?, ?)`,
        newId, scene.id, label, shot.description, shot.shot_size, shot.camera_angle, shot.camera_movement,
        shot.lens_note, shot.shooting_duration_minutes, shot.equipment_notes, shot.storyboard_image_id,
        shot.image_alt, shot.planning_status, stamp, stamp)
      const ids = shotsForScene(db, scene.id).map((row) => row.id).filter((id) => id !== newId)
      const index = ids.indexOf(shot.id)
      ids.splice(index + 1, 0, newId)
      writeOrder(db, "shots", ids)
      changed(run(db, "UPDATE scenes SET shot_order_revision = shot_order_revision + 1, updated_at = ? WHERE id = ? AND shot_order_revision = ?",
        stamp, scene.id, orderRevision))
    })
  } catch (error) {
    failConstraint(error)
  }
  return newId
}

export function moveShot(db, shotId, targetSceneId, input) {
  try {
    transaction(db, () => {
      const shot = mustShot(db, shotId)
      const source = mustScene(db, shot.scene_id)
      const target = mustScene(db, targetSceneId)
      if (source.production_id !== target.production_id) throw new ValidationError("Move the shot to a scene in the same production.")
      if (source.id === target.id) throw new ValidationError("Choose a different scene.")
      if (shot.revision !== input.revision) throw new ConflictError()
      if (source.shot_order_revision !== input.sourceOrderRevision) throw new ConflictError()
      if (target.shot_order_revision !== input.targetOrderRevision) throw new ConflictError()
      const targetCount = get(db, "SELECT COUNT(*) AS c FROM shots WHERE scene_id = ?", target.id).c
      if (targetCount >= LIMITS.shotsPerScene) throw new ValidationError("The destination scene has reached the shot limit.")
      const stamp = now()
      changed(run(db, `UPDATE shots SET scene_id = ?, sort_order = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?`,
        target.id, nextSort(db, "shots", "scene_id", target.id), stamp, shotId, input.revision))
      const sourceIds = shotsForScene(db, source.id).map((row) => row.id)
      writeOrder(db, "shots", sourceIds)
      changed(run(db, "UPDATE scenes SET shot_order_revision = shot_order_revision + 1, updated_at = ? WHERE id = ? AND shot_order_revision = ?",
        stamp, source.id, input.sourceOrderRevision))
      changed(run(db, "UPDATE scenes SET shot_order_revision = shot_order_revision + 1, updated_at = ? WHERE id = ? AND shot_order_revision = ?",
        stamp, target.id, input.targetOrderRevision))
    })
  } catch (error) {
    failConstraint(error)
  }
}

export function deleteShot(db, uploadDir, shotId, orderRevision) {
  const shot = mustShot(db, shotId)
  try {
    transaction(db, () => {
      const scene = mustScene(db, shot.scene_id)
      if (scene.shot_order_revision !== orderRevision) throw new ConflictError()
      run(db, "DELETE FROM shots WHERE id = ?", shotId)
      const ids = shotsForScene(db, scene.id).map((row) => row.id)
      writeOrder(db, "shots", ids)
      changed(run(db, "UPDATE scenes SET shot_order_revision = shot_order_revision + 1, updated_at = ? WHERE id = ? AND shot_order_revision = ?",
        now(), scene.id, orderRevision))
    })
  } catch (error) {
    failConstraint(error)
  }
  if (shot.storyboard_image_id) releaseUnreferenced(db, uploadDir, [shot.storyboard_image_id])
}

function displayFilename(name) {
  const base = path.basename(String(name || "upload")).replaceAll("\u0000", "")
  return base.slice(0, 240) || "upload"
}

export function saveShotImage(db, uploadDir, shotId, { bytes, filename, alt, revision }) {
  if (!String(alt || "").trim()) throw new ValidationError("Describe the image for someone who cannot see it.")
  const cleanAlt = readText(alt, { max: 300, label: "Image description", required: true })
  const shot = mustShot(db, shotId)
  const scene = mustScene(db, shot.scene_id)
  const transcoded = transcodeStoryboard(bytes, filename)
  const imageId = uid()
  writeImageFile(uploadDir, scene.production_id, transcoded.storageKey, transcoded.bytes)
  const previous = shot.storyboard_image_id
  try {
    transaction(db, () => {
      run(db, `INSERT INTO storyboard_images
        (id, production_id, storage_key, content_type, width, height, byte_size, original_filename, created_at)
        VALUES (?, ?, ?, 'image/png', ?, ?, ?, ?, ?)`,
        imageId, scene.production_id, transcoded.storageKey, transcoded.width, transcoded.height,
        transcoded.bytes.length, displayFilename(filename), now())
      changed(run(db, `UPDATE shots SET storyboard_image_id = ?, image_alt = ?, revision = revision + 1, updated_at = ?
        WHERE id = ? AND revision = ?`, imageId, cleanAlt, now(), shotId, revision))
    })
  } catch (error) {
    removeImageFile(uploadDir, scene.production_id, transcoded.storageKey)
    failConstraint(error)
  }
  if (previous) releaseUnreferenced(db, uploadDir, [previous])
  return imageId
}

export function clearShotImage(db, uploadDir, shotId, revision) {
  const shot = mustShot(db, shotId)
  const previous = shot.storyboard_image_id
  try {
    transaction(db, () => {
      changed(run(db, `UPDATE shots SET storyboard_image_id = NULL, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?`,
        now(), shotId, revision))
    })
  } catch (error) {
    failConstraint(error)
  }
  if (previous) releaseUnreferenced(db, uploadDir, [previous])
}

function releaseUnreferenced(db, uploadDir, imageIds) {
  for (const imageId of new Set(imageIds.filter(Boolean))) {
    const count = get(db, "SELECT COUNT(*) AS c FROM shots WHERE storyboard_image_id = ?", imageId)
    if (count.c > 0) continue
    const image = get(db, "SELECT * FROM storyboard_images WHERE id = ?", imageId)
    if (!image) continue
    run(db, "DELETE FROM storyboard_images WHERE id = ?", imageId)
    removeImageFile(uploadDir, image.production_id, image.storage_key)
  }
}

export function imageForRequest(db, uploadDir, imageId) {
  const image = get(db, "SELECT * FROM storyboard_images WHERE id = ?", imageId)
  if (!image) return null
  const bytes = readImageFile(uploadDir, image.production_id, image.storage_key)
  return { image, bytes }
}

export function listCharacters(db, productionId) {
  return all(db, "SELECT * FROM characters WHERE production_id = ? ORDER BY name ASC", productionId)
}

export function createCharacter(db, productionId, input) {
  mustProduction(db, productionId)
  return ensureCharacter(db, productionId, input.name, input.notes || "")
}

export function updateCharacter(db, characterId, input) {
  try {
    changed(run(db, "UPDATE characters SET name = ?, notes = ?, revision = revision + 1 WHERE id = ? AND revision = ?",
      input.name, input.notes, characterId, input.revision))
  } catch (error) {
    failConstraint(error)
  }
}

export function deleteCharacter(db, characterId, revision) {
  const character = must(get(db, "SELECT * FROM characters WHERE id = ?", characterId), "Character not found.")
  const used = all(db, `SELECT scenes.heading, scenes.display_number FROM scene_characters
    JOIN scenes ON scenes.id = scene_characters.scene_id
    WHERE scene_characters.character_id = ? ORDER BY scenes.sort_order ASC`, characterId)
  if (used.length) {
    const names = used.map((row) => `${row.display_number || "unnumbered"} ${row.heading}`).join(", ")
    throw new ValidationError(`Remove ${character.name} from these scenes before deleting the character: ${names}.`)
  }
  try {
    changed(run(db, "DELETE FROM characters WHERE id = ? AND revision = ?", characterId, revision))
  } catch (error) {
    failConstraint(error)
  }
}

export function listLocations(db, productionId) {
  return all(db, "SELECT * FROM locations WHERE production_id = ? ORDER BY name ASC", productionId)
}

export function createLocation(db, productionId, input) {
  mustProduction(db, productionId)
  return ensureLocation(db, productionId, input.name, input.notes || "")
}

export function updateLocation(db, locationId, input) {
  const location = must(get(db, "SELECT * FROM locations WHERE id = ?", locationId), "Location not found.")
  try {
    changed(run(db, "UPDATE locations SET name = ?, notes = ?, revision = revision + 1 WHERE id = ? AND revision = ?",
      input.name, input.notes, locationId, input.revision))
  } catch (error) {
    failConstraint(error)
  }
  return location
}

export function deleteLocation(db, locationId, revision) {
  const location = must(get(db, "SELECT * FROM locations WHERE id = ?", locationId), "Location not found.")
  const used = all(db, "SELECT display_number, heading FROM scenes WHERE location_id = ? ORDER BY sort_order ASC", locationId)
  if (used.length) {
    const names = used.map((row) => `${row.display_number || "unnumbered"} ${row.heading}`).join(", ")
    throw new ValidationError(`Reassign these scenes before deleting ${location.name}: ${names}.`)
  }
  try {
    changed(run(db, "DELETE FROM locations WHERE id = ? AND revision = ?", locationId, revision))
  } catch (error) {
    failConstraint(error)
  }
}

export function sceneCharacters(db, sceneId) {
  return all(db, `SELECT characters.* FROM scene_characters
    JOIN characters ON characters.id = scene_characters.character_id
    WHERE scene_characters.scene_id = ? ORDER BY characters.name ASC`, sceneId)
}

export function sceneBundle(db, sceneId) {
  const scene = mustScene(db, sceneId)
  const production = mustProduction(db, scene.production_id)
  const shots = shotsForScene(db, sceneId).map((shot) => ({
    ...shot,
    image: shot.storyboard_image_id ? get(db, "SELECT * FROM storyboard_images WHERE id = ?", shot.storyboard_image_id) : null,
  }))
  const duration = sceneDuration(scene, shots)
  const scriptVersion = scene.script_version_id
    ? get(db, "SELECT id, created_at, source_kind, original_filename FROM script_versions WHERE id = ?", scene.script_version_id)
    : null
  return {
    production,
    scene,
    shots,
    duration,
    characters: listCharacters(db, production.id),
    selected: new Set(sceneCharacters(db, sceneId).map((row) => row.id)),
    locations: listLocations(db, production.id),
    scenes: listScenes(db, production.id),
    scriptVersion,
  }
}

function assertDayCapacity(db, productionId) {
  const count = get(db, "SELECT COUNT(*) AS c FROM shoot_days WHERE production_id = ?", productionId).c
  if (count >= LIMITS.daysPerProduction) throw new ValidationError("This production has reached the shoot-day limit.")
}

export function createShootDay(db, productionId, input) {
  const production = mustProduction(db, productionId)
  if (input.maxMinutes === 0) throw new ValidationError("Leave the maximum blank, or enter at least 1 minute.")
  const start = interpretLocal(production.timezone, input.localDate, input.localStartTime)
  if (!start.ok) throw new ValidationError(start.message)
  const id = uid()
  const stamp = now()
  run(db, `INSERT INTO shoot_days (
    id, production_id, local_date, local_start_time, label, max_planned_duration_minutes, notes,
    schedule_order_revision, revision, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
    id, productionId, input.localDate, input.localStartTime, input.label, input.maxMinutes, input.notes.trim(), stamp, stamp)
  return id
}

export function updateShootDay(db, dayId, input) {
  if (input.maxMinutes === 0) throw new ValidationError("Leave the maximum blank, or enter at least 1 minute.")
  try {
    transaction(db, () => {
      const day = mustDay(db, dayId)
      const production = mustProduction(db, day.production_id)
      const start = interpretLocal(production.timezone, input.localDate, input.localStartTime)
      if (!start.ok) throw new ValidationError(start.message)
      changed(run(db, `UPDATE shoot_days SET
        local_date = ?, local_start_time = ?, label = ?, max_planned_duration_minutes = ?, notes = ?,
        revision = revision + 1, updated_at = ?
        WHERE id = ? AND revision = ?`,
        input.localDate, input.localStartTime, input.label, input.maxMinutes, input.notes.trim(), now(), dayId, input.revision))
      const timingChanged = day.local_date !== input.localDate || day.local_start_time !== input.localStartTime
      if (timingChanged) {
        const calc = dayView(db, dayId).calc
        if (calc.status === "invalid") throw new ValidationError(calc.reason)
      }
    })
  } catch (error) {
    failConstraint(error)
  }
}

export function deleteShootDay(db, dayId, revision) {
  mustDay(db, dayId)
  try {
    transaction(db, () => {
      changed(run(db, "UPDATE shoot_days SET revision = revision + 1 WHERE id = ? AND revision = ?", dayId, revision))
      run(db, "DELETE FROM schedule_items WHERE shoot_day_id = ?", dayId)
      changed(run(db, "DELETE FROM shoot_days WHERE id = ?", dayId))
    })
  } catch (error) {
    failConstraint(error)
  }
}

export function addSceneToDay(db, dayId, sceneId, orderRevision) {
  try {
    transaction(db, () => {
      const day = mustDay(db, dayId)
      const scene = mustScene(db, sceneId)
      if (scene.production_id !== day.production_id) throw new ValidationError("Choose a scene from this production.")
      const count = get(db, "SELECT COUNT(*) AS c FROM schedule_items WHERE shoot_day_id = ?", dayId).c
      if (count >= LIMITS.itemsPerDay) throw new ValidationError("This shoot day has reached the item limit.")
      if (day.schedule_order_revision !== orderRevision) throw new ConflictError()
      const existing = get(db, "SELECT id FROM schedule_items WHERE scene_id = ?", sceneId)
      if (existing) throw new ValidationError("That scene is already assigned to a shoot day. Each scene can be scheduled once.")
      run(db, `INSERT INTO schedule_items (id, shoot_day_id, kind, scene_id, label, duration_minutes, sort_order, revision)
        VALUES (?, ?, 'scene_work', ?, '', NULL, ?, 1)`, uid(), dayId, sceneId, nextSort(db, "schedule_items", "shoot_day_id", dayId))
      changed(run(db, "UPDATE shoot_days SET schedule_order_revision = schedule_order_revision + 1, updated_at = ? WHERE id = ? AND schedule_order_revision = ?",
        now(), dayId, orderRevision))
      const calc = dayView(db, dayId).calc
      if (calc.status === "invalid") throw new ValidationError(calc.reason)
    })
  } catch (error) {
    failConstraint(error)
  }
}

export function addActivityToDay(db, dayId, input) {
  try {
    transaction(db, () => {
      const day = mustDay(db, dayId)
      const count = get(db, "SELECT COUNT(*) AS c FROM schedule_items WHERE shoot_day_id = ?", dayId).c
      if (count >= LIMITS.itemsPerDay) throw new ValidationError("This shoot day has reached the item limit.")
      if (day.schedule_order_revision !== input.orderRevision) throw new ConflictError()
      run(db, `INSERT INTO schedule_items (id, shoot_day_id, kind, scene_id, label, duration_minutes, sort_order, revision)
        VALUES (?, ?, ?, NULL, ?, ?, ?, 1)`,
        uid(), dayId, input.kind, input.label, input.durationMinutes, nextSort(db, "schedule_items", "shoot_day_id", dayId))
      changed(run(db, "UPDATE shoot_days SET schedule_order_revision = schedule_order_revision + 1, updated_at = ? WHERE id = ? AND schedule_order_revision = ?",
        now(), dayId, input.orderRevision))
      const calc = dayView(db, dayId).calc
      if (calc.status === "invalid") throw new ValidationError(calc.reason)
    })
  } catch (error) {
    failConstraint(error)
  }
}

export function updateActivity(db, itemId, input) {
  try {
    transaction(db, () => {
      const item = must(get(db, "SELECT * FROM schedule_items WHERE id = ?", itemId), "Schedule item not found.")
      if (item.kind === "scene_work") throw new ValidationError("Scene timing comes from the scene and its shots. Edit those estimates instead.")
      changed(run(db, `UPDATE schedule_items SET label = ?, duration_minutes = ?, revision = revision + 1 WHERE id = ? AND revision = ?`,
        input.label, input.durationMinutes, itemId, input.revision))
      const calc = dayView(db, item.shoot_day_id).calc
      if (calc.status === "invalid") throw new ValidationError(calc.reason)
    })
  } catch (error) {
    failConstraint(error)
  }
}

export function deleteScheduleItem(db, itemId, orderRevision) {
  const item = must(get(db, "SELECT * FROM schedule_items WHERE id = ?", itemId), "Schedule item not found.")
  try {
    transaction(db, () => {
      const day = mustDay(db, item.shoot_day_id)
      if (day.schedule_order_revision !== orderRevision) throw new ConflictError()
      run(db, "DELETE FROM schedule_items WHERE id = ?", itemId)
      const ids = all(db, "SELECT id FROM schedule_items WHERE shoot_day_id = ? ORDER BY sort_order ASC, id ASC", day.id).map((row) => row.id)
      writeOrder(db, "schedule_items", ids)
      changed(run(db, "UPDATE shoot_days SET schedule_order_revision = schedule_order_revision + 1, updated_at = ? WHERE id = ? AND schedule_order_revision = ?",
        now(), day.id, orderRevision))
    })
  } catch (error) {
    failConstraint(error)
  }
}

export function dayView(db, dayId) {
  const day = mustDay(db, dayId)
  const production = mustProduction(db, day.production_id)
  const rows = all(db, "SELECT * FROM schedule_items WHERE shoot_day_id = ? ORDER BY sort_order ASC, id ASC", dayId)
  const items = rows.map((item) => {
    if (item.kind !== "scene_work") {
      return {
        ...item,
        sceneId: null,
        label: item.label,
        durationMinutes: item.duration_minutes,
        durationSource: "item",
        locationId: null,
        locationName: null,
        sceneHeading: item.label,
        displayNumber: "",
        storyTime: "",
        partialMinutes: null,
      }
    }
    const scene = mustScene(db, item.scene_id)
    const shots = shotsForScene(db, scene.id)
    const duration = sceneDuration(scene, shots)
    const location = scene.location_id ? get(db, "SELECT * FROM locations WHERE id = ?", scene.location_id) : null
    return {
      ...item,
      sceneId: scene.id,
      label: scene.heading,
      durationMinutes: duration.known ? duration.minutes : null,
      durationSource: duration.source,
      locationId: scene.location_id,
      locationName: location?.name || "",
      sceneHeading: scene.heading,
      displayNumber: scene.display_number,
      storyTime: scene.story_time_of_day,
      partialMinutes: duration.partialMinutes,
      scene,
      shots,
    }
  })
  const calc = calculateSchedule({
    zone: production.timezone,
    localDate: day.local_date,
    localStartTime: day.local_start_time,
    items,
    maxMinutes: day.max_planned_duration_minutes,
  })
  return { day, production, calc, unscheduled: unscheduledScenes(db, production.id) }
}

export function unscheduledScenes(db, productionId) {
  return all(db, `SELECT scenes.* FROM scenes
    WHERE scenes.production_id = ?
      AND NOT EXISTS (SELECT 1 FROM schedule_items WHERE schedule_items.scene_id = scenes.id)
    ORDER BY scenes.sort_order ASC`, productionId)
}

export function listDays(db, productionId) {
  return all(db, "SELECT * FROM shoot_days WHERE production_id = ? ORDER BY local_date ASC, local_start_time ASC, id ASC", productionId)
    .map((day) => dayView(db, day.id))
}

function shotWarnings(scene, shots) {
  const warnings = []
  const duration = sceneDuration(scene, shots)
  if (!duration.known) {
    const partial = duration.partialMinutes ? ` At least ${duration.partialMinutes} entered minutes are recorded, and that partial sum is not used as the scene duration.` : ""
    warnings.push({
      code: "unknown-duration",
      text: `${sceneLabel(scene)} has an unknown shooting duration.${partial}`,
    })
  } else if (duration.minutes === 0) {
    warnings.push({ code: "zero-estimate", text: `${sceneLabel(scene)} has a zero-minute shooting estimate.` })
  }
  for (const shot of shots) {
    const label = shot.display_label || "Untitled shot"
    if (shot.shooting_duration_minutes === null) {
      warnings.push({ code: "missing-shot-estimate", text: `${sceneLabel(scene)}, shot ${label}: shooting duration is missing.` })
    } else if (shot.shooting_duration_minutes === 0) {
      warnings.push({ code: "zero-shot-estimate", text: `${sceneLabel(scene)}, shot ${label}: shooting duration is zero minutes.` })
    }
  }
  return warnings
}

function sceneLabel(scene) {
  return `Scene ${scene.display_number || "unnumbered"} (${scene.heading})`
}

export function productionWarnings(db, productionId) {
  const scenes = listScenes(db, productionId)
  const warnings = []
  const scheduled = new Set(all(db, `SELECT scene_id AS id FROM schedule_items
    JOIN shoot_days ON shoot_days.id = schedule_items.shoot_day_id
    WHERE shoot_days.production_id = ? AND scene_id IS NOT NULL`, productionId).map((row) => row.id))
  for (const scene of scenes) {
    const shots = shotsForScene(db, scene.id)
    if (!scheduled.has(scene.id)) warnings.push({ code: "unscheduled", text: `${sceneLabel(scene)} is not on a shoot day.` })
    warnings.push(...shotWarnings(scene, shots))
  }
  for (const view of listDays(db, productionId)) {
    const prefix = view.day.label ? `${view.day.local_date} ${view.day.label}` : view.day.local_date
    for (const warning of scheduleWarnings(view.calc)) {
      warnings.push({ ...warning, text: `${prefix}: ${warning.text}` })
    }
  }
  return warnings
}

export function scheduleWarnings(calc) {
  const warnings = []
  if (calc.status === "invalid") warnings.push({ code: "invalid-schedule", text: calc.reason })
  if (calc.status === "incomplete") warnings.push({ code: "incomplete-schedule", text: calc.reason })
  if (calc.exceedsMax) {
    warnings.push({ code: "max-exceeded", text: "Known estimates exceed this shoot day's maximum planned duration." })
  } else if (calc.maxUnconfirmed) {
    warnings.push({ code: "max-unconfirmed", text: "The maximum planned duration cannot be confirmed because a duration is missing." })
  }
  let previous = null
  for (const item of calc.items) {
    if (item.kind !== "scene_work") {
      if (item.durationMinutes === 0) warnings.push({ code: "zero-estimate", text: `${item.label || "Activity"} is zero minutes.` })
      previous = null
      continue
    }
    if (!item.locationId) {
      warnings.push({ code: "missing-location", text: `${item.displayNumber || "Unnumbered"} ${item.sceneHeading} has no location.` })
    }
    if (previous?.locationId && item.locationId && previous.locationId !== item.locationId) {
      warnings.push({
        code: "location-change",
        text: `Planning reminder: location changes from ${previous.locationName} to ${item.locationName} between adjacent scene-work items. This is not a travel-time calculation.`,
      })
    }
    previous = item
  }
  return warnings
}

export function purgeExpiredPreviews(db) {
  const cutoff = new Date(Date.now() - LIMITS.previewHours * 3600 * 1000).toISOString()
  run(db, "DELETE FROM import_previews WHERE created_at < ?", cutoff)
}

export function createScriptPreview(db, { productionId = null, mode, name = "", timezone = "", logline = "", sourceKind, filename = "", text }) {
  const parsed = parseScript(text)
  const id = uid()
  run(db, `INSERT INTO import_previews (
    id, production_id, mode, new_name, new_timezone, new_logline, source_kind, original_filename, original_text, payload_json, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, productionId, mode, name, timezone, logline, sourceKind, filename, text, JSON.stringify(parsed), now())
  return { id, parsed }
}

export function previewFromUpload(db, input) {
  const text = typeof input.text === "string"
    ? decodeScriptBuffer(Buffer.from(input.text, "utf8"))
    : decodeScriptBuffer(input.buffer, input.filename)
  if (input.productionId) {
    const production = mustProduction(db, input.productionId)
    if (sceneCount(db, production.id) > 0) {
      throw new ValidationError("This production already has scenes. Import creates a new production instead of merging or replacing planning data.")
    }
    return createScriptPreview(db, {
      productionId: production.id,
      mode: "existing",
      sourceKind: input.sourceKind,
      filename: input.filename || "",
      text,
    })
  }
  return createScriptPreview(db, {
    mode: "new",
    name: input.name,
    timezone: input.timezone,
    logline: input.logline || "",
    sourceKind: input.sourceKind,
    filename: input.filename || "",
    text,
  })
}

export function getPreview(db, id) {
  const preview = must(get(db, "SELECT * FROM import_previews WHERE id = ?", id), "Import preview not found or expired.")
  return { ...preview, payload: JSON.parse(preview.payload_json) }
}

export function readScriptCommit(body, payload) {
  const preamble = readText(scalar(body, "preamble"), { max: LIMITS.scriptBytes, label: "Unassigned text", trim: false })
  const scenes = []
  const held = []
  payload.scenes.forEach((detected, index) => {
    const include = scalar(body, `scene_${index}_include`) === "yes"
    const scriptText = readText(scalar(body, `scene_${index}_text`), { max: LIMITS.scriptField, label: `Scene ${index + 1} text`, trim: false })
    const heading = readText(scalar(body, `scene_${index}_heading`), { max: 240, label: `Scene ${index + 1} heading`, required: include })
    const record = {
      displayNumber: readText(scalar(body, `scene_${index}_number`), { max: 12, label: `Scene ${index + 1} number` }),
      intExt: scalar(body, `scene_${index}_int_ext`) || "OTHER",
      locationName: readText(scalar(body, `scene_${index}_location`), { max: LIMITS.short, label: `Scene ${index + 1} location` }),
      storyTime: readText(scalar(body, `scene_${index}_time`), { max: 80, label: `Scene ${index + 1} time of day` }),
      heading,
      scriptText,
    }
    if (!["INT", "EXT", "INT_EXT", "EST", "OTHER"].includes(record.intExt)) {
      throw new ValidationError(`Scene ${index + 1} has an unknown interior/exterior value.`)
    }
    if (!include) {
      if ((detected.scriptText || detected.heading) && !`${scriptText}${heading}`.trim()) {
        throw new ValidationError(`Scene ${index + 1} was excluded, but its text was missing from the form. Reload the preview so nothing is dropped.`)
      }
      const block = [heading, scriptText].filter((part) => part && part.trim()).join("\n")
      if (block.trim()) held.push(block)
      return
    }
    scenes.push(record)
  })
  for (let extra = 0; extra < 3; extra += 1) {
    const heading = readText(scalar(body, `extra_${extra}_heading`), { max: 240, label: `Extra scene ${extra + 1} heading` })
    const scriptText = readText(scalar(body, `extra_${extra}_text`), { max: LIMITS.scriptField, label: `Extra scene ${extra + 1} text`, trim: false })
    if (!heading && !scriptText.trim()) continue
    if (!heading) throw new ValidationError("An extra scene has text but no heading. Add a heading or clear the text. Nothing was saved.")
    const intExt = scalar(body, `extra_${extra}_int_ext`) || "INT"
    if (!["INT", "EXT", "INT_EXT", "EST", "OTHER"].includes(intExt)) throw new ValidationError("Extra scene has an unknown interior/exterior value.")
    scenes.push({
      displayNumber: readText(scalar(body, `extra_${extra}_number`), { max: 12, label: "Extra scene number" }),
      intExt,
      locationName: readText(scalar(body, `extra_${extra}_location`), { max: LIMITS.short, label: "Extra scene location" }),
      storyTime: readText(scalar(body, `extra_${extra}_time`), { max: 80, label: "Extra scene time of day" }),
      heading,
      scriptText,
    })
  }
  if (!scenes.length) throw new ValidationError("Keep at least one scene before saving. Nothing was saved.")
  if (scenes.length > LIMITS.scenesPerProduction) throw new ValidationError("That import has too many scenes.")
  const committedPreamble = [preamble, ...held].filter((part) => part && String(part).trim()).join("\n\n")
  return { committedPreamble, scenes }
}

export function commitScriptPreview(db, previewId, body) {
  try {
    return transaction(db, () => {
      const preview = getPreview(db, previewId)
      if (preview.mode === "json") throw new ValidationError("This preview is not a script import.")
      const edited = readScriptCommit(body, preview.payload)
      let productionId = preview.production_id
      if (preview.mode === "new") {
        productionId = createProduction(db, {
          name: preview.new_name,
          timezone: preview.new_timezone,
          logline: preview.new_logline,
          notes: "Created from a script import. The original text is preserved as a script version.",
        })
      } else if (sceneCount(db, productionId) > 0) {
        throw new ValidationError("This production now has scenes. Sceneplan did not merge or replace them. Start a new production from the import.")
      }
      const versionId = uid()
      run(db, `INSERT INTO script_versions
        (id, production_id, original_text, source_kind, original_filename, committed_preamble, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        versionId, productionId, preview.original_text, preview.source_kind, preview.original_filename, edited.committedPreamble, now())
      edited.scenes.forEach((scene, index) => {
        const sceneId = uid()
        const locationId = scene.locationName ? ensureLocation(db, productionId, scene.locationName) : null
        const stamp = now()
        run(db, `INSERT INTO scenes (
          id, production_id, script_version_id, display_number, heading, int_ext, location_id,
          story_time_of_day, script_text, synopsis, production_notes, shooting_duration_override_minutes,
          sort_order, revision, shot_order_revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', NULL, ?, 1, 1, ?, ?)`,
          sceneId, productionId, versionId, scene.displayNumber, scene.heading, scene.intExt, locationId,
          scene.storyTime, scene.scriptText, index + 1, stamp, stamp)
      })
      run(db, "UPDATE productions SET scene_order_revision = scene_order_revision + 1, updated_at = ? WHERE id = ?", now(), productionId)
      run(db, "DELETE FROM import_previews WHERE id = ?", previewId)
      return productionId
    })
  } catch (error) {
    failConstraint(error)
  }
}

export function listScriptVersions(db, productionId) {
  return all(db, "SELECT * FROM script_versions WHERE production_id = ? ORDER BY created_at ASC, id ASC", productionId)
}

export function getScriptVersion(db, productionId, versionId) {
  const version = must(get(db, "SELECT * FROM script_versions WHERE id = ? AND production_id = ?", versionId, productionId), "Script version not found.")
  return version
}

export function knownImageKeys(db) {
  return all(db, "SELECT production_id, storage_key FROM storyboard_images").map((row) => `${row.production_id}/${row.storage_key}`)
}

export function workspaceScenes(db, productionId, query = "") {
  const needle = query.trim().toLowerCase()
  const characters = listCharacters(db, productionId)
  const locations = listLocations(db, productionId)
  const locationName = new Map(locations.map((row) => [row.id, row.name]))
  const links = all(db, `SELECT scene_characters.scene_id, characters.name FROM scene_characters
    JOIN characters ON characters.id = scene_characters.character_id
    JOIN scenes ON scenes.id = scene_characters.scene_id
    WHERE scenes.production_id = ?`, productionId)
  const namesByScene = new Map()
  for (const link of links) {
    const list = namesByScene.get(link.scene_id) || []
    list.push(link.name)
    namesByScene.set(link.scene_id, list)
  }
  return listScenes(db, productionId).filter((scene) => {
    if (!needle) return true
    const haystack = [
      scene.display_number,
      scene.heading,
      scene.script_text,
      scene.synopsis,
      scene.production_notes,
      scene.story_time_of_day,
      locationName.get(scene.location_id) || "",
      ...(namesByScene.get(scene.id) || []),
    ].join("\n").toLowerCase()
    return haystack.includes(needle)
  }).map((scene) => ({
    ...scene,
    locationName: locationName.get(scene.location_id) || "",
    characterNames: namesByScene.get(scene.id) || [],
    duration: sceneDuration(scene, shotsForScene(db, scene.id)),
  }))
}

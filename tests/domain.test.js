import assert from "node:assert/strict"
import test from "node:test"
import { PNG } from "pngjs"
import { existsSync } from "node:fs"
import { openDatabase, run, transaction } from "../src/db.js"
import { tempApp } from "./helpers.js"
import {
  addActivityToDay,
  addSceneToDay,
  commitScriptPreview,
  createCharacter,
  createLocation,
  createProduction,
  createScene,
  createShootDay,
  createShot,
  dayView,
  deleteCharacter,
  deleteScene,
  deleteShot,
  duplicateShot,
  moveOrdered,
  mustProduction,
  previewFromUpload,
  productionWarnings,
  saveShotImage,
  updateProduction,
  updateScene,
  updateShot,
} from "../src/domain.js"
import { exportProduction, importTransfer } from "../src/transfer.js"
import { ConflictError, ValidationError } from "../src/errors.js"

function pngBuffer() {
  const png = new PNG({ width: 8, height: 6 })
  for (let i = 0; i < 8 * 6; i += 1) {
    png.data[i * 4] = 80
    png.data[i * 4 + 1] = 20
    png.data[i * 4 + 2] = 40
    png.data[i * 4 + 3] = 255
  }
  return PNG.sync.write(png)
}

function production(db, name = "Test film") {
  return createProduction(db, { name, timezone: "America/New_York", logline: "", notes: "" })
}

function sceneInput(extra = {}) {
  return {
    displayNumber: "1",
    heading: "INT. ROOM - DAY",
    intExt: "INT",
    locationId: "",
    newLocationName: "",
    storyTime: "DAY",
    scriptText: "Action.",
    synopsis: "",
    productionNotes: "",
    durationOverride: null,
    characterIds: [],
    newCharacterName: "",
    ...extra,
  }
}

function shotInput(orderRevision, extra = {}) {
  return {
    displayLabel: "1A",
    description: "Wide room",
    shotSize: "Wide",
    cameraAngle: "Eye level",
    cameraMovement: "Static",
    lensNote: "",
    shootingDuration: 10,
    equipmentNotes: "",
    planningStatus: "planned",
    imageAlt: "",
    orderRevision,
    ...extra,
  }
}

test("persists productions and rejects stale scene edits", () => {
  const app = tempApp()
  try {
    const id = production(app.db)
    app.db.close()
    const reopened = openDatabase(`${app.dir}/sceneplan.sqlite`)
    assert.equal(mustProduction(reopened, id).name, "Test film")
    const sceneId = createScene(reopened, id, sceneInput())
    updateScene(reopened, sceneId, sceneInput({ heading: "INT. ROOM - NIGHT", revision: 1 }))
    assert.throws(() => updateScene(reopened, sceneId, sceneInput({ heading: "INT. OTHER - DAY", revision: 1 })), ConflictError)
    assert.equal(mustProduction(reopened, id).name, "Test film")
    reopened.close()
  } finally {
    app.close()
  }
})

test("shot order, duplication, and shared images survive deleting one shot", () => {
  const app = tempApp()
  try {
    const id = production(app.db)
    const sceneId = createScene(app.db, id, sceneInput())
    const first = createShot(app.db, sceneId, shotInput(1, { displayLabel: "1A", shootingDuration: 4 }))
    const second = createShot(app.db, sceneId, shotInput(2, { displayLabel: "1B", shootingDuration: 6 }))
    assert.throws(() => moveOrdered(app.db, "shots", sceneId, second, "up", 1), ConflictError)
    const moved = moveOrdered(app.db, "shots", sceneId, second, "up", 3)
    assert.equal(moved.moved, true)
    saveShotImage(app.db, app.uploadDir, first, { bytes: pngBuffer(), filename: "../../<img>.png", alt: "A red frame", revision: 1 })
    const copyId = duplicateShot(app.db, first, 4)
    const copy = app.db.prepare("SELECT * FROM shots WHERE id = ?").get(copyId)
    const original = app.db.prepare("SELECT * FROM shots WHERE id = ?").get(first)
    assert.equal(copy.storyboard_image_id, original.storyboard_image_id)
    assert.notEqual(copy.id, original.id)
    deleteShot(app.db, app.uploadDir, first, 5)
    const still = app.db.prepare("SELECT * FROM shots WHERE id = ?").get(copyId)
    assert.ok(still.storyboard_image_id)
    const image = app.db.prepare("SELECT * FROM storyboard_images WHERE id = ?").get(still.storyboard_image_id)
    assert.equal(existsSync(`${app.uploadDir}/${id}/${image.storage_key}`), true)
    assert.equal(image.storage_key.includes(".."), false)
    deleteShot(app.db, app.uploadDir, copyId, 6)
    assert.equal(app.db.prepare("SELECT COUNT(*) AS c FROM storyboard_images").get().c, 0)
    assert.equal(existsSync(`${app.uploadDir}/${id}/${image.storage_key}`), false)
  } finally {
    app.close()
  }
})

test("schedule assignment, live estimates, and deletion rules", () => {
  const app = tempApp()
  try {
    const id = production(app.db)
    const locationId = createLocation(app.db, id, { name: "Kitchen", notes: "" })
    const characterId = createCharacter(app.db, id, { name: "Ada", notes: "" })
    const sceneId = createScene(app.db, id, sceneInput({ locationId, characterIds: [characterId], durationOverride: 25 }))
    createShot(app.db, sceneId, shotInput(1, { shootingDuration: 5 }))
    const other = createScene(app.db, id, sceneInput({ heading: "EXT. STREET - NIGHT", intExt: "EXT", displayNumber: "2", storyTime: "NIGHT" }))
    const dayId = createShootDay(app.db, id, {
      localDate: "2026-04-18",
      localStartTime: "16:00",
      label: "Main",
      maxMinutes: 480,
      notes: "",
    })
    addSceneToDay(app.db, dayId, sceneId, 1)
    assert.throws(() => addSceneToDay(app.db, dayId, sceneId, 2), ValidationError)
    addActivityToDay(app.db, dayId, { kind: "break", label: "Meal", durationMinutes: 20, orderRevision: 2 })
    const view = dayView(app.db, dayId)
    assert.equal(view.calc.status, "valid")
    assert.equal(view.calc.items[0].durationSource, "override")
    assert.equal(view.calc.items[0].endLabel, "16:25")
    updateShot(app.db, app.db.prepare("SELECT id FROM shots").get().id, shotInput(1, { shootingDuration: 90, revision: 1 }))
    const after = dayView(app.db, dayId)
    assert.equal(after.calc.items[0].endLabel, "16:25")
    updateScene(app.db, sceneId, sceneInput({ locationId, characterIds: [characterId], durationOverride: null, revision: 1 }))
    const live = dayView(app.db, dayId)
    assert.equal(live.calc.items[0].durationSource, "shots")
    assert.equal(live.calc.items[0].endLabel, "17:30")
    assert.throws(() => deleteCharacter(app.db, characterId, 1), /Remove Ada/)
    assert.throws(() => createShootDay(app.db, id, {
      localDate: "2026-03-08",
      localStartTime: "02:30",
      label: "",
      maxMinutes: null,
      notes: "",
    }), /does not exist/)
    const otherProd = production(app.db, "Other")
    assert.throws(() => run(app.db, "UPDATE scenes SET location_id = ? WHERE id = ?", createLocation(app.db, otherProd, { name: "Elsewhere", notes: "" }), sceneId), /cross-production/)
    deleteScene(app.db, app.uploadDir, sceneId, mustProduction(app.db, id).scene_order_revision)
    assert.equal(app.db.prepare("SELECT COUNT(*) AS c FROM shots WHERE scene_id = ?").get(sceneId).c, 0)
    assert.equal(app.db.prepare("SELECT COUNT(*) AS c FROM schedule_items WHERE scene_id = ?").get(sceneId).c, 0)
    assert.ok(app.db.prepare("SELECT id FROM scenes WHERE id = ?").get(other))
    deleteCharacter(app.db, characterId, 1)
    assert.equal(app.db.prepare("SELECT COUNT(*) AS c FROM characters WHERE id = ?").get(characterId).c, 0)
  } finally {
    app.close()
  }
})

test("script import preserves the snapshot and refuses to replace scenes", () => {
  const app = tempApp()
  try {
    const id = production(app.db)
    const text = "Title page\n\nINT. KITCHEN - DAY\nAda waits.\n\nEXT. STREET - NIGHT\nRain."
    const preview = previewFromUpload(app.db, { productionId: id, sourceKind: "paste", text })
    assert.match(preview.parsed.preamble, /Title page/)
    const body = {
      preamble: preview.parsed.preamble,
      scene_0_include: "yes",
      scene_0_number: "1",
      scene_0_int_ext: "INT",
      scene_0_location: "Kitchen",
      scene_0_time: "DAY",
      scene_0_heading: "INT. KITCHEN - DAY",
      scene_0_text: "Ada waits.",
      scene_1_include: "yes",
      scene_1_number: "2",
      scene_1_int_ext: "EXT",
      scene_1_location: "Street",
      scene_1_time: "NIGHT",
      scene_1_heading: "EXT. STREET - NIGHT",
      scene_1_text: "Rain.",
    }
    commitScriptPreview(app.db, preview.id, body)
    const version = app.db.prepare("SELECT * FROM script_versions").get()
    assert.equal(version.original_text, text)
    updateScene(app.db, app.db.prepare("SELECT id FROM scenes ORDER BY sort_order LIMIT 1").get().id, sceneInput({
      heading: "INT. KITCHEN - LATER",
      scriptText: "Changed planning text",
      revision: 1,
    }))
    assert.equal(app.db.prepare("SELECT original_text FROM script_versions").get().original_text, text)
    assert.throws(() => previewFromUpload(app.db, { productionId: id, sourceKind: "paste", text: "INT. NEW - DAY\nNope." }), /already has scenes/)
    assert.equal(app.db.prepare("SELECT COUNT(*) AS c FROM scenes").get().c, 2)
    assert.throws(() => decodeCall(), /UTF-8/)
    function decodeCall() {
      previewFromUpload(app.db, { productionId: production(app.db, "Empty"), sourceKind: "upload", filename: "bad.txt", buffer: Buffer.from([0xff, 0x80]) })
    }
    assert.equal(app.db.prepare("SELECT COUNT(*) AS c FROM script_versions").get().c, 1)
  } finally {
    app.close()
  }
})

test("a failed import commit does not leave a partial production", () => {
  const app = tempApp()
  try {
    const before = app.db.prepare("SELECT COUNT(*) AS c FROM productions").get().c
    assert.throws(() => transaction(app.db, () => {
      production(app.db)
      throw new ValidationError("stop")
    }), /stop/)
    assert.equal(app.db.prepare("SELECT COUNT(*) AS c FROM productions").get().c, before)
  } finally {
    app.close()
  }
})

test("json export and import remaps ids and omits image files", () => {
  const app = tempApp()
  try {
    const id = production(app.db)
    const sceneId = createScene(app.db, id, sceneInput())
    const shotId = createShot(app.db, sceneId, shotInput(1))
    saveShotImage(app.db, app.uploadDir, shotId, { bytes: pngBuffer(), filename: "frame.png", alt: "Frame", revision: 1 })
    const dayId = createShootDay(app.db, id, { localDate: "2026-04-18", localStartTime: "10:00", label: "", maxMinutes: null, notes: "" })
    addSceneToDay(app.db, dayId, sceneId, 1)
    const payload = exportProduction(app.db, id)
    assert.equal(payload.includesImageFiles, false)
    assert.equal(payload.shots[0].storyboardImageId == null, false)
    const imported = importTransfer(app.db, payload)
    assert.notEqual(imported.productionId, id)
    assert.equal(imported.omittedImageRefs, 1)
    const copyShot = app.db.prepare("SELECT * FROM shots WHERE scene_id IN (SELECT id FROM scenes WHERE production_id = ?)").get(imported.productionId)
    assert.equal(copyShot.storyboard_image_id, null)
    assert.equal(copyShot.description, "Wide room")
    assert.notEqual(copyShot.id, shotId)
  } finally {
    app.close()
  }
})

test("timezone changes keep local clock fields", () => {
  const app = tempApp()
  try {
    const id = production(app.db)
    const dayId = createShootDay(app.db, id, { localDate: "2026-04-18", localStartTime: "16:00", label: "Main", maxMinutes: null, notes: "" })
    const result = updateProduction(app.db, id, { name: "Test film", timezone: "Europe/Paris", logline: "", notes: "", revision: 1 })
    assert.equal(result.timezoneChanged, true)
    const day = app.db.prepare("SELECT * FROM shoot_days WHERE id = ?").get(dayId)
    assert.equal(day.local_date, "2026-04-18")
    assert.equal(day.local_start_time, "16:00")
    assert.equal(productionWarnings(app.db, id).some((warning) => warning.code === "unscheduled"), false)
  } finally {
    app.close()
  }
})

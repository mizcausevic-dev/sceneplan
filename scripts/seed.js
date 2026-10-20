import { PNG } from "pngjs"
import { resolveConfig } from "../src/config.js"
import { get, openDatabase } from "../src/db.js"
import {
  addActivityToDay,
  addSceneToDay,
  createCharacter,
  createLocation,
  createProduction,
  createScene,
  createShootDay,
  createShot,
  duplicateShot,
  saveShotImage,
} from "../src/domain.js"
import { mkdirSync } from "node:fs"

const NAME = "Paper Boats on Mercer Street"

function boatPng() {
  const width = 320
  const height = 180
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (width * y + x) << 2
      const sky = y < 110
      png.data[i] = sky ? 11 : 31
      png.data[i + 1] = sky ? 18 : 40
      png.data[i + 2] = sky ? 32 : 46
      png.data[i + 3] = 255
      const fold = Math.abs(x - 160) < (110 - Math.abs(y - 128)) * 1.4 && y > 112 && y < 150
      if (fold) {
        png.data[i] = 102
        png.data[i + 1] = 252
        png.data[i + 2] = 241
      }
    }
  }
  return PNG.sync.write(png)
}

function blankScene(extra) {
  return {
    newLocationName: "",
    newCharacterName: "",
    scriptText: "",
    synopsis: "",
    productionNotes: "Fictional demonstration content. Durations are planning estimates.",
    durationOverride: null,
    characterIds: [],
    ...extra,
  }
}

function blankShot(extra) {
  return {
    displayLabel: "",
    description: "",
    shotSize: "",
    cameraAngle: "",
    cameraMovement: "",
    lensNote: "",
    shootingDuration: null,
    equipmentNotes: "",
    planningStatus: "planned",
    imageAlt: "",
    ...extra,
  }
}

const config = resolveConfig()
mkdirSync(config.uploadDir, { recursive: true })
const db = openDatabase(config.dbPath)
const existing = get(db, "SELECT id FROM productions WHERE name = ?", NAME)
if (existing) {
  console.log(`Seed already present: ${existing.id}`)
  db.close()
  process.exit(0)
}

const productionId = createProduction(db, {
  name: NAME,
  timezone: "America/New_York",
  logline: "On one night, Ada Vuk and her brother Leo try to float a paper boat farther than the corner.",
  notes: "Fictional demonstration content for Sceneplan. Not a real production, not a schedule recommendation, and not a record of anyone's shoot.",
})

const mercer = createLocation(db, productionId, { name: "Mercer Street", notes: "Fictional block. Wet pavement, one working streetlight." })
const laundry = createLocation(db, productionId, { name: "Corner Laundromat", notes: "Fictional interior. Fluorescent, one broken dryer." })
const river = createLocation(db, productionId, { name: "River Walk", notes: "Fictional path below the street. No permit implied." })
const bus = createLocation(db, productionId, { name: "City Bus", notes: "Fictional interior. Last northbound run." })
const ada = createCharacter(db, productionId, { name: "Ada Vuk", notes: "Fictional. Twelve. Keeps the boat in a coat pocket." })
const leo = createCharacter(db, productionId, { name: "Leo Vuk", notes: "Fictional. Sixteen. Has the apartment key." })
const rios = createCharacter(db, productionId, { name: "Miss Rios", notes: "Fictional. Closes the laundromat." })

function addScene(input) {
  return createScene(db, productionId, blankScene(input))
}

function addShot(sceneId, input) {
  const scene = get(db, "SELECT shot_order_revision FROM scenes WHERE id = ?", sceneId)
  return createShot(db, sceneId, blankShot({ ...input, orderRevision: scene.shot_order_revision }))
}

const scene1 = addScene({
  displayNumber: "1",
  heading: "EXT. MERCER STREET - DUSK",
  intExt: "EXT",
  locationId: mercer,
  storyTime: "DUSK",
  synopsis: "Ada and Leo leave the building with the boat still dry.",
  scriptText: "ADA folds the boat once more. LEO watches the street, not the paper.",
  characterIds: [ada, leo],
})
addShot(scene1, { displayLabel: "1A", description: "Wide of the stoop as the door closes behind them.", shotSize: "Wide", cameraAngle: "Eye level", cameraMovement: "Static", shootingDuration: 8, planningStatus: "ready" })
addShot(scene1, { displayLabel: "1B", description: "Ada's hands hide the boat in her coat.", shotSize: "Insert", cameraAngle: "High", cameraMovement: "Static", shootingDuration: 6, planningStatus: "planned" })
addShot(scene1, { displayLabel: "1C", description: "Leo looks back at a dark window.", shotSize: "Close-up", cameraAngle: "Eye level", cameraMovement: "Handheld", shootingDuration: 4, planningStatus: "planned" })

const scene2 = addScene({
  displayNumber: "2",
  heading: "INT. CORNER LAUNDROMAT - NIGHT",
  intExt: "INT",
  locationId: laundry,
  storyTime: "NIGHT",
  synopsis: "Rain sends them inside. Miss Rios is counting quarters.",
  scriptText: "The boat sits on a dryer. MISS RIOS does not ask whose it is.",
  characterIds: [ada, rios],
})
addShot(scene2, { displayLabel: "2A", description: "Establishing view through the wet window.", shotSize: "Establishing", cameraAngle: "Eye level", cameraMovement: "Static", shootingDuration: 10, planningStatus: "ready" })
addShot(scene2, { displayLabel: "2B", description: "Miss Rios slides a quarter back across the counter.", shotSize: "Medium", cameraAngle: "Eye level", cameraMovement: "Static", shootingDuration: 8, planningStatus: "planned" })
const shot2c = addShot(scene2, {
  displayLabel: "2C",
  description: "The paper boat on the dryer, slightly open.",
  shotSize: "Insert",
  cameraAngle: "Overhead",
  cameraMovement: "Static",
  lensNote: "50mm",
  shootingDuration: 5,
  planningStatus: "ready",
  imageAlt: "Placeholder drawing of a folded paper boat on a dark dryer.",
})
const scene2Row = get(db, "SELECT shot_order_revision FROM scenes WHERE id = ?", scene2)
const shot2cRow = get(db, "SELECT revision FROM shots WHERE id = ?", shot2c)
saveShotImage(db, config.uploadDir, shot2c, {
  bytes: boatPng(),
  filename: "paper-boat.png",
  alt: "Placeholder drawing of a folded paper boat on a dark dryer.",
  revision: shot2cRow.revision,
})
duplicateShot(db, shot2c, scene2Row.shot_order_revision)

const scene3 = addScene({
  displayNumber: "3",
  heading: "EXT. RIVER WALK - NIGHT",
  intExt: "EXT",
  locationId: river,
  storyTime: "NIGHT",
  synopsis: "They reach the water. The override covers the whole setup, not the sum of the shots.",
  scriptText: "ADA sets the boat down. It turns once and keeps going.",
  productionNotes: "Fictional demonstration. Shooting duration override is 40 minutes and wins over the shot sum.",
  durationOverride: 40,
  characterIds: [ada, leo],
})
addShot(scene3, { displayLabel: "3A", description: "Low track along the railing.", shotSize: "Medium wide", cameraAngle: "Low", cameraMovement: "Dolly", shootingDuration: 12, planningStatus: "idea" })
addShot(scene3, { displayLabel: "3B", description: "The boat leaves Ada's hand.", shotSize: "Close-up", cameraAngle: "Eye level", cameraMovement: "Static", shootingDuration: 9, planningStatus: "planned" })
addShot(scene3, { displayLabel: "3C", description: "Leo's face as the boat gets small.", shotSize: "Close-up", cameraAngle: "Eye level", cameraMovement: "Static", shootingDuration: 7, planningStatus: "planned" })

const scene4 = addScene({
  displayNumber: "4",
  heading: "INT. CITY BUS - NIGHT",
  intExt: "INT",
  locationId: bus,
  storyTime: "NIGHT",
  synopsis: "The ride between the laundromat and the river.",
  scriptText: "They do not talk. The boat is wet at one corner.",
  characterIds: [ada, leo],
})
addShot(scene4, { displayLabel: "4A", description: "Across the aisle, both of them in one seat.", shotSize: "Medium", cameraAngle: "Eye level", cameraMovement: "Handheld", shootingDuration: 7, planningStatus: "planned" })
addShot(scene4, { displayLabel: "4B", description: "Street lights pass the window.", shotSize: "Insert", cameraAngle: "Eye level", cameraMovement: "Pan", shootingDuration: 5, planningStatus: "idea" })
addShot(scene4, { displayLabel: "4C", description: "Ada checks the boat is still in the pocket.", shotSize: "Close-up", cameraAngle: "High", cameraMovement: "Static", shootingDuration: 6, planningStatus: "planned" })

const scene5 = addScene({
  displayNumber: "5",
  heading: "EXT. MERCER STREET - DAWN",
  intExt: "EXT",
  locationId: mercer,
  storyTime: "DAWN",
  synopsis: "Unscheduled on purpose, with one missing estimate and one zero-minute estimate.",
  scriptText: "The stoop is empty. A wet corner of paper is stuck to the step.",
  productionNotes: "Fictional demonstration. Left off the shoot day so the unscheduled warning is visible.",
  characterIds: [ada],
})
addShot(scene5, { displayLabel: "5A", description: "The empty stoop. Duration intentionally blank.", shotSize: "Wide", cameraAngle: "Eye level", cameraMovement: "Static", shootingDuration: null, planningStatus: "idea" })
addShot(scene5, { displayLabel: "5B", description: "A held frame on the paper scrap. Entered as zero minutes, which is an estimate, not a missing value.", shotSize: "Insert", cameraAngle: "High", cameraMovement: "Static", shootingDuration: 0, planningStatus: "idea" })

const dayId = createShootDay(db, productionId, {
  localDate: "2026-04-18",
  localStartTime: "16:00",
  label: "Main unit",
  maxMinutes: 480,
  notes: "Fictional demonstration schedule. Times are planning estimates in America/New_York. They are not a call sheet and they do not reflect labor, safety, or travel rules.",
})

function dayRevision() {
  return get(db, "SELECT schedule_order_revision FROM shoot_days WHERE id = ?", dayId).schedule_order_revision
}

addActivityToDay(db, dayId, { kind: "setup_move", label: "Load in at Mercer Street", durationMinutes: 30, orderRevision: dayRevision() })
addSceneToDay(db, dayId, scene1, dayRevision())
addSceneToDay(db, dayId, scene2, dayRevision())
addActivityToDay(db, dayId, { kind: "setup_move", label: "Company move to the bus", durationMinutes: 20, orderRevision: dayRevision() })
addSceneToDay(db, dayId, scene4, dayRevision())
addActivityToDay(db, dayId, { kind: "break", label: "Meal break", durationMinutes: 40, orderRevision: dayRevision() })
addActivityToDay(db, dayId, { kind: "setup_move", label: "Company move to the river walk", durationMinutes: 25, orderRevision: dayRevision() })
addSceneToDay(db, dayId, scene3, dayRevision())

console.log(`Seeded fictional production ${productionId}`)
db.close()

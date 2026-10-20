import { LIMITS, SHOT_SIZES, CAMERA_ANGLES, CAMERA_MOVES, PLANNING_STATUSES, INT_EXT, ITEM_KINDS } from "./limits.js"
import { ValidationError } from "./errors.js"
import { isTimezone } from "./time.js"

export function scalar(body, name) {
  const value = body?.[name]
  if (Array.isArray(value)) return value[0] ?? ""
  return value ?? ""
}

export function many(body, name) {
  const value = body?.[name]
  if (value == null || value === "") return []
  return (Array.isArray(value) ? value : [value]).map(String).filter((item) => item !== "")
}

export function readText(value, { max, label, required = false, trim = true } = {}) {
  let text = String(value ?? "")
  if (text.includes("\u0000")) throw new ValidationError(`${label} contains an invalid character.`)
  if (trim) text = text.trim()
  if (required && text.length === 0) throw new ValidationError(`${label} is required.`)
  if (text.length > max) throw new ValidationError(`${label} must be ${max} characters or fewer.`)
  return text
}

export function readRevision(body, name = "revision") {
  const raw = String(scalar(body, name)).trim()
  if (!/^\d+$/.test(raw)) throw new ValidationError("Missing revision. Reload the page.")
  const value = Number(raw)
  if (!Number.isSafeInteger(value)) throw new ValidationError("Missing revision. Reload the page.")
  return value
}

export function readDuration(value, { allowBlank = true, label = "Duration" } = {}) {
  const raw = String(value ?? "").trim()
  if (raw === "") {
    if (allowBlank) return null
    throw new ValidationError(`${label} is required.`)
  }
  if (!/^\d+$/.test(raw)) throw new ValidationError(`${label} must be a whole number of minutes.`)
  const number = Number(raw)
  if (number > LIMITS.durationMax) {
    throw new ValidationError(`${label} must be from 0 through ${LIMITS.durationMax} minutes.`)
  }
  return number
}

export function readChoice(value, options, { label, allowBlank = false } = {}) {
  const raw = String(value ?? "").trim()
  if (raw === "" && allowBlank) return ""
  const allowed = options.map((option) => typeof option === "string" ? option : option.value)
  if (!allowed.includes(raw)) throw new ValidationError(`Choose a ${label} from the list.`)
  return raw
}

export function readTimezone(value) {
  const zone = String(value ?? "").trim()
  if (!isTimezone(zone)) throw new ValidationError("Choose a valid IANA timezone.")
  return zone
}

export function readProductionInput(body, { revision = false } = {}) {
  return {
    name: readText(scalar(body, "name"), { max: LIMITS.name, label: "Production name", required: true }),
    timezone: readTimezone(scalar(body, "timezone")),
    logline: readText(scalar(body, "logline"), { max: LIMITS.logline, label: "Logline" }),
    notes: readText(scalar(body, "notes"), { max: LIMITS.notes, label: "Notes", trim: false }),
    revision: revision ? readRevision(body) : undefined,
  }
}

export function readSceneInput(body, { revision = false, orderRevision = false } = {}) {
  return {
    displayNumber: readText(scalar(body, "display_number"), { max: 12, label: "Scene number" }),
    heading: readText(scalar(body, "heading"), { max: 240, label: "Heading", required: true }),
    intExt: readChoice(scalar(body, "int_ext"), INT_EXT, { label: "interior or exterior" }),
    locationId: String(scalar(body, "location_id") || "").trim(),
    newLocationName: readText(scalar(body, "new_location_name"), { max: LIMITS.short, label: "New location" }),
    storyTime: readText(scalar(body, "story_time_of_day"), { max: 80, label: "Story time of day" }),
    scriptText: readText(scalar(body, "script_text"), { max: LIMITS.scriptField, label: "Script text", trim: false }),
    synopsis: readText(scalar(body, "synopsis"), { max: 5000, label: "Synopsis", trim: false }),
    productionNotes: readText(scalar(body, "production_notes"), { max: LIMITS.notes, label: "Production notes", trim: false }),
    durationOverride: readDuration(scalar(body, "shooting_duration_override_minutes"), { label: "Shooting duration override" }),
    characterIds: many(body, "character_ids"),
    newCharacterName: readText(scalar(body, "new_character_name"), { max: LIMITS.short, label: "New character" }),
    revision: revision ? readRevision(body) : undefined,
    orderRevision: orderRevision ? readRevision(body, "order_revision") : undefined,
  }
}

export function readShotInput(body, { revision = false, orderRevision = false } = {}) {
  return {
    displayLabel: readText(scalar(body, "display_label"), { max: 40, label: "Shot label" }),
    description: readText(scalar(body, "description"), { max: LIMITS.description, label: "Description", trim: false }),
    shotSize: readChoice(scalar(body, "shot_size"), SHOT_SIZES, { label: "shot size", allowBlank: true }),
    cameraAngle: readChoice(scalar(body, "camera_angle"), CAMERA_ANGLES, { label: "camera angle", allowBlank: true }),
    cameraMovement: readChoice(scalar(body, "camera_movement"), CAMERA_MOVES, { label: "camera movement", allowBlank: true }),
    lensNote: readText(scalar(body, "lens_note"), { max: 120, label: "Lens note" }),
    shootingDuration: readDuration(scalar(body, "shooting_duration_minutes"), { label: "Shooting duration" }),
    equipmentNotes: readText(scalar(body, "equipment_notes"), { max: 2000, label: "Equipment notes", trim: false }),
    planningStatus: readChoice(scalar(body, "planning_status") || "planned", PLANNING_STATUSES, { label: "planning status" }),
    imageAlt: readText(scalar(body, "image_alt"), { max: 300, label: "Image description" }),
    revision: revision ? readRevision(body) : undefined,
    orderRevision: orderRevision ? readRevision(body, "order_revision") : undefined,
  }
}

export function readShootDayInput(body, { revision = false } = {}) {
  return {
    localDate: readText(scalar(body, "local_date"), { max: 10, label: "Date", required: true }),
    localStartTime: readText(scalar(body, "local_start_time"), { max: 5, label: "Start time", required: true }),
    label: readText(scalar(body, "label"), { max: 120, label: "Day label" }),
    maxMinutes: readDuration(scalar(body, "max_planned_duration_minutes"), { label: "Maximum planned duration" }),
    notes: readText(scalar(body, "notes"), { max: LIMITS.notes, label: "Notes", trim: false }),
    revision: revision ? readRevision(body) : undefined,
  }
}

export function readActivityInput(body) {
  const kind = readChoice(scalar(body, "kind"), ITEM_KINDS.filter((item) => item.value !== "scene_work"), { label: "activity" })
  return {
    kind,
    label: readText(scalar(body, "label"), { max: LIMITS.short, label: "Activity label", required: true }),
    durationMinutes: readDuration(scalar(body, "duration_minutes"), { allowBlank: false, label: "Activity duration" }),
    orderRevision: readRevision(body, "order_revision"),
  }
}

export function statusLabel(value) {
  return PLANNING_STATUSES.find((item) => item.value === value)?.label || value
}

export function intExtLabel(value) {
  return INT_EXT.find((item) => item.value === value)?.label || value
}

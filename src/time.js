import { DateTime } from "luxon"

const ZONES = new Set(Intl.supportedValuesOf("timeZone"))

export function isTimezone(value) {
  return typeof value === "string" && ZONES.has(value)
}

export function timezoneNames() {
  return [...ZONES]
}

function partsMatch(dt, parts) {
  return dt.year === parts.year
    && dt.month === parts.month
    && dt.day === parts.day
    && dt.hour === parts.hour
    && dt.minute === parts.minute
}

function parseDateParts(localDate, localTime) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate)
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(localTime)
  if (!dateMatch || !timeMatch) return null
  const parts = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
  }
  if (parts.hour > 23 || parts.minute > 59) return null
  const check = DateTime.fromObject(
    { year: parts.year, month: parts.month, day: parts.day },
    { zone: "utc" },
  )
  if (!check.isValid || check.year !== parts.year || check.month !== parts.month || check.day !== parts.day) {
    return null
  }
  return parts
}

function offsetsNear(zone, utcMillis) {
  const offsets = new Set()
  for (let t = utcMillis - 36 * 3600 * 1000; t <= utcMillis + 36 * 3600 * 1000; t += 15 * 60 * 1000) {
    offsets.add(DateTime.fromMillis(t, { zone }).offset)
  }
  return offsets
}

export function interpretLocal(zone, localDate, localTime) {
  if (!isTimezone(zone)) {
    return { ok: false, code: "timezone", message: "Choose a valid IANA timezone, such as America/New_York." }
  }
  const parts = parseDateParts(localDate, localTime)
  if (!parts) {
    return { ok: false, code: "format", message: "Use a real calendar date and a 24-hour start time like 07:30." }
  }
  const asUtc = DateTime.fromObject({ ...parts, second: 0, millisecond: 0 }, { zone: "utc" })
  const matches = []
  for (const offset of offsetsNear(zone, asUtc.toMillis())) {
    const utcMillis = asUtc.toMillis() - offset * 60 * 1000
    const zoned = DateTime.fromMillis(utcMillis, { zone })
    if (partsMatch(zoned, parts)) matches.push(zoned)
  }
  const unique = []
  for (const match of matches) {
    if (!unique.some((item) => item.toMillis() === match.toMillis())) unique.push(match)
  }
  if (unique.length === 0) {
    return {
      ok: false,
      code: "nonexistent",
      message: `This start time does not exist in ${zone}. Clocks skip this local time when the offset changes. Pick a start time that the local clock actually reaches.`,
    }
  }
  if (unique.length > 1) {
    return {
      ok: false,
      code: "ambiguous",
      message: `This start time is ambiguous in ${zone}. Clocks repeat this local time when the offset changes. Pick a different start time.`,
    }
  }
  return { ok: true, dateTime: unique[0] }
}

export function formatLocalTime(dateTime) {
  return dateTime.toFormat("HH:mm")
}

export function nextLocalMidnight(dateTime) {
  return dateTime.startOf("day").plus({ days: 1 })
}

export function explainInvalidSchedule(code, zone) {
  if (code === "transition") {
    return `This shoot day is not valid. Sceneplan does not schedule through a timezone offset change in ${zone}. Split the work or choose a start time that stays on one offset.`
  }
  if (code === "midnight") {
    return "This schedule reaches or crosses local midnight. Sceneplan keeps each shoot day inside one local calendar date. Shorten the day or move later work to the next date."
  }
  return "This schedule is not valid."
}

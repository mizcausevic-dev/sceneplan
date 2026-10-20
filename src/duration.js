import { explainInvalidSchedule, formatLocalTime, interpretLocal, nextLocalMidnight } from "./time.js"

export function sceneDuration(scene, shots) {
  const override = scene.shooting_duration_override_minutes
  if (override !== null && override !== undefined) {
    return {
      minutes: override,
      source: "override",
      known: true,
      incomplete: false,
      partialMinutes: null,
    }
  }
  if (!shots.length) {
    return {
      minutes: null,
      source: "unknown",
      known: false,
      incomplete: true,
      partialMinutes: null,
    }
  }
  let sum = 0
  let missing = false
  for (const shot of shots) {
    if (shot.shooting_duration_minutes === null || shot.shooting_duration_minutes === undefined) missing = true
    else sum += shot.shooting_duration_minutes
  }
  if (missing) {
    return {
      minutes: null,
      source: "shots",
      known: false,
      incomplete: true,
      partialMinutes: sum,
    }
  }
  return {
    minutes: sum,
    source: "shots",
    known: true,
    incomplete: false,
    partialMinutes: null,
  }
}

export function durationLabel(duration) {
  if (!duration.known) {
    if (duration.partialMinutes) {
      return `Incomplete, at least ${duration.partialMinutes} min entered`
    }
    return "Unknown duration"
  }
  if (duration.source === "override") return `${duration.minutes} min override`
  return `${duration.minutes} min from shots`
}

export function calculateSchedule({ zone, localDate, localStartTime, items, maxMinutes = null }) {
  const start = interpretLocal(zone, localDate, localStartTime)
  const blankItems = items.map((item) => ({
    ...item,
    startLabel: null,
    endLabel: null,
    timing: "not-calculated",
  }))
  if (!start.ok) {
    return {
      status: "invalid",
      reason: start.message,
      reasonCode: start.code,
      items: blankItems,
      exceedsMax: false,
      maxUnconfirmed: false,
      knownMinutes: 0,
      totalKnown: false,
    }
  }

  const startDt = start.dateTime
  const midnight = nextLocalMidnight(startDt)
  let cursor = startDt
  let stopped = false
  let knownMinutes = 0
  let totalKnown = true
  const evaluated = []

  for (const item of items) {
    const minutes = item.durationMinutes
    if (stopped) {
      totalKnown = false
      evaluated.push({ ...item, startLabel: null, endLabel: null, timing: "not-calculated" })
      continue
    }
    const startLabel = formatLocalTime(cursor)
    if (minutes === null || minutes === undefined) {
      totalKnown = false
      stopped = true
      evaluated.push({ ...item, startLabel, endLabel: null, timing: "incomplete" })
      continue
    }
    const next = cursor.plus({ minutes })
    if (next.offset !== startDt.offset) {
      return {
        status: "invalid",
        reason: explainInvalidSchedule("transition", zone),
        reasonCode: "transition",
        items: blankItems,
        exceedsMax: false,
        maxUnconfirmed: !totalKnown,
        knownMinutes,
        totalKnown: false,
      }
    }
    if (next.toMillis() >= midnight.toMillis()) {
      return {
        status: "invalid",
        reason: explainInvalidSchedule("midnight", zone),
        reasonCode: "midnight",
        items: blankItems,
        exceedsMax: false,
        maxUnconfirmed: false,
        knownMinutes,
        totalKnown: false,
      }
    }
    knownMinutes += minutes
    evaluated.push({
      ...item,
      startLabel,
      endLabel: formatLocalTime(next),
      timing: "exact",
    })
    cursor = next
  }

  const status = totalKnown ? "valid" : "incomplete"
  let exceedsMax = false
  let maxUnconfirmed = false
  if (maxMinutes !== null && maxMinutes !== undefined) {
    if (!totalKnown) {
      maxUnconfirmed = true
      if (knownMinutes > maxMinutes) exceedsMax = true
    } else if (knownMinutes > maxMinutes) {
      exceedsMax = true
    }
  }

  return {
    status,
    reason: status === "incomplete"
      ? "Timing is incomplete because a duration is missing. Earlier times are shown. Later times are not calculated. Missing durations are not treated as zero."
      : null,
    reasonCode: status === "incomplete" ? "incomplete" : null,
    items: evaluated,
    exceedsMax,
    maxUnconfirmed,
    knownMinutes,
    totalKnown,
  }
}

import assert from "node:assert/strict"
import test from "node:test"
import { calculateSchedule, sceneDuration } from "../src/duration.js"
import { interpretLocal } from "../src/time.js"

test("uses the scene override ahead of shot sums and treats missing sums as unknown", () => {
  const override = sceneDuration({ shooting_duration_override_minutes: 40 }, [
    { shooting_duration_minutes: 10 },
    { shooting_duration_minutes: 5 },
  ])
  assert.equal(override.minutes, 40)
  assert.equal(override.source, "override")

  const derived = sceneDuration({ shooting_duration_override_minutes: null }, [
    { shooting_duration_minutes: 10 },
    { shooting_duration_minutes: 5 },
  ])
  assert.equal(derived.minutes, 15)
  assert.equal(derived.known, true)

  const incomplete = sceneDuration({ shooting_duration_override_minutes: null }, [
    { shooting_duration_minutes: 10 },
    { shooting_duration_minutes: null },
  ])
  assert.equal(incomplete.known, false)
  assert.equal(incomplete.partialMinutes, 10)

  const empty = sceneDuration({ shooting_duration_override_minutes: null }, [])
  assert.equal(empty.known, false)
  assert.equal(empty.minutes, null)

  const zero = sceneDuration({ shooting_duration_override_minutes: 0 }, [])
  assert.equal(zero.known, true)
  assert.equal(zero.minutes, 0)
})

test("rejects nonexistent and ambiguous local start times", () => {
  const gap = interpretLocal("America/New_York", "2026-03-08", "02:30")
  assert.equal(gap.ok, false)
  assert.equal(gap.code, "nonexistent")
  const fold = interpretLocal("America/New_York", "2026-11-01", "01:30")
  assert.equal(fold.ok, false)
  assert.equal(fold.code, "ambiguous")
  const fine = interpretLocal("America/New_York", "2026-04-18", "16:00")
  assert.equal(fine.ok, true)
})

test("calculates live times until an unknown duration and does not treat it as zero", () => {
  const calc = calculateSchedule({
    zone: "America/New_York",
    localDate: "2026-04-18",
    localStartTime: "16:00",
    items: [
      { id: "a", durationMinutes: 30, kind: "break", locationId: null },
      { id: "b", durationMinutes: null, kind: "scene_work", locationId: "l1" },
      { id: "c", durationMinutes: 20, kind: "scene_work", locationId: "l2" },
    ],
  })
  assert.equal(calc.status, "incomplete")
  assert.equal(calc.items[0].startLabel, "16:00")
  assert.equal(calc.items[0].endLabel, "16:30")
  assert.equal(calc.items[1].startLabel, "16:30")
  assert.equal(calc.items[1].endLabel, null)
  assert.equal(calc.items[2].timing, "not-calculated")
  assert.equal(calc.items[2].startLabel, null)
})

test("rejects schedules that reach midnight or cross a timezone offset change", () => {
  const midnight = calculateSchedule({
    zone: "America/New_York",
    localDate: "2026-04-18",
    localStartTime: "23:30",
    items: [{ id: "a", durationMinutes: 30, kind: "break" }],
  })
  assert.equal(midnight.status, "invalid")
  assert.equal(midnight.reasonCode, "midnight")
  assert.equal(midnight.items[0].startLabel, null)

  const spring = calculateSchedule({
    zone: "America/New_York",
    localDate: "2026-03-08",
    localStartTime: "01:30",
    items: [{ id: "a", durationMinutes: 60, kind: "break" }],
  })
  assert.equal(spring.status, "invalid")
  assert.equal(spring.reasonCode, "transition")

  const fall = calculateSchedule({
    zone: "America/New_York",
    localDate: "2026-11-01",
    localStartTime: "00:30",
    items: [{ id: "a", durationMinutes: 90, kind: "break" }],
  })
  assert.equal(fall.status, "invalid")
  assert.equal(fall.reasonCode, "transition")
})

test("warns when known minutes exceed the maximum without failing a same-day plan", () => {
  const calc = calculateSchedule({
    zone: "America/New_York",
    localDate: "2026-04-18",
    localStartTime: "09:00",
    maxMinutes: 20,
    items: [{ id: "a", durationMinutes: 30, kind: "break" }],
  })
  assert.equal(calc.status, "valid")
  assert.equal(calc.exceedsMax, true)
  assert.equal(calc.items[0].endLabel, "09:30")
})
